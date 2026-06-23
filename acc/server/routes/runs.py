from __future__ import annotations

import json
from collections import deque
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from acc.agent_events import ensure_agent_event_projection
from acc.app.control_projection import (
    load_control_ledger_projection,
    load_decisions_projection,
    load_dispatches_projection,
    load_plan_steps_projection,
    load_run_plan_projection,
)
from acc.app.run_events import RunEventProjectionService
from acc.app.run_projection import build_node_run_projection
from acc.control_plane import SecretLikePathError, reject_secret_like_path
from acc.result_store.filesystem import FilesystemResultStore
from acc.result_store.types import NodeId, RunId
from acc.run_index import NodeRunSummary, load_or_rebuild_run_index, load_run_summary_by_id
from acc.server.context import (
    get_project_root,
    get_workbench_run_manager,
    is_relative_to,
    relative_project_path,
)
from acc.server.live_events import LiveEventProjectionService
from acc.server.run_projection import RunProjection
from acc.storage import validate_run_id
from acc.storage_refs import make_node_artifact_ref
from acc.utils import AccError

router = APIRouter(prefix="/runs", tags=["runs"])
STREAM_HEARTBEAT_INTERVAL_SECONDS = 15.0
STREAM_AGENT_EVENT_BATCH_LIMIT = 200
STREAM_INITIAL_FRAME_BUDGET = 1000
STREAM_INITIAL_BYTE_BUDGET = 1024 * 1024
STREAM_NODE_LOG_TAIL_BYTES = 16 * 1024
STREAM_NODE_LOG_LIVE_BYTES = 64 * 1024
STREAM_AGENT_EVENT_TAIL_LIMIT = 200


