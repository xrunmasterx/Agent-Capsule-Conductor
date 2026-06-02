from __future__ import annotations

import asyncio
import json
from collections import deque
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from acc.app.run_projection import build_node_run_projection
from acc.result_store.filesystem import FilesystemResultStore
from acc.result_store.types import NodeId, RunId
from acc.run_index import NodeRunSummary, load_or_rebuild_run_index, load_run_summary_by_id
from acc.server.context import (
    get_project_root,
    get_workbench_run_manager,
    is_relative_to,
    reject_secret_like_path,
    relative_project_path,
)
from acc.server.run_projection import RunProjection
from acc.session import utc_now_iso
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


@router.post("/{run_id}/cancel")
async def cancel_run(run_id: str, request: Request) -> dict[str, Any]:
    validate_path_component(run_id, "run_id")
    try:
        return await get_workbench_run_manager(request).cancel(run_id)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{run_id}/nodes/{node_id}")
def get_node(run_id: str, node_id: str, request: Request) -> dict[str, Any]:
    node = find_node_or_404(run_id, node_id, request)
    payload = build_node_run_projection(node, project_root=get_project_root(request))
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
    try:
        run_dir = resolve_run_dir_or_404(run_id, request)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        if not run_id.startswith("ui_workflow_"):
            raise
        validate_path_component(run_id, "run_id")
        event_log = project_root / "runs" / run_id / "events.jsonl"
        return {
            "run_id": run_id,
            "event_log": relative_project_path(project_root, event_log),
            "events": [],
        }
    event_log = run_dir / "events.jsonl"
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
    event_log = run_dir / "nodes" / node_id / "events.jsonl"
    return {
        "run_id": run_id,
        "node_id": node_id,
        "event_log": relative_project_path(project_root, event_log),
        "events": read_jsonl_tolerant(event_log, limit=limit),
    }


@router.get("/{run_id}/nodes/{node_id}/logs/{stream}")
def get_node_log_delta(
    run_id: str,
    node_id: str,
    stream: str,
    request: Request,
    offset: int = Query(0, ge=0),
    limit: int = Query(65536, ge=1, le=262144),
) -> dict[str, Any]:
    run_dir = resolve_run_dir_or_404(run_id, request)
    validate_path_component(node_id, "node_id")
    if stream not in {"stdout", "stderr"}:
        raise HTTPException(status_code=400, detail=f"Invalid log stream: {stream}")
    return read_node_log_delta(run_dir, run_id, node_id, stream, offset=offset, limit=limit)


@router.get("/{run_id}/stream")
async def stream_run(run_id: str, request: Request) -> StreamingResponse:
    run_dir = resolve_run_dir_or_404(run_id, request)

    async def event_source():
        offsets: dict[tuple[str, str], int] = {}
        while not await request.is_disconnected():
            for node_dir in iter_node_dirs(run_dir):
                node_id = node_dir.name
                for stream_name in ("stdout", "stderr"):
                    key = (node_id, stream_name)
                    delta = read_node_log_delta(
                        run_dir,
                        run_id,
                        node_id,
                        stream_name,
                        offset=offsets.get(key, 0),
                        limit=65536,
                    )
                    offsets[key] = int(delta["next_offset"])
                    if delta["text"]:
                        payload = {
                            "type": "node_log_delta",
                            "run_id": run_id,
                            "node_id": node_id,
                            "stream": stream_name,
                            "offset": delta["offset"],
                            "next_offset": delta["next_offset"],
                            "text": delta["text"],
                            "timestamp": utc_now_iso(),
                        }
                        data = json.dumps(payload, ensure_ascii=False)
                        yield f"event: node_log_delta\ndata: {data}\n\n"

            summary_path = run_dir / "run_summary.json"
            if summary_path.exists():
                try:
                    summary = json.loads(summary_path.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    summary = None
                if isinstance(summary, dict) and summary.get("status") in {
                    "success",
                    "failed",
                    "cancelled",
                    "crashed",
                }:
                    payload = {"type": "summary", "run_id": run_id, "summary": summary}
                    yield f"event: summary\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                    break
            await asyncio.sleep(0.5)

    return StreamingResponse(event_source(), media_type="text/event-stream")


@router.get("/{run_id}/projection/nodes")
def list_projection_nodes(run_id: str, request: Request) -> dict[str, Any]:
    run_dir = resolve_run_dir_or_404(run_id, request)
    projection = _build_run_projection(run_dir)
    views = projection.list_nodes(RunId(run_id))
    return {
        "run_id": run_id,
        "nodes": [view.to_jsonable() for view in views],
    }


@router.get("/{run_id}/projection/nodes/{node_id}")
def get_projection_node(run_id: str, node_id: str, request: Request) -> dict[str, Any]:
    run_dir = resolve_run_dir_or_404(run_id, request)
    validate_path_component(node_id, "node_id")
    projection = _build_run_projection(run_dir)
    view = projection.get_node(RunId(run_id), NodeId(node_id))
    if view is None:
        raise HTTPException(
            status_code=404,
            detail=f"No ResultStore record for node: {node_id}",
        )
    return view.to_jsonable()


@router.get("/{run_id}/projection/outputs/{target_field}")
def get_projection_workflow_output(
    run_id: str, target_field: str, request: Request
) -> dict[str, Any]:
    run_dir = resolve_run_dir_or_404(run_id, request)
    validate_path_component(target_field, "target_field")
    projection = _build_run_projection(run_dir)
    view = projection.get_workflow_output(RunId(run_id), target_field)
    if view is None:
        raise HTTPException(
            status_code=404,
            detail=f"No workflow output for target_field: {target_field}",
        )
    return view.to_jsonable()


def read_node_log_delta(
    run_dir: Path,
    run_id: str,
    node_id: str,
    stream: str,
    *,
    offset: int,
    limit: int,
) -> dict[str, Any]:
    log_path = run_dir / "nodes" / node_id / f"{stream}.log"
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


def iter_node_dirs(run_dir: Path) -> list[Path]:
    nodes_dir = run_dir / "nodes"
    if not nodes_dir.exists() or not nodes_dir.is_dir():
        return []
    return sorted(item for item in nodes_dir.iterdir() if item.is_dir())


def _build_run_projection(run_dir: Path) -> RunProjection:
    return RunProjection(
        result_store=FilesystemResultStore(run_dir.parent),
        run_dir=run_dir,
    )


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
    for event in read_jsonl_tolerant(run_dir / "events.jsonl", limit=limit):
        ordered_events.append((event_sort_key(event), sequence, event))
        sequence += 1

    nodes_dir = run_dir / "nodes"
    if nodes_dir.exists() and nodes_dir.is_dir():
        for node_dir in sorted(item for item in nodes_dir.iterdir() if item.is_dir()):
            nested_event_log = node_dir / "nested_workflow" / "events.jsonl"
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
