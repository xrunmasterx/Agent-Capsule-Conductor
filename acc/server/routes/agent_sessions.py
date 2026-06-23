from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from acc.app.agent_sessions import AgentTurnService, AgentTurnTaskManager
from acc.runner import LocalRunnerService, RunnerCapabilityError
from acc.server.context import get_project_root
from acc.server.live_events import (
    WorkbenchLiveBus,
    agent_turn_stream_key,
    live_event_from_agent_event,
    replay_events_after_seq,
    sse_event,
)
from acc.session import utc_now_iso
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
    workspace_alias: str | None = None
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
                    else workspace_ref_for_alias(request, payload.source.get("workspace_alias")),
                )
            if source_type != "run_node":
                raise AccError("Agent session source.type must be run_node or workbench_assistant")
            return service_for(request).create_session_from_run_node(
                run_id=str(payload.source.get("run_id") or ""),
                node_id=str(payload.source.get("node_id") or ""),
                node_run_dir=payload.source.get("node_run_dir")
                if isinstance(payload.source.get("node_run_dir"), str)
                else None,
            )
        if payload.task_id is None or payload.node_id is None or payload.callable_ref is None:
            raise AccError("task_id, node_id, and callable_ref are required without source")
        return service_for(request).create_session(
            task_id=payload.task_id,
            node_id=payload.node_id,
            callable_ref=payload.callable_ref,
            runtime=payload.runtime,
            workspace_ref=payload.workspace_ref
            or workspace_ref_for_alias(request, payload.workspace_alias),
            output_schema=payload.output_schema,
        )
    except RunnerCapabilityError as exc:
        raise HTTPException(status_code=400, detail=exc.to_payload()) from exc
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
        ensure_agent_turn_live_tailer(
            request,
            session_id=session_id,
            turn_id=str(turn["turn_id"]),
        )
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
def stream_agent_turn_events(
    session_id: str,
    turn_id: str,
    request: Request,
    after_seq: int = Query(0, ge=0),
) -> StreamingResponse:
    async def event_stream():
        service = service_for(request)
        bus = live_bus_for(request)
        stream_key = agent_turn_stream_key(session_id, turn_id)
        initial_live_events: list[dict[str, Any]] = []
        sequence = 0
        try:
            payload = service.turn_events(session_id, turn_id)
        except AccError as exc:
            yield f"event: error\ndata: {json.dumps({'detail': str(exc)})}\n\n"
            return
        events = payload.get("events") if isinstance(payload.get("events"), list) else []
        live_source = live_source_for_turn(service, session_id)
        for event in events:
            sequence += 1
            yield f"event: agent_event\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
            live_event = live_event_from_agent_event(
                event,
                sequence,
                source=live_source,
            )
            initial_live_events.append(live_event)
        for event in replay_events_after_seq(initial_live_events, after_seq):
            yield sse_event("live_event", event)
        ensure_agent_turn_live_tailer(
            request,
            session_id=session_id,
            turn_id=turn_id,
            start_seq=sequence,
        )
        async for queue in bus.subscribe(stream_key):
            while True:
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=0.5)
                except TimeoutError:
                    pass
                else:
                    if int(event.get("seq") or 0) > after_seq:
                        yield sse_event("live_event", event)
                    if event.get("type") == "terminal":
                        yield (
                            "event: terminal\n"
                            f"data: {json.dumps(event.get('payload') or {}, ensure_ascii=False)}"
                            "\n\n"
                        )
                        return
                try:
                    turn = service.get_turn(session_id, turn_id)
                except AccError as exc:
                    yield f"event: error\ndata: {json.dumps({'detail': str(exc)})}\n\n"
                    return
                status = str(turn.get("status") or "")
                if status in {"success", "failed", "cancelled", "timeout"}:
                    terminal_payload = {
                        "session_id": session_id,
                        "turn_id": turn_id,
                        "status": status,
                    }
                    terminal_live_event = {
                        "event_id": f"live_{session_id}_{turn_id}_terminal",
                        "seq": sequence + 1,
                        "source": live_source,
                        "session_id": session_id,
                        "turn_id": turn_id,
                        "type": "terminal",
                        "stream": "agent",
                        "payload": terminal_payload,
                        "timestamp": utc_now_iso(),
                    }
                    if terminal_live_event["seq"] > after_seq:
                        yield sse_event("live_event", terminal_live_event)
                    yield (f"event: terminal\ndata: {json.dumps(terminal_payload)}\n\n")
                    return

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


