from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

import yaml
from fastapi import APIRouter, HTTPException, Request
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError
from pydantic import BaseModel, ConfigDict

from acc.app import WorkflowAppService
from acc.app.local_directory_picker import LocalDirectorySelection, select_local_directory
from acc.app.workbench_adapter import (
    CompiledWorkbenchWorkflowBundle,
    canonicalize_workbench_workflow_payload,
    compile_workbench_workflow_bundle,
    merge_workbench_snapshot_projection,
)
from acc.app.workbench_snapshots import WorkbenchCanvasSnapshotService
from acc.app.workflow_refs import WorkflowCatalog, WorkflowRefMode, rewrite_workflow_function_refs
from acc.callable_registry import CallableRegistry
from acc.server.context import (
    configured_project_dir,
    get_project_root,
    get_workbench_run_manager,
    relative_project_path,
)
from acc.server.run_manager import WorkbenchRunJob
from acc.runner import LocalRunnerService, RunnerCapabilityError
from acc.storage import (
    RunHandle,
    claim_run,
    generate_run_id,
    parse_legacy_run_dir,
    resolve_run_dir as storage_run_dir,
    validate_run_id,
)
from acc.utils import AccError, load_json

router = APIRouter(prefix="/workflows", tags=["workflows"])


@dataclass(frozen=True)
class PreparedRuntimeGraph:
    workflow_id: str
    graph_dir: Path
    accflow_path: Path
    workflows_dir: Path
    bundle: CompiledWorkbenchWorkflowBundle
    child_name_map: dict[str, str]


class WorkflowSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    graph: dict[str, Any]
    path: str | None = None
    force: bool = False


class WorkflowRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str | None = None
    run_dir: str | None = None
    binding_path: str | None = None
    binding_ref: str | None = None
    workspace: str | None = None
    workspace_alias: str | None = None
    input: dict[str, Any] | None = None


class WorkflowRunGraphRequest(WorkflowRunRequest):
    graph: dict[str, Any]
    task_id: str | None = None


class WorkflowBindingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_root: str


class WorkflowDirectorySelectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    initial_dir: str | None = None


