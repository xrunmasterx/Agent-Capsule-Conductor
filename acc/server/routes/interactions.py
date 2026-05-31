from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from acc.app.interactions import (
    answer_interaction,
    create_interaction,
    get_interaction,
    interaction_payload,
    list_interactions,
)
from acc.app.scheduler import enqueue_wakeup, new_wakeup_request
from acc.domain import AccError, InteractionKind
from acc.server.context import get_project_root
from acc.store import emit_event

router = APIRouter(prefix="/runs", tags=["interactions"])


class InteractionAnswerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer: dict[str, Any]


class InteractionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: InteractionKind
    prompt: str
    node_id: str | None = None
    options: list[str] = []
    payload: dict[str, Any] | None = None


def _run_dir(request: Request, run_id: str):
    project_root = get_project_root(request)
    run_dir = project_root / "runs" / run_id
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
    return run_dir


@router.get("/{run_id}/interactions")
def list_run_interactions(run_id: str, request: Request) -> dict[str, Any]:
    run_dir = _run_dir(request, run_id)
    items = [interaction_payload(item) for item in list_interactions(run_dir)]
    return {"run_id": run_id, "interactions": items}


@router.get("/{run_id}/interactions/{interaction_id}")
def get_run_interaction(run_id: str, interaction_id: str, request: Request) -> dict[str, Any]:
    run_dir = _run_dir(request, run_id)
    try:
        return interaction_payload(get_interaction(run_dir, interaction_id))
    except AccError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{run_id}/interactions/{interaction_id}/answer")
def answer_run_interaction(
    run_id: str,
    interaction_id: str,
    body: InteractionAnswerRequest,
    request: Request,
) -> dict[str, Any]:
    run_dir = _run_dir(request, run_id)
    try:
        updated = answer_interaction(run_dir, interaction_id, body.answer)
    except AccError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    emit_event(
        run_dir / "workflow_events.jsonl",
        "interaction_answered",
        f"workflow_{run_id}",
        status="answered",
        payload={"interaction_id": interaction_id, "answer": body.answer},
    )
    enqueue_wakeup(
        run_dir,
        new_wakeup_request(
            run_id=run_id,
            reason="human",
            coalesce_key=f"interaction:{interaction_id}",
            payload={"interaction_id": interaction_id},
        ),
    )
    return interaction_payload(updated)


@router.post("/{run_id}/interactions")
def create_run_interaction(
    run_id: str,
    body: InteractionCreateRequest,
    request: Request,
) -> dict[str, Any]:
    run_dir = _run_dir(request, run_id)
    created = create_interaction(
        run_dir,
        run_id=run_id,
        kind=body.kind,
        prompt=body.prompt,
        node_id=body.node_id,
        options=tuple(body.options),
        payload=body.payload,
    )
    return interaction_payload(created)
