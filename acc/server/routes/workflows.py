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
    get_workbench_run_manager,
    relative_project_path,
)
from acc.server.run_manager import WorkbenchRunJob
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


class WorkflowRunGraphRequest(WorkflowRunRequest):
    graph: dict[str, Any]
    task_id: str | None = None


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


@router.post("/run-graph")
def run_graph_endpoint(payload: WorkflowRunGraphRequest, request: Request) -> dict[str, Any]:
    project_root = get_project_root(request)
    run_dir = resolve_run_dir(project_root, payload.run_dir)
    graph_path = prepare_runtime_graph(payload.graph, run_dir, request)
    workspace, binding_path = resolve_run_environment(project_root, payload)
    try:
        result = WorkflowAppService(registry=server_registry(request)).run_sync(
            graph_path,
            run_dir,
            workspace=workspace,
            binding_path=binding_path,
            input_payload=payload.input,
        )
        return enrich_inline_nested_node_runs(result)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/run-graph/submit")
async def submit_run_graph_endpoint(
    payload: WorkflowRunGraphRequest,
    request: Request,
) -> dict[str, Any]:
    project_root = get_project_root(request)
    run_dir = resolve_run_dir(project_root, payload.run_dir)
    graph_path = prepare_runtime_graph(payload.graph, run_dir, request)
    workspace, binding_path = resolve_run_environment(project_root, payload)
    workflow_id = str(legacy_graph_payload_for_save(payload.graph).get("id") or graph_path.stem)
    registry = server_registry(request)
    manager = get_workbench_run_manager(request)
    try:
        return await manager.submit(
            WorkbenchRunJob(
                graph_path=graph_path,
                run_dir=run_dir,
                workflow_id=workflow_id,
                task_id=payload.task_id,
                workspace=workspace,
                binding_path=binding_path,
                input_payload=payload.input,
                service_factory=lambda: WorkflowAppService(registry=registry),
            )
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def prepare_runtime_graph(
    graph_payload: dict[str, Any],
    run_dir: Path,
    request: Request,
) -> Path:
    project_root = get_project_root(request)
    graph = legacy_graph_payload_for_save(graph_payload)
    workflow_id = str(graph.get("id") or "")
    if not workflow_id:
        raise HTTPException(status_code=400, detail="Workflow graph id is required")
    graph_dir = project_root / "runs" / "_workflow_graph_specs" / run_dir.name
    graph_dir.mkdir(parents=True, exist_ok=True)
    graph_path = graph_dir / f"{workflow_id}.graph.json"
    normalize_capsule_node_inputs(graph, request)
    materialize_inline_workflow_nodes(graph_path, graph, request)
    temp_path = graph_path.with_suffix(f"{graph_path.suffix}.{uuid4().hex}.tmp")
    temp_path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    try:
        WorkflowAppService(registry=server_registry(request)).validate(temp_path)
    except (AccError, JsonSchemaValidationError) as exc:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    replace_workflow_file(temp_path, graph_path)
    return graph_path


def enrich_inline_nested_node_runs(result: dict[str, Any]) -> dict[str, Any]:
    """Expose nested workflow node statuses for the Workbench run overlay.

    The clean runtime correctly records nested node runs under
    nodes/<workflow_node>/nested_workflow/workflow_run.json. The Workbench
    needs those node statuses in the immediate run response so internal nodes
    can render success/failure without treating runtime state as canvas state.
    """
    nodes = result.get("nodes")
    if not isinstance(nodes, list):
        return result
    existing_node_ids = {str(node.get("node_id")) for node in nodes if isinstance(node, dict)}
    expanded_nodes = list(nodes)
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("node_id") or "")
        run_dir = node.get("run_dir")
        if not node_id or not isinstance(run_dir, str):
            continue
        nested_run_path = Path(run_dir) / "nested_workflow" / "workflow_run.json"
        if not nested_run_path.exists():
            continue
        try:
            nested_run = load_json(nested_run_path)
        except AccError:
            continue
        nested_nodes = nested_run.get("nodes")
        if not isinstance(nested_nodes, list):
            continue
        for nested_node in nested_nodes:
            if not isinstance(nested_node, dict):
                continue
            nested_node_id = str(nested_node.get("node_id") or "")
            if not nested_node_id:
                continue
            ui_node_id = f"{node_id}__internal__{nested_node_id}"
            if ui_node_id in existing_node_ids:
                continue
            existing_node_ids.add(ui_node_id)
            expanded_nodes.append(
                {
                    **nested_node,
                    "parent_node_id": node_id,
                    "ui_node_id": ui_node_id,
                }
            )
    return {**result, "nodes": expanded_nodes}


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
    run_dir = resolve_run_dir(project_root, payload.run_dir)
    workspace, binding_path = resolve_run_environment(project_root, payload)
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


