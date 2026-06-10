from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from acc.app.interactions import get_interaction
from acc.models import AccError, PlanStep, PlanStepTransitionRecord
from acc.session import utc_now_iso
from acc.store import load_json, write_json
from acc.store.control_ledger import (
    append_control_event,
    append_plan_step_transition,
    load_decisions,
    load_plan_steps,
    load_run_plan,
    next_plan_step_transition_sequence,
)

TERMINAL_RUN_STATUSES = frozenset({"success", "failed", "cancelled", "crashed"})
WAITING_RUN_STATUSES = frozenset(
    {"waiting_interaction", "waiting_handoff", "waiting_timer"}
)
RESUMING_RUN_STATUSES = frozenset({"resuming"})
ACTIVE_RUN_STATUSES = (
    frozenset({"queued", "running", "cancel_requested"})
    | WAITING_RUN_STATUSES
    | RESUMING_RUN_STATUSES
)
RESTART_INTERRUPTED_RUN_STATUSES = frozenset(
    {"queued", "running", "cancel_requested", "resuming"}
)


@dataclass(frozen=True)
class ResumeRunResult:
    run_id: str
    status: str
    run_dir: str
    resumed_step_ids: tuple[str, ...]
    skipped_success_step_ids: tuple[str, ...]
    warnings: tuple[str, ...] = ()

    def as_payload(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "status": self.status,
            "run_dir": self.run_dir,
            "resumed_step_ids": list(self.resumed_step_ids),
            "skipped_success_step_ids": list(self.skipped_success_step_ids),
            "warnings": list(self.warnings),
        }


@dataclass(frozen=True)
class RejectHumanGateResult:
    run_id: str
    status: str
    run_dir: str
    rejected_step_ids: tuple[str, ...]
    warnings: tuple[str, ...] = ()

    def as_payload(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "status": self.status,
            "run_dir": self.run_dir,
            "rejected_step_ids": list(self.rejected_step_ids),
            "warnings": list(self.warnings),
        }


def is_terminal_run_status(status: str | None) -> bool:
    return status in TERMINAL_RUN_STATUSES


def is_waiting_run_status(status: str | None) -> bool:
    return status in WAITING_RUN_STATUSES


def is_active_run_status(status: str | None) -> bool:
    return status in ACTIVE_RUN_STATUSES


def is_restart_interrupted_run_status(status: str | None) -> bool:
    return status in RESTART_INTERRUPTED_RUN_STATUSES


def load_run_status(run_dir: Path) -> str:
    payload = _load_run_summary_payload(run_dir)
    status = payload.get("status")
    if not isinstance(status, str) or not status:
        raise AccError(f"run_summary.json missing status for run: {run_dir.name}")
    return status


def reject_terminal_run_for_wakeup(run_dir: Path) -> None:
    status = load_run_status(run_dir)
    if is_terminal_run_status(status):
        raise AccError(f"Terminal run cannot be answered or woken: {run_dir.name} ({status})")


def resume_waiting_run(
    run_dir: Path,
    *,
    reason: str,
    interaction_id: str | None = None,
    decision_id: str | None = None,
) -> ResumeRunResult:
    """Resume a waiting run without reinitializing its run directory or rerunning success steps."""

    if not run_dir.exists():
        raise AccError(f"Run directory not found: {run_dir}")
    current_status = load_run_status(run_dir)
    if is_terminal_run_status(current_status):
        raise AccError(f"Cannot resume terminal run: {run_dir.name} ({current_status})")
    if not is_waiting_run_status(current_status):
        raise AccError(f"Run is not waiting: {run_dir.name} ({current_status})")
    if reason != "human":
        raise AccError(f"Resume reason is not implemented: {reason}")
    if not interaction_id:
        raise AccError("Human resume requires interaction_id")

    interaction = get_interaction(run_dir, interaction_id)
    if interaction.status != "answered":
        raise AccError(f"Interaction is not answered: {interaction_id}")

    run_plan_result = load_run_plan(run_dir)
    if run_plan_result.value is None:
        raise AccError("Cannot resume run without run_plan.json")
    steps_result = load_plan_steps(run_dir)
    decisions_result = load_decisions(run_dir)
    if decisions_result.warnings:
        raise AccError("Cannot resume run without decisions.jsonl")

    warnings: list[str] = []
    waiting_steps = _matching_waiting_steps(steps_result.value, interaction_id)
    if not waiting_steps:
        raise AccError(f"No waiting PlanStep matches interaction: {interaction_id}")
    skipped_success_step_ids = tuple(
        step.plan_step_id for step in steps_result.value if step.status == "success"
    )

    next_sequence = next_plan_step_transition_sequence(run_dir)
    resumed_step_ids: list[str] = []
    for step in waiting_steps:
        ready_step = replace(step, status="ready", updated_at=utc_now_iso())
        if decision_id is not None:
            ready_step = replace(ready_step, decision_id=decision_id)
        append_plan_step_transition(
            run_dir,
            PlanStepTransitionRecord(
                sequence=next_sequence,
                recorded_at=ready_step.updated_at or utc_now_iso(),
                plan_step_id=ready_step.plan_step_id,
                previous_status=step.status,
                next_status="ready",
                snapshot=ready_step,
                reason="human interaction answered",
                decision_id=decision_id,
            ),
        )
        next_sequence += 1
        resumed_step_ids.append(step.plan_step_id)

    write_run_summary_status(run_dir, "resuming")
    append_control_event(
        run_dir,
        event_type="run_resuming",
        run_id=run_dir.name,
        payload={
            "reason": reason,
            "interaction_id": interaction_id,
            "resumed_step_ids": resumed_step_ids,
        },
    )
    return ResumeRunResult(
        run_id=run_dir.name,
        status="resuming",
        run_dir=str(run_dir.resolve()),
        resumed_step_ids=tuple(resumed_step_ids),
        skipped_success_step_ids=skipped_success_step_ids,
        warnings=tuple(warnings),
    )


