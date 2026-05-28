from __future__ import annotations

import json
from collections import deque
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from acc.run_index import NodeRunSummary, load_or_rebuild_run_index, load_run_summary_by_id
from acc.server.context import (
    get_project_root,
    is_relative_to,
    reject_secret_like_path,
    relative_project_path,
)
from acc.utils import AccError

router = APIRouter(prefix="/runs", tags=["runs"])


@router.get("")
def list_runs(request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    index = load_or_rebuild_run_index(project_root / "runs")
    return index.model_dump()


@router.get("/{run_id}")
def get_run(run_id: str, request: Request) -> dict[str, Any]:
    return load_run_or_404(run_id, request).model_dump()


@router.get("/{run_id}/nodes/{node_id}")
def get_node(run_id: str, node_id: str, request: Request) -> dict[str, Any]:
    node = find_node_or_404(run_id, node_id, request)
    payload = node.model_dump()
    payload["artifacts_url"] = f"/api/runs/{run_id}/nodes/{node_id}/artifacts"
    return payload


@router.get("/{run_id}/nodes/{node_id}/artifacts")
def list_node_artifacts(run_id: str, node_id: str, request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    node = find_node_or_404(run_id, node_id, request)
    if not node.artifact_dir:
        return {"run_id": run_id, "node_id": node_id, "artifacts": []}
    artifact_dir = Path(node.artifact_dir).resolve()
    if not is_relative_to(artifact_dir, project_root):
        raise HTTPException(status_code=400, detail="Artifact directory is outside project root")
    if not artifact_dir.exists() or not artifact_dir.is_dir():
        return {"run_id": run_id, "node_id": node_id, "artifacts": []}
    artifacts = []
    for path in sorted(item for item in artifact_dir.rglob("*") if item.is_file()):
        try:
            reject_secret_like_path(path)
        except HTTPException:
            continue
        rel_path = relative_project_path(project_root, path)
        artifacts.append(
            {
                "name": path.name,
                "path": rel_path,
                "read_url": f"/api/artifacts/read?path={rel_path}",
                "size_bytes": path.stat().st_size,
            }
        )
    return {"run_id": run_id, "node_id": node_id, "artifacts": artifacts}


@router.get("/{run_id}/events")
def get_run_events(
    run_id: str,
    request: Request,
    limit: int = Query(200, ge=1, le=1000),
) -> dict[str, Any]:
    project_root = get_project_root(request)
    run_dir = resolve_run_dir_or_404(run_id, request)
    event_log = run_dir / "workflow_events.jsonl"
    return {
        "run_id": run_id,
        "event_log": relative_project_path(project_root, event_log),
        "events": read_run_events_with_nested(run_dir, limit=limit),
    }


@router.get("/{run_id}/nodes/{node_id}/events")
def get_node_events(
    run_id: str,
    node_id: str,
    request: Request,
    limit: int = Query(200, ge=1, le=1000),
) -> dict[str, Any]:
    project_root = get_project_root(request)
    run_dir = resolve_run_dir_or_404(run_id, request)
    validate_path_component(node_id, "node_id")
    event_log = run_dir / "node_runs" / node_id / "events.jsonl"
    if not event_log.exists():
        legacy_event_log = run_dir / "nodes" / node_id / "events.jsonl"
        if legacy_event_log.exists():
            event_log = legacy_event_log
    return {
        "run_id": run_id,
        "node_id": node_id,
        "event_log": relative_project_path(project_root, event_log),
        "events": read_jsonl_tolerant(event_log, limit=limit),
    }


def load_run_or_404(run_id: str, request: Request):
    try:
        return load_run_summary_by_id(run_id, get_project_root(request) / "runs")
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def find_node_or_404(run_id: str, node_id: str, request: Request) -> NodeRunSummary:
    summary = load_run_or_404(run_id, request)
    for node in summary.nodes:
        if node.node_id == node_id:
            return node
    raise HTTPException(status_code=404, detail=f"Node not found: {node_id}")


def resolve_run_dir_or_404(run_id: str, request: Request) -> Path:
    validate_path_component(run_id, "run_id")
    project_root = get_project_root(request)
    run_dir = (project_root / "runs" / run_id).resolve()
    runs_root = (project_root / "runs").resolve()
    if not run_dir.is_relative_to(runs_root) or not run_dir.exists() or not run_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
    return run_dir


def validate_path_component(value: str, label: str) -> None:
    if value in {"", ".", ".."} or Path(value).name != value or "/" in value or "\\" in value:
        raise HTTPException(status_code=400, detail=f"Invalid {label}: {value}")


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


def read_run_events_with_nested(run_dir: Path, limit: int = 200) -> list[dict[str, Any]]:
    ordered_events: list[tuple[str, int, dict[str, Any]]] = []
    sequence = 0
    for event in read_jsonl_tolerant(run_dir / "workflow_events.jsonl", limit=limit):
        ordered_events.append((event_sort_key(event), sequence, event))
        sequence += 1

    nodes_dir = run_dir / "nodes"
    if nodes_dir.exists() and nodes_dir.is_dir():
        for node_dir in sorted(item for item in nodes_dir.iterdir() if item.is_dir()):
            nested_event_log = node_dir / "nested_workflow" / "workflow_events.jsonl"
            for event in read_jsonl_tolerant(nested_event_log, limit=limit):
                nested_event = annotate_nested_event(event, node_dir.name)
                ordered_events.append((event_sort_key(nested_event), sequence, nested_event))
                sequence += 1

    ordered_events.sort(key=lambda item: (item[0], item[1]))
    return [event for _, _, event in ordered_events[-limit:]]


def annotate_nested_event(event: dict[str, Any], parent_node_id: str) -> dict[str, Any]:
    nested_event = dict(event)
    nested_event["nested"] = True
    nested_event["parent_node_id"] = parent_node_id
    node_id = nested_event.get("node_id")
    if isinstance(node_id, str) and node_id:
        nested_event.setdefault("ui_node_id", f"{parent_node_id}__internal__{node_id}")
    return nested_event


def event_sort_key(event: dict[str, Any]) -> str:
    timestamp = event.get("timestamp")
    return timestamp if isinstance(timestamp, str) else ""


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
