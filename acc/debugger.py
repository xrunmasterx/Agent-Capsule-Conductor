from __future__ import annotations

import difflib
import hashlib
import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from acc.app import WorkflowAppService
from acc.events import read_jsonl_events
from acc.registry import CapsuleRegistry
from acc.run_index import NodeRunSummary, RunSummary, SummaryError, load_run_summary, write_json
from acc.session import utc_now_iso
from acc.utils import AccError, load_json
from acc.workflow_graph import normalize_workflow_graph, topological_levels

SUCCESS_STATUSES = {"success"}

TEXT_EXTENSIONS = {
    ".json",
    ".jsonl",
    ".md",
    ".txt",
    ".log",
    ".yaml",
    ".yml",
}
STATUS_PRIORITY = [
    "manual_review",
    "schema_error",
    "artifact_error",
    "workspace_error",
    "timeout",
    "adapter_error",
    "unavailable",
    "failed",
    "skipped",
]


@dataclass
class WorkflowNodeResult:
    node_id: str
    capsule_id: str
    level: int
    status: str
    summary: str
    run_dir: Path
    conductor_output: dict[str, Any] = field(default_factory=dict)
    node_summary: NodeRunSummary | None = None
    output: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    attempts: int = 1

    @property
    def succeeded(self) -> bool:
        return self.status in SUCCESS_STATUSES


def replay_workflow_events(run_dir: Path, node_id: str | None = None) -> dict[str, Any]:
    resolved_run_dir = resolve_run_dir(run_dir)
    workflow_summary = load_optional_json(resolved_run_dir / "workflow_summary.json") or {}
    run_manifest = load_optional_json(resolved_run_dir / "workflow_run_manifest.json") or {}
    workflow_events = annotate_events(
        read_jsonl_events(resolved_run_dir / "workflow_events.jsonl"),
        source="workflow",
    )

    node_payloads: list[dict[str, Any]] = []
    replay_errors: list[dict[str, Any]] = []
    node_summaries = workflow_summary.get("nodes", []) if isinstance(workflow_summary, dict) else []
    for node_summary in node_summaries:
        if not isinstance(node_summary, dict):
            continue
        current_node_id = str(node_summary.get("node_id") or "")
        if node_id is not None and current_node_id != node_id:
            continue
        node_events = annotate_events(
            read_jsonl_events(node_run_dir(resolved_run_dir, current_node_id) / "events.jsonl"),
            source=f"node:{current_node_id}",
        )
        node_timestamps = derive_node_timestamps(current_node_id, workflow_events, node_events)
        node_error = derive_node_error(node_summary, workflow_events, node_events)
        node_payloads.append(
            {
                "node_id": current_node_id,
                "capsule_id": node_summary.get("capsule_id"),
                "status": node_summary.get("status", "unknown"),
                "started_at": node_timestamps["started_at"],
                "ended_at": node_timestamps["ended_at"],
                "error": node_error,
                "output_path": node_summary.get("output_path"),
                "artifact_dir": node_summary.get("artifact_dir"),
                "event_log": node_summary.get("event_log"),
                "adapter_events": [
                    event for event in node_events if event.get("type") == "adapter_started"
                ],
            }
        )
        replay_errors.extend(node_errors(current_node_id, node_summary, node_error))

    timeline = sort_timeline(
        [
            *(
                workflow_events
                if node_id is None
                else [event for event in workflow_events if event.get("node_id") in {None, node_id}]
            ),
            *(
                []
                if node_id is None
                else annotate_events(
                    read_jsonl_events(node_run_dir(resolved_run_dir, node_id) / "events.jsonl"),
                    source=f"node:{node_id}",
                )
            ),
        ]
    )
    if node_id is None:
        for payload in node_payloads:
            current_node_id = payload["node_id"]
            timeline.extend(
                annotate_events(
                    read_jsonl_events(
                        node_run_dir(resolved_run_dir, current_node_id) / "events.jsonl"
                    ),
                    source=f"node:{current_node_id}",
                )
            )
        timeline = sort_timeline(timeline)

    workflow_status = str(workflow_summary.get("status") or run_manifest.get("status") or "unknown")
    payload = {
        "run_dir": str(resolved_run_dir.resolve()),
        "status": workflow_status if node_id is None else node_status_for(node_payloads),
        "workflow_status": workflow_status,
        "workflow_id": workflow_summary.get("workflow_id") or run_manifest.get("workflow_id"),
        "node_filter": node_id,
        "failed_node": first_failed_node(node_payloads),
        "nodes": node_payloads,
        "timeline": timeline,
        "errors": replay_errors,
        "event_log": str((resolved_run_dir / "workflow_events.jsonl").resolve()),
    }
    write_json(resolved_run_dir / "replay_manifest.json", payload)
    return payload


