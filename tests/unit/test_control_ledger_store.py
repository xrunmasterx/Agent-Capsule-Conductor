from __future__ import annotations

import json
from pathlib import Path

import pytest

from acc.domain import (
    AccError,
    CallableRef,
    DecisionRecord,
    DispatchEnvelope,
    DispatchTransitionRecord,
    PlanStep,
    PlanStepTransitionRecord,
    RunPlan,
    control_ledger_to_dict,
)
from acc.store.control_ledger import (
    append_control_event,
    append_decision_record,
    append_dispatch_transition,
    append_plan_step_transition,
    load_decisions,
    load_dispatches,
    load_plan_steps,
    load_run_plan,
    write_run_plan,
)


def test_missing_control_ledger_files_return_empty_values_and_warnings(tmp_path: Path) -> None:
    assert load_run_plan(tmp_path).value is None
    assert "run_plan.json" in load_run_plan(tmp_path).warnings[0]

    steps = load_plan_steps(tmp_path)
    assert steps.value == ()
    assert "plan_steps.jsonl" in steps.warnings[0]

    dispatches = load_dispatches(tmp_path)
    assert dispatches.value == ()
    assert "dispatches.jsonl" in dispatches.warnings[0]

    decisions = load_decisions(tmp_path)
    assert decisions.value == ()
    assert "decisions.jsonl" in decisions.warnings[0]


def test_run_plan_round_trips_through_json(tmp_path: Path) -> None:
    write_run_plan(tmp_path, _run_plan())

    loaded = load_run_plan(tmp_path)

    assert loaded.warnings == ()
    assert loaded.value is not None
    assert loaded.value.run_plan_id == "plan_1"
    assert loaded.value.status == "active"


def test_plan_step_loader_projects_latest_transition_state(tmp_path: Path) -> None:
    append_plan_step_transition(
        tmp_path,
        PlanStepTransitionRecord(
            sequence=1,
            recorded_at="2026-06-03T00:00:00Z",
            plan_step_id="step_analyze",
            previous_status=None,
            next_status="pending",
            snapshot=_plan_step(status="pending"),
            reason="initial fixed plan",
        ),
    )
    append_plan_step_transition(
        tmp_path,
        PlanStepTransitionRecord(
            sequence=2,
            recorded_at="2026-06-03T00:00:01Z",
            plan_step_id="step_analyze",
            previous_status="pending",
            next_status="ready",
            snapshot=_plan_step(status="ready"),
            reason="dependencies satisfied",
        ),
    )

    steps = load_plan_steps(tmp_path).value

    assert len(steps) == 1
    assert steps[0].plan_step_id == "step_analyze"
    assert steps[0].status == "ready"


def test_dispatch_loader_projects_latest_transition_state(tmp_path: Path) -> None:
    append_dispatch_transition(
        tmp_path,
        DispatchTransitionRecord(
            sequence=1,
            recorded_at="2026-06-03T00:00:00Z",
            dispatch_id="dispatch_1",
            previous_status=None,
            next_status="started",
            snapshot=_dispatch(status="started"),
            reason="dispatch started",
            decision_id="decision_1",
            plan_step_id="step_analyze",
        ),
    )
    append_dispatch_transition(
        tmp_path,
        DispatchTransitionRecord(
            sequence=2,
            recorded_at="2026-06-03T00:00:01Z",
            dispatch_id="dispatch_1",
            previous_status="started",
            next_status="completed",
            snapshot=_dispatch(status="completed"),
            reason="dispatch completed",
            decision_id="decision_1",
            plan_step_id="step_analyze",
        ),
    )

    dispatches = load_dispatches(tmp_path).value

    assert len(dispatches) == 1
    assert dispatches[0].dispatch_id == "dispatch_1"
    assert dispatches[0].status == "completed"


