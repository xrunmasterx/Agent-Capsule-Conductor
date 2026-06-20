from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict

from acc.app import WorkflowAppService
from acc.app.run_lifecycle import is_terminal_run_status
from acc.app.workbench_tasks import WorkbenchTaskService
from acc.run_index import load_run_summary_by_id
from acc.runner import (
    LOCAL_TOKEN_HEADER,
    LocalRunnerService,
    RunnerCapabilityError,
    validate_local_token,
)
from acc.server.context import get_project_root, get_workbench_run_manager
from acc.server.routes import runs as runs_routes
from acc.server.routes import workflows as workflow_routes
from acc.server.run_manager import WorkbenchRunJob
from acc.storage import claim_run
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
    service = service_for(request)
    job_id = payload.job_id or service.new_job_id()
    workflow_id = str(payload.graph.get("id") or "")
    try:
        workflow_routes.preflight_runtime_graph(payload.graph, request, task_id=payload.task_id)
        resolved = service.validate_job_before_evidence(
            graph=payload.graph,
            workspace_alias=payload.workspace_alias,
            binding_ref=payload.binding_ref,
            manager=get_workbench_run_manager(request),
        )
        handle = claim_run(
            project_root,
            run_id=payload.run_id,
            workflow_id=workflow_id,
            task_id=payload.task_id,
        )
        graph_path = workflow_routes.prepare_runtime_graph(
            payload.graph,
            handle.run_dir,
            request,
            task_id=payload.task_id,
        )
        manager = get_workbench_run_manager(request)
        submit_result = await manager.submit(
            WorkbenchRunJob(
                graph_path=graph_path,
                run_dir=handle.run_dir,
                workflow_id=workflow_id,
                task_id=payload.task_id,
                workspace=None if resolved["binding_path"] else resolved["workspace"],
                binding_path=resolved["binding_path"],
                input_payload=payload.input,
                service_factory=lambda: WorkflowAppService(project_root=project_root),
            )
        )
        remember_workbench_task_run(project_root, payload.task_id, handle.run_id)
        return service.write_job_receipt(
            job_id=job_id,
            status=str(submit_result.get("status") or "queued"),
            workspace_alias=payload.workspace_alias,
            run_id=handle.run_id,
            task_id=payload.task_id,
            workflow_id=workflow_id,
        )
    except RunnerCapabilityError as exc:
        receipt = service.write_job_receipt(
            job_id=job_id,
            status="rejected",
            workspace_alias=payload.workspace_alias,
            task_id=payload.task_id,
            workflow_id=workflow_id,
            rejection=exc.to_payload(),
        )
        raise HTTPException(
            status_code=400,
            detail={**exc.to_payload(), "job": receipt},
        ) from exc
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


def remember_workbench_task_run(project_root: Path, task_id: str | None, run_id: str) -> None:
    """Best-effort index update for Workbench-owned runner submissions.

    The runner API also accepts ``task_id`` as loose metadata for non-Workbench
    callers. Missing or invalid Workbench task records must not turn a valid
    runner submission into a failed request after the run has been queued.
    """

    if not task_id:
        return
    try:
        WorkbenchTaskService(project_root).update(
            task_id,
            {
                "active_run_id": None,
                "latest_run_id": run_id,
            },
        )
    except AccError:
        return


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