def rerun_single_node(
    run_dir: Path,
    node_id: str,
    out_dir: Path,
    *,
    registry: CapsuleRegistry | None = None,
) -> dict[str, Any]:
    return _lineage_run(run_dir, node_id, out_dir, registry=registry, operation="rerun_node")


def rerun_from_node(
    run_dir: Path,
    node_id: str,
    out_dir: Path,
    *,
    registry: CapsuleRegistry | None = None,
) -> dict[str, Any]:
    return _lineage_run(run_dir, node_id, out_dir, registry=registry, operation="rerun_from")


def fork_run(
    run_dir: Path,
    node_id: str,
    override_path: Path,
    out_dir: Path,
    *,
    registry: CapsuleRegistry | None = None,
) -> dict[str, Any]:
    override_payload = load_json(override_path)
    if not isinstance(override_payload, dict):
        raise AccError(f"Fork override must be a JSON object: {override_path}")
    return _lineage_run(
        run_dir,
        node_id,
        out_dir,
        registry=registry,
        operation="fork",
        override_payload=override_payload,
        override_path=override_path,
    )


def diff_runs(run_a: Path, run_b: Path) -> dict[str, Any]:
    run_a_dir = resolve_run_dir(run_a)
    run_b_dir = resolve_run_dir(run_b)
    summary_a = require_run_summary(run_a_dir)
    summary_b = require_run_summary(run_b_dir)

    nodes_a = {node.node_id: node for node in summary_a.nodes}
    nodes_b = {node.node_id: node for node in summary_b.nodes}
    node_ids = sorted(set(nodes_a) | set(nodes_b))
    node_diffs = []
    for node_id in node_ids:
        node_a = nodes_a.get(node_id)
        node_b = nodes_b.get(node_id)
        node_diffs.append(
            {
                "node_id": node_id,
                "status": {
                    "a": None if node_a is None else node_a.status,
                    "b": None if node_b is None else node_b.status,
                    "changed": status_value(node_a) != status_value(node_b),
                },
                "prompt_diff": None
                if node_a is None or node_b is None
                else artifact_diff(node_a.prompt_path, node_b.prompt_path),
                "output_diff": None
                if node_a is None or node_b is None
                else artifact_diff(node_a.output_path, node_b.output_path),
                "artifact_dir_diff": None
                if node_a is None or node_b is None
                else artifact_diff(node_a.artifact_dir, node_b.artifact_dir),
                "schema_errors": {
                    "a": collect_errors(node_a, "schema_error"),
                    "b": collect_errors(node_b, "schema_error"),
                },
                "artifact_errors": {
                    "a": collect_errors(node_a, "artifact_error"),
                    "b": collect_errors(node_b, "artifact_error"),
                },
            }
        )

    return {
        "run_a": str(run_a_dir.resolve()),
        "run_b": str(run_b_dir.resolve()),
        "status": {
            "a": summary_a.status,
            "b": summary_b.status,
            "changed": summary_a.status != summary_b.status,
        },
        "duration_ms": {
            "a": duration_ms_for_run(run_a_dir, summary_a),
            "b": duration_ms_for_run(run_b_dir, summary_b),
        },
        "workflow_id": workflow_id_pair(run_a_dir, run_b_dir, summary_a, summary_b),
        "node_diffs": node_diffs,
        "changed_nodes": [diff["node_id"] for diff in node_diffs if node_changed(diff)],
    }


