from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from acc.app.authoring import AuthoringSessionService
from acc.server.context import get_project_root
from acc.utils import AccError

router = APIRouter(prefix="/authoring", tags=["authoring"])


class AuthoringSessionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_id: str | None = None
    task_id: str
    canvas_hash: str
    canvas_snapshot: dict[str, Any]
    selection: dict[str, Any] | None = None


class AuthoringMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str
    canvas_hash: str
    canvas_snapshot: dict[str, Any]
    selection: dict[str, Any] | None = None


class AuthoringProposalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proposal: dict[str, Any] | None = None
    task_id: str
    canvas_hash: str
    canvas_snapshot: dict[str, Any]
    temporary_resources: dict[str, Any] | None = None


@router.get("/agents")
def list_authoring_agents(request: Request) -> dict[str, Any]:
    try:
        return service_for(request).list_agents()
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sessions")
def create_authoring_session(
    payload: AuthoringSessionCreateRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return service_for(request).create_session(
            agent_id=payload.agent_id,
            task_id=payload.task_id,
            canvas_hash=payload.canvas_hash,
            canvas_snapshot=payload.canvas_snapshot,
            selection=payload.selection,
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/sessions/{session_id}")
def get_authoring_session(session_id: str, request: Request) -> dict[str, Any]:
    try:
        return service_for(request).get_session(session_id)
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/messages")
async def post_authoring_message(
    session_id: str,
    payload: AuthoringMessageRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return await service_for(request).post_message(
            session_id,
            message=payload.message,
            canvas_hash=payload.canvas_hash,
            canvas_snapshot=payload.canvas_snapshot,
            selection=payload.selection,
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/proposals/validate")
def validate_authoring_proposal(
    payload: AuthoringProposalRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return service_for(request).validate_proposal(
            proposal=payload.proposal,
            task_id=payload.task_id,
            canvas_hash=payload.canvas_hash,
            canvas_snapshot=payload.canvas_snapshot,
            temporary_resources=payload.temporary_resources,
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/proposals/dry-run")
def dry_run_authoring_proposal(
    payload: AuthoringProposalRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return service_for(request).dry_run_proposal(
            proposal=payload.proposal,
            task_id=payload.task_id,
            canvas_hash=payload.canvas_hash,
            canvas_snapshot=payload.canvas_snapshot,
            temporary_resources=payload.temporary_resources,
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def service_for(request: Request) -> AuthoringSessionService:
    return AuthoringSessionService(project_root=get_project_root(request))