@router.get("")
def list_workflows(request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    workflows_dir = configured_project_dir(project_root, "ACC_WORKFLOWS_DIR", "workflows")
    if not workflows_dir.exists():
        return {"workflows": []}
    workflows = []
    for path in sorted(workflows_dir.glob("*.yaml")):
        payload = load_yaml(path)
        workflow_id = str(payload.get("name") or path.stem)
        workflows.append(
            {
                "workflow_id": workflow_id,
                "file_id": path.stem,
                "name": payload.get("name"),
                "description": payload.get("description"),
                "version": payload.get("version"),
                "path": relative_project_path(project_root, path),
                "task_count": len(payload.get("tasks", []))
                if isinstance(payload.get("tasks"), list)
                else 0,
            }
        )
    for path in sorted(workflows_dir.glob("*.accflow.json")):
        payload = load_json_or_500(path)
        workflow_id = str(payload.get("id") or path.name.removesuffix(".accflow.json"))
        workflows.append(
            {
                "workflow_id": workflow_id,
                "file_id": path.name.removesuffix(".accflow.json"),
                "name": payload.get("name"),
                "description": payload.get("description"),
                "version": payload.get("version"),
                "path": relative_project_path(project_root, path),
                "task_count": len(payload.get("nodes", []))
                if isinstance(payload.get("nodes"), list)
                else 0,
                "type": "graph",
                "format": "accflow",
            }
        )
    return {"workflows": workflows}


@router.post("/run-graph")
def run_graph_endpoint(payload: WorkflowRunGraphRequest, request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    preflight_runtime_graph(payload.graph, request, task_id=payload.task_id)
    resolved = resolve_runner_environment_before_evidence(
        project_root,
        payload,
        request,
        graph=payload.graph,
    )
    handle = claim_run_for_payload(
        project_root,
        payload,
        workflow_id=str(payload.graph.get("id") or ""),
        task_id=payload.task_id,
    )
    graph_path = prepare_runtime_graph(payload.graph, handle.run_dir, request, task_id=payload.task_id)
    try:
        result = WorkflowAppService(project_root=project_root).run_sync(
            graph_path,
            handle.run_dir,
            workspace=resolved["workspace"],
            binding_path=resolved["binding_path"],
            input_payload=payload.input,
        )
        return project_run_response(result)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/run-graph/submit")
async def submit_run_graph_endpoint(
    payload: WorkflowRunGraphRequest,
    request: Request,
) -> dict[str, Any]:
    project_root = get_project_root(request)
    run_id = select_run_id_for_payload(payload)
    run_dir = storage_run_dir(project_root, run_id)
    prepared = compile_runtime_graph(payload.graph, run_dir, request, task_id=payload.task_id)
    manager = get_workbench_run_manager(request)
    resolved = resolve_runner_environment_before_evidence(
        project_root,
        payload,
        request,
        graph=payload.graph,
        manager=manager,
    )
    handle = claim_selected_run(
        project_root,
        run_id,
        workflow_id=prepared.workflow_id,
        task_id=payload.task_id,
    )
    graph_path = write_prepared_runtime_graph(prepared, handle.run_dir, request)
    try:
        return await manager.submit(
            WorkbenchRunJob(
                graph_path=graph_path,
                run_dir=handle.run_dir,
                workflow_id=prepared.workflow_id,
                task_id=payload.task_id,
                workspace=resolved["workspace"],
                binding_path=resolved["binding_path"],
                input_payload=payload.input,
                service_factory=lambda: WorkflowAppService(project_root=project_root),
            )
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def prepare_runtime_graph(
    graph_payload: dict[str, Any],
    run_dir: Path,
    request: Request,
    *,
    task_id: str | None = None,
) -> Path:
    prepared = compile_runtime_graph(graph_payload, run_dir, request, task_id=task_id)
    return write_prepared_runtime_graph(prepared, run_dir, request)


def compile_runtime_graph(
    graph_payload: dict[str, Any],
    run_dir: Path,
    request: Request,
    *,
    task_id: str | None = None,
) -> PreparedRuntimeGraph:
    project_root = get_project_root(request)
    graph = graph_with_latest_workbench_node_modes(graph_payload, project_root, task_id)
    workflow_id = str(graph.get("id") or "")
    if not workflow_id:
        raise HTTPException(status_code=400, detail="Workflow graph id is required")
    graph_dir = runtime_workflow_spec_dir(project_root, run_dir)
    accflow_path = graph_dir / "root.accflow.json"
    workflows_dir = configured_project_dir(project_root, "ACC_WORKFLOWS_DIR", "workflows")
    bundle = graph_bundle_for_accflow_save(
        graph,
        source_path=accflow_path,
        callable_registry=CallableRegistry.from_project_root(project_root),
        main_data_edge_policy="preserve_explicit",
    )
    bundle, child_name_map = runtime_named_workflow_bundle(bundle)
    try:
        bundle = resolve_bundle_workflow_refs(
            bundle,
            project_root=project_root,
            workflows_dir=workflows_dir,
            accflow_path=accflow_path,
            mode="runtime",
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PreparedRuntimeGraph(
        workflow_id=workflow_id,
        graph_dir=graph_dir,
        accflow_path=accflow_path,
        workflows_dir=workflows_dir,
        bundle=bundle,
        child_name_map=child_name_map,
    )


def write_prepared_runtime_graph(
    prepared: PreparedRuntimeGraph,
    run_dir: Path,
    request: Request,
) -> Path:
    write_bundle_to_directory(
        prepared.bundle,
        accflow_path=prepared.accflow_path,
        request=request,
        workflows_dir=prepared.workflows_dir,
    )
    write_runtime_spec_manifest(
        prepared.graph_dir,
        project_root=get_project_root(request),
        run_dir=run_dir,
        workflow_id=prepared.workflow_id,
        root_path=prepared.accflow_path,
        child_name_map=prepared.child_name_map,
        child_names=sorted(prepared.bundle.children),
    )
    return prepared.accflow_path


def preflight_runtime_graph(
    graph_payload: dict[str, Any],
    request: Request,
    *,
    task_id: str | None = None,
) -> None:
    project_root = get_project_root(request)
    graph = graph_with_latest_workbench_node_modes(graph_payload, project_root, task_id)
    workflow_id = str(graph.get("id") or "")
    if not workflow_id:
        raise HTTPException(status_code=400, detail="Workflow graph id is required")
    workflows_dir = configured_project_dir(project_root, "ACC_WORKFLOWS_DIR", "workflows")
    source_path = project_root / "runs" / "_workflow_function_specs" / "_preflight" / "root.accflow.json"
    bundle = graph_bundle_for_accflow_save(
        graph,
        source_path=source_path,
        callable_registry=CallableRegistry.from_project_root(project_root),
        main_data_edge_policy="preserve_explicit",
    )
    bundle, _child_name_map = runtime_named_workflow_bundle(bundle)
    try:
        resolve_bundle_workflow_refs(
            bundle,
            project_root=project_root,
            workflows_dir=workflows_dir,
            accflow_path=source_path,
            mode="runtime",
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def runtime_workflow_spec_dir(project_root: Path, run_dir: Path) -> Path:
    run_key = relative_project_path(project_root, run_dir)
    return project_root / "runs" / "_workflow_function_specs" / f"run-{stable_short_hash(run_key)}"


def stable_short_hash(value: str, *, length: int = 12) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def runtime_named_workflow_bundle(
    bundle: CompiledWorkbenchWorkflowBundle,
) -> tuple[CompiledWorkbenchWorkflowBundle, dict[str, str]]:
    child_name_map = {
        child_name: f"child-{index:04d}.accflow.json"
        for index, child_name in enumerate(sorted(bundle.children), start=1)
    }
    if not child_name_map:
        return bundle, {}
    children = {
        child_name_map[child_name]: rewrite_workflow_ref_names(child_payload, child_name_map)
        for child_name, child_payload in bundle.children.items()
    }
    root = rewrite_workflow_ref_names(bundle.root, child_name_map)
    return (
        CompiledWorkbenchWorkflowBundle(
            root=root,
            children=children,
            validation_preview=bundle.validation_preview,
            ref_resolution_preview=bundle.ref_resolution_preview,
            normalization=bundle.normalization,
        ),
        child_name_map,
    )


def rewrite_workflow_ref_names(payload: dict[str, Any], name_map: dict[str, str]) -> dict[str, Any]:
    rewritten = json.loads(json.dumps(payload))
    for node in rewritten.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        ref = node.get("callable_ref")
        if isinstance(ref, dict) and ref.get("kind") == "workflow_function":
            ref_id = str(ref.get("id") or "")
            if ref_id in name_map:
                ref["id"] = name_map[ref_id]
        workflow_ref = node.get("workflow_ref")
        if isinstance(workflow_ref, str) and workflow_ref in name_map:
            node["workflow_ref"] = name_map[workflow_ref]
    metadata = rewritten.get("metadata")
    if isinstance(metadata, dict):
        child_path = metadata.get("compiled_child_path")
        if isinstance(child_path, str) and child_path in name_map:
            metadata["compiled_child_path"] = name_map[child_path]
    return rewritten


def write_runtime_spec_manifest(
    graph_dir: Path,
    *,
    project_root: Path,
    run_dir: Path,
    workflow_id: str,
    root_path: Path,
    child_name_map: dict[str, str],
    child_names: list[str],
) -> None:
    reverse_child_name_map = {new: old for old, new in child_name_map.items()}
    manifest = {
        "schema_version": "acc.runtime.workflow_specs.v1",
        "run_dir": relative_project_path(project_root, run_dir),
        "workflow_id": workflow_id,
        "root": root_path.name,
        "children": [
            {
                "path": child_name,
                "original_path": reverse_child_name_map.get(child_name, child_name),
            }
            for child_name in child_names
        ],
    }
    write_accflow_json(graph_dir / "runtime_specs.json", manifest)


def graph_with_latest_workbench_node_modes(
    graph_payload: dict[str, Any],
    project_root: Path,
    task_id: str | None,
) -> dict[str, Any]:
    if not task_id:
        return graph_payload
    try:
        snapshot = WorkbenchCanvasSnapshotService(project_root).get(task_id)
    except AccError:
        return graph_payload
    canvas_snapshot = snapshot.get("canvas_snapshot")
    if not isinstance(canvas_snapshot, dict):
        return graph_payload
    return merge_workbench_snapshot_projection(graph_payload, canvas_snapshot)


def project_run_response(result: dict[str, Any]) -> dict[str, Any]:
    return result


@router.get("/{workflow_id}")
def get_workflow(workflow_id: str, request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    workflows_dir = configured_project_dir(project_root, "ACC_WORKFLOWS_DIR", "workflows")
    if not workflows_dir.exists():
        raise HTTPException(status_code=404, detail=f"Workflow not found: {workflow_id}")
    direct_path = direct_accflow_path(workflows_dir, workflow_id)
    if direct_path is not None:
        payload = load_json_or_500(direct_path)
        return {
            "workflow_id": str(payload.get("id") or workflow_id),
            "file_id": workflow_id,
            "path": relative_project_path(project_root, direct_path),
            "workflow": payload,
            "graph": payload,
            "type": "graph",
            "format": "accflow",
        }
    for path in sorted(workflows_dir.glob("*.yaml")):
        payload = load_yaml(path)
        candidate_ids = {path.stem, str(payload.get("name") or "")}
        if workflow_id in candidate_ids:
            return {
                "workflow_id": str(payload.get("name") or path.stem),
                "file_id": path.stem,
                "path": relative_project_path(project_root, path),
                "workflow": payload,
            }
    for path in sorted(workflows_dir.glob("*.accflow.json")):
        payload = load_json_or_500(path)
        file_id = path.name.removesuffix(".accflow.json")
        candidate_ids = {file_id, str(payload.get("id") or "")}
        if workflow_id in candidate_ids:
            return {
                "workflow_id": str(payload.get("id") or file_id),
                "file_id": file_id,
                "path": relative_project_path(project_root, path),
                "workflow": payload,
                "graph": payload,
                "type": "graph",
                "format": "accflow",
            }
    raise HTTPException(status_code=404, detail=f"Workflow not found: {workflow_id}")


@router.post("")
def create_workflow(payload: WorkflowSaveRequest, request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    workflows_dir = configured_project_dir(project_root, "ACC_WORKFLOWS_DIR", "workflows")
    workflow_id = str(payload.graph.get("id") or "")
    if not workflow_id:
        raise HTTPException(status_code=400, detail="Workflow graph id is required")
    path = workflow_storage_path(workflows_dir, payload.path or f"{workflow_id}.accflow.json")
    if path.exists() and not payload.force:
        raise HTTPException(status_code=409, detail=f"Workflow already exists: {path.name}")
    return save_graph(
        path,
        payload.graph,
        request,
        force_main_data_edge_migration=payload.force,
    )


@router.put("/{workflow_id}")
def update_workflow(
    workflow_id: str,
    payload: WorkflowSaveRequest,
    request: Request,
) -> dict[str, Any]:
    project_root = get_project_root(request)
    workflows_dir = configured_project_dir(project_root, "ACC_WORKFLOWS_DIR", "workflows")
    path = workflow_storage_path(workflows_dir, payload.path or f"{workflow_id}.accflow.json")
    return save_graph(
        path,
        payload.graph,
        request,
        force_main_data_edge_migration=payload.force,
    )


@router.post("/{workflow_id}/validate")
def validate_workflow_endpoint(workflow_id: str, request: Request) -> dict[str, Any]:
    graph_path = find_graph_path(workflow_id, request)
    try:
        return WorkflowAppService(project_root=get_project_root(request)).validate(graph_path)
    except (AccError, JsonSchemaValidationError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{workflow_id}/binding")
def get_workflow_binding(workflow_id: str, request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    path = default_binding_path(project_root, workflow_id)
    if not path.exists():
        return {
            "workflow_id": workflow_id,
            "binding_path": relative_project_path(project_root, path),
            "workspace_root": None,
            "exists": False,
            "status": "unbound",
        }
    try:
        payload = load_json(path)
    except AccError as exc:
        return {
            "workflow_id": workflow_id,
            "binding_path": relative_project_path(project_root, path),
            "workspace_root": None,
            "exists": True,
            "status": "invalid",
            "error": str(exc),
        }
    workspace_root = str(payload.get("workspace_root") or "")
    validation = validate_workspace_root(workspace_root)
    return {
        "workflow_id": workflow_id,
        "binding_path": relative_project_path(project_root, path),
        "workspace_root": workspace_root or None,
        "exists": True,
        "status": "valid" if validation["valid"] else "missing",
        "error": validation.get("error"),
    }


@router.post("/{workflow_id}/binding/validate")
def validate_workflow_binding(
    workflow_id: str,
    payload: WorkflowBindingRequest,
    request: Request,
) -> dict[str, Any]:
    validation = validate_workspace_root(payload.workspace_root)
    return {
        "workflow_id": workflow_id,
        "workspace_root": validation["workspace_root"],
        "valid": validation["valid"],
        "status": "valid" if validation["valid"] else "missing",
        "error": validation.get("error"),
    }


@router.post("/{workflow_id}/binding/select-directory")
def select_workflow_binding_directory(
    workflow_id: str,
    payload: WorkflowDirectorySelectionRequest,
    request: Request,
) -> dict[str, Any]:
    _ = request
    selection = select_local_directory(payload.initial_dir)
    return directory_selection_response(workflow_id, selection)


@router.put("/{workflow_id}/binding")
def save_workflow_binding(
    workflow_id: str,
    payload: WorkflowBindingRequest,
    request: Request,
) -> dict[str, Any]:
    validation = validate_workspace_root(payload.workspace_root)
    if not validation["valid"]:
        raise HTTPException(status_code=400, detail=validation["error"])
    project_root = get_project_root(request)
    path = default_binding_path(project_root, workflow_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    binding = {
        "workflow_id": workflow_id,
        "binding_name": f"{workflow_id}.local",
        "state_mode": "stateful",
        "workspace_root": validation["workspace_root"],
        "behavior_policy": {"mode": "workspace_native"},
    }
    temp_path = path.with_suffix(f"{path.suffix}.{uuid4().hex}.tmp")
    temp_path.write_text(
        json.dumps(binding, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    temp_path.replace(path)
    return {
        "status": "saved",
        "workflow_id": workflow_id,
        "binding_path": relative_project_path(project_root, path),
        "workspace_root": validation["workspace_root"],
        "exists": True,
    }


@router.post("/{workflow_id}/binding/open-folder")
def open_workflow_binding_folder(workflow_id: str, request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    bindings_dir = (project_root / "bindings").resolve()
    if not bindings_dir.is_relative_to(project_root):
        raise HTTPException(status_code=400, detail="Bindings directory is outside project root")
    bindings_dir.mkdir(parents=True, exist_ok=True)
    opened = open_local_folder(bindings_dir)
    return {
        "workflow_id": workflow_id,
        "path": relative_project_path(project_root, bindings_dir),
        "opened": opened,
    }


@router.post("/{workflow_id}/run")
def run_workflow_endpoint(
    workflow_id: str,
    payload: WorkflowRunRequest,
    request: Request,
) -> dict[str, Any]:
    project_root = get_project_root(request)
    graph_path = find_graph_path(workflow_id, request)
    resolved = resolve_runner_environment_before_evidence(project_root, payload, request)
    handle = claim_run_for_payload(project_root, payload, workflow_id=workflow_id)
    try:
        return WorkflowAppService(project_root=project_root).run_sync(
            graph_path,
            handle.run_dir,
            workspace=resolved["workspace"],
            binding_path=resolved["binding_path"],
            input_payload=payload.input,
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def claim_run_for_payload(
    project_root: Path,
    payload: WorkflowRunRequest,
    *,
    workflow_id: str | None = None,
    task_id: str | None = None,
) -> RunHandle:
    return claim_selected_run(
        project_root,
        select_run_id_for_payload(payload),
        workflow_id=workflow_id,
        task_id=task_id,
    )


def select_run_id_for_payload(payload: WorkflowRunRequest) -> str:
    if payload.run_id and payload.run_dir:
        raise HTTPException(status_code=400, detail="Provide run_id or run_dir, not both")
    try:
        if payload.run_dir:
            return parse_legacy_run_dir(payload.run_dir)
        return validate_run_id(payload.run_id or generate_run_id())
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def claim_selected_run(
    project_root: Path,
    run_id: str,
    *,
    workflow_id: str | None = None,
    task_id: str | None = None,
) -> RunHandle:
    try:
        return claim_run(project_root, run_id=run_id, workflow_id=workflow_id, task_id=task_id)
    except AccError as exc:
        status_code = 409 if str(exc).startswith("Run already exists:") else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


def resolve_run_dir(project_root: Path, run_dir_value: str) -> Path:
    try:
        run_id = parse_legacy_run_dir(run_dir_value)
        return storage_run_dir(project_root, run_id)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def resolve_run_environment(
    project_root: Path,
    payload: WorkflowRunRequest,
) -> tuple[Path | None, Path | None]:
    if payload.workspace and (payload.binding_path or payload.binding_ref):
        raise HTTPException(status_code=400, detail="Provide workspace or binding, not both")
    if payload.binding_path and payload.binding_ref:
        raise HTTPException(status_code=400, detail="Provide binding_path or binding_ref, not both")
    workspace = None
    binding_path = None
    if payload.workspace:
        workspace = Path(payload.workspace).expanduser().resolve()
        if not workspace.exists() or not workspace.is_dir():
            raise HTTPException(
                status_code=400,
                detail=f"Workspace directory not found: {workspace}",
            )
    if payload.binding_path:
        binding_path = resolve_binding_path(project_root, payload.binding_path)
    return workspace, binding_path


def resolve_runner_environment_before_evidence(
    project_root: Path,
    payload: WorkflowRunRequest,
    request: Request,
    *,
    graph: dict[str, Any] | None = None,
    manager: Any | None = None,
) -> dict[str, Path | None]:
    if payload.binding_ref:
        try:
            resolved = LocalRunnerService(project_root).validate_job_before_evidence(
                graph=graph or {"nodes": []},
                workspace_alias=payload.workspace_alias,
                binding_ref=payload.binding_ref,
                raw_workspace=payload.workspace,
                manager=manager,
            )
            return {
                "workspace": None if resolved["binding_path"] else resolved["workspace"],
                "binding_path": resolved["binding_path"],
            }
        except RunnerCapabilityError as exc:
            raise HTTPException(status_code=400, detail=exc.to_payload()) from exc
    if payload.workspace_alias:
        try:
            resolved = LocalRunnerService(project_root).validate_job_before_evidence(
                graph=graph or {"nodes": []},
                workspace_alias=payload.workspace_alias,
                raw_workspace=payload.workspace,
                manager=manager,
            )
            return {"workspace": resolved["workspace"], "binding_path": None}
        except RunnerCapabilityError as exc:
            raise HTTPException(status_code=400, detail=exc.to_payload()) from exc
    if graph is not None:
        try:
            LocalRunnerService(project_root).validate_job_before_evidence(
                graph=graph,
                workspace_alias=None,
                raw_workspace=payload.workspace,
                manager=manager,
            )
        except RunnerCapabilityError as exc:
            raise HTTPException(status_code=400, detail=exc.to_payload()) from exc
    workspace, binding_path = resolve_run_environment(project_root, payload)
    return {"workspace": workspace, "binding_path": binding_path}


def load_yaml(path: Path) -> dict[str, Any]:
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise HTTPException(status_code=500, detail=f"Invalid workflow YAML: {path}") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=500, detail=f"Workflow YAML must be an object: {path}")
    return payload


def load_json_or_500(path: Path) -> dict[str, Any]:
    try:
        payload = load_json(path)
    except AccError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=500, detail=f"Workflow JSON must be an object: {path}")
    return payload


def validate_workflow_save_path(
    request: Request,
    temp_path: Path,
    *,
    workflows_dir: Path | None = None,
    workflow_catalog: WorkflowCatalog | None = None,
) -> dict[str, Any]:
    """REQ-B4-005: reject invalid accflow before replace."""
    service = WorkflowAppService(project_root=get_project_root(request))
    resolved_dir = workflows_dir or temp_path.parent
    try:
        try:
            validation = service.validate(
                temp_path,
                workflows_dir=resolved_dir,
                workflow_catalog=workflow_catalog,
            )
        except TypeError:
            validation = service.validate(temp_path)
    except (AccError, JsonSchemaValidationError) as exc:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if validation.get("status") == "invalid":
        temp_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail={"message": "Workflow validation failed", "validation": validation},
        )
    return validation


def workflow_storage_path(workflows_dir: Path, path_value: str) -> Path:
    if not path_value.endswith(".accflow.json"):
        raise HTTPException(
            status_code=400,
            detail="Workflow path must end with .accflow.json",
        )
    candidate = (workflows_dir / path_value).resolve()
    if not candidate.is_relative_to(workflows_dir.resolve()):
        raise HTTPException(status_code=400, detail="Workflow path is outside workflows directory")
    return candidate


def workflow_function_path(workflows_dir: Path, path_value: str) -> Path:
    return workflow_storage_path(workflows_dir, path_value)


def direct_accflow_path(workflows_dir: Path, workflow_id: str) -> Path | None:
    if "/" in workflow_id or "\\" in workflow_id:
        return None
    candidate = (workflows_dir / f"{workflow_id}.accflow.json").resolve()
    if not candidate.is_relative_to(workflows_dir.resolve()) or not candidate.exists():
        return None
    return candidate


def save_graph(
    path: Path,
    graph: dict[str, Any],
    request: Request,
    *,
    force_main_data_edge_migration: bool = False,
) -> dict[str, Any]:
    accflow_path = path
    project_root = get_project_root(request)
    workflows_dir = configured_project_dir(project_root, "ACC_WORKFLOWS_DIR", "workflows")
    bundle = graph_bundle_for_accflow_save(
        graph,
        source_path=accflow_path,
        callable_registry=CallableRegistry.from_project_root(project_root),
        force_main_data_edge_migration=force_main_data_edge_migration,
        main_data_edge_policy="preserve_explicit",
    )
    try:
        bundle = resolve_bundle_workflow_refs(
            bundle,
            project_root=project_root,
            workflows_dir=workflows_dir,
            accflow_path=accflow_path,
            mode="persistent",
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    validation = write_bundle_to_directory(
        bundle,
        accflow_path=accflow_path,
        request=request,
        workflows_dir=workflows_dir,
    )
    return {
        "status": "saved",
        "workflow_id": bundle.root["id"],
        "path": relative_project_path(project_root, accflow_path),
        "format": "accflow",
        "canonical_preview": {
            **bundle.root,
            "children": bundle.children,
            "validation": bundle.validation_preview,
            "ref_resolution": bundle.ref_resolution_preview or [],
        },
        "normalization": bundle.normalization,
        "validation": validation,
    }


def graph_payload_for_runtime(
    graph: dict[str, Any],
    *,
    source_path: Path | None = None,
) -> dict[str, Any]:
    try:
        return canonicalize_workbench_workflow_payload(graph, source_path=source_path)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def graph_payload_for_accflow_save(
    graph: dict[str, Any],
    *,
    source_path: Path,
) -> dict[str, Any]:
    try:
        return canonicalize_workbench_workflow_payload(graph, source_path=source_path)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def graph_bundle_for_accflow_save(
    graph: dict[str, Any],
    *,
    source_path: Path,
    callable_registry: CallableRegistry | None = None,
    force_main_data_edge_migration: bool = False,
    main_data_edge_policy: str = "migrate_legacy",
) -> CompiledWorkbenchWorkflowBundle:
    try:
        return compile_workbench_workflow_bundle(
            graph,
            source_path=source_path,
            callable_registry=callable_registry,
            force_main_data_edge_migration=force_main_data_edge_migration,
            main_data_edge_policy=main_data_edge_policy,  # type: ignore[arg-type]
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def write_bundle_to_directory(
    bundle: CompiledWorkbenchWorkflowBundle,
    *,
    accflow_path: Path,
    request: Request,
    workflows_dir: Path | None = None,
) -> dict[str, Any]:
    accflow_path.parent.mkdir(parents=True, exist_ok=True)
    staging_dir = accflow_path.parent / f".bundle-{uuid4().hex[:12]}"
    staging_dir.mkdir(parents=True)
    staging_root = staging_dir / accflow_path.name
    try:
        write_accflow_json(staging_root, bundle.root)
        for child_name, child_payload in bundle.children.items():
            child_path = workflow_storage_path(staging_dir, child_name)
            write_accflow_json(child_path, child_payload)
        project_root = get_project_root(request)
        base_workflows_dir = workflows_dir or accflow_path.parent
        staged_overlay = {staging_root: bundle.root}
        staged_overlay.update(
            {
                staging_dir / child_name: child_payload
                for child_name, child_payload in bundle.children.items()
            }
        )
        workflow_catalog = WorkflowCatalog(
            project_root=project_root,
            workflows_dir=base_workflows_dir,
            overlay_payloads=staged_overlay,
        )
        validation = validate_workflow_save_path(
            request,
            staging_root,
            workflows_dir=staging_dir,
            workflow_catalog=workflow_catalog,
        )
        for child_name in bundle.children:
            replace_workflow_file(staging_dir / child_name, accflow_path.parent / child_name)
        replace_workflow_file(staging_root, accflow_path)
        return validation
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)


def resolve_bundle_workflow_refs(
    bundle: CompiledWorkbenchWorkflowBundle,
    *,
    project_root: Path,
    workflows_dir: Path,
    accflow_path: Path,
    mode: WorkflowRefMode,
) -> CompiledWorkbenchWorkflowBundle:
    overlay_payloads = {accflow_path: bundle.root}
    overlay_payloads.update(
        {accflow_path.parent / child_name: child for child_name, child in bundle.children.items()}
    )
    catalog = WorkflowCatalog(
        project_root=project_root,
        workflows_dir=workflows_dir,
        overlay_payloads=overlay_payloads,
    )
    root, resolutions = rewrite_workflow_function_refs(
        bundle.root,
        catalog=catalog,
        template_source_path=accflow_path,
        mode=mode,
    )
    children: dict[str, dict[str, Any]] = {}
    for child_name, child_payload in bundle.children.items():
        child_path = accflow_path.parent / child_name
        rewritten_child, child_resolutions = rewrite_workflow_function_refs(
            child_payload,
            catalog=catalog,
            template_source_path=child_path,
            mode=mode,
        )
        children[child_name] = rewritten_child
        resolutions.extend(child_resolutions)
    return CompiledWorkbenchWorkflowBundle(
        root=root,
        children=children,
        validation_preview={
            **bundle.validation_preview,
            "ref_resolution_count": len(resolutions),
        },
        ref_resolution_preview=resolutions,
        normalization=bundle.normalization,
    )


def write_accflow_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def replace_workflow_file(temp_path: Path, target_path: Path) -> None:
    try:
        temp_path.replace(target_path)
        return
    except PermissionError:
        if target_path.exists():
            os.chmod(target_path, 0o666)
            target_path.unlink()
        temp_path.replace(target_path)


def default_binding_path(project_root: Path, workflow_id: str) -> Path:
    safe_id = workflow_id.replace("/", "_").replace("\\", "_")
    return (project_root / "bindings" / f"{safe_id}.binding.local.json").resolve()


def resolve_binding_path(project_root: Path, path_value: str) -> Path:
    candidate = (project_root / path_value).resolve()
    bindings_root = (project_root / "bindings").resolve()
    if not candidate.is_relative_to(bindings_root):
        raise HTTPException(status_code=400, detail="Binding path is outside bindings directory")
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail="Binding file not found")
    return candidate


def validate_workspace_root(path_value: str) -> dict[str, Any]:
    if not path_value:
        return {"workspace_root": "", "valid": False, "error": "Workspace directory is required"}
    workspace = Path(path_value).expanduser().resolve()
    if not workspace.exists() or not workspace.is_dir():
        return {
            "workspace_root": str(workspace),
            "valid": False,
            "error": f"Workspace directory not found: {workspace}",
        }
    return {"workspace_root": str(workspace), "valid": True}


def open_local_folder(path: Path) -> bool:
    try:
        if sys.platform.startswith("win"):
            os.startfile(str(path))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
    except OSError:
        return False
    return True


def directory_selection_response(
    workflow_id: str,
    selection: LocalDirectorySelection,
) -> dict[str, Any]:
    response: dict[str, Any] = {
        "workflow_id": workflow_id,
        "status": selection.status,
        "workspace_root": None,
        "valid": False,
        "error": selection.error,
    }
    if selection.status != "selected":
        return response

    validation = validate_workspace_root(selection.path or "")
    response["workspace_root"] = validation["workspace_root"]
    response["valid"] = validation["valid"]
    if validation["valid"]:
        response["error"] = None
    else:
        response["status"] = "failed"
        response["error"] = validation.get("error")
    return response


def find_graph_path(workflow_id: str, request: Request) -> Path:
    project_root = get_project_root(request)
    workflows_dir = configured_project_dir(project_root, "ACC_WORKFLOWS_DIR", "workflows")
    if not workflows_dir.exists():
        raise HTTPException(status_code=404, detail=f"Workflow not found: {workflow_id}")
    direct_path = direct_accflow_path(workflows_dir, workflow_id)
    if direct_path is not None:
        return direct_path
    for path in sorted(workflows_dir.glob("*.accflow.json")):
        payload = load_json_or_500(path)
        file_id = path.name.removesuffix(".accflow.json")
        if workflow_id in {file_id, str(payload.get("id") or "")}:
            return path
    raise HTTPException(status_code=404, detail=f"Workflow not found: {workflow_id}")
