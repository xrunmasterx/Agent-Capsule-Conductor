"""Layer 3: Pure state-machine transition helpers.

This module is the single source of truth for all status transition tables
and their enforcement logic.  Every function here is **pure** -- no file I/O,
no network, no mutation of external state.  Given a current domain object and
a desired next status it either returns ``(TransitionRecord, updated_object)``
or raises ``AccError`` for illegal transitions.

The tables defined here replace the copies formerly in
``control_ledger_codec.py``.  That module now imports from here.
"""

from __future__ import annotations

import dataclasses
from typing import Any

from acc.models import (
    AccError,
    DispatchEnvelope,
    DispatchStatus,
    DispatchTransitionRecord,
    PlanStep,
    PlanStepStatus,
    PlanStepTransitionRecord,
    RunPlanStatus,
)
from acc.session import utc_now_iso

# ---------------------------------------------------------------------------
# PlanStep transition table
# ---------------------------------------------------------------------------
#
# ``None`` as key represents the initial creation (no prior status).

PLAN_STEP_TRANSITIONS: dict[PlanStepStatus | None, frozenset[PlanStepStatus]] = {
    None: frozenset({"pending", "ready", "waiting_interaction"}),
    "pending": frozenset({"ready", "waiting_interaction", "failed", "skipped", "cancelled"}),
    "ready": frozenset({"waiting_interaction", "dispatching", "failed", "skipped", "cancelled"}),
    "waiting_interaction": frozenset({"ready", "skipped", "cancelled"}),
    "dispatching": frozenset({"running", "failed", "cancelled"}),
    "running": frozenset({"success", "failed", "cancelled"}),
    "success": frozenset(),  # terminal
    "failed": frozenset(),  # terminal
    "skipped": frozenset(),  # terminal
    "cancelled": frozenset(),  # terminal
}

# ---------------------------------------------------------------------------
# DispatchEnvelope transition table
# ---------------------------------------------------------------------------

DISPATCH_TRANSITIONS: dict[DispatchStatus | None, frozenset[DispatchStatus]] = {
    None: frozenset({"pending", "started"}),
    "pending": frozenset({"started", "failed", "cancelled"}),
    "started": frozenset({"completed", "failed", "cancelled"}),
    "completed": frozenset(),  # terminal
    "failed": frozenset(),  # terminal
    "cancelled": frozenset(),  # terminal
}

# ---------------------------------------------------------------------------
# RunPlan transition table
# ---------------------------------------------------------------------------

RUN_PLAN_TRANSITIONS: dict[RunPlanStatus | None, frozenset[RunPlanStatus]] = {
    None: frozenset({"proposed", "active"}),
    "proposed": frozenset({"active", "cancelled"}),
    "active": frozenset({"completed", "failed", "cancelled"}),
    "completed": frozenset(),
    "failed": frozenset(),
    "cancelled": frozenset(),
}

# ---------------------------------------------------------------------------
# Terminal-status helpers
# ---------------------------------------------------------------------------

PLAN_STEP_TERMINAL: frozenset[PlanStepStatus] = frozenset(
    {"success", "failed", "skipped", "cancelled"}
)

DISPATCH_TERMINAL: frozenset[DispatchStatus] = frozenset(
    {"completed", "failed", "cancelled"}
)


# ---------------------------------------------------------------------------
# Pure transition functions
# ---------------------------------------------------------------------------