def artifact_diff(artifact_a: str | Path | None, artifact_b: str | Path | None) -> dict[str, Any]:
    path_a = None if artifact_a in {None, ""} else Path(str(artifact_a))
    path_b = None if artifact_b in {None, ""} else Path(str(artifact_b))
    exists_a = path_a is not None and path_a.exists()
    exists_b = path_b is not None and path_b.exists()
    payload = {
        "artifact_a": None if path_a is None else str(path_a.resolve()),
        "artifact_b": None if path_b is None else str(path_b.resolve()),
        "exists": {"a": exists_a, "b": exists_b},
    }
    if not exists_a or not exists_b:
        payload["kind"] = "existence"
        payload["same"] = exists_a == exists_b and exists_a and exists_b
        payload["diff"] = []
        return payload
    if path_a is None or path_b is None:
        payload["kind"] = "existence"
        payload["same"] = False
        payload["diff"] = []
        return payload
    if path_a.is_dir() or path_b.is_dir():
        return {
            **payload,
            "kind": "directory",
            "same": directory_fingerprint(path_a) == directory_fingerprint(path_b),
            "diff": directory_diff(path_a, path_b),
        }

    json_a = parse_json_file(path_a)
    json_b = parse_json_file(path_b)
    if json_a is not None and json_b is not None:
        diff = json_value_diff(json_a, json_b)
        return {**payload, "kind": "json", "same": not diff, "diff": diff}

    text_a = read_text_if_possible(path_a)
    text_b = read_text_if_possible(path_b)
    if text_a is not None and text_b is not None:
        diff_lines = list(
            difflib.unified_diff(
                text_a.splitlines(),
                text_b.splitlines(),
                fromfile=path_a.name,
                tofile=path_b.name,
                lineterm="",
            )
        )
        return {**payload, "kind": "text", "same": not diff_lines, "diff": diff_lines}

    digest_a = file_digest(path_a)
    digest_b = file_digest(path_b)
    return {
        **payload,
        "kind": "binary",
        "same": digest_a == digest_b,
        "diff": {
            "size_bytes": {"a": path_a.stat().st_size, "b": path_b.stat().st_size},
            "sha256": {"a": digest_a, "b": digest_b},
        },
    }


