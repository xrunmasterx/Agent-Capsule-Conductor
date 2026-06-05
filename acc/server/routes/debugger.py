from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from acc.debugger import (
    diff_runs,
    replay_workflow_events,
)
from acc.server.context import get_project_root, resolve_inside_project
from acc.utils import AccError

router = APIRouter(prefix="/debugger", tags=["debugger"])


class ReplayRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_id: str | None = None


class DiffRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_a: str
    run_b: str


@router.post("/runs/{run_id}/replay")
def replay_run(run_id: str, payload: ReplayRequest, request: Request) -> dict[str, Any]:
    try:
        return replay_workflow_events(resolve_run_dir(request, run_id), payload.node_id)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/diff")
def diff_runs_endpoint(payload: DiffRequest, request: Request) -> dict[str, Any]:
    try:
        return diff_runs(
            resolve_inside_project(get_project_root(request), payload.run_a),
            resolve_inside_project(get_project_root(request), payload.run_b),
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def resolve_run_dir(request: Request, run_id: str) -> Path:
    return resolve_inside_project(get_project_root(request), Path("runs") / run_id)
