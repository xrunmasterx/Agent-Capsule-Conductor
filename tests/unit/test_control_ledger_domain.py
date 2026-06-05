from __future__ import annotations

from dataclasses import is_dataclass, replace

import pytest

from acc.domain import (
    AccError,
    CallableRef,
    ControlEventRecord,
    ControlPolicy,
    DecisionRecord,
    DispatchEnvelope,
    DispatchTransitionRecord,
    ExecutionNode,
    ExecutionPlan,
    NodeInvocationSpec,
    PlanStep,
    PlanStepTransitionRecord,
    ReplayPolicy,
    RunPlan,
)
from acc.engine.control_ledger import (
    build_fixed_run_plan,
    parse_control_policy,
    parse_decision_record,
    parse_plan_step,
    parse_plan_step_transition,
    parse_replay_policy,
    parse_run_plan,
    validate_plan_steps,
)


def test_control_ledger_domain_records_are_first_class_dataclasses() -> None:
    for model in [
        ControlPolicy,
        RunPlan,
        PlanStep,
        DispatchEnvelope,
        DecisionRecord,
        ReplayPolicy,
        PlanStepTransitionRecord,
        DispatchTransitionRecord,
        ControlEventRecord,
    ]:
        assert is_dataclass(model)


def test_parser_rejects_unknown_top_level_fields() -> None:
    payload = _run_plan_payload()
    payload["legacy_status"] = "active"

    with pytest.raises(AccError, match="unknown field"):
        parse_run_plan(payload)


def test_metadata_rejects_executable_semantics() -> None:
    payload = _control_policy_payload()
    payload["metadata"] = {"run_id": "smuggled"}

    with pytest.raises(AccError, match="executable semantic key"):
        parse_control_policy(payload)


def test_build_fixed_run_plan_maps_execution_plan_to_steps() -> None:
    producer = NodeInvocationSpec(
        id="produce",
        callable_ref=CallableRef(kind="tool_class", id="fake_producer"),
    )
    consumer = NodeInvocationSpec(
        id="consume",
        callable_ref=CallableRef(kind="agent_class", id="generic_fake_agent"),
    )
    execution_plan = ExecutionPlan(
        workflow_function_id="fixed_flow",
        schema_version="acc.core.v2",
        nodes=(
            ExecutionNode(node_id="produce", invocation=producer),
            ExecutionNode(node_id="consume", invocation=consumer, depends_on=("produce",)),
        ),
        levels=(("produce",), ("consume",)),
    )

    run_plan, steps = build_fixed_run_plan(
        execution_plan,
        run_id="run_1",
        invocation_id="invocation_1",
        control_policy_id="fixed_control_policy",
        template_snapshot_ref="function_invocation.json",
        created_at="2026-06-03T00:00:00Z",
    )

    assert run_plan.source == "fixed"
    assert run_plan.step_count == 2
    assert [step.plan_step_id for step in steps] == ["step_produce", "step_consume"]
    assert steps[0].status == "ready"
    assert steps[1].status == "pending"
    assert steps[1].depends_on == ("step_produce",)
    assert steps[1].dependency_node_ids == ("produce",)


def test_plan_step_validation_rejects_duplicate_step_id() -> None:
    step = parse_plan_step(_plan_step_payload())

    with pytest.raises(AccError, match="Duplicate PlanStep id"):
        validate_plan_steps((step, replace(step)))


def test_plan_step_validation_rejects_missing_dependency() -> None:
    step = parse_plan_step(_plan_step_payload(depends_on=["missing_step"]))

    with pytest.raises(AccError, match="depends on missing step"):
        validate_plan_steps((step,))


def test_plan_step_transition_rejects_invalid_status_transition() -> None:
    payload = {
        "sequence": 1,
        "recorded_at": "2026-06-03T00:00:00Z",
        "plan_step_id": "step_analyze",
        "previous_status": "pending",
        "next_status": "success",
        "snapshot": _plan_step_payload(status="success"),
        "reason": "invalid jump",
    }

    with pytest.raises(AccError, match="Invalid PlanStep status transition"):
        parse_plan_step_transition(payload)


