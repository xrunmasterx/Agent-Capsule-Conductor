from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Request
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError
from pydantic import BaseModel, ConfigDict

from acc.registry import CapsuleRegistry
from acc.server.context import (
    configured_project_dir,
    get_project_root,
    relative_project_path,
)
from acc.utils import AccError, load_json
from acc.workflow_graph import validate_workflow_graph
from acc.workflow_runner import run_workflow_graph_sync

router = APIRouter(prefix="/workflows", tags=["workflows"])


class WorkflowSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    graph: dict[str, Any]
    path: str | None = None
    force: bool = False


class WorkflowRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_dir: str


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
        return validate_workflow_graph(graph_path, registry=server_registry(request))
    except (AccError, JsonSchemaValidationError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
    try:
        return run_workflow_graph_sync(graph_path, run_dir, registry=server_registry(request))
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
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    try:
        validate_workflow_graph(temp_path, registry=server_registry(request))
    except (AccError, JsonSchemaValidationError) as exc:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    temp_path.replace(path)
    return {
        "status": "saved",
        "workflow_id": graph["id"],
        "path": relative_project_path(get_project_root(request), path),
        "validation": validate_workflow_graph(path, registry=server_registry(request)),
    }


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
