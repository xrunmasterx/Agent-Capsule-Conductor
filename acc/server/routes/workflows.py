from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any
from uuid import uuid4

import yaml
from fastapi import APIRouter, HTTPException, Request
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError
from pydantic import BaseModel, ConfigDict

from acc.app import WorkflowAppService
from acc.registry import CapsuleRegistry
from acc.server.context import (
    configured_project_dir,
    get_project_root,
    relative_project_path,
)
from acc.utils import AccError, load_json

router = APIRouter(prefix="/workflows", tags=["workflows"])


class WorkflowSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    graph: dict[str, Any]
    path: str | None = None
    force: bool = False


class WorkflowRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_dir: str
    binding_path: str | None = None
    workspace: str | None = None
    input: dict[str, Any] | None = None


class WorkflowBindingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_root: str


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
    for path in sorted(workflows_dir.glob("*.graph.json")):
        payload = load_json_or_500(path)
        workflow_id = str(payload.get("id") or path.name.removesuffix(".graph.json"))
        workflows.append(
            {
                "workflow_id": workflow_id,
                "file_id": path.name.removesuffix(".graph.json"),
                "name": payload.get("name"),
                "description": payload.get("description"),
                "version": payload.get("version"),
                "path": relative_project_path(project_root, path),
                "task_count": len(payload.get("nodes", []))
                if isinstance(payload.get("nodes"), list)
                else 0,
                "type": "graph",
            }
        )
    return {"workflows": workflows}


@router.get("/{workflow_id}")
def get_workflow(workflow_id: str, request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    workflows_dir = configured_project_dir(project_root, "ACC_WORKFLOWS_DIR", "workflows")
    if not workflows_dir.exists():
        raise HTTPException(status_code=404, detail=f"Workflow not found: {workflow_id}")
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
    for path in sorted(workflows_dir.glob("*.graph.json")):
        payload = load_json_or_500(path)
        file_id = path.name.removesuffix(".graph.json")
        candidate_ids = {file_id, str(payload.get("id") or "")}
        if workflow_id in candidate_ids:
            return {
                "workflow_id": str(payload.get("id") or file_id),
                "file_id": file_id,
                "path": relative_project_path(project_root, path),
                "workflow": payload,
                "graph": payload,
                "type": "graph",
            }
    raise HTTPException(status_code=404, detail=f"Workflow not found: {workflow_id}")


@router.post("")
def create_workflow(payload: WorkflowSaveRequest, request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    workflows_dir = configured_project_dir(project_root, "ACC_WORKFLOWS_DIR", "workflows")
    workflow_id = str(payload.graph.get("id") or "")
    if not workflow_id:
        raise HTTPException(status_code=400, detail="Workflow graph id is required")
    path = workflow_graph_path(workflows_dir, payload.path or f"{workflow_id}.graph.json")
    if path.exists() and not payload.force:
        raise HTTPException(status_code=409, detail=f"Workflow already exists: {path.name}")
    return save_graph(path, payload.graph, request)


@router.put("/{workflow_id}")
def update_workflow(
    workflow_id: str,
    payload: WorkflowSaveRequest,
    request: Request,
) -> dict[str, Any]:
    project_root = get_project_root(request)
    workflows_dir = configured_project_dir(project_root, "ACC_WORKFLOWS_DIR", "workflows")
    path = workflow_graph_path(workflows_dir, payload.path or f"{workflow_id}.graph.json")
    return save_graph(path, payload.graph, request)


@router.post("/{workflow_id}/validate")
def validate_workflow_endpoint(workflow_id: str, request: Request) -> dict[str, Any]:
    graph_path = find_graph_path(workflow_id, request)
    try:
        return WorkflowAppService(registry=server_registry(request)).validate(graph_path)
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
    run_dir = (project_root / payload.run_dir).resolve()
    if not run_dir.is_relative_to(project_root):
        raise HTTPException(status_code=400, detail="Run directory is outside project root")
    if payload.workspace and payload.binding_path:
        raise HTTPException(status_code=400, detail="Provide workspace or binding_path, not both")
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
    try:
        return WorkflowAppService(registry=server_registry(request)).run_sync(
            graph_path,
            run_dir,
            workspace=workspace,
            binding_path=binding_path,
            input_payload=payload.input,
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


def workflow_graph_path(workflows_dir: Path, path_value: str) -> Path:
    if not path_value.endswith(".graph.json"):
        raise HTTPException(status_code=400, detail="Workflow path must end with .graph.json")
    candidate = (workflows_dir / path_value).resolve()
    if not candidate.is_relative_to(workflows_dir.resolve()):
        raise HTTPException(status_code=400, detail="Workflow path is outside workflows directory")
    return candidate


def save_graph(path: Path, graph: dict[str, Any], request: Request) -> dict[str, Any]:
    graph = legacy_graph_payload_for_save(graph)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(f"{path.suffix}.{uuid4().hex}.tmp")
    temp_path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    try:
        WorkflowAppService(registry=server_registry(request)).validate(temp_path)
    except (AccError, JsonSchemaValidationError) as exc:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    replace_workflow_file(temp_path, path)
    return {
        "status": "saved",
        "workflow_id": graph["id"],
        "path": relative_project_path(get_project_root(request), path),
        "validation": WorkflowAppService(registry=server_registry(request)).validate(path),
    }


def legacy_graph_payload_for_save(graph: dict[str, Any]) -> dict[str, Any]:
    payload = json.loads(json.dumps(graph))
    recover_wrapped_capsule_nodes(payload)
    if "control_edges" not in payload and isinstance(payload.get("edges"), list):
        payload["control_edges"] = payload["edges"]
    payload.setdefault("data_edges", [])
    return payload


def recover_wrapped_capsule_nodes(graph: dict[str, Any]) -> None:
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("kind") != "workflow":
            continue
        if node.get("capsule_id") != "fake-agent.generic":
            continue
        if node.get("workflow_ref"):
            continue
        ui = node.get("ui")
        if not isinstance(ui, dict):
            continue
        internal_nodes = ui.get("internal_nodes")
        if not isinstance(internal_nodes, list) or len(internal_nodes) != 1:
            continue
        internal_node = internal_nodes[0]
        if not isinstance(internal_node, dict):
            continue
        runtime = internal_node.get("runtime")
        if not isinstance(runtime, str) or runtime == "fake-agent.generic":
            continue
        node["capsule_id"] = runtime
        node["kind"] = "tool" if internal_node.get("kind") == "Tool" else "agent_session"
        node.pop("ui", None)


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


def find_graph_path(workflow_id: str, request: Request) -> Path:
    project_root = get_project_root(request)
    workflows_dir = configured_project_dir(project_root, "ACC_WORKFLOWS_DIR", "workflows")
    if not workflows_dir.exists():
        raise HTTPException(status_code=404, detail=f"Workflow not found: {workflow_id}")
    for path in sorted(workflows_dir.glob("*.graph.json")):
        payload = load_json_or_500(path)
        file_id = path.name.removesuffix(".graph.json")
        if workflow_id in {file_id, str(payload.get("id") or "")}:
            return path
    raise HTTPException(status_code=404, detail=f"Workflow not found: {workflow_id}")


def server_registry(request: Request) -> CapsuleRegistry:
    project_root = get_project_root(request)
    capsules_dir = configured_project_dir(project_root, "ACC_CAPSULES_DIR", "capsules")
    return CapsuleRegistry(capsules_dir)