def _lineage_run(
    run_dir: Path,
    node_id: str,
    out_dir: Path,
    *,
    registry: CapsuleRegistry | None = None,
    operation: str,
    override_payload: dict[str, Any] | None = None,
    override_path: Path | None = None,
) -> dict[str, Any]:
    registry = registry or CapsuleRegistry()
    source_run_dir = resolve_run_dir(run_dir)
    graph = load_graph_snapshot(source_run_dir)
    node_by_id = {node["id"]: node for node in graph["nodes"]}
    if node_id not in node_by_id:
        raise AccError(f"Workflow node not found: {node_id}")

    normalized_graph = normalize_workflow_graph(graph)
    ordered_node_ids = topological_order_ids(normalized_graph)
    affected_nodes = (
        {node_id}
        if operation == "rerun_node"
        else descendants_including_self(normalized_graph, node_id)
    )
    preserved_nodes = [
        current_node_id
        for current_node_id in ordered_node_ids
        if current_node_id not in affected_nodes
    ]
    lineage_run_dir = out_dir.resolve()
    started_at = utc_now_iso()
    parent_manifest = load_optional_json(source_run_dir / "workflow_run_manifest.json") or {}
    lineage_payload = {
        "operation": operation,
        "source_run_dir": str(source_run_dir.resolve()),
        "source_run_id": source_run_dir.name,
        "target_node_id": node_id,
        "affected_nodes": sorted(affected_nodes),
        "preserved_nodes": preserved_nodes,
        "override_path": None if override_path is None else str(override_path.resolve()),
        "override": override_payload,
        "created_at": started_at,
    }

    lineage_graph = graph_with_node_override(graph, node_id, override_payload or {})
    temp_graph_path = write_lineage_graph_temp(
        lineage_run_dir,
        lineage_graph,
        operation,
    )
    try:
        workflow_payload = WorkflowAppService(registry=registry).run_sync(
            temp_graph_path,
            lineage_run_dir,
        )
    finally:
        temp_graph_path.unlink(missing_ok=True)

    workflow_payload["lineage"] = lineage_payload
    graph_source_path = resolve_graph_source_path(source_run_dir, parent_manifest)
    rewrite_lineage_manifest_graph_path(lineage_run_dir, graph_source_path)
    attach_lineage_metadata(lineage_run_dir, lineage_payload, operation)
    replay_manifest = {
        "run_dir": str(lineage_run_dir.resolve()),
        "status": workflow_payload.get("status"),
        "lineage": lineage_payload,
        "errors": workflow_payload.get("errors", []),
        "nodes": workflow_payload.get("nodes", []),
    }
    write_json(lineage_run_dir / "replay_manifest.json", replay_manifest)
    if operation == "fork":
        write_json(
            lineage_run_dir / "fork_manifest.json",
            {
                "run_dir": str(lineage_run_dir.resolve()),
                "status": workflow_payload.get("status"),
                "parent_run_dir": str(source_run_dir.resolve()),
                "parent_run_id": source_run_dir.name,
                "from_node_id": node_id,
                "override": override_payload,
                "override_path": None if override_path is None else str(override_path.resolve()),
                "created_at": started_at,
            },
        )
    return workflow_payload


def resolve_run_dir(run_ref: Path) -> Path:
    if run_ref.exists():
        return run_ref.resolve()
    candidate = Path("runs") / run_ref
    if candidate.exists():
        return candidate.resolve()
    raise AccError(f"Run not found: {run_ref}")


def graph_with_node_override(
    graph: dict[str, Any],
    node_id: str,
    override_payload: dict[str, Any],
) -> dict[str, Any]:
    cloned = json.loads(json.dumps(graph))
    for node in cloned.get("nodes", []):
        if not isinstance(node, dict) or node.get("id") != node_id:
            continue
        if override_payload:
            node["input"] = {**dict(node.get("input", {}) or {}), **override_payload}
        return cloned
    raise AccError(f"Workflow node not found: {node_id}")


def write_lineage_graph_temp(
    lineage_run_dir: Path,
    graph: dict[str, Any],
    operation: str,
) -> Path:
    lineage_run_dir.parent.mkdir(parents=True, exist_ok=True)
    temp_path = lineage_run_dir.parent / f".{lineage_run_dir.name}.{operation}.graph.json"
    write_json(temp_path, graph)
    return temp_path


def rewrite_lineage_manifest_graph_path(run_dir: Path, graph_source_path: Path) -> None:
    manifest_path = run_dir / "workflow_run_manifest.json"
    manifest = load_optional_json(manifest_path) or {}
    if not isinstance(manifest, dict):
        return
    manifest["graph_path"] = str(graph_source_path.resolve())
    write_json(manifest_path, manifest)


def load_graph_snapshot(run_dir: Path) -> dict[str, Any]:
    snapshot_path = run_dir / "workflow_graph.json"
    if snapshot_path.exists():
        graph = load_json(snapshot_path)
        if isinstance(graph, dict):
            return graph
    manifest = load_optional_json(run_dir / "workflow_run_manifest.json") or {}
    graph_path = resolve_graph_source_path(run_dir, manifest)
    graph = load_json(graph_path)
    if not isinstance(graph, dict):
        raise AccError(f"Workflow graph must be a JSON object: {graph_path}")
    return graph