def transition_plan_step(
    current: PlanStep,
    next_status: PlanStepStatus,
    *,
    context: dict[str, Any] | None = None,
    sequence: int,
    decision_id: str | None = None,
    dispatch_id: str | None = None,
    session_id: str | None = None,
    artifact_bundle_id: str | None = None,
    failure_id: str | None = None,
    reason: str,
) -> tuple[PlanStepTransitionRecord, PlanStep]:
    """Validate and execute a PlanStep status transition.

    Returns ``(record, updated_step)``.  Raises ``AccError`` on illegal
    transitions (STRICT mode -- enforced at write time, not read time).
    """
    ctx = context or {}
    allowed = PLAN_STEP_TRANSITIONS.get(current.status, frozenset())
    if next_status not in allowed:
        raise AccError(
            f"Illegal PlanStep transition: {current.plan_step_id!r} "
            f"{current.status!r} -> {next_status!r}. "
            f"Allowed from {current.status!r}: {sorted(allowed) or '(terminal)'}. "
            f"Context: {ctx}"
        )

    now = ctx.get("recorded_at") or utc_now_iso()
    updated = dataclasses.replace(
        current,
        status=next_status,
        updated_at=now,
        decision_id=decision_id or current.decision_id,
        dispatch_id=dispatch_id or current.dispatch_id,
        session_id=session_id or current.session_id,
        artifact_bundle_id=artifact_bundle_id or current.artifact_bundle_id,
        failure_id=failure_id or current.failure_id,
    )
    record = PlanStepTransitionRecord(
        sequence=sequence,
        recorded_at=now,
        plan_step_id=updated.plan_step_id,
        previous_status=current.status,
        next_status=next_status,
        snapshot=updated,
        reason=reason,
        decision_id=decision_id,
        dispatch_id=dispatch_id,
    )
    return record, updated


def transition_plan_step_initial(
    step: PlanStep,
    *,
    sequence: int,
    reason: str,
    recorded_at: str | None = None,
) -> PlanStepTransitionRecord:
    """Create the initial transition record for a brand-new PlanStep.

    The ``previous_status`` is ``None`` (no predecessor).
    """
    allowed = PLAN_STEP_TRANSITIONS.get(None, frozenset())
    if step.status not in allowed:
        raise AccError(
            f"Illegal initial PlanStep status: {step.plan_step_id!r} "
            f"status={step.status!r}. "
            f"Allowed initial statuses: {sorted(allowed)}."
        )
    now = recorded_at or utc_now_iso()
    return PlanStepTransitionRecord(
        sequence=sequence,
        recorded_at=now,
        plan_step_id=step.plan_step_id,
        previous_status=None,
        next_status=step.status,
        snapshot=step,
        reason=reason,
    )


def transition_dispatch(
    current: DispatchEnvelope,
    next_status: DispatchStatus,
    *,
    context: dict[str, Any] | None = None,
    sequence: int,
    decision_id: str | None = None,
    plan_step_id: str | None = None,
    reason: str,
) -> tuple[DispatchTransitionRecord, DispatchEnvelope]:
    """Validate and execute a DispatchEnvelope status transition.

    Returns ``(record, updated_dispatch)``.  Raises ``AccError`` on illegal
    transitions.
    """
    ctx = context or {}
    allowed = DISPATCH_TRANSITIONS.get(current.status, frozenset())
    if next_status not in allowed:
        raise AccError(
            f"Illegal DispatchEnvelope transition: {current.dispatch_id!r} "
            f"{current.status!r} -> {next_status!r}. "
            f"Allowed from {current.status!r}: {sorted(allowed) or '(terminal)'}."
        )

    now = ctx.get("recorded_at") or utc_now_iso()
    updated = dataclasses.replace(current, status=next_status)
    record = DispatchTransitionRecord(
        sequence=sequence,
        recorded_at=now,
        dispatch_id=updated.dispatch_id,
        previous_status=current.status,
        next_status=next_status,
        snapshot=updated,
        reason=reason,
        decision_id=decision_id,
        plan_step_id=plan_step_id,
    )
    return record, updated


def transition_dispatch_initial(
    dispatch: DispatchEnvelope,
    *,
    sequence: int,
    reason: str,
    decision_id: str | None = None,
    plan_step_id: str | None = None,
    recorded_at: str | None = None,
) -> DispatchTransitionRecord:
    """Create the initial transition record for a brand-new DispatchEnvelope."""
    allowed = DISPATCH_TRANSITIONS.get(None, frozenset())
    if dispatch.status not in allowed:
        raise AccError(
            f"Illegal initial DispatchEnvelope status: {dispatch.dispatch_id!r} "
            f"status={dispatch.status!r}. "
            f"Allowed initial statuses: {sorted(allowed)}."
        )
    now = recorded_at or utc_now_iso()
    return DispatchTransitionRecord(
        sequence=sequence,
        recorded_at=now,
        dispatch_id=dispatch.dispatch_id,
        previous_status=None,
        next_status=dispatch.status,
        snapshot=dispatch,
        reason=reason,
        decision_id=decision_id,
        plan_step_id=plan_step_id,
    )
