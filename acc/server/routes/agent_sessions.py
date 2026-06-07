from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from acc.app.agent_sessions import AgentTurnService, AgentTurnTaskManager
from acc.server.context import get_project_root
from acc.utils import AccError

router = APIRouter(prefix="/agent-sessions", tags=["agent-sessions"])


class AgentSessionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: dict[str, Any] | None = None
    task_id: str | None = None
    node_id: str | None = None
    callable_ref: dict[str, Any] | None = None
    runtime: str = "codex_app_server"
    workspace_ref: str = ""
    output_schema: dict[str, Any] | None = None


class AgentTurnSubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str
    reason: str = "node_chat"
    expected_provider_session_id: str | None = None
    canvas_hash: str | None = None
    canvas_snapshot: dict[str, Any] | None = None
    selection: dict[str, Any] | None = None


class AgentOutputPublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_turn_id: str


class AgentDraftValidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_turn_id: str


@router.post("")
def create_agent_session(payload: AgentSessionCreateRequest, request: Request) -> dict[str, Any]:
    try:
        if payload.source is not None:
            source_type = payload.source.get("type")
            if source_type == "workbench_assistant":
                return service_for(request).create_workbench_assistant_session(
                    task_id=str(payload.source.get("task_id") or ""),
                    canvas_hash=str(payload.source.get("canvas_hash") or ""),
                    canvas_snapshot=payload.source.get("canvas_snapshot")
                    if isinstance(payload.source.get("canvas_snapshot"), dict)
                    else {},
                    selection=payload.source.get("selection")
                    if isinstance(payload.source.get("selection"), dict)
                    else None,
                    agent_id=payload.source.get("agent_id")
                    if isinstance(payload.source.get("agent_id"), str)
                    else None,
                    workspace_ref=payload.source.get("workspace_ref")
                    if isinstance(payload.source.get("workspace_ref"), str)
                    else None,
                )
            if source_type != "run_node":
                raise AccError("Agent session source.type must be run_node or workbench_assistant")
            return service_for(request).create_session_from_run_node(
                run_id=str(payload.source.get("run_id") or ""),
                node_id=str(payload.source.get("node_id") or ""),
            )
        if payload.task_id is None or payload.node_id is None or payload.callable_ref is None:
            raise AccError("task_id, node_id, and callable_ref are required without source")
        return service_for(request).create_session(
            task_id=payload.task_id,
            node_id=payload.node_id,
            callable_ref=payload.callable_ref,
            runtime=payload.runtime,
            workspace_ref=payload.workspace_ref,
            output_schema=payload.output_schema,
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{session_id}")
def get_agent_session(session_id: str, request: Request) -> dict[str, Any]:
    try:
        return service_for(request).get_session(session_id)
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{session_id}/messages")
def get_agent_session_messages(session_id: str, request: Request) -> dict[str, Any]:
    try:
        return service_for(request).messages(session_id)
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{session_id}/turns/submit")
async def submit_agent_turn(
    session_id: str,
    payload: AgentTurnSubmitRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        turn = service_for(request).submit_agent_turn(
            session_id,
            message=payload.message,
            reason=payload.reason,
            expected_provider_session_id=payload.expected_provider_session_id,
            canvas_hash=payload.canvas_hash,
            canvas_snapshot=payload.canvas_snapshot,
            selection=payload.selection,
        )
        task_manager_for(request).submit(session_id=session_id, turn_id=str(turn["turn_id"]))
        return turn
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{session_id}/turns/{turn_id}/events")
def get_agent_turn_events(session_id: str, turn_id: str, request: Request) -> dict[str, Any]:
    try:
        return service_for(request).turn_events(session_id, turn_id)
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{session_id}/turns/{turn_id}/stream")
def stream_agent_turn_events(session_id: str, turn_id: str, request: Request) -> StreamingResponse:
    async def event_stream():
        seen = 0
        while True:
            try:
                payload = service_for(request).turn_events(session_id, turn_id)
                turn = service_for(request).get_turn(session_id, turn_id)
            except AccError as exc:
                yield f"event: error\ndata: {json.dumps({'detail': str(exc)})}\n\n"
                return
            events = payload.get("events") if isinstance(payload.get("events"), list) else []
            for event in events[seen:]:
                yield f"event: agent_event\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
            seen = len(events)
            status = str(turn.get("status") or "")
            if status in {"success", "failed", "cancelled", "timeout"}:
                terminal_payload = {
                    "session_id": session_id,
                    "turn_id": turn_id,
                    "status": status,
                }
                yield (
                    "event: terminal\n"
                    f"data: {json.dumps(terminal_payload)}\n\n"
                )
                return
            await asyncio.sleep(0.5)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/{session_id}/assistant-draft/validate")
def validate_assistant_draft(
    session_id: str,
    payload: AgentDraftValidateRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return service_for(request).validate_assistant_draft(
            session_id,
            expected_turn_id=payload.expected_turn_id,
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{session_id}/output/publish")
def publish_agent_output(
    session_id: str,
    payload: AgentOutputPublishRequest,
    request: Request,
) -> dict[str, Any]:
    try:
        return service_for(request).publish_output(
            session_id,
            expected_turn_id=payload.expected_turn_id,
        )
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def service_for(request: Request) -> AgentTurnService:
    return AgentTurnService(project_root=get_project_root(request))


def task_manager_for(request: Request) -> AgentTurnTaskManager:
    project_root = get_project_root(request)
    manager = getattr(request.app.state, "agent_turn_task_manager", None)
    if isinstance(manager, AgentTurnTaskManager) and manager.project_root == project_root:
        return manager
    manager = AgentTurnTaskManager(project_root)
    request.app.state.agent_turn_task_manager = manager
    return manager