def resolve_graph_source_path(run_dir: Path, manifest: dict[str, Any]) -> Path:
    snapshot_path = run_dir / "workflow_graph.json"
    if snapshot_path.exists():
        return snapshot_path
    raw_path = manifest.get("graph_path")
    if not isinstance(raw_path, str) or not raw_path:
        raise AccError(
            f"Workflow graph path is missing in {run_dir / 'workflow_run_manifest.json'}"
        )
    graph_path = Path(raw_path)
    if graph_path.exists():
        return graph_path.resolve()
    fallback = run_dir / graph_path.name
    if fallback.exists():
        return fallback.resolve()
    raise AccError(f"Workflow graph not found for run {run_dir}: {raw_path}")


def annotate_events(events: list[dict[str, Any]], *, source: str) -> list[dict[str, Any]]:
    return [{**event, "source": source} for event in events]


def sort_timeline(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        events,
        key=lambda event: (
            str(event.get("timestamp") or ""),
            str(event.get("source") or ""),
            str(event.get("event_id") or ""),
        ),
    )


def derive_node_timestamps(
    node_id: str,
    workflow_events: list[dict[str, Any]],
    node_events: list[dict[str, Any]],
) -> dict[str, str | None]:
    started_at = first_timestamp(
        [
            event
            for event in [*workflow_events, *node_events]
            if event.get("node_id") == node_id
            or event.get("type") in {"session_started", "node_started"}
        ]
    )
    ended_at = last_timestamp(
        [
            event
            for event in [*workflow_events, *node_events]
            if event.get("node_id") == node_id
            or event.get("type")
            in {"session_completed", "session_failed", "node_completed", "node_failed"}
        ]
    )
    return {"started_at": started_at, "ended_at": ended_at}


def derive_node_error(
    node_summary: dict[str, Any],
    workflow_events: list[dict[str, Any]],
    node_events: list[dict[str, Any]],
) -> str | None:
    errors = node_summary.get("errors", [])
    if isinstance(errors, list) and errors:
        first_error = errors[0]
        if isinstance(first_error, dict):
            message = first_error.get("message")
            if isinstance(message, str) and message:
                return message
    current_node_id = node_summary.get("node_id")
    for event in [*reversed(workflow_events), *reversed(node_events)]:
        if current_node_id is not None and event.get("node_id") not in {None, current_node_id}:
            continue
        payload = event.get("payload")
        if isinstance(payload, dict) and isinstance(payload.get("error"), str):
            return str(payload["error"])
    return None


def node_errors(
    node_id: str, node_summary: dict[str, Any], node_error: str | None
) -> list[dict[str, Any]]:
    errors = node_summary.get("errors", [])
    if isinstance(errors, list) and errors:
        return [{"node_id": node_id, **error} for error in errors if isinstance(error, dict)]
    if node_error:
        return [
            {
                "node_id": node_id,
                "error_class": str(node_summary.get("status")),
                "message": node_error,
            }
        ]
    return []


def node_status_for(node_payloads: list[dict[str, Any]]) -> str:
    if not node_payloads:
        return "unknown"
    return str(node_payloads[0].get("status") or "unknown")


def first_failed_node(node_payloads: list[dict[str, Any]]) -> str | None:
    for payload in node_payloads:
        if payload.get("status") not in SUCCESS_STATUSES:
            return str(payload.get("node_id"))
    return None


def first_timestamp(events: list[dict[str, Any]]) -> str | None:
    timestamps = [str(event.get("timestamp")) for event in events if event.get("timestamp")]
    return min(timestamps) if timestamps else None


def last_timestamp(events: list[dict[str, Any]]) -> str | None:
    timestamps = [str(event.get("timestamp")) for event in events if event.get("timestamp")]
    return max(timestamps) if timestamps else None


def load_optional_json(path: Path) -> Any:
    if not path.exists():
        return None
    return load_json(path)