def test_plan_step_loader_rejects_duplicate_sequence(tmp_path: Path) -> None:
    first = PlanStepTransitionRecord(
        sequence=1,
        recorded_at="2026-06-03T00:00:00Z",
        plan_step_id="step_analyze",
        previous_status=None,
        next_status="pending",
        snapshot=_plan_step(status="pending"),
        reason="initial",
    )
    second = PlanStepTransitionRecord(
        sequence=1,
        recorded_at="2026-06-03T00:00:01Z",
        plan_step_id="step_plan",
        previous_status=None,
        next_status="pending",
        snapshot=_plan_step(plan_step_id="step_plan", node_id="plan", status="pending"),
        reason="duplicate sequence",
    )
    path = tmp_path / "plan_steps.jsonl"
    path.write_text(
        "\n".join(
            [
                json.dumps(control_ledger_to_dict(first), sort_keys=True),
                json.dumps(control_ledger_to_dict(second), sort_keys=True),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    with pytest.raises(AccError, match="duplicate sequence"):
        load_plan_steps(tmp_path)


def test_decisions_round_trip_through_jsonl(tmp_path: Path) -> None:
    append_decision_record(tmp_path, _decision())

    decisions = load_decisions(tmp_path).value

    assert len(decisions) == 1
    assert decisions[0].decision_id == "decision_1"
    assert decisions[0].kind == "dispatch"
    assert decisions[0].input_evidence_refs == ("run_plan.json",)


def test_control_event_writer_uses_canonical_events_jsonl_schema(tmp_path: Path) -> None:
    event = append_control_event(
        tmp_path,
        event_type="decision_recorded",
        run_id="run_1",
        decision_id="decision_1",
        payload={"summary": "dispatch accepted"},
        event_id="event_1",
        timestamp="2026-06-03T00:00:00Z",
    )

    lines = (tmp_path / "events.jsonl").read_text(encoding="utf-8").splitlines()
    payload = json.loads(lines[0])

    assert event.event_id == "event_1"
    assert payload["event_id"] == "event_1"
    assert payload["type"] == "decision_recorded"
    assert payload["run_id"] == "run_1"
    assert payload["decision_id"] == "decision_1"
    assert "event_type" not in payload
    assert "workflow_run_id" not in payload
    assert not (tmp_path / "workflow_events.jsonl").exists()


def _run_plan() -> RunPlan:
    return RunPlan(
        run_plan_id="plan_1",
        run_id="run_1",
        workflow_function_id="workflow_1",
        invocation_id="invocation_1",
        source="fixed",
        schema_version="acc.control.v1",
        template_snapshot_ref="function_invocation.json",
        control_policy_id="policy_fixed",
        created_at="2026-06-03T00:00:00Z",
        status="active",
        step_count=1,
        metadata={"label": "fixed plan"},
    )


def _plan_step(
    *,
    plan_step_id: str = "step_analyze",
    node_id: str = "analyze",
    status: str = "pending",
) -> PlanStep:
    return PlanStep(
        plan_step_id=plan_step_id,
        run_plan_id="plan_1",
        run_id="run_1",
        node_id=node_id,
        callable_ref=_callable_ref(),
        depends_on=(),
        source="fixed",
        status=status,  # type: ignore[arg-type]
        dependency_node_ids=(),
        input_snapshot_refs=("nodes/analyze/input.json",),
        created_at="2026-06-03T00:00:00Z",
        updated_at="2026-06-03T00:00:00Z",
        metadata={"label": node_id},
    )


def _dispatch(*, status: str = "started") -> DispatchEnvelope:
    return DispatchEnvelope(
        dispatch_id="dispatch_1",
        run_id="run_1",
        run_plan_id="plan_1",
        plan_step_id="step_analyze",
        node_id="analyze",
        callable_ref=_callable_ref(),
        scope_frame_id="scope_1",
        invocation_id="invocation_1",
        idempotency_key="run_1:step_analyze:1",
        correlation_id="correlation_1",
        input_ref="nodes/analyze/input.json",
        policy_snapshot_ref="run_plan.json",
        created_by_decision_id="decision_1",
        attempt=1,
        created_at="2026-06-03T00:00:00Z",
        status=status,  # type: ignore[arg-type]
        result_refs=(),
        metadata={"label": "dispatch"},
    )


def _decision() -> DecisionRecord:
    return DecisionRecord(
        decision_id="decision_1",
        run_id="run_1",
        run_plan_id="plan_1",
        actor="system",
        kind="dispatch",
        timestamp="2026-06-03T00:00:00Z",
        policy_snapshot={"policy_id": "policy_fixed"},
        candidates=({"action": "dispatch"},),
        selected={"action": "dispatch", "plan_step_id": "step_analyze"},
        rejected=(),
        rationale="fixed DAG ready node",
        input_evidence_refs=("run_plan.json",),
        result_refs=(),
        replay_binding={"mode": "deterministic_recompile"},
        correlation_id="correlation_1",
        metadata={"label": "dispatch decision"},
    )


def _callable_ref() -> CallableRef:
    return CallableRef(kind="agent_class", id="worker.codex")
