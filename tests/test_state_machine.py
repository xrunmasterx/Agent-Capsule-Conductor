"""Unit tests for Layer 3 pure state-machine transition helpers.

Tests cover:
 - All legal PlanStep transitions
 - All legal DispatchEnvelope transitions
 - Illegal transitions raise AccError (STRICT mode)
 - Terminal states cannot transition further
 - Initial transitions (previous_status=None)
 - Pure functions have no side effects
"""

from __future__ import annotations

import copy

import pytest

from acc.models import (
    AccError,
    CallableRef,
    DispatchEnvelope,
    PlanStep,
)
from acc.state_machine import (
    DISPATCH_TRANSITIONS,
    PLAN_STEP_TRANSITIONS,
    transition_dispatch,
    transition_dispatch_initial,
    transition_plan_step,
    transition_plan_step_initial,
)


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

_CALLABLE_REF = CallableRef(kind="agent_class", id="test_agent", version="1.0.0")


def _make_plan_step(status: str = "pending", **overrides) -> PlanStep:
    defaults = dict(
        plan_step_id="ps_1",
        run_plan_id="rp_1",
        run_id="run_1",
        node_id="node_a",
        callable_ref=_CALLABLE_REF,
        depends_on=(),
        source="fixed",
        status=status,
    )
    defaults.update(overrides)
    return PlanStep(**defaults)


def _make_dispatch(status: str = "started") -> DispatchEnvelope:
    return DispatchEnvelope(
        dispatch_id="dispatch_1",
        run_id="run_1",
        run_plan_id="rp_1",
        plan_step_id="ps_1",
        node_id="node_a",
        callable_ref=_CALLABLE_REF,
        scope_frame_id="scope_1",
        invocation_id="inv_1",
        idempotency_key="run_1:ps_1:1",
        correlation_id="corr_1",
        input_ref="nodes/node_a/input.json",
        policy_snapshot_ref="run_plan.json",
        created_by_decision_id="dec_1",
        attempt=1,
        created_at="2026-01-01T00:00:00Z",
        status=status,
    )


# ---------------------------------------------------------------------------
# PlanStep: legal transitions
# ---------------------------------------------------------------------------

class TestPlanStepLegalTransitions:
    """Every entry in the transition table should succeed without error."""

    @pytest.mark.parametrize(
        "from_status,to_status",
        [
            ("pending", "ready"),
            ("pending", "waiting_interaction"),
            ("pending", "failed"),
            ("pending", "skipped"),
            ("pending", "cancelled"),
            ("ready", "waiting_interaction"),
            ("ready", "dispatching"),
            ("ready", "failed"),
            ("ready", "skipped"),
            ("ready", "cancelled"),
            ("waiting_interaction", "ready"),
            ("waiting_interaction", "skipped"),
            ("waiting_interaction", "cancelled"),
            ("dispatching", "running"),
            ("dispatching", "failed"),
            ("dispatching", "cancelled"),
            ("running", "success"),
            ("running", "failed"),
            ("running", "cancelled"),
        ],
    )
    def test_legal_transition(self, from_status: str, to_status: str) -> None:
        step = _make_plan_step(status=from_status)
        record, updated = transition_plan_step(
            step,
            to_status,
            sequence=1,
            reason="test",
        )
        assert updated.status == to_status
        assert record.previous_status == from_status
        assert record.next_status == to_status
        assert record.plan_step_id == step.plan_step_id
        assert record.snapshot == updated

    def test_transition_preserves_existing_fields(self) -> None:
        step = _make_plan_step(
            status="pending",
            decision_id="existing_dec",
            session_id="existing_sess",
        )
        _record, updated = transition_plan_step(
            step,
            "ready",
            sequence=1,
            reason="test",
        )
        # Existing fields should be preserved when no override given
        assert updated.decision_id == "existing_dec"
        assert updated.session_id == "existing_sess"

    def test_transition_overrides_fields(self) -> None:
        step = _make_plan_step(status="ready")
        _record, updated = transition_plan_step(
            step,
            "dispatching",
            sequence=1,
            reason="test",
            decision_id="new_dec",
            dispatch_id="new_disp",
        )
        assert updated.decision_id == "new_dec"
        assert updated.dispatch_id == "new_disp"


# ---------------------------------------------------------------------------
# PlanStep: illegal transitions (STRICT mode)
# ---------------------------------------------------------------------------

class TestPlanStepIllegalTransitions:
    """All of these should raise AccError."""

    @pytest.mark.parametrize(
        "from_status,to_status",
        [
            ("pending", "running"),
            ("pending", "success"),
            ("pending", "dispatching"),
            ("ready", "running"),
            ("ready", "success"),
            ("ready", "pending"),
            ("dispatching", "ready"),
            ("dispatching", "pending"),
            ("dispatching", "dispatching"),
            ("dispatching", "success"),
            ("running", "ready"),
            ("running", "pending"),
            ("running", "dispatching"),
        ],
    )
    def test_illegal_transition_raises(self, from_status: str, to_status: str) -> None:
        step = _make_plan_step(status=from_status)
        with pytest.raises(AccError, match="Illegal PlanStep transition"):
            transition_plan_step(step, to_status, sequence=1, reason="bad")


# ---------------------------------------------------------------------------
# PlanStep: terminal states
# ---------------------------------------------------------------------------