def reject_waiting_human_gate(
    run_dir: Path,
    *,
    interaction_id: str,
    decision_id: str,
) -> RejectHumanGateResult:
    if not run_dir.exists():
        raise AccError(f"Run directory not found: {run_dir}")
    current_status = load_run_status(run_dir)
    if is_terminal_run_status(current_status):
        raise AccError(f"Cannot reject terminal run: {run_dir.name} ({current_status})")
    if not is_waiting_run_status(current_status):
        raise AccError(f"Run is not waiting: {run_dir.name} ({current_status})")
    interaction = get_interaction(run_dir, interaction_id)
    if interaction.status != "answered":
        raise AccError(f"Interaction is not answered: {interaction_id}")

    run_plan_result = load_run_plan(run_dir)
    if run_plan_result.value is None:
        raise AccError("Cannot reject human gate without run_plan.json")
    steps_result = load_plan_steps(run_dir)
    rejected_steps = _matching_waiting_steps(steps_result.value, interaction_id)
    if not rejected_steps:
        raise AccError(f"No waiting PlanStep matches interaction: {interaction_id}")

    next_sequence = next_plan_step_transition_sequence(run_dir)
    rejected_step_ids: list[str] = []
    for step in rejected_steps:
        skipped_step = replace(
            step,
            status="skipped",
            decision_id=decision_id,
            updated_at=utc_now_iso(),
        )
        append_plan_step_transition(
            run_dir,
            PlanStepTransitionRecord(
                sequence=next_sequence,
                recorded_at=skipped_step.updated_at or utc_now_iso(),
                plan_step_id=skipped_step.plan_step_id,
                previous_status=step.status,
                next_status="skipped",
                snapshot=skipped_step,
                reason="human interaction rejected",
                decision_id=decision_id,
            ),
        )
        next_sequence += 1
        rejected_step_ids.append(step.plan_step_id)

    write_run_summary_status(run_dir, "failed", ended_at=utc_now_iso())
    append_control_event(
        run_dir,
        event_type="human_gate_rejected",
        run_id=run_dir.name,
        decision_id=decision_id,
        payload={
            "interaction_id": interaction_id,
            "rejected_step_ids": rejected_step_ids,
        },
    )
    return RejectHumanGateResult(
        run_id=run_dir.name,
        status="failed",
        run_dir=str(run_dir.resolve()),
        rejected_step_ids=tuple(rejected_step_ids),
    )


def _matching_waiting_steps(
    steps: tuple[PlanStep, ...],
    interaction_id: str,
) -> tuple[PlanStep, ...]:
    waiting = tuple(step for step in steps if step.status == "waiting_interaction")
    exact = tuple(step for step in waiting if step.required_interaction_id == interaction_id)
    if exact:
        return exact
    if len(waiting) == 1 and waiting[0].required_interaction_id is None:
        return waiting
    return ()


def _load_run_summary_payload(run_dir: Path) -> dict[str, Any]:
    path = run_dir / "run_summary.json"
    if not path.exists():
        raise AccError(f"run_summary.json not found for run: {run_dir.name}")
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise AccError(f"run_summary.json must contain an object: {run_dir.name}")
    return payload


def write_run_summary_status(run_dir: Path, status: str, *, ended_at: str | None = None) -> None:
    payload = _load_run_summary_payload(run_dir)
    payload["status"] = status
    if not is_terminal_run_status(status):
        payload.pop("ended_at", None)
    elif ended_at is not None:
        payload["ended_at"] = ended_at
    write_json(run_dir / "run_summary.json", payload)