@router.get("")
def list_runs(request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    index = load_or_rebuild_run_index(project_root / "runs")
    return index.model_dump()


@router.get("/{run_id}")
def get_run(run_id: str, request: Request) -> dict[str, Any]:
    validate_http_run_id(run_id)
    return load_run_or_404(run_id, request).model_dump()


@router.get("/{run_id}/state")
def get_run_state(run_id: str, request: Request) -> dict[str, Any]:
    run_dir = resolve_run_dir_or_404(run_id, request)
    return RunEventProjectionService(run_dir).read_run_state_snapshot()


@router.get("/{run_id}/plan")
def get_run_plan(run_id: str, request: Request) -> dict[str, Any]:
    run_dir = resolve_run_dir_or_404(run_id, request)
    return project_events_ref(load_run_plan_projection(run_dir), request)


@router.get("/{run_id}/steps")
def get_run_plan_steps(run_id: str, request: Request) -> dict[str, Any]:
    run_dir = resolve_run_dir_or_404(run_id, request)
    return project_events_ref(load_plan_steps_projection(run_dir), request)


@router.get("/{run_id}/dispatches")
def get_run_dispatches(run_id: str, request: Request) -> dict[str, Any]:
    run_dir = resolve_run_dir_or_404(run_id, request)
    return project_events_ref(load_dispatches_projection(run_dir), request)


@router.get("/{run_id}/decisions")
def get_run_decision_records(run_id: str, request: Request) -> dict[str, Any]:
    run_dir = resolve_run_dir_or_404(run_id, request)
    return project_events_ref(load_decisions_projection(run_dir), request)


@router.get("/{run_id}/control-ledger")
def get_run_control_ledger(run_id: str, request: Request) -> dict[str, Any]:
    run_dir = resolve_run_dir_or_404(run_id, request)
    return project_events_ref(load_control_ledger_projection(run_dir), request)


@router.post("/{run_id}/cancel")
async def cancel_run(run_id: str, request: Request) -> dict[str, Any]:
    validate_http_run_id(run_id)
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
        except SecretLikePathError:
            continue
        artifact_relative_path = str(path.relative_to(artifact_dir)).replace("\\", "/")
        artifact_ref = make_node_artifact_ref(run_id, node_id, artifact_relative_path)
        legacy_artifact_ref = f"run:{run_id}:node:{node_id}:artifact:{artifact_relative_path}"
        rel_path = relative_project_path(project_root, path)
        artifacts.append(
            {
                "name": path.name,
                "path": rel_path,
                "artifact_ref": artifact_ref,
                "legacy_artifact_ref": legacy_artifact_ref,
                "read_url": f"/api/artifacts/read?path={artifact_ref}",
                "size_bytes": path.stat().st_size,
            }
        )
    return {"run_id": run_id, "node_id": node_id, "artifacts": artifacts}


@router.get("/{run_id}/evidence")
def read_run_evidence(run_id: str, path: str, request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    run_dir = resolve_run_dir_or_404(run_id, request)
    evidence_path = resolve_run_evidence_path(path, project_root=project_root, run_dir=run_dir)
    try:
        reject_secret_like_path(evidence_path)
    except SecretLikePathError as exc:
        raise HTTPException(
            status_code=403,
            detail={"code": "artifact_policy_denied", "message": str(exc)},
        ) from exc
    if not evidence_path.exists() or not evidence_path.is_file():
        raise HTTPException(status_code=404, detail=f"Run evidence not found: {path}")
    try:
        content = evidence_path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=415, detail=f"Run evidence is not UTF-8 text: {path}"
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=404, detail=f"Run evidence not readable: {path}") from exc
    return {
        "artifact_ref": path,
        "path": relative_project_path(project_root, evidence_path),
        "name": evidence_path.name,
        "type": infer_evidence_type(evidence_path),
        "size_bytes": evidence_path.stat().st_size,
        "content": content,
    }


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
        validate_http_run_id(run_id)
        event_log = project_root / "runs" / run_id / "events.jsonl"
        return {
            "run_id": run_id,
            "event_log": relative_project_path(project_root, event_log),
            "events": [],
        }
    event_log = run_dir / "events.jsonl"
    event_projection = RunEventProjectionService(run_dir)
    return {
        "run_id": run_id,
        "event_log": relative_project_path(project_root, event_log),
        "events": event_projection.read_run_events_with_nested(limit=limit),
    }


@router.get("/{run_id}/nodes/{node_id}/events")
def get_node_events(
    run_id: str,
    node_id: str,
    request: Request,
    limit: int = Query(200, ge=1, le=1000),
    node_run_dir: str | None = Query(None),
) -> dict[str, Any]:
    project_root = get_project_root(request)
    run_dir = resolve_run_dir_or_404(run_id, request)
    validate_path_component(node_id, "node_id")
    if node_run_dir:
        node_dir = resolve_run_evidence_path(
            node_run_dir, project_root=project_root, run_dir=run_dir
        )
        if not node_dir.is_dir() or node_dir.name != node_id:
            raise HTTPException(status_code=400, detail="node_run_dir does not match node_id")
    else:
        node_dir = run_dir / "nodes" / node_id
    event_log = node_dir / "events.jsonl"
    event_projection = RunEventProjectionService(run_dir)
    return {
        "run_id": run_id,
        "node_id": node_id,
        "event_log": relative_project_path(project_root, event_log),
        "events": event_projection.read_node_events_with_agent(
            node_id,
            limit=limit,
            node_run_dir=str(node_dir.resolve()) if node_run_dir else None,
        ),
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
    return RunEventProjectionService(run_dir).read_node_log_delta(
        node_id,
        stream,
        offset=offset,
        limit=limit,
    )


@router.get("/{run_id}/stream")
async def stream_run(
    run_id: str,
    request: Request,
    after_seq: int = Query(0, ge=0),
    history: str = Query("none", pattern="^(none|tail|full)$"),
    tail_bytes: int = Query(STREAM_NODE_LOG_TAIL_BYTES, ge=0, le=262144),
    tail_events: int = Query(STREAM_AGENT_EVENT_TAIL_LIMIT, ge=0, le=1000),
) -> StreamingResponse:
    run_dir = resolve_run_dir_or_404(run_id, request)
    service = LiveEventProjectionService(
        run_dir,
        history=history if isinstance(history, str) else "none",
        tail_bytes=tail_bytes if isinstance(tail_bytes, int) else STREAM_NODE_LOG_TAIL_BYTES,
        tail_events=tail_events if isinstance(tail_events, int) else STREAM_AGENT_EVENT_TAIL_LIMIT,
        heartbeat_seconds=STREAM_HEARTBEAT_INTERVAL_SECONDS,
    )

    async def event_source():
        async for frame in service.stream_sse(
            request,
            after_seq=after_seq if isinstance(after_seq, int) else 0,
        ):
            yield frame

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
    return RunEventProjectionService(run_dir).read_node_log_delta(
        node_id,
        stream,
        offset=offset,
        limit=limit,
    )


def read_node_log_delta_from_dir(
    node_dir: Path,
    run_id: str,
    node_id: str,
    stream: str,
    *,
    offset: int,
    limit: int,
) -> dict[str, Any]:
    run_dir = root_run_dir_for_node_dir(node_dir)
    return RunEventProjectionService(run_dir).read_node_log_delta(
        node_id,
        stream,
        offset=offset,
        limit=limit,
        node_run_dir=str(node_dir.resolve()),
    )


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


def effective_node_log_path(run_dir: Path, node_id: str, stream: str) -> Path:
    return effective_node_log_path_for_dir(run_dir / "nodes" / node_id, stream)


def effective_node_log_path_for_dir(node_dir: Path, stream: str) -> Path:
    return RunEventProjectionService(root_run_dir_for_node_dir(node_dir)).resolve_effective_log(
        node_dir,
        stream,
    )


def resolve_run_evidence_path(path: str, *, project_root: Path, run_dir: Path) -> Path:
    if not path:
        raise HTTPException(status_code=400, detail="Evidence path is required")
    candidate = Path(path)
    resolved = (
        candidate.resolve() if candidate.is_absolute() else (project_root / candidate).resolve()
    )
    if not is_relative_to(resolved, run_dir):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "artifact_policy_denied",
                "message": "Run evidence path must stay inside the requested run directory",
            },
        )
    return resolved


