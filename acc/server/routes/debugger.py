from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from acc.debugger import (
    diff_runs,
    fork_run,
    replay_workflow_events,
    rerun_from_node,
    rerun_single_node,
)
from acc.server.context import get_project_root, resolve_inside_project
from acc.utils import AccError

router = APIRouter(prefix="/debugger", tags=["debugger"])


class ReplayRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_id: str | None = None


class LineageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    out_dir: str


class ForkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    out_dir: str
    override: dict[str, Any] | None = None


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


@router.post("/runs/{run_id}/nodes/{node_id}/rerun")
def rerun_node(
    run_id: str,
    node_id: str,
    payload: LineageRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return rerun_single_node(
            resolve_run_dir(request, run_id),
            node_id,
            resolve_inside_project(get_project_root(request), payload.out_dir),
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/runs/{run_id}/nodes/{node_id}/rerun-from")
def rerun_from(
    run_id: str,
    node_id: str,
    payload: LineageRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return rerun_from_node(
            resolve_run_dir(request, run_id),
            node_id,
            resolve_inside_project(get_project_root(request), payload.out_dir),
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/runs/{run_id}/nodes/{node_id}/fork")
def fork_node(run_id: str, node_id: str, payload: ForkRequest, request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    out_dir = resolve_inside_project(project_root, payload.out_dir)
    override_dir = project_root / "runs" / "_ui_debugger_overrides"
    override_dir.mkdir(parents=True, exist_ok=True)
    override_path = override_dir / f"{run_id}_{node_id}_fork_override.json"
    override_path.write_text(
        json.dumps(payload.override or {}, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    try:
        return fork_run(resolve_run_dir(request, run_id), node_id, override_path, out_dir)
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
