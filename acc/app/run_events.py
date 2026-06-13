from __future__ import annotations

import json
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from acc.agent_events import ensure_agent_event_projection


@dataclass(frozen=True)
class NodeIdentity:
    run_id: str
    node_id: str
    node_dir: Path
    ui_node_id: str | None = None
    parent_node_id: str | None = None
    call_depth: int = 0

    @property
    def node_run_dir(self) -> str:
        return str(self.node_dir.resolve())

    def stream_identity(self) -> dict[str, str]:
        identity: dict[str, str] = {}
        if self.ui_node_id:
            identity["ui_node_id"] = self.ui_node_id
        if self.parent_node_id:
            identity["parent_node_id"] = self.parent_node_id
        if self.call_depth:
            identity["node_run_dir"] = self.node_run_dir
        return identity


class RunEventProjectionService:
    """Read-only projection over run, node, nested workflow, and agent-turn evidence."""

    def __init__(self, run_dir: Path) -> None:
        self.run_dir = run_dir.resolve()
        self.run_id = self.run_dir.name

    def iter_node_identities(self) -> list[NodeIdentity]:
        identities: list[NodeIdentity] = []
        for node_dir in iter_node_dirs(self.run_dir):
            identity = NodeIdentity(
                run_id=self.run_id,
                node_id=node_dir.name,
                node_dir=node_dir.resolve(),
            )
            identities.append(identity)
            nested_run_dir = node_dir / "nested_workflow"
            if nested_run_dir.exists() and nested_run_dir.is_dir():
                identities.extend(
                    self._iter_nested_node_identities(
                        nested_run_dir,
                        parent_ui_node_id=node_dir.name,
                        call_depth=1,
                    )
                )
        return identities

    def read_run_events_with_nested(self, *, limit: int) -> list[dict[str, Any]]:
        ordered_events: list[tuple[tuple[str, int], int, dict[str, Any]]] = []
        sequence = 0
        for event in read_jsonl_tolerant(self.run_dir / "events.jsonl", limit=limit):
            ordered_events.append((event_sort_key(event), sequence, event))
            sequence += 1

        for nested_event in self.read_nested_workflow_events(limit=limit):
            ordered_events.append((event_sort_key(nested_event), sequence, nested_event))
            sequence += 1

        ordered_events.sort(key=lambda item: (item[0], item[1]))
        return [event for _, _, event in ordered_events[-limit:]]

    def read_nested_workflow_events(self, *, limit: int) -> list[dict[str, Any]]:
        return self._read_nested_workflow_events(
            self.run_dir,
            parent_ui_node_id=None,
            limit=limit,
        )

    def read_node_events_with_agent(
        self,
        node_id: str,
        *,
        limit: int,
        node_run_dir: str | None = None,
    ) -> list[dict[str, Any]]:
        identity = self.resolve_node_identity(node_id, node_run_dir=node_run_dir)
        if identity is None:
            return []
        ordered_events: list[tuple[tuple[str, int], int, dict[str, Any]]] = []
        sequence = 0
        for event in read_jsonl_tolerant(identity.node_dir / "events.jsonl", limit=limit):
            projected = dict(event)
            projected.update(identity.stream_identity())
            ordered_events.append((event_sort_key(projected), sequence, projected))
            sequence += 1
        agent_event_log = self.resolve_agent_turn_event_log(identity.node_dir)
        if agent_event_log is not None:
            for event_index, event in enumerate(read_jsonl_tolerant(agent_event_log, limit=limit), start=1):
                projected = self.project_agent_event(
                    event,
                    identity,
                    fallback_event_seq=event_index,
                )
                ordered_events.append((event_sort_key(projected), sequence, projected))
                sequence += 1
        ordered_events.sort(key=lambda item: (item[0], item[1]))
        return [event for _, _, event in ordered_events[-limit:]]

    def read_node_log_delta(
        self,
        node_id: str,
        stream: str,
        *,
        offset: int,
        limit: int,
        node_run_dir: str | None = None,
    ) -> dict[str, Any]:
        identity = self.resolve_node_identity(node_id, node_run_dir=node_run_dir)
        if identity is None:
            identity = NodeIdentity(
                run_id=self.run_id,
                node_id=node_id,
                node_dir=self.run_dir / "nodes" / node_id,
            )
        log_path = self.resolve_effective_log(identity.node_dir, stream)
        delta = read_log_delta(
            log_path,
            self.run_id,
            identity.node_id,
            stream,
            offset=offset,
            limit=limit,
        )
        delta.update(identity.stream_identity())
        return delta

    def read_node_log_delta_from_identity(
        self,
        identity: NodeIdentity,
        stream: str,
        *,
        offset: int,
        limit: int,
    ) -> dict[str, Any]:
        log_path = self.resolve_effective_log(identity.node_dir, stream)
        delta = read_log_delta(
            log_path,
            self.run_id,
            identity.node_id,
            stream,
            offset=offset,
            limit=limit,
        )
        delta.update(identity.stream_identity())
        return delta

    def resolve_effective_log(self, node_dir: Path, stream: str) -> Path:
        node_log_path = node_dir / f"{stream}.log"
        runtime = load_json_tolerant(node_dir / "runtime.json")
        session_dir = self._resolve_agent_session_dir(node_dir, runtime)
        turn_id = runtime.get("turn_id")
        if session_dir is None or not isinstance(turn_id, str) or not is_safe_path_component(turn_id):
            return node_log_path
        turn_log_path = session_dir / "turns" / turn_id / f"{stream}.log"
        if turn_log_path.exists() and turn_log_path.is_file():
            return turn_log_path
        return node_log_path

    def resolve_agent_turn_event_log(self, node_dir: Path) -> Path | None:
        runtime = load_json_tolerant(node_dir / "runtime.json")
        session_dir = self._resolve_agent_session_dir(node_dir, runtime)
        turn_id = runtime.get("turn_id")
        if session_dir is None or not isinstance(turn_id, str) or not is_safe_path_component(turn_id):
            return None
        event_log = session_dir / "turns" / turn_id / "events.jsonl"
        return event_log if event_log.exists() and event_log.is_file() else None

    def project_agent_event(
        self,
        event: dict[str, Any],
        identity: NodeIdentity,
        *,
        fallback_event_seq: int | None = None,
    ) -> dict[str, Any]:
        projected = ensure_agent_event_projection(event, fallback_event_seq=fallback_event_seq)
        projected["source"] = "agent_session"
        projected["run_id"] = projected.get("run_id") or self.run_id
        projected["node_id"] = projected.get("node_id") or identity.node_id
        projected["agent_session_id"] = projected.get("session_id")
        projected["agent_turn_id"] = projected.get("turn_id")
        projected.update(identity.stream_identity())
        return projected

    def resolve_node_identity(
        self,
        node_id: str,
        *,
        node_run_dir: str | None = None,
    ) -> NodeIdentity | None:
        if node_run_dir:
            try:
                target_dir = Path(node_run_dir).resolve()
            except OSError:
                return None
            for identity in self.iter_node_identities():
                if identity.node_id == node_id and identity.node_dir.resolve() == target_dir:
                    return identity
            return None
        for identity in self.iter_node_identities():
            if identity.node_id == node_id and not identity.parent_node_id:
                return identity
        return None

    def _iter_nested_node_identities(
        self,
        nested_run_dir: Path,
        *,
        parent_ui_node_id: str,
        call_depth: int,
    ) -> list[NodeIdentity]:
        identities: list[NodeIdentity] = []
        for node_dir in iter_node_dirs(nested_run_dir):
            node_id = node_dir.name
            ui_node_id = f"{parent_ui_node_id}__internal__{node_id}"
            identity = NodeIdentity(
                run_id=self.run_id,
                node_id=node_id,
                node_dir=node_dir.resolve(),
                ui_node_id=ui_node_id,
                parent_node_id=parent_ui_node_id,
                call_depth=call_depth,
            )
            identities.append(identity)
            nested_child_run_dir = node_dir / "nested_workflow"
            if nested_child_run_dir.exists() and nested_child_run_dir.is_dir():
                identities.extend(
                    self._iter_nested_node_identities(
                        nested_child_run_dir,
                        parent_ui_node_id=ui_node_id,
                        call_depth=call_depth + 1,
                    )
                )
        return identities

    def _read_nested_workflow_events(
        self,
        run_dir: Path,
        *,
        parent_ui_node_id: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        nested_events: list[dict[str, Any]] = []
        for node_dir in iter_node_dirs(run_dir):
            nested_run_dir = node_dir / "nested_workflow"
            if not nested_run_dir.exists() or not nested_run_dir.is_dir():
                continue
            nested_parent_ui_node_id = (
                f"{parent_ui_node_id}__internal__{node_dir.name}"
                if parent_ui_node_id
                else node_dir.name
            )
            for event in read_jsonl_tolerant(nested_run_dir / "events.jsonl", limit=limit):
                nested_events.append(
                    annotate_nested_event(event, nested_parent_ui_node_id, nested_run_dir)
                )
            nested_events.extend(
                self._read_nested_workflow_events(
                    nested_run_dir,
                    parent_ui_node_id=nested_parent_ui_node_id,
                    limit=limit,
                )
            )
        return nested_events

    def _resolve_agent_session_dir(self, node_dir: Path, runtime: dict[str, Any]) -> Path | None:
        session_ref = runtime.get("agent_session_ref")
        if not isinstance(session_ref, str) or not session_ref:
            return None
        try:
            session_dir = Path(session_ref).resolve()
        except OSError:
            return None
        if not self.is_valid_agent_session_dir_for_node(node_dir, session_dir):
            return None
        return session_dir

    def is_valid_agent_session_dir_for_node(self, node_dir: Path, session_dir: Path) -> bool:
        node_dir = node_dir.resolve()
        session_dir = session_dir.resolve()
        if not is_relative_to_path(node_dir, self.run_dir):
            return False
        for root in self._allowed_agent_session_roots(node_dir):
            if is_relative_to_path(session_dir, root):
                return True
        return False

    def _allowed_agent_session_roots(self, node_dir: Path) -> list[Path]:
        roots = [
            (self.run_dir.parent / "_agent_sessions" / self.run_id).resolve(),
            (self.run_dir / "_agent_sessions").resolve(),
        ]
        current = node_dir.resolve()
        while current != self.run_dir and is_relative_to_path(current, self.run_dir):
            if current.name == "nested_workflow" and current.parent.name:
                roots.append((current.parent / "runs" / "_agent_sessions").resolve())
            current = current.parent
        return unique_paths(roots)


def iter_node_dirs(run_dir: Path) -> list[Path]:
    nodes_dir = run_dir / "nodes"
    if not nodes_dir.exists() or not nodes_dir.is_dir():
        return []
    return sorted(item for item in nodes_dir.iterdir() if item.is_dir())


def read_log_delta(
    log_path: Path,
    run_id: str,
    node_id: str,
    stream: str,
    *,
    offset: int,
    limit: int,
) -> dict[str, Any]:
    if not log_path.exists():
        return {
            "type": "node_log_delta",
            "run_id": run_id,
            "node_id": node_id,
            "stream": stream,
            "offset": offset,
            "next_offset": offset,
            "text": "",
            "eof": True,
        }
    size = log_path.stat().st_size
    safe_offset = min(offset, size)
    with log_path.open("rb") as file:
        file.seek(safe_offset)
        chunk = file.read(min(limit, max(0, size - safe_offset)))
    return {
        "type": "node_log_delta",
        "run_id": run_id,
        "node_id": node_id,
        "stream": stream,
        "offset": safe_offset,
        "next_offset": safe_offset + len(chunk),
        "text": chunk.decode("utf-8", errors="replace"),
        "eof": safe_offset + len(chunk) >= size,
    }


def read_jsonl_tolerant(path: Path, limit: int = 200) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    events: deque[dict[str, Any]] = deque(maxlen=limit)
    with path.open(encoding="utf-8", errors="replace") as file:
        lines = enumerate(file, start=1)
        for line_number, line in lines:
            event = parse_jsonl_event(line, line_number)
            if event is not None:
                events.append(event)
    return list(events)


def annotate_nested_event(
    event: dict[str, Any],
    parent_node_id: str,
    nested_run_dir: Path,
) -> dict[str, Any]:
    nested_event = dict(event)
    nested_event["nested"] = True
    nested_event["parent_node_id"] = parent_node_id
    node_id = nested_event.get("node_id")
    if isinstance(node_id, str) and node_id:
        nested_event.setdefault("ui_node_id", f"{parent_node_id}__internal__{node_id}")
        nested_event.setdefault("node_run_dir", str((nested_run_dir / "nodes" / node_id).resolve()))
    return nested_event


def event_sort_key(event: dict[str, Any]) -> tuple[str, int]:
    timestamp = event.get("timestamp")
    event_seq = event.get("event_seq")
    return (timestamp if isinstance(timestamp, str) else "", event_seq if isinstance(event_seq, int) else 0)


def parse_jsonl_event(line: str, line_number: int) -> dict[str, Any] | None:
    if not line.strip():
        return None
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return {"type": "raw_log", "line": line_number, "payload": {"text": line.rstrip("\n")}}
    if isinstance(payload, dict):
        return payload
    return {"type": "raw_log", "line": line_number, "payload": {"text": line.rstrip("\n")}}


def load_json_tolerant(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def is_safe_path_component(value: str) -> bool:
    return (
        value not in {"", ".", ".."}
        and Path(value).name == value
        and "/" not in value
        and "\\" not in value
    )


def is_relative_to_path(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


def unique_paths(paths: list[Path]) -> list[Path]:
    seen: set[str] = set()
    result: list[Path] = []
    for path in paths:
        key = str(path.resolve())
        if key in seen:
            continue
        seen.add(key)
        result.append(path.resolve())
    return result