def require_run_summary(run_dir: Path) -> RunSummary:
    summary = load_run_summary(run_dir)
    if summary is None:
        raise AccError(f"Run summary not found: {run_dir}")
    return summary


def collect_errors(node: NodeRunSummary | None, error_class: str) -> list[dict[str, Any]]:
    if node is None:
        return []
    return [error.model_dump() for error in node.errors if error.error_class == error_class]


def workflow_id_pair(
    run_a_dir: Path,
    run_b_dir: Path,
    summary_a: RunSummary,
    summary_b: RunSummary,
) -> dict[str, Any]:
    manifest_a = load_optional_json(run_a_dir / "workflow_run_manifest.json") or {}
    manifest_b = load_optional_json(run_b_dir / "workflow_run_manifest.json") or {}
    return {
        "a": summary_a.workflow_id or manifest_a.get("workflow_id"),
        "b": summary_b.workflow_id or manifest_b.get("workflow_id"),
    }


def duration_ms_for_run(run_dir: Path, summary: RunSummary) -> int | None:
    if summary.duration_ms is not None:
        return summary.duration_ms
    manifest = load_optional_json(run_dir / "workflow_run_manifest.json") or {}
    started_at = manifest.get("started_at") or summary.started_at
    ended_at = manifest.get("ended_at") or summary.ended_at
    if not isinstance(started_at, str) or not isinstance(ended_at, str):
        return None
    from acc.run_index import duration_ms

    return duration_ms(started_at, ended_at)


def node_changed(diff: dict[str, Any]) -> bool:
    if diff["status"]["changed"]:
        return True
    for key in ("prompt_diff", "output_diff", "artifact_dir_diff"):
        value = diff.get(key)
        if isinstance(value, dict) and not value.get("same", True):
            return True
    return bool(diff["schema_errors"]["a"] or diff["schema_errors"]["b"])


def status_value(node: NodeRunSummary | None) -> str | None:
    return None if node is None else node.status


