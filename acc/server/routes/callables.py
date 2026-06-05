from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from acc.control_plane import (
    CallableAlreadyExistsError,
    CallableNotFoundError,
    delete_agent_callable_payload,
    list_callables_payload,
    save_agent_callable_payload,
    show_callable_payload,
)
from acc.server.context import get_project_root
from acc.utils import AccError

router = APIRouter(prefix="/callables", tags=["callables"])


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
    try:
        return delete_agent_callable_payload(get_project_root(request), callable_id)
    except CallableNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def save_agent_callable(
    callable_id: str,
    payload: AgentClassSaveRequest,
    request: Request,
    *,
    overwrite: bool,
) -> dict[str, Any]:
    try:
        return save_agent_callable_payload(
            get_project_root(request),
            callable_id,
            payload.model_dump(),
            overwrite=overwrite,
        )
    except CallableAlreadyExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
