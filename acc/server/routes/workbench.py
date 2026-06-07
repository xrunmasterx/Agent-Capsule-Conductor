from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from acc.app.workbench_snapshots import WorkbenchCanvasSnapshotService
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