def parse_json_file(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


def read_text_if_possible(path: Path) -> str | None:
    if path.suffix.lower() in TEXT_EXTENSIONS:
        try:
            return path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return None
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return None


def json_value_diff(value_a: Any, value_b: Any, path: str = "$") -> list[dict[str, Any]]:
    if type(value_a) is not type(value_b):
        return [{"path": path, "a": value_a, "b": value_b}]
    if isinstance(value_a, dict):
        diff: list[dict[str, Any]] = []
        for key in sorted(set(value_a) | set(value_b)):
            next_path = f"{path}.{key}"
            if key not in value_a:
                diff.append({"path": next_path, "a": None, "b": value_b[key]})
                continue
            if key not in value_b:
                diff.append({"path": next_path, "a": value_a[key], "b": None})
                continue
            diff.extend(json_value_diff(value_a[key], value_b[key], next_path))
        return diff
    if isinstance(value_a, list):
        diff: list[dict[str, Any]] = []
        max_length = max(len(value_a), len(value_b))
        for index in range(max_length):
            next_path = f"{path}[{index}]"
            if index >= len(value_a):
                diff.append({"path": next_path, "a": None, "b": value_b[index]})
                continue
            if index >= len(value_b):
                diff.append({"path": next_path, "a": value_a[index], "b": None})
                continue
            diff.extend(json_value_diff(value_a[index], value_b[index], next_path))
        return diff
    if value_a != value_b:
        return [{"path": path, "a": value_a, "b": value_b}]
    return []


def directory_diff(path_a: Path, path_b: Path) -> dict[str, Any]:
    files_a = directory_fingerprint(path_a)
    files_b = directory_fingerprint(path_b)
    common = sorted(set(files_a) & set(files_b))
    changed = [
        relative_path
        for relative_path in common
        if files_a[relative_path] != files_b[relative_path]
    ]
    return {
        "added": sorted(set(files_b) - set(files_a)),
        "removed": sorted(set(files_a) - set(files_b)),
        "changed": changed,
        "common": common,
    }


def directory_fingerprint(path: Path) -> dict[str, str]:
    if not path.exists() or not path.is_dir():
        return {}
    fingerprint: dict[str, str] = {}
    for child in sorted(item for item in path.rglob("*") if item.is_file()):
        relative_path = child.relative_to(path).as_posix()
        fingerprint[relative_path] = file_digest(child)
    return fingerprint


def file_digest(path: Path, chunk_size: int = 64 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while True:
            chunk = file.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def topological_order_ids(graph: dict[str, Any]) -> list[str]:
    remaining = [node["id"] for node in graph["nodes"]]
    levels = topological_levels(graph)
    ordered: list[str] = []
    for level in levels:
        ordered.extend(level)
    if ordered:
        return ordered
    return remaining


def descendants_including_self(graph: dict[str, Any], node_id: str) -> set[str]:
    descendants = {node_id}
    changed = True
    while changed:
        changed = False
        for edge in graph.get("control_edges", []):
            if edge["from"] in descendants and edge["to"] not in descendants:
                descendants.add(edge["to"])
                changed = True
    return descendants


def copy_run_for_lineage(source_run_dir: Path, out_dir: Path) -> Path:
    resolved_out_dir = out_dir.resolve()
    if resolved_out_dir.exists():
        if any(resolved_out_dir.iterdir()):
            raise AccError(f"Refusing to reuse non-empty lineage run directory: {resolved_out_dir}")
        resolved_out_dir.rmdir()
    shutil.copytree(source_run_dir, resolved_out_dir)
    return resolved_out_dir


def clear_affected_node_runs(run_dir: Path, affected_nodes: set[str]) -> None:
    for current_node_id in affected_nodes:
        for candidate in [
            node_run_dir(run_dir, current_node_id),
            run_dir / "nodes" / current_node_id,
        ]:
            if candidate.exists():
                shutil.rmtree(candidate)


def node_run_dir(run_dir: Path, node_id: str) -> Path:
    node_runs_dir = run_dir / "node_runs"
    if node_runs_dir.exists():
        return node_runs_dir / node_id
    return run_dir / "nodes" / node_id


def load_preserved_node_results(
    run_dir: Path,
    ordered_node_ids: list[str],
    node_by_id: dict[str, dict[str, Any]],
    affected_nodes: set[str],
) -> dict[str, WorkflowNodeResult]:
    results: dict[str, WorkflowNodeResult] = {}
    for current_node_id in ordered_node_ids:
        if current_node_id in affected_nodes:
            continue
        node = node_by_id[current_node_id]
        current_node_run_dir = node_run_dir(run_dir, current_node_id)
        summary = require_node_summary(run_dir, current_node_id)
        conductor_output = load_optional_json(current_node_run_dir / "conductor_output.json") or {
            "status": summary.status,
            "summary": summary.summary,
            "output_path": summary.output_path,
            "artifact_dir": summary.artifact_dir,
            "event_log": summary.event_log,
        }
        results[current_node_id] = WorkflowNodeResult(
            node_id=current_node_id,
            capsule_id=node["capsule_id"],
            level=0,
            status=summary.status,
            summary=summary.summary,
            run_dir=current_node_run_dir,
            conductor_output=conductor_output,
            node_summary=summary,
            output=load_output_payload(conductor_output),
            error=summary.errors[0].message if summary.errors else None,
        )
    return results


def build_context_from_results(
    node_results: dict[str, WorkflowNodeResult],
    graph: dict[str, Any],
) -> dict[str, Any]:
    context: dict[str, Any] = {"workflow": {"input": graph.get("input", {})}, "nodes": {}}
    for result in node_results.values():
        payload = {
            "output": result.output,
            "output_path": result.conductor_output.get("output_path"),
            "artifact_dir": result.conductor_output.get("artifact_dir"),
        }
        if not result.succeeded:
            payload["status"] = result.status
            payload["error"] = result.error
        context["nodes"][result.node_id] = payload
    return context


def require_node_summary(run_dir: Path, node_id: str) -> NodeRunSummary:
    summary_path = node_run_dir(run_dir, node_id) / "node_summary.json"
    if not summary_path.exists():
        raise AccError(f"Node summary not found for {node_id}: {summary_path}")
    payload = load_json(summary_path)
    if isinstance(payload, dict):
        payload["node_id"] = node_id
    return NodeRunSummary.model_validate(payload)


def load_output_payload(conductor_output: dict[str, Any]) -> dict[str, Any]:
    output_path = conductor_output.get("output_path")
    if not output_path:
        return {}
    payload = load_json(Path(output_path))
    return payload if isinstance(payload, dict) else {}


def load_node_summary(run_dir: Path, conductor_output: dict[str, Any]) -> NodeRunSummary:
    summary_path = run_dir / "node_summary.json"
    if summary_path.exists():
        payload = load_json(summary_path)
        payload["node_id"] = run_dir.name
        write_json(summary_path, payload)
        return NodeRunSummary.model_validate(payload)
    manifest_path = run_dir / "session_manifest.json"
    manifest = load_json(manifest_path) if manifest_path.exists() else {}
    from acc.run_index import build_node_summary

    return build_node_summary(run_dir, manifest, conductor_output)


def workflow_result_from_node_run(
    node: dict[str, Any],
    node_run_dir_path: Path,
    conductor_output: dict[str, Any],
    level: int,
) -> WorkflowNodeResult:
    node_summary = load_node_summary(node_run_dir_path, conductor_output)
    output = load_output_payload(conductor_output)
    status = str(conductor_output.get("status") or "failed")
    error = str(conductor_output.get("error") or conductor_output.get("summary") or "")
    return WorkflowNodeResult(
        node_id=node["id"],
        capsule_id=node["capsule_id"],
        level=level,
        status=status,
        summary=str(conductor_output.get("summary") or node_summary.summary),
        run_dir=node_run_dir_path,
        conductor_output=conductor_output,
        node_summary=node_summary,
        output=output,
        error=error if status not in SUCCESS_STATUSES else None,
    )


def skipped_node_result(
    node: dict[str, Any], node_run_dir_path: Path, reason: str
) -> WorkflowNodeResult:
    summary = NodeRunSummary(
        node_id=node["id"],
        capsule_id=node["capsule_id"],
        status="skipped",
        summary=reason,
        run_dir=str(node_run_dir_path.resolve()),
        errors=[
            SummaryError(
                error_class="skipped",
                message=reason,
                paths={"run_dir": str(node_run_dir_path.resolve())},
            )
        ],
    )
    node_run_dir_path.mkdir(parents=True, exist_ok=True)
    write_json(node_run_dir_path / "node_summary.json", summary.model_dump())
    return WorkflowNodeResult(
        node_id=node["id"],
        capsule_id=node["capsule_id"],
        level=0,
        status="skipped",
        summary=reason,
        run_dir=node_run_dir_path,
        node_summary=summary,
        error=reason,
    )


def level_map(graph: dict[str, Any]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for index, level in enumerate(topological_levels(graph)):
        for node_id in level:
            mapping[node_id] = index
    return mapping


def summarize_workflow_status(node_summaries: list[NodeRunSummary]) -> str:
    statuses = [summary.status for summary in node_summaries]
    if statuses and all(status in SUCCESS_STATUSES for status in statuses):
        return "success"
    for candidate in STATUS_PRIORITY:
        if candidate in statuses:
            return candidate
    return "failed"


def attach_lineage_metadata(run_dir: Path, lineage_payload: dict[str, Any], operation: str) -> None:
    manifest_path = run_dir / "workflow_run_manifest.json"
    payload = load_optional_json(manifest_path) or {}
    payload["lineage"] = lineage_payload
    payload["operation"] = operation
    write_json(manifest_path, payload)