def test_decision_record_rejects_missing_required_fields() -> None:
    missing_decision_id = _decision_payload()
    del missing_decision_id["decision_id"]
    with pytest.raises(AccError, match="decision_id"):
        parse_decision_record(missing_decision_id)

    missing_evidence = _decision_payload()
    del missing_evidence["input_evidence_refs"]
    with pytest.raises(AccError, match="input_evidence_refs"):
        parse_decision_record(missing_evidence)


def test_replay_policy_mode_and_graphops_apply_are_validated() -> None:
    invalid_mode = _replay_policy_payload()
    invalid_mode["mode"] = "ask_llm_again"
    with pytest.raises(AccError, match="Invalid ReplayPolicy.mode"):
        parse_replay_policy(invalid_mode)

    graphops_apply = _replay_policy_payload()
    graphops_apply["graphops_apply_allowed"] = True
    with pytest.raises(AccError, match="graphops_apply_allowed must be false"):
        parse_replay_policy(graphops_apply)


def _callable_ref_payload() -> dict[str, str]:
    return {"kind": "agent_class", "id": "worker.codex"}


def _control_policy_payload() -> dict[str, object]:
    return {
        "policy_id": "policy_fixed",
        "mode": "fixed",
        "actor": "system",
        "allowed_targets": ["analyze", _callable_ref_payload()],
        "requires_human_approval": False,
        "allow_dynamic_dispatch": False,
        "allow_handoff": False,
        "max_dispatch_depth": 1,
        "max_repeat_per_target": 1,
        "max_concurrency": 2,
        "replay_policy_ref": "replay_fixed",
        "metadata": {"label": "fixed policy"},
    }


def _run_plan_payload() -> dict[str, object]:
    return {
        "run_plan_id": "plan_1",
        "run_id": "run_1",
        "workflow_function_id": "workflow_1",
        "invocation_id": "invocation_1",
        "source": "fixed",
        "schema_version": "acc.control.v1",
        "template_snapshot_ref": "function_invocation.json",
        "control_policy_id": "policy_fixed",
        "created_at": "2026-06-03T00:00:00Z",
        "status": "active",
        "step_count": 1,
        "metadata": {"label": "fixed plan"},
    }


def _plan_step_payload(
    *,
    status: str = "pending",
    depends_on: list[str] | None = None,
) -> dict[str, object]:
    return {
        "plan_step_id": "step_analyze",
        "run_plan_id": "plan_1",
        "run_id": "run_1",
        "node_id": "analyze",
        "callable_ref": _callable_ref_payload(),
        "depends_on": depends_on or [],
        "source": "fixed",
        "status": status,
        "dependency_node_ids": [],
        "input_snapshot_refs": ["nodes/analyze/input.json"],
        "created_at": "2026-06-03T00:00:00Z",
        "updated_at": "2026-06-03T00:00:00Z",
        "metadata": {"label": "analyze"},
    }


def _decision_payload() -> dict[str, object]:
    return {
        "decision_id": "decision_1",
        "run_id": "run_1",
        "run_plan_id": "plan_1",
        "actor": "system",
        "kind": "dispatch",
        "timestamp": "2026-06-03T00:00:00Z",
        "policy_snapshot": {"policy_id": "policy_fixed"},
        "candidates": [{"action": "dispatch"}],
        "selected": {"action": "dispatch", "plan_step_id": "step_analyze"},
        "rejected": [],
        "rationale": "fixed DAG ready node",
        "input_evidence_refs": ["run_plan.json"],
        "result_refs": [],
        "replay_binding": {"mode": "deterministic_recompile"},
        "correlation_id": "correlation_1",
        "metadata": {"label": "dispatch decision"},
    }


def _replay_policy_payload() -> dict[str, object]:
    return {
        "replay_policy_id": "replay_fixed",
        "mode": "deterministic_recompile",
        "template_snapshot_required": True,
        "reuse_human_answers": True,
        "reuse_supervisor_decisions": True,
        "reuse_handoff_decisions": True,
        "graphops_apply_allowed": False,
        "metadata": {"label": "fixed replay"},
    }