class TestPlanStepTerminalStates:
    """Terminal states cannot transition to any other state."""

    @pytest.mark.parametrize("terminal", ["success", "failed", "skipped", "cancelled"])
    def test_terminal_to_any(self, terminal: str) -> None:
        step = _make_plan_step(status=terminal)
        for target in (
            "pending", "ready", "waiting_interaction", "dispatching",
            "running", "success", "failed", "skipped", "cancelled",
        ):
            with pytest.raises(AccError, match="Illegal PlanStep transition"):
                transition_plan_step(step, target, sequence=1, reason="bad")


# ---------------------------------------------------------------------------
# PlanStep: initial transitions
# ---------------------------------------------------------------------------

class TestPlanStepInitialTransition:
    @pytest.mark.parametrize("initial_status", ["pending", "ready", "waiting_interaction"])
    def test_legal_initial(self, initial_status: str) -> None:
        step = _make_plan_step(status=initial_status)
        record = transition_plan_step_initial(
            step,
            sequence=1,
            reason="initial",
        )
        assert record.previous_status is None
        assert record.next_status == initial_status
        assert record.snapshot == step

    @pytest.mark.parametrize("bad_status", ["running", "success", "failed", "dispatching"])
    def test_illegal_initial(self, bad_status: str) -> None:
        step = _make_plan_step(status=bad_status)
        with pytest.raises(AccError, match="Illegal initial PlanStep status"):
            transition_plan_step_initial(step, sequence=1, reason="bad")


# ---------------------------------------------------------------------------
# DispatchEnvelope: legal transitions
# ---------------------------------------------------------------------------

class TestDispatchLegalTransitions:
    @pytest.mark.parametrize(
        "from_status,to_status",
        [
            ("pending", "started"),
            ("pending", "failed"),
            ("pending", "cancelled"),
            ("started", "completed"),
            ("started", "failed"),
            ("started", "cancelled"),
        ],
    )
    def test_legal_transition(self, from_status: str, to_status: str) -> None:
        dispatch = _make_dispatch(status=from_status)
        record, updated = transition_dispatch(
            dispatch,
            to_status,
            sequence=1,
            reason="test",
        )
        assert updated.status == to_status
        assert record.previous_status == from_status
        assert record.next_status == to_status
        assert record.dispatch_id == dispatch.dispatch_id


# ---------------------------------------------------------------------------
# DispatchEnvelope: illegal transitions
# ---------------------------------------------------------------------------

class TestDispatchIllegalTransitions:
    @pytest.mark.parametrize(
        "from_status,to_status",
        [
            ("pending", "completed"),
            ("started", "pending"),
            ("started", "started"),
        ],
    )
    def test_illegal_transition_raises(self, from_status: str, to_status: str) -> None:
        dispatch = _make_dispatch(status=from_status)
        with pytest.raises(AccError, match="Illegal DispatchEnvelope transition"):
            transition_dispatch(dispatch, to_status, sequence=1, reason="bad")


# ---------------------------------------------------------------------------
# DispatchEnvelope: terminal states
# ---------------------------------------------------------------------------

class TestDispatchTerminalStates:
    @pytest.mark.parametrize("terminal", ["completed", "failed", "cancelled"])
    def test_terminal_to_any(self, terminal: str) -> None:
        dispatch = _make_dispatch(status=terminal)
        for target in ("pending", "started", "completed", "failed", "cancelled"):
            with pytest.raises(AccError, match="Illegal DispatchEnvelope transition"):
                transition_dispatch(dispatch, target, sequence=1, reason="bad")


# ---------------------------------------------------------------------------
# DispatchEnvelope: initial transitions
# ---------------------------------------------------------------------------

class TestDispatchInitialTransition:
    @pytest.mark.parametrize("initial_status", ["pending", "started"])
    def test_legal_initial(self, initial_status: str) -> None:
        dispatch = _make_dispatch(status=initial_status)
        record = transition_dispatch_initial(
            dispatch,
            sequence=1,
            reason="initial",
        )
        assert record.previous_status is None
        assert record.next_status == initial_status

    @pytest.mark.parametrize("bad_status", ["completed", "failed", "cancelled"])
    def test_illegal_initial(self, bad_status: str) -> None:
        dispatch = _make_dispatch(status=bad_status)
        with pytest.raises(AccError, match="Illegal initial DispatchEnvelope status"):
            transition_dispatch_initial(dispatch, sequence=1, reason="bad")


# ---------------------------------------------------------------------------
# Purity: no side effects
# ---------------------------------------------------------------------------

class TestPurity:
    """Pure functions must not mutate their input arguments."""

    def test_plan_step_not_mutated(self) -> None:
        step = _make_plan_step(status="pending")
        original = copy.deepcopy(step)
        _record, _updated = transition_plan_step(
            step,
            "ready",
            sequence=1,
            reason="test",
        )
        assert step == original

    def test_dispatch_not_mutated(self) -> None:
        dispatch = _make_dispatch(status="started")
        original = copy.deepcopy(dispatch)
        _record, _updated = transition_dispatch(
            dispatch,
            "completed",
            sequence=1,
            reason="test",
        )
        assert dispatch == original


# ---------------------------------------------------------------------------
# Table completeness
# ---------------------------------------------------------------------------

class TestTableCompleteness:
    """Every PlanStepStatus and DispatchStatus must appear in their table."""

    def test_plan_step_table_has_all_statuses(self) -> None:
        expected = {
            None, "pending", "ready", "waiting_interaction", "dispatching",
            "running", "success", "failed", "skipped", "cancelled",
        }
        assert set(PLAN_STEP_TRANSITIONS.keys()) == expected

    def test_dispatch_table_has_all_statuses(self) -> None:
        expected = {
            None, "pending", "started", "completed", "failed", "cancelled",
        }
        assert set(DISPATCH_TRANSITIONS.keys()) == expected
