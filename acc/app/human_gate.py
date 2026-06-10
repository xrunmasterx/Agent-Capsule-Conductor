from __future__ import annotations

from pathlib import Path
from typing import Any

from acc.app.interactions import (
    create_human_gate_interaction,
    get_interaction,
    interaction_payload,
)
from acc.models import AccError, InteractionRequest, NodeInvocationSpec

APPROVAL_CHOICES = frozenset({"approve", "reject"})


def node_requires_human_approval(node: NodeInvocationSpec) -> bool:
    return node.control.require_human_approval


def approval_prompt_for_node(node: NodeInvocationSpec) -> str:
    if node.control.approval_prompt:
        return node.control.approval_prompt
    return f"Approve node '{node.id}' before dispatch?"


def create_pending_human_gate(
    run_dir: Path,
    *,
    run_id: str,
    node: NodeInvocationSpec,
) -> InteractionRequest:
    return create_human_gate_interaction(
        run_dir,
        run_id=run_id,
        node_id=node.id,
        prompt=approval_prompt_for_node(node),
    )


def validate_approval_answer(
    interaction: InteractionRequest,
    answer: dict[str, Any],
) -> str:
    choice = _approval_choice(answer)
    allowed = set(interaction.options or APPROVAL_CHOICES)
    if choice not in allowed:
        raise AccError(f"Approval answer must be one of: {', '.join(sorted(allowed))}")
    return choice


def idempotent_answer_payload(
    run_dir: Path,
    interaction_id: str,
    answer: dict[str, Any],
) -> dict[str, Any] | None:
    current = get_interaction(run_dir, interaction_id)
    if current.status != "answered":
        return None
    if current.answer == answer:
        payload = interaction_payload(current)
        payload["idempotent"] = True
        return payload
    raise AccError(f"Interaction already answered with a different answer: {interaction_id}")


def _approval_choice(answer: dict[str, Any]) -> str:
    for key in ("decision", "choice", "action", "value"):
        value = answer.get(key)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in APPROVAL_CHOICES:
                return normalized
    raise AccError("Approval answer must choose approve or reject")
