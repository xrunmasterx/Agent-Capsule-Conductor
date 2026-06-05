from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from acc.app.human_gate import (
    idempotent_answer_payload,
    validate_approval_answer,
)
from acc.app.interactions import (
    answer_interaction,
    get_interaction,
    interaction_payload,
)
from acc.app.run_lifecycle import (
    is_waiting_run_status,
    reject_terminal_run_for_wakeup,
    reject_waiting_human_gate,
    resume_waiting_run,
)
from acc.app.scheduler import enqueue_wakeup, new_wakeup_request
from acc.domain import AccError, DecisionRecord
from acc.session import utc_now_iso
from acc.store.control_ledger import append_control_event, append_decision_record


def answer_human_gate(
    run_dir: Path,
    *,
    run_id: str,
    interaction_id: str,
    answer: dict[str, Any],
) -> dict[str, Any]:
    idempotent = idempotent_answer_payload(run_dir, interaction_id, answer)
    if idempotent is not None:
        return idempotent

    reject_terminal_run_for_wakeup(run_dir)
    interaction = get_interaction(run_dir, interaction_id)
    choice = validate_approval_answer(interaction, answer)
    updated = answer_interaction(run_dir, interaction_id, answer)
    decision = _append_approval_decision(
        run_dir,
        run_id=run_id,
        interaction_id=interaction_id,
        node_id=updated.node_id,
        choice=choice,
        answer=answer,
    )
    enqueue_wakeup(
        run_dir,
        new_wakeup_request(
            run_id=run_id,
            reason="human",
            coalesce_key=f"interaction:{interaction_id}",
            target_node_id=updated.node_id,
            payload={"interaction_id": interaction_id, "decision_id": decision.decision_id},
        ),
    )

    payload = interaction_payload(updated)
    payload["decision_id"] = decision.decision_id
    run_status = _try_load_run_status(run_dir)
    if is_waiting_run_status(run_status):
        if choice == "approve":
            resume = resume_waiting_run(
                run_dir,
                reason="human",
                interaction_id=interaction_id,
                decision_id=decision.decision_id,
            )
            payload["resume"] = resume.as_payload()
            dispatch = _dispatch_approved_gate_if_possible(run_dir, interaction_id)
            if dispatch is not None:
                payload["dispatch"] = dispatch
        else:
            rejection = reject_waiting_human_gate(
                run_dir,
                interaction_id=interaction_id,
                decision_id=decision.decision_id,
            )
            payload["rejection"] = rejection.as_payload()
    return payload


def _append_approval_decision(
    run_dir: Path,
    *,
    run_id: str,
    interaction_id: str,
    node_id: str | None,
    choice: str,
    answer: dict[str, Any],
) -> DecisionRecord:
    decision = DecisionRecord(
        decision_id=f"decision_{run_id}_approval_{interaction_id}",
        run_id=run_id,
        actor="human",
        kind="approval",
        timestamp=utc_now_iso(),
        input_evidence_refs=(f"interactions/{interaction_id}.json",),
        selected={
            "action": choice,
            "interaction_id": interaction_id,
            "answer": answer,
            **({"node_id": node_id} if node_id else {}),
        },
        result_refs=("decisions.jsonl", "wakeup_queue.jsonl"),
        rationale=f"Human approval answer: {choice}",
    )
    append_decision_record(run_dir, decision)
    append_control_event(
        run_dir,
        event_type="decision_recorded",
        run_id=run_id,
        node_id=node_id,
        decision_id=decision.decision_id,
        payload={"kind": "approval", "choice": choice, "interaction_id": interaction_id},
    )
    return decision


def _try_load_run_status(run_dir: Path) -> str | None:
    try:
        from acc.app.run_lifecycle import load_run_status

        return load_run_status(run_dir)
    except AccError:
        return None


def _dispatch_approved_gate_if_possible(
    run_dir: Path,
    interaction_id: str,
) -> dict[str, Any] | None:
    snapshot = run_dir / "behavior_snapshot" / "workflow_function_template.json"
    if not snapshot.exists():
        return None
    from acc.app.core_v2_runtime import resume_approved_human_gate_dispatch

    return asyncio.run(
        resume_approved_human_gate_dispatch(run_dir, interaction_id=interaction_id)
    )
