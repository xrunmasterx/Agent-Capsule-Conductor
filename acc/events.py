from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import uuid4

from acc.session import utc_now_iso


class JsonlEventEmitter:
    def __init__(
        self,
        event_log_path: Path,
        *,
        workflow_run_id: str | None = None,
        session_id: str | None = None,
        node_id: str | None = None,
    ) -> None:
        self.event_log_path = event_log_path
        self.workflow_run_id = workflow_run_id
        self.session_id = session_id
        self.node_id = node_id

    def emit(
        self,
        event_type: str,
        *,
        status: str | None = None,
        level: int | None = None,
        payload: dict[str, Any] | None = None,
        workflow_run_id: str | None = None,
        session_id: str | None = None,
        node_id: str | None = None,
    ) -> dict[str, Any]:
        event = {
            "event_id": f"event_{uuid4().hex}",
            "type": event_type,
            "timestamp": utc_now_iso(),
            "payload": payload or {},
        }
        resolved_workflow_run_id = workflow_run_id or self.workflow_run_id
        resolved_session_id = session_id or self.session_id
        resolved_node_id = node_id or self.node_id
        if resolved_workflow_run_id is not None:
            event["workflow_run_id"] = resolved_workflow_run_id
        if resolved_session_id is not None:
            event["session_id"] = resolved_session_id
        if resolved_node_id is not None:
            event["node_id"] = resolved_node_id
        if level is not None:
            event["level"] = level
        if status is not None:
            event["status"] = status

        self.event_log_path.parent.mkdir(parents=True, exist_ok=True)
        with self.event_log_path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
        return event


class SessionEventEmitter(JsonlEventEmitter):
    pass


class WorkflowEventEmitter(JsonlEventEmitter):
    pass


def iter_jsonl_events(event_log_path: Path) -> Iterator[dict[str, Any]]:
    if not event_log_path.exists():
        return
    with event_log_path.open(encoding="utf-8") as file:
        for line in file:
            if not line.strip():
                continue
            payload = json.loads(line)
            if isinstance(payload, dict):
                yield payload


def read_jsonl_events(event_log_path: Path) -> list[dict[str, Any]]:
    return list(iter_jsonl_events(event_log_path))