def workspace_ref_for_alias(request: Request, alias: object) -> str:
    if not isinstance(alias, str) or not alias:
        return ""
    return str(LocalRunnerService(get_project_root(request)).resolve_workspace_alias(alias))


def task_manager_for(request: Request) -> AgentTurnTaskManager:
    project_root = get_project_root(request)
    manager = getattr(request.app.state, "agent_turn_task_manager", None)
    if isinstance(manager, AgentTurnTaskManager) and manager.project_root == project_root:
        return manager
    manager = AgentTurnTaskManager(project_root)
    request.app.state.agent_turn_task_manager = manager
    return manager


def live_bus_for(request: Request) -> WorkbenchLiveBus:
    bus = getattr(request.app.state, "workbench_live_bus", None)
    if isinstance(bus, WorkbenchLiveBus):
        return bus
    bus = WorkbenchLiveBus()
    request.app.state.workbench_live_bus = bus
    return bus


def live_source_for_turn(service: AgentTurnService, session_id: str) -> str:
    try:
        session = service.get_session(session_id)
    except AccError:
        return "agent_turn"
    if session.get("session_kind") == "workbench_assistant":
        return "assistant_turn"
    return "agent_turn"


def ensure_agent_turn_live_tailer(
    request: Request,
    *,
    session_id: str,
    turn_id: str,
    start_seq: int = 0,
) -> None:
    tasks = getattr(request.app.state, "agent_turn_live_tailers", None)
    if not isinstance(tasks, dict):
        tasks = {}
        request.app.state.agent_turn_live_tailers = tasks
    key = agent_turn_stream_key(session_id, turn_id)
    task = tasks.get(key)
    if isinstance(task, asyncio.Task) and not task.done():
        return
    task = asyncio.create_task(
        tail_agent_turn_events(
            request,
            stream_key=key,
            session_id=session_id,
            turn_id=turn_id,
            start_seq=start_seq,
        )
    )
    tasks[key] = task


async def tail_agent_turn_events(
    request: Request,
    *,
    stream_key: str,
    session_id: str,
    turn_id: str,
    start_seq: int,
) -> None:
    service = service_for(request)
    bus = live_bus_for(request)
    seen = 0
    live_source = live_source_for_turn(service, session_id)
    bus.ensure_min_seq(stream_key, start_seq)
    try:
        while True:
            payload = service.turn_events(session_id, turn_id)
            events = payload.get("events") if isinstance(payload.get("events"), list) else []
            if seen > len(events):
                seen = 0
            for event in events[seen:]:
                seq = bus.next_seq(stream_key)
                live_event = live_event_from_agent_event(
                    event,
                    seq,
                    source=live_source,
                )
                bus.publish(stream_key, live_event)
            seen = len(events)
            turn = service.get_turn(session_id, turn_id)
            status = str(turn.get("status") or "")
            if status in {"success", "failed", "cancelled", "timeout"}:
                seq = bus.next_seq(stream_key)
                terminal_payload = {
                    "session_id": session_id,
                    "turn_id": turn_id,
                    "status": status,
                }
                bus.publish(
                    stream_key,
                    {
                        "event_id": f"live_{session_id}_{turn_id}_terminal",
                        "seq": seq,
                        "source": live_source,
                        "session_id": session_id,
                        "turn_id": turn_id,
                        "type": "terminal",
                        "stream": "agent",
                        "payload": terminal_payload,
                        "timestamp": utc_now_iso(),
                    },
                )
                return
            await asyncio.sleep(0.25)
    except AccError:
        return
    finally:
        tasks = getattr(request.app.state, "agent_turn_live_tailers", None)
        if isinstance(tasks, dict):
            current = tasks.get(stream_key)
            if current is asyncio.current_task():
                tasks.pop(stream_key, None)
