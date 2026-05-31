"""Run-scoped human interactions (REQ-B3)."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

from acc.domain import AccError, InteractionKind, InteractionRequest
from acc.session import utc_now_iso
from acc.store import load_json, write_json


def interactions_dir(run_dir: Path) -> Path:
    path = run_dir / "interactions"
    path.mkdir(parents=True, exist_ok=True)
    return path


def interaction_payload(request: InteractionRequest) -> dict[str, Any]:
    return {
        "interaction_id": request.interaction_id,
        "run_id": request.run_id,
        "node_id": request.node_id,
        "kind": request.kind,
        "status": request.status,
        "prompt": request.prompt,
        "options": list(request.options),
        "payload": request.payload,
        "created_at": request.created_at,
        "answered_at": request.answered_at,
        "answer": request.answer,
    }


def parse_interaction_request(raw: dict[str, Any]) -> InteractionRequest:
    return InteractionRequest(
        interaction_id=str(raw["interaction_id"]),
        run_id=str(raw["run_id"]),
        node_id=raw.get("node_id"),
        kind=raw["kind"],
        status=raw["status"],
        prompt=str(raw["prompt"]),
        options=tuple(raw.get("options") or []),
        payload=raw.get("payload") if isinstance(raw.get("payload"), dict) else {},
        created_at=str(raw["created_at"]),
        answered_at=raw.get("answered_at"),
        answer=raw.get("answer") if isinstance(raw.get("answer"), dict) else None,
    )


def create_interaction(
    run_dir: Path,
    *,
    run_id: str,
    kind: InteractionKind,
    prompt: str,
    node_id: str | None = None,
    options: tuple[str, ...] = (),
    payload: dict[str, Any] | None = None,
) -> InteractionRequest:
    request = InteractionRequest(
        interaction_id=uuid4().hex,
        run_id=run_id,
        node_id=node_id,
        kind=kind,
        status="pending",
        prompt=prompt,
        options=options,
        payload=payload or {},
        created_at=utc_now_iso(),
    )
    path = interactions_dir(run_dir) / f"{request.interaction_id}.json"
    write_json(path, interaction_payload(request))
    return request


def list_interactions(run_dir: Path) -> list[InteractionRequest]:
    directory = interactions_dir(run_dir)
    items: list[InteractionRequest] = []
    for path in sorted(directory.glob("*.json")):
        payload = load_json(path)
        if isinstance(payload, dict):
            items.append(parse_interaction_request(payload))
    return items


def get_interaction(run_dir: Path, interaction_id: str) -> InteractionRequest:
    path = interactions_dir(run_dir) / f"{interaction_id}.json"
    if not path.exists():
        raise AccError(f"Interaction not found: {interaction_id}")
    return parse_interaction_request(load_json(path))


def answer_interaction(
    run_dir: Path,
    interaction_id: str,
    answer: dict[str, Any],
) -> InteractionRequest:
    current = get_interaction(run_dir, interaction_id)
    if current.status == "answered":
        return current
    if current.status in {"expired", "cancelled"}:
        raise AccError(f"Interaction {interaction_id} is {current.status}")
    updated = InteractionRequest(
        interaction_id=current.interaction_id,
        run_id=current.run_id,
        node_id=current.node_id,
        kind=current.kind,
        status="answered",
        prompt=current.prompt,
        options=current.options,
        payload=current.payload,
        created_at=current.created_at,
        answered_at=utc_now_iso(),
        answer=answer,
    )
    write_json(interactions_dir(run_dir) / f"{interaction_id}.json", interaction_payload(updated))
    return updated


def create_human_gate_interaction(
    run_dir: Path,
    *,
    run_id: str,
    node_id: str,
    prompt: str,
    kind: InteractionKind = "approval",
) -> InteractionRequest:
    return create_interaction(
        run_dir,
        run_id=run_id,
        kind=kind,
        prompt=prompt,
        node_id=node_id,
        options=("approve", "reject") if kind == "approval" else (),
    )
