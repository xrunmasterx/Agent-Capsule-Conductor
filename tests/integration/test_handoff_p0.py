from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from acc.app.core_v2_loader import load_workflow_function_template
from acc.app.core_v2_runtime import (
    dispatch_ready_handoff_plan_steps,
    run_core_v2_workflow_path,
)
from acc.app.handoff import materialize_handoff_plan_step
from acc.models import (
    AccError,
    CallableRef,
    ControlEdge,
    HandoffControlPolicy,
    HandoffRequest,
    NodeInvocationSpec,
    PlanStep,
    PlanStepTransitionRecord,
    RunPlan,
    WorkflowFunctionTemplate,
)
from acc.store.control_ledger import (
    append_plan_step_transition,
    load_decisions,
    load_dispatches,
    load_plan_steps,
    load_run_plan,
    write_run_plan,
)


def test_handoff_new_session_dispatches_target_through_core_v2_path(
    tmp_path: Path,
) -> None:
    workflow_path = tmp_path / "handoff_source.accflow.json"
    _write_source_workflow(workflow_path)
    run_dir = tmp_path / "run"
    asyncio.run(run_core_v2_workflow_path(workflow_path, run_dir))
    run_plan = load_run_plan(run_dir).value
    assert run_plan is not None
    target_ref = CallableRef(kind="agent_class", id="generic_fake_agent")

    materialized = materialize_handoff_plan_step(
        run_dir,
        request=_request(
            run_plan,
            mode="new_session",
            target_node_id="handoff_worker",
            target_callable_ref=target_ref,
            input_payload={"task": "handoff only"},
        ),
        control_policy=_policy(allowed_target_callable_refs=(target_ref,)),
        run_plan=run_plan,
        template=load_workflow_function_template(workflow_path),
    )

    assert materialized["created_new_step"] is True
    assert materialized["payload_ref"] == "handoffs/h_new/payload.json"
    assert not (run_dir / "nodes" / "handoff_worker").exists()

    result = asyncio.run(dispatch_ready_handoff_plan_steps(run_dir))

    output = json.loads((run_dir / "nodes" / "handoff_worker" / "output.json").read_text())
    steps = {step.node_id: step for step in load_plan_steps(run_dir).value}
    dispatches = load_dispatches(run_dir).value
    handoff_decision = [
        decision for decision in load_decisions(run_dir).value if decision.kind == "handoff"
    ][-1]
    assert result["status"] == "success"
    assert result["dispatched_step_ids"] == ["step_handoff_worker"]
    assert output["status"] == "success"
    assert output["input"] == {"task": "handoff only"}
    assert "producer_node_id" not in output["input"]
    assert steps["handoff_worker"].source == "handoff"
    assert steps["handoff_worker"].status == "success"
    assert dispatches[-1].status == "completed"
    assert handoff_decision.selected["conversation_memory_shared"] is False
    assert (run_dir / "handoffs" / "h_new" / "payload.json").exists()


def test_handoff_illegal_target_rejected_without_step_or_payload(
    tmp_path: Path,
) -> None:
    workflow_path = tmp_path / "handoff_source.accflow.json"
    _write_source_workflow(workflow_path)
    run_dir = tmp_path / "run"
    asyncio.run(run_core_v2_workflow_path(workflow_path, run_dir))
    run_plan = load_run_plan(run_dir).value
    assert run_plan is not None
    before_steps = load_plan_steps(run_dir).value

    with pytest.raises(AccError, match="not an outgoing edge target or approved roster target"):
        materialize_handoff_plan_step(
            run_dir,
            request=_request(
                run_plan,
                handoff_id="h_bad",
                mode="new_session",
                target_node_id="illegal",
                target_callable_ref=CallableRef(kind="agent_class", id="generic_fake_agent"),
            ),
            control_policy=_policy(),
            run_plan=run_plan,
            template=load_workflow_function_template(workflow_path),
        )

    assert load_plan_steps(run_dir).value == before_steps
    assert not (run_dir / "handoffs" / "h_bad").exists()


def test_handoff_route_only_selects_existing_outgoing_target_without_session(
    tmp_path: Path,
) -> None:
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    template = _route_template()
    run_plan = _run_plan(step_count=2)
    write_run_plan(run_dir, run_plan)
    _append_source_success_step(run_dir)
    append_plan_step_transition(
        run_dir,
        PlanStepTransitionRecord(
            sequence=5,
            recorded_at="2026-06-03T00:00:00Z",
            plan_step_id="step_target",
            previous_status=None,
            next_status="pending",
            snapshot=_target_step("pending"),
            reason="test target pending",
        ),
    )

    materialized = materialize_handoff_plan_step(
        run_dir,
        request=_request(run_plan, mode="route_only"),
        control_policy=_policy(allowed_modes=("route_only",)),
        run_plan=run_plan,
        template=template,
    )

    steps = {step.node_id: step for step in load_plan_steps(run_dir).value}
    decisions = load_decisions(run_dir).value
    assert materialized["created_new_step"] is False
    assert materialized["step"]["node_id"] == "target"
    assert steps["target"].status == "ready"
    assert steps["target"].decision_id == decisions[-1].decision_id
    assert decisions[-1].kind == "handoff"
    assert decisions[-1].selected["selected_existing_node_id"] == "target"
    assert not (run_dir / "nodes" / "target" / "session_instance_manifest.json").exists()


