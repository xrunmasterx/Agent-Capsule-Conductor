from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict

from acc.app.workbench_boundary_transfer import preview_boundary_transfer_for_canvas_snapshot
from acc.app.workbench_snapshots import WorkbenchCanvasSnapshotService
from acc.app.workbench_tasks import WorkbenchTaskService
from acc.server.context import get_project_root
from acc.utils import AccError

router = APIRouter(prefix="/workbench", tags=["workbench"])


class WorkbenchCanvasSnapshotRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    canvas_hash: str
    canvas_snapshot: dict[str, Any]
    selection: dict[str, Any] | None = None
    temporary_resources: dict[str, Any] | None = None


class WorkbenchTaskCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    title: str = "Untitled task"
    saved_workflow_ref: str | None = None
    active_run_id: str | None = None
    latest_run_id: str | None = None
    retention: dict[str, Any] | None = None


class WorkbenchTaskUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    saved_workflow_ref: str | None = None
    active_run_id: str | None = None
    latest_run_id: str | None = None
    retention: dict[str, Any] | None = None


class WorkbenchTaskCanvasRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    canvas_hash: str
    canvas_snapshot: dict[str, Any]
    selection: dict[str, Any] | None = None
    temporary_resources: dict[str, Any] | None = None
    base_canvas_hash: str | None = None


class WorkbenchBoundaryTransferPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    canvas_snapshot: dict[str, Any]
    edge_id: str | None = None


@router.get("/tasks")
def list_tasks(request: Request) -> dict[str, Any]:
    return task_service_for(request).list_tasks()


@router.post("/tasks")
def create_task(payload: WorkbenchTaskCreateRequest, request: Request) -> dict[str, Any]:
    try:
        return task_service_for(request).create(payload.model_dump())
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/tasks/{task_id}")
def get_task(task_id: str, request: Request) -> dict[str, Any]:
    try:
        return task_service_for(request).get(task_id)
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/tasks/{task_id}")
def update_task(
    task_id: str,
    payload: WorkbenchTaskUpdateRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return task_service_for(request).update(task_id, payload.model_dump(exclude_unset=True))
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str, request: Request) -> dict[str, Any]:
    try:
        task = task_service_for(request).tombstone(task_id)
        return {"status": "deleted", "task": task}
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/tasks/{task_id}/canvas")
def put_task_canvas(
    task_id: str,
    payload: WorkbenchTaskCanvasRequest,
    request: Request,
    if_match: str | None = Header(default=None, alias="If-Match"),
    include_snapshot: bool = Query(default=False),
) -> dict[str, Any]:
    base_canvas_hash = payload.base_canvas_hash or normalized_if_match(if_match)
    try:
        saved = task_service_for(request).put_canvas(
            task_id,
            payload.model_dump(),
            base_canvas_hash=base_canvas_hash,
        )
        if include_snapshot:
            return saved
        return slim_canvas_save_ack(saved)
    except AccError as exc:
        status = 409 if "stale" in str(exc).lower() else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@router.get("/tasks/{task_id}/canvas")
def get_task_canvas(task_id: str, request: Request) -> dict[str, Any]:
    try:
        return task_service_for(request).get_canvas(task_id)
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/boundary-transfer/preview")
def preview_boundary_transfer(
    payload: WorkbenchBoundaryTransferPreviewRequest,
) -> dict[str, Any]:
    return preview_boundary_transfer_for_canvas_snapshot(
        payload.canvas_snapshot,
        edge_id=payload.edge_id,
    )


@router.post("/canvas-snapshots")
def publish_canvas_snapshot(
    payload: WorkbenchCanvasSnapshotRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return service_for(request).publish(payload.model_dump())
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/canvas-snapshots/{task_id}")
def get_canvas_snapshot(task_id: str, request: Request) -> dict[str, Any]:
    try:
        return service_for(request).get(task_id)
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def service_for(request: Request) -> WorkbenchCanvasSnapshotService:
    return WorkbenchCanvasSnapshotService(get_project_root(request))


def task_service_for(request: Request) -> WorkbenchTaskService:
    return WorkbenchTaskService(get_project_root(request))


def normalized_if_match(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip()
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        return text[1:-1]
    return text


def slim_canvas_save_ack(saved: dict[str, Any]) -> dict[str, Any]:
    return {
        "task_id": saved["task_id"],
        "canvas_hash": saved["canvas_hash"],
        "saved_at": saved.get("published_at") or saved.get("updated_at"),
    }