def infer_evidence_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".md":
        return "markdown"
    if suffix == ".json":
        return "json"
    if suffix in {".log", ".jsonl"}:
        return "log"
    if suffix in {".patch", ".diff"}:
        return "patch"
    return "text"


def is_valid_agent_session_dir_for_node(node_dir: Path, session_dir: Path) -> bool:
    return RunEventProjectionService(
        root_run_dir_for_node_dir(node_dir)
    ).is_valid_agent_session_dir_for_node(node_dir, session_dir)


def is_safe_path_component(value: str) -> bool:
    return (
        value not in {"", ".", ".."}
        and Path(value).name == value
        and "/" not in value
        and "\\" not in value
    )


def iter_node_dirs(run_dir: Path) -> list[Path]:
    nodes_dir = run_dir / "nodes"
    if not nodes_dir.exists() or not nodes_dir.is_dir():
        return []
    return sorted(item for item in nodes_dir.iterdir() if item.is_dir())


def iter_stream_node_refs(run_dir: Path) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    for identity in RunEventProjectionService(run_dir).iter_node_identities():
        refs.append(
            {
                "node_id": identity.node_id,
                "node_dir": identity.node_dir,
                **identity.stream_identity(),
            }
        )
    return refs


def iter_nested_stream_node_refs(
    nested_run_dir: Path,
    parent_ui_node_id: str,
) -> list[dict[str, Any]]:
    run_dir = root_run_dir_for_node_dir(nested_run_dir)
    prefix = f"{parent_ui_node_id}__internal__"
    refs: list[dict[str, Any]] = []
    for identity in RunEventProjectionService(run_dir).iter_node_identities():
        if identity.ui_node_id and identity.ui_node_id.startswith(prefix):
            refs.append(
                {
                    "node_id": identity.node_id,
                    "node_dir": identity.node_dir,
                    **identity.stream_identity(),
                }
            )
    return refs