def test_handoff_resume_session_rejected_with_explicit_p0_reason(
    tmp_path: Path,
) -> None:
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    template = _route_template()
    run_plan = _run_plan(step_count=2)
    write_run_plan(run_dir, run_plan)
    _append_source_success_step(run_dir)
    append_plan_step_transition(
        run_dir,
        PlanStepTransitionRecord(
            sequence=5,
            recorded_at="2026-06-03T00:00:00Z",
            plan_step_id="step_target",
            previous_status=None,
            next_status="pending",
            snapshot=_target_step("pending"),
            reason="test target pending",
        ),
    )

    with pytest.raises(AccError, match="resume_session is not implemented in P0"):
        materialize_handoff_plan_step(
            run_dir,
            request=_request(run_plan, mode="resume_session"),
            control_policy=_policy(allowed_modes=("resume_session",)),
            run_plan=run_plan,
            template=template,
        )

    assert not (run_dir / "handoffs" / "h_new").exists()


def _request(
    run_plan: RunPlan,
    *,
    handoff_id: str = "h_new",
    mode: str,
    target_node_id: str = "target",
    target_callable_ref: CallableRef | None = None,
    input_payload: dict[str, object] | None = None,
) -> HandoffRequest:
    return HandoffRequest(
        handoff_id=handoff_id,
        run_id=run_plan.run_id,
        run_plan_id=run_plan.run_plan_id,
        source_plan_step_id="step_source",
        source_node_id="source",
        target_node_id=target_node_id,
        target_callable_ref=target_callable_ref or CallableRef(kind="tool_class", id="merge"),
        mode=mode,  # type: ignore[arg-type]
        input_payload=dict(input_payload or {"task": "route"}),
    )


def _policy(
    *,
    allowed_modes: tuple[str, ...] = ("new_session", "route_only"),
    allowed_target_callable_refs: tuple[CallableRef, ...] = (),
) -> HandoffControlPolicy:
    return HandoffControlPolicy(
        policy_id="policy_handoff",
        actor="node:source",
        source_node_id="source",
        allowed_modes=allowed_modes,  # type: ignore[arg-type]
        allowed_target_callable_refs=allowed_target_callable_refs,
    )


def _write_source_workflow(path: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "schema_version": "acc.core.v2",
                "id": "handoff_source",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "source",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _route_template() -> WorkflowFunctionTemplate:
    return WorkflowFunctionTemplate(
        id="workflow",
        version="0.1.0",
        node_invocations={
            "source": NodeInvocationSpec(
                id="source",
                callable_ref=CallableRef(kind="tool_class", id="fake_producer"),
            ),
            "target": NodeInvocationSpec(
                id="target",
                callable_ref=CallableRef(kind="tool_class", id="merge"),
            ),
        },
        control_edges=[ControlEdge(source="source", target="target")],
        data_edges=[],
    )


def _run_plan(*, step_count: int) -> RunPlan:
    return RunPlan(
        run_plan_id="run_plan_run",
        run_id="run",
        workflow_function_id="workflow",
        invocation_id="invocation_run",
        source="fixed",
        schema_version="acc.control.v1",
        template_snapshot_ref="behavior_snapshot/workflow_function_template.json",
        control_policy_id="policy_fixed",
        created_at="2026-06-03T00:00:00Z",
        status="active",
        step_count=step_count,
    )


def _append_source_success_step(run_dir: Path) -> None:
    transitions = [
        (1, None, _source_step("ready")),
        (2, "ready", _source_step("dispatching")),
        (3, "dispatching", _source_step("running")),
        (4, "running", _source_step("success", session_id="session_run_source")),
    ]
    for sequence, previous, step in transitions:
        append_plan_step_transition(
            run_dir,
            PlanStepTransitionRecord(
                sequence=sequence,
                recorded_at="2026-06-03T00:00:00Z",
                plan_step_id=step.plan_step_id,
                previous_status=previous,  # type: ignore[arg-type]
                next_status=step.status,
                snapshot=step,
                reason="test source step",
            ),
        )


def _source_step(status: str, *, session_id: str | None = None) -> PlanStep:
    return PlanStep(
        plan_step_id="step_source",
        run_plan_id="run_plan_run",
        run_id="run",
        node_id="source",
        callable_ref=CallableRef(kind="tool_class", id="fake_producer"),
        depends_on=(),
        source="fixed",
        status=status,  # type: ignore[arg-type]
        session_id=session_id,
        created_at="2026-06-03T00:00:00Z",
        updated_at="2026-06-03T00:00:00Z",
    )


def _target_step(status: str) -> PlanStep:
    return PlanStep(
        plan_step_id="step_target",
        run_plan_id="run_plan_run",
        run_id="run",
        node_id="target",
        callable_ref=CallableRef(kind="tool_class", id="merge"),
        depends_on=("step_source",),
        source="fixed",
        status=status,  # type: ignore[arg-type]
        dependency_node_ids=("source",),
        created_at="2026-06-03T00:00:00Z",
        updated_at="2026-06-03T00:00:00Z",
    )