def resolve_run_dir(project_root: Path, run_dir_value: str) -> Path:
    run_dir = (project_root / run_dir_value).resolve()
    if not run_dir.is_relative_to(project_root):
        raise HTTPException(status_code=400, detail="Run directory is outside project root")
    return run_dir


def resolve_run_environment(
    project_root: Path,
    payload: WorkflowRunRequest,
) -> tuple[Path | None, Path | None]:
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
    return workspace, binding_path


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
    normalize_capsule_node_inputs(graph, request)
    materialize_inline_workflow_nodes(path, graph, request)
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


def normalize_capsule_node_inputs(graph: dict[str, Any], request: Request) -> None:
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return
    for node in nodes:
        if not isinstance(node, dict) or is_inline_workflow_container(node):
            continue
        kind = str(node.get("kind") or "agent_session")
        if kind == "workflow":
            continue
        capsule_id = (
            node.get("legacy_capsule_id")
            or node.get("capsule_id")
            or node.get("capsuleId")
            or node.get("runtime")
        )
        if not isinstance(capsule_id, str) or not capsule_id:
            continue
        input_payload, receive_upstream_context, upstream_context_fields = (
            inline_capsule_input_payload(node, capsule_id, request)
        )
        node["input"] = input_payload
        node["acc_receive_upstream_context"] = receive_upstream_context
        if upstream_context_fields:
            node["acc_upstream_context_fields"] = upstream_context_fields
        else:
            node.pop("acc_upstream_context_fields", None)