def stream_node_identity(node_ref: dict[str, Any]) -> dict[str, Any]:
    identity: dict[str, Any] = {}
    for key in ("ui_node_id", "parent_node_id", "node_run_dir"):
        value = node_ref.get(key)
        if isinstance(value, str) and value:
            identity[key] = value
    return identity


def _build_run_projection(run_dir: Path) -> RunProjection:
    return RunProjection(
        result_store=FilesystemResultStore(run_dir.parent),
        run_dir=run_dir,
    )


def root_run_dir_for_node_dir(path: Path) -> Path:
    current = path.resolve()
    while current != current.parent:
        if current.parent.name == "runs":
            return current
        current = current.parent
    return path.resolve()


def project_events_ref(payload: dict[str, Any], request: Request) -> dict[str, Any]:
    events_ref = payload.get("events_ref")
    if isinstance(events_ref, str) and events_ref:
        payload = dict(payload)
        payload["events_ref"] = relative_project_path(get_project_root(request), Path(events_ref))
    return payload


def load_run_or_404(run_id: str, request: Request):
    validate_http_run_id(run_id)
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
    validate_http_run_id(run_id)
    project_root = get_project_root(request)
    run_dir = (project_root / "runs" / run_id).resolve()
    runs_root = (project_root / "runs").resolve()
    if not run_dir.is_relative_to(runs_root) or not run_dir.exists() or not run_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
    return run_dir


def validate_path_component(value: str, label: str) -> None:
    if value in {"", ".", ".."} or Path(value).name != value or "/" in value or "\\" in value:
        raise HTTPException(status_code=400, detail=f"Invalid {label}: {value}")


def validate_http_run_id(run_id: str) -> None:
    try:
        validate_run_id(run_id)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
    return RunEventProjectionService(run_dir).read_run_events_with_nested(limit=limit)


def read_node_events_with_agent(
    run_dir: Path,
    node_id: str,
    limit: int,
) -> list[dict[str, Any]]:
    return RunEventProjectionService(run_dir).read_node_events_with_agent(
        node_id,
        limit=limit,
    )


def effective_agent_event_log_path(run_dir: Path, node_id: str) -> Path | None:
    return effective_agent_event_log_path_for_dir(run_dir / "nodes" / node_id)


def effective_agent_event_log_path_for_dir(node_dir: Path) -> Path | None:
    return RunEventProjectionService(
        root_run_dir_for_node_dir(node_dir)
    ).resolve_agent_turn_event_log(node_dir)


def project_agent_event(
    event: dict[str, Any],
    *,
    run_id: str,
    node_id: str,
    fallback_event_seq: int | None = None,
) -> dict[str, Any]:
    projected = ensure_agent_event_projection(event, fallback_event_seq=fallback_event_seq)
    projected["source"] = "agent_session"
    projected["run_id"] = projected.get("run_id") or run_id
    projected["node_id"] = projected.get("node_id") or node_id
    projected["agent_session_id"] = projected.get("session_id")
    projected["agent_turn_id"] = projected.get("turn_id")
    return projected


def load_json_tolerant(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def read_nested_workflow_events(
    run_dir: Path,
    parent_ui_node_id: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    events = RunEventProjectionService(
        root_run_dir_for_node_dir(run_dir)
    ).read_nested_workflow_events(limit=limit)
    if parent_ui_node_id is None:
        return events
    return [
        event
        for event in events
        if isinstance(event.get("parent_node_id"), str)
        and str(event["parent_node_id"]).startswith(parent_ui_node_id)
    ]


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
