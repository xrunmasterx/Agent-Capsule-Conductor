from __future__ import annotations

import re
from typing import Any
from uuid import uuid4

import yaml
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from acc.callable_registry import CallableRegistry
from acc.control_plane import list_callables_payload, show_callable_payload
from acc.server.context import get_project_root
from acc.utils import AccError

router = APIRouter(prefix="/callables", tags=["callables"])
CALLABLE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


class AgentClassSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    version: str = "0.1.0"
    runtime: str = "codex_cli"
    default_prompt: str = ""
    name: str | None = None
    description: str | None = None
    input_ports: dict[str, Any] | None = None
    output_ports: dict[str, Any] | None = None
    artifact_contract: dict[str, Any] | None = None
    default_permissions: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


@router.get("")
def list_callables(request: Request) -> dict[str, Any]:
    try:
        return list_callables_payload(get_project_root(request))
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{callable_id}")
def get_callable(callable_id: str, request: Request) -> dict[str, Any]:
    try:
        return show_callable_payload(callable_id, get_project_root(request))
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/agents")
def create_agent_callable(payload: AgentClassSaveRequest, request: Request) -> dict[str, Any]:
    return save_agent_callable(payload.id, payload, request, overwrite=False)


@router.put("/agents/{callable_id}")
def update_agent_callable(
    callable_id: str,
    payload: AgentClassSaveRequest,
    request: Request,
) -> dict[str, Any]:
    if payload.id != callable_id:
        raise HTTPException(status_code=400, detail="Callable id in path and body must match")
    return save_agent_callable(callable_id, payload, request, overwrite=True)


@router.delete("/agents/{callable_id}")
def delete_agent_callable(callable_id: str, request: Request) -> dict[str, Any]:
    validate_callable_id(callable_id)
    project_root = get_project_root(request)
    path = agent_callable_path(project_root, callable_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Agent callable not found: {callable_id}")
    path.unlink()
    return {"status": "deleted", "id": callable_id}


def save_agent_callable(
    callable_id: str,
    payload: AgentClassSaveRequest,
    request: Request,
    *,
    overwrite: bool,
) -> dict[str, Any]:
    validate_callable_id(callable_id)
    project_root = get_project_root(request)
    path = agent_callable_path(project_root, callable_id)
    if path.exists() and not overwrite:
        raise HTTPException(status_code=409, detail=f"Agent callable already exists: {callable_id}")
    path.parent.mkdir(parents=True, exist_ok=True)
    previous = path.read_text(encoding="utf-8") if path.exists() else None
    data = agent_payload_to_yaml(payload)
    temp_path = path.with_name(f"{path.stem}.{uuid4().hex}.tmp")
    temp_path.write_text(
        yaml.safe_dump(data, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    try:
        temp_path.replace(path)
        CallableRegistry.from_project_root(project_root).resolve_class_id(callable_id)
    except Exception as exc:
        temp_path.unlink(missing_ok=True)
        if previous is None:
            path.unlink(missing_ok=True)
        else:
            path.write_text(previous, encoding="utf-8")
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "status": "saved",
        "callable": show_callable_payload(callable_id, project_root)["callable"],
    }


def agent_payload_to_yaml(payload: AgentClassSaveRequest) -> dict[str, Any]:
    metadata = dict(payload.metadata or {})
    if payload.name:
        metadata["name"] = payload.name
    if payload.description:
        metadata["description"] = payload.description
    data: dict[str, Any] = {
        "id": payload.id,
        "version": payload.version or "0.1.0",
        "runtime": payload.runtime or "codex_cli",
    }
    if payload.default_prompt:
        data["default_prompt"] = payload.default_prompt
    if payload.default_permissions:
        data["default_permissions"] = payload.default_permissions
    data["input_ports"] = payload.input_ports or {"main": {"type": "artifact", "required": False}}
    data["output_ports"] = payload.output_ports or {"main": {"type": "artifact", "required": True}}
    data["artifact_contract"] = payload.artifact_contract or {}
    if metadata:
        data["metadata"] = metadata
    return data


def validate_callable_id(callable_id: str) -> None:
    if not CALLABLE_ID_RE.fullmatch(callable_id):
        raise HTTPException(status_code=400, detail="Callable id must match ^[A-Za-z0-9_.-]+$")


def agent_callable_path(project_root: Any, callable_id: str):
    agents_dir = (project_root / "callables" / "agents").resolve()
    path = (agents_dir / f"{callable_id}.yaml").resolve()
    if not path.is_relative_to(agents_dir):
        raise HTTPException(status_code=400, detail="Callable path is outside agents directory")
    return path