def materialize_inline_workflow_nodes(path: Path, graph: dict[str, Any], request: Request) -> None:
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return
    for node in nodes:
        if not is_inline_workflow_container(node):
            continue
        child_payload = inline_workflow_payload(graph, node, request)
        child_path = path.parent / f"{graph['id']}__{node['id']}.accflow.json"
        child_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = child_path.with_name(f"{child_path.stem}.{uuid4().hex}.accflow.json")
        temp_path.write_text(
            json.dumps(child_payload, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        try:
            WorkflowAppService(registry=server_registry(request)).validate(temp_path)
        except (AccError, JsonSchemaValidationError) as exc:
            temp_path.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        replace_workflow_file(temp_path, child_path)
        node["workflow_ref"] = child_path.name
        node["capsule_id"] = "fake-agent.generic"
        node["kind"] = "workflow"
        node.setdefault("timeout_seconds", inline_workflow_timeout_seconds(node, request))
        node.setdefault("input_ports", [{"id": "main", "direction": "input"}])
        node.setdefault("output_ports", [{"id": "main", "direction": "output"}])
        child_output_ports = workflow_port_ids(child_payload.get("exposed_outputs")) or ["main"]
        parent_output_ports = workflow_port_ids(node.get("output_ports")) or ["main"]
        node["workflow_call_output_bindings"] = [
            {
                "workflow_output": child_port,
                "parent_port": parent_output_ports[index]
                if index < len(parent_output_ports)
                else child_port,
                "required": False,
                "materialization": "copy",
            }
            for index, child_port in enumerate(child_output_ports)
        ]
        ui = node.get("ui")
        if isinstance(ui, dict):
            ui["inline_workflow_ref"] = child_path.name


def workflow_port_ids(value: Any) -> list[str]:
    if isinstance(value, list):
        return [
            str(item["id"])
            for item in value
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        ]
    if isinstance(value, dict):
        return [str(key) for key in value if isinstance(key, str)]
    return []


def is_inline_workflow_container(node: Any) -> bool:
    if not isinstance(node, dict) or node.get("kind") != "workflow":
        return False
    ui = node.get("ui")
    if not isinstance(ui, dict):
        return False
    internal_nodes = ui.get("internal_nodes")
    return isinstance(internal_nodes, list) and len(internal_nodes) > 0


def inline_workflow_payload(
    parent_graph: dict[str, Any],
    node: dict[str, Any],
    request: Request,
) -> dict[str, Any]:
    ui = node.get("ui") if isinstance(node.get("ui"), dict) else {}
    internal_nodes = ui.get("internal_nodes") if isinstance(ui, dict) else []
    internal_edges = ui.get("internal_edges") if isinstance(ui, dict) else []
    if not isinstance(internal_nodes, list):
        internal_nodes = []
    if not isinstance(internal_edges, list):
        internal_edges = []
    raw_control_edges = [
        {
            "id": str(edge.get("id") or f"control_{edge.get('from')}_{edge.get('to')}"),
            "from": str(edge["from"]),
            "to": str(edge["to"]),
            "condition": edge.get("condition"),
            "context": edge.get("context")
            if edge.get("context") in {"upstream_output", "none"}
            else "upstream_output",
        }
        for edge in internal_edges
        if isinstance(edge, dict)
        and isinstance(edge.get("from"), str)
        and isinstance(edge.get("to"), str)
    ]
    input_boundary_id = f"{node['id']}__workflow_inputs"
    output_boundary_id = f"{node['id']}__workflow_outputs"
    input_bound_targets = [
        str(edge["to"])
        for edge in raw_control_edges
        if edge["from"] == input_boundary_id and isinstance(edge.get("to"), str)
    ]
    output_bound_sources = [
        str(edge["from"])
        for edge in raw_control_edges
        if edge["to"] == output_boundary_id and isinstance(edge.get("from"), str)
    ]
    control_edges = [
        edge
        for edge in raw_control_edges
        if edge["from"] != input_boundary_id
        and edge["to"] != output_boundary_id
        and edge["to"] != input_boundary_id
        and edge["from"] != output_boundary_id
    ]
    data_edges = [
        {
            "id": str(edge.get("id") or "data_edge"),
            "from": edge["from"],
            "to": edge["to"],
            "materialization": edge.get("materialization") or "copy",
        }
        for edge in internal_edges
        if isinstance(edge, dict)
        and isinstance(edge.get("from"), dict)
        and isinstance(edge.get("to"), dict)
    ]
    internal_ids = [
        str(item["id"])
        for item in internal_nodes
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    ]
    control_sources = {str(edge["from"]) for edge in control_edges}
    control_targets = {str(edge["to"]) for edge in control_edges}
    entry_ids = input_bound_targets or (
        [node_id for node_id in internal_ids if node_id not in control_targets]
        or internal_ids[:1]
    )
    terminal_ids = output_bound_sources or (
        [node_id for node_id in internal_ids if node_id not in control_sources]
        or internal_ids[-1:]
    )
    output_ports = [
        {"id": "main" if index == 0 else f"main_{node_id}", "direction": "output"}
        for index, node_id in enumerate(terminal_ids)
    ]
    return {
        "id": f"{parent_graph['id']}__{node['id']}",
        "version": "0.4.0",
        "name": str(node.get("label") or node.get("id")),
        "nodes": [
            inline_internal_node_payload(item, request)
            for item in internal_nodes
            if isinstance(item, dict)
        ],
        "control_edges": control_edges,
        "data_edges": data_edges,
        "exposed_inputs": [{"id": "main", "direction": "input", "required": False}],
        "exposed_outputs": output_ports,
        "workflow_input_bindings": [
            {
                "source_port": "main",
                "target": {"node": node_id, "port": "main"},
                "required": False,
                "materialization": "copy",
            }
            for node_id in entry_ids
        ],
        "workflow_output_bindings": [
            {
                "source": {"node": node_id, "port": "main"},
                "target_port": "main" if index == 0 else f"main_{node_id}",
                "required": False,
                "materialization": "copy",
            }
            for index, node_id in enumerate(terminal_ids)
        ],
        "policies": {
            "failure_mode": "fail_fast",
            "max_concurrency": int(
                dict(parent_graph.get("policy") or {}).get("max_concurrency") or 4
            ),
        },
        "metadata": {
            "layout": "inline-workflow-container",
            "parent_workflow_id": parent_graph["id"],
            "parent_node_id": node["id"],
        },
    }


def inline_workflow_timeout_seconds(node: dict[str, Any], request: Request) -> int:
    ui = node.get("ui") if isinstance(node.get("ui"), dict) else {}
    internal_nodes = ui.get("internal_nodes") if isinstance(ui, dict) else []
    if not isinstance(internal_nodes, list):
        return 600
    registry = server_registry(request)
    timeout_sum = 0
    for internal_node in internal_nodes:
        if not isinstance(internal_node, dict):
            continue
        capsule_id = (
            internal_node.get("capsuleId")
            or internal_node.get("capsule_id")
            or internal_node.get("runtime")
        )
        if not isinstance(capsule_id, str) or not capsule_id:
            timeout_sum += 60
            continue
        try:
            timeout_sum += registry.get(capsule_id).spec.permissions.timeout_seconds
        except AccError:
            timeout_sum += 60
    return max(600, min(timeout_sum or 600, 3600))


def inline_internal_node_payload(node: dict[str, Any], request: Request) -> dict[str, Any]:
    capsule_id = str(
        node.get("capsuleId")
        or node.get("capsule_id")
        or node.get("runtime")
        or "fake-agent.generic"
    )
    input_payload, receive_upstream_context, upstream_context_fields = (
        inline_capsule_input_payload(node, capsule_id, request)
    )
    timeout_seconds = inline_capsule_timeout_seconds(capsule_id, request)
    payload = {
        "id": str(node["id"]),
        "kind": "agent",
        "runtime": "capsule",
        "legacy_capsule_id": capsule_id,
        "timeout_seconds": timeout_seconds,
        "input": input_payload,
        "acc_receive_upstream_context": receive_upstream_context,
        "input_ports": normalize_inline_ports(
            node.get("inputPorts") or node.get("input_ports"),
            "input",
        ),
        "output_ports": normalize_inline_ports(
            node.get("outputPorts") or node.get("output_ports"),
            "output",
        ),
        "position": node.get("position"),
    }
    if upstream_context_fields:
        payload["acc_upstream_context_fields"] = upstream_context_fields
    return payload


def inline_capsule_input_payload(
    node: dict[str, Any],
    capsule_id: str,
    request: Request,
) -> tuple[dict[str, Any], bool, list[str]]:
    raw_input = node.get("input") if isinstance(node.get("input"), dict) else {}
    fallback_text = str(
        raw_input.get("topic")
        or raw_input.get("task")
        or node.get("task")
        or node.get("name")
        or node.get("label")
        or node.get("id")
    )
    try:
        schema = load_json(server_registry(request).get(capsule_id).input_schema_path)
    except AccError:
        return raw_input or {"topic": fallback_text}, True, []

    properties = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
    allows_extra = schema.get("additionalProperties", True) is not False
    input_payload = dict(raw_input)
    if not allows_extra:
        input_payload = {key: value for key, value in input_payload.items() if key in properties}

    upstream_context_fields: list[str] = []
    required = schema.get("required") if isinstance(schema.get("required"), list) else []
    for key, property_schema in properties.items():
        if key in input_payload:
            continue
        if not isinstance(property_schema, dict):
            continue
        property_type = property_schema.get("type")
        if key in required or property_type == "string":
            input_payload[key] = default_inline_schema_value(key, property_type, fallback_text)
            if should_fill_from_upstream_context(key, property_type):
                upstream_context_fields.append(key)
    if not input_payload and (allows_extra or "topic" in properties):
        input_payload = {"topic": fallback_text}

    receive_upstream_context = allows_extra or "upstream_context" in properties
    return input_payload, receive_upstream_context, upstream_context_fields


def default_inline_schema_value(key: str, property_type: Any, fallback_text: str) -> Any:
    if property_type == "array":
        return []
    if property_type == "object":
        return {}
    if property_type in {"integer", "number"}:
        return 0
    if property_type == "boolean":
        return False
    if key == "time_scope":
        return "最近24小时"
    return fallback_text


def should_fill_from_upstream_context(key: str, property_type: Any) -> bool:
    return property_type == "string" and key not in {
        "task",
        "topic",
        "focus",
        "time_scope",
        "query",
        "keyword",
    }


def inline_capsule_timeout_seconds(capsule_id: str, request: Request) -> int:
    try:
        return int(server_registry(request).get(capsule_id).spec.permissions.timeout_seconds)
    except AccError:
        return 60


def normalize_inline_ports(value: Any, direction: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        return [{"id": "main", "direction": direction}]
    ports: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            continue
        ports.append(
            {
                "id": item["id"],
                "direction": direction,
                "required": bool(item.get("required", False)),
                "cardinality": str(item.get("cardinality") or "one"),
            }
        )
    return ports or [{"id": "main", "direction": direction}]


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
        if ui.get("semantic_kind") == "workflow_container":
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
