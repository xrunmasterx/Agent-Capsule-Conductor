from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import acc.run_status as run_status
from acc.app.interactions import get_interaction
from acc.models import AccError
from acc.session import utc_now_iso
from acc.state_machine import transition_plan_step
from acc.store import load_json, write_json
from acc.store.control_ledger import (
    append_control_event,
    append_plan_step_transition,
    load_decisions,
    load_plan_steps,
    load_run_plan,
    next_plan_step_transition_sequence,
)

ACTIVE_RUN_STATUSES = run_status.ACTIVE_RUN_STATUSES
RESTART_INTERRUPTED_RUN_STATUSES = run_status.RESTART_INTERRUPTED_RUN_STATUSES
TERMINAL_RUN_STATUSES = run_status.TERMINAL_RUN_STATUSES
WAITING_RUN_STATUSES = run_status.WAITING_RUN_STATUSES
is_active_run_status = run_status.is_active_run_status
is_restart_interrupted_run_status = run_status.is_restart_interrupted_run_status
is_terminal_run_status = run_status.is_terminal_run_status
is_waiting_run_status = run_status.is_waiting_run_status


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
    run_id: str | None = None,
) -> ResumeRunResult:
    resolved_run_id = run_id or run_dir.name
    status = load_run_status(run_dir)
    if not is_waiting_run_status(status):
        if is_terminal_run_status(status):
            raise AccError(f"Cannot resume terminal run: {resolved_run_id} ({status})")
        raise AccError(
            f"Run is not waiting and cannot be resumed: {resolved_run_id} ({status})"
        )
    if interaction_id:
        interaction = get_interaction(run_dir, interaction_id)
        if interaction.status != "answered":
            raise AccError(
                f"Interaction must be answered before resume: {interaction_id} "
                f"({interaction.status})"
            )

    steps = load_plan_steps(run_dir).value
    resumed: list[str] = []
    skipped_success: list[str] = []
    warnings: list[str] = []
    sequence = next_plan_step_transition_sequence(run_dir)
    for step in steps:
        if step.status == "waiting_interaction":
            record, _updated = transition_plan_step(
                step,
                "ready",
                sequence=sequence,
                reason="interaction_answered",
            )
            append_plan_step_transition(run_dir, record)
            sequence += 1
            resumed.append(step.plan_step_id)
        elif step.status == "success":
            skipped_success.append(step.plan_step_id)

    _write_run_summary_status(run_dir, "resuming")
    append_control_event(
        run_dir,
        event_type="run_resuming",
        run_id=resolved_run_id,
        payload={
            "reason": reason,
            "interaction_id": interaction_id,
            "decision_id": decision_id,
            "resumed_step_ids": resumed,
        },
    )
    return ResumeRunResult(
        run_id=resolved_run_id,
        status="resuming",
        run_dir=str(run_dir.resolve()),
        resumed_step_ids=tuple(resumed),
        skipped_success_step_ids=tuple(skipped_success),
        warnings=tuple(warnings),
    )


def reject_waiting_human_gate(
    run_dir: Path,
    *,
    interaction_id: str | None = None,
    decision_id: str | None = None,
    run_id: str | None = None,
) -> RejectHumanGateResult:
    return reject_human_gate_run(
        run_dir,
        run_id=run_id or run_dir.name,
        interaction_id=interaction_id,
        decision_id=decision_id,
    )


def reject_human_gate_run(
    run_dir: Path,
    *,
    run_id: str,
    interaction_id: str | None = None,
    decision_id: str | None = None,
) -> RejectHumanGateResult:
    status = load_run_status(run_dir)
    if not is_waiting_run_status(status):
        if is_terminal_run_status(status):
            raise AccError(f"Terminal run cannot be rejected: {run_id} ({status})")
        raise AccError(f"Run is not waiting and cannot be rejected: {run_id} ({status})")

    steps = load_plan_steps(run_dir).value
    rejected: list[str] = []
    sequence = next_plan_step_transition_sequence(run_dir)
    for step in steps:
        if step.status != "waiting_interaction":
            continue
        record, _updated = transition_plan_step(
            step,
            "skipped",
            sequence=sequence,
            reason="interaction_rejected",
            decision_id=decision_id,
            failure_id=f"failure_{run_id}_{step.node_id}",
        )
        append_plan_step_transition(run_dir, record)
        sequence += 1
        rejected.append(step.plan_step_id)

    _write_run_summary_status(run_dir, "failed")
    append_control_event(
        run_dir,
        event_type="run_rejected",
        run_id=run_id,
        payload={
            "interaction_id": interaction_id,
            "decision_id": decision_id,
            "rejected_step_ids": rejected,
        },
    )
    return RejectHumanGateResult(
        run_id=run_id,
        status="failed",
        run_dir=str(run_dir.resolve()),
        rejected_step_ids=tuple(rejected),
    )


def restart_interrupted_run(run_dir: Path, *, run_id: str) -> ResumeRunResult:
    status = load_run_status(run_dir)
    if not is_restart_interrupted_run_status(status):
        raise AccError(f"Run cannot be restarted from status: {run_id} ({status})")

    steps = load_plan_steps(run_dir).value
    skipped_success = tuple(step.plan_step_id for step in steps if step.status == "success")
    _write_run_summary_status(run_dir, "resuming")
    append_control_event(
        run_dir,
        event_type="run_restart_requested",
        run_id=run_id,
        payload={"previous_status": status},
    )
    return ResumeRunResult(
        run_id=run_id,
        status="resuming",
        run_dir=str(run_dir.resolve()),
        resumed_step_ids=(),
        skipped_success_step_ids=skipped_success,
    )


def _load_run_summary_payload(run_dir: Path) -> dict[str, Any]:
    payload = load_json(run_dir / "run_summary.json")
    if not isinstance(payload, dict):
        raise AccError(f"run_summary.json must contain an object: {run_dir}")
    return payload


def write_run_summary_status(run_dir: Path, status: str) -> None:
    _write_run_summary_status(run_dir, status)


def _write_run_summary_status(run_dir: Path, status: str) -> None:
    payload = _load_run_summary_payload(run_dir)
    payload["status"] = status
    if is_terminal_run_status(status):
        payload["ended_at"] = utc_now_iso()
    else:
        payload.pop("ended_at", None)
    write_json(run_dir / "run_summary.json", payload)


def load_active_run_decisions(run_dir: Path) -> list[dict[str, Any]]:
    run_plan = load_run_plan(run_dir).value
    if run_plan is None:
        return []
    return [decision.as_dict() for decision in load_decisions(run_dir).value]
