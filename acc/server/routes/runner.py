from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict

from acc.app.workflow_submission import (
    RunnerJobSubmissionRequest,
    RunnerSubmissionRejected,
    SubmissionError,
    WorkflowSubmissionService,
)
from acc.run_index import load_run_summary_by_id
from acc.run_status import is_terminal_run_status
from acc.runner import (
    LOCAL_TOKEN_HEADER,
    LocalRunnerService,
    RunnerCapabilityError,
    validate_local_token,
)
from acc.server.context import get_project_root, get_workbench_run_manager
from acc.server.routes import runs as runs_routes
from acc.utils import AccError

router = APIRouter(prefix="/runner", tags=["runner"])


class RunnerWorkspaceCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    alias: str
    display_name: str | None = None
    local_path: str


class RunnerJobCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    graph: dict[str, Any]
    job_id: str | None = None
    run_id: str | None = None
    task_id: str | None = None
    workspace_alias: str = "default"
    binding_ref: str | None = None
    input: dict[str, Any] | None = None


@router.get("/health")
def runner_health(request: Request) -> dict[str, Any]:
    return service_for(request).health()


@router.get("/capabilities")
def runner_capabilities(request: Request) -> dict[str, Any]:
    return service_for(request).capabilities(write=True)


@router.get("/providers")
def runner_providers(request: Request) -> dict[str, Any]:
    service = service_for(request)
    return {
        "runner_id": service.ensure_runner_record()["runner_id"],
        "provider_status": service.provider_status(),
    }


@router.get("/workspaces")
def runner_workspaces(
    request: Request,
    local_debug: bool = Query(False),
) -> dict[str, Any]:
    require_debug_auth_if_needed(request, local_debug)
    return service_for(request).workspaces(local_debug=local_debug)


@router.post("/workspaces")
def create_runner_workspace(
    payload: RunnerWorkspaceCreateRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return service_for(request).add_workspace(
            payload.alias,
            payload.local_path,
            display_name=payload.display_name,
        )
    except RunnerCapabilityError as exc:
        raise HTTPException(status_code=400, detail=exc.to_payload()) from exc


@router.post("/jobs")
async def submit_runner_job(
    payload: RunnerJobCreateRequest,
    request: Request,
) -> dict[str, Any]:
    project_root = get_project_root(request)
    runner_service = service_for(request)
    service = WorkflowSubmissionService(
        project_root,
        get_workbench_run_manager(request),
        local_runner_service=runner_service,
    )
    try:
        return await service.submit_runner_job(
            RunnerJobSubmissionRequest(
                graph=payload.graph,
                job_id=payload.job_id,
                run_id=payload.run_id,
                task_id=payload.task_id,
                workspace_alias=payload.workspace_alias,
                binding_ref=payload.binding_ref,
                input_payload=payload.input,
            )
        )
    except RunnerSubmissionRejected as exc:
        raise HTTPException(status_code=400, detail=exc.detail) from exc
    except SubmissionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/jobs/{job_id}")
def get_runner_job(job_id: str, request: Request) -> dict[str, Any]:
    try:
        return service_for(request).get_job(job_id)
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/jobs/{job_id}/cancel")
async def cancel_runner_job(job_id: str, request: Request) -> dict[str, Any]:
    service = service_for(request)
    try:
        job = service.get_job(job_id)
        run_id = job.get("run_id")
        if not isinstance(run_id, str) or not run_id:
            return service.update_job_status(job_id, "cancelled")
        try:
            result = await get_workbench_run_manager(request).cancel(run_id)
            service.update_job_status(job_id, str(result.get("status") or "cancel_requested"))
            return service.get_job(job_id)
        except AccError:
            summary = load_run_summary_by_id(run_id, get_project_root(request) / "runs")
            if is_terminal_run_status(summary.status):
                return service.update_job_status(job_id, summary.status)
            raise
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/runs/{run_id}/projection")
def runner_run_projection(
    run_id: str,
    request: Request,
    local_debug: bool = Query(False),
) -> dict[str, Any]:
    require_debug_auth_if_needed(request, local_debug)
    try:
        return service_for(request).run_projection(run_id, local_debug=local_debug)
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/runs/{run_id}/stream")
async def runner_run_stream(run_id: str, request: Request):
    return await runs_routes.stream_run(run_id, request)


@router.get("/artifacts/{artifact_id}/preview")
def runner_artifact_preview(artifact_id: str, request: Request) -> dict[str, Any]:
    try:
        return service_for(request).artifact_preview(artifact_id)
    except RunnerCapabilityError as exc:
        if exc.code == "artifact_not_found":
            status_code = 404
        elif exc.code == "artifact_policy_denied":
            status_code = 403
        else:
            status_code = 400
        raise HTTPException(status_code=status_code, detail=exc.to_payload()) from exc


def service_for(request: Request) -> LocalRunnerService:
    return LocalRunnerService(get_project_root(request))


def require_debug_auth_if_needed(request: Request, local_debug: bool) -> None:
    if not local_debug:
        return
    token = request.headers.get(LOCAL_TOKEN_HEADER)
    if not validate_local_token(Path(get_project_root(request)), token):
        raise HTTPException(
            status_code=401,
            detail={
                "code": "auth_missing",
                "message": "local_debug requires the local runner token",
            },
        )
