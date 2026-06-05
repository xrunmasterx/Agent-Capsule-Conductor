from __future__ import annotations

import pytest

from acc.domain import (
    AccError,
    CallableRef,
    ControlEdge,
    HandoffControlPolicy,
    HandoffRequest,
    NodeInvocationSpec,
    PlanStep,
    RunPlan,
    WorkflowFunctionTemplate,
)
from acc.engine.handoff import compile_handoff_to_plan_step


def test_handoff_new_session_compiles_decision_and_dynamic_step() -> None:
    request = _request(
        mode="new_session",
        target_node_id="handoff_worker",
        target_callable_ref=CallableRef(kind="agent_class", id="generic_fake_agent"),
        payload_ref="handoffs/h1/payload.json",
    )

    compilation = compile_handoff_to_plan_step(
        request,
        control_policy=_policy(
            allowed_target_callable_refs=(
                CallableRef(kind="agent_class", id="generic_fake_agent"),
            )
        ),
        run_plan=_run_plan(),
        template=_template(include_target=False),
        existing_steps=(_source_step("success"),),
        timestamp="2026-06-03T00:00:00Z",
    )

    assert compilation.decision.kind == "handoff"
    assert compilation.decision.actor == "node:source"
    assert compilation.decision.selected["source_node_id"] == "source"
    assert compilation.decision.selected["target_node_id"] == "handoff_worker"
    assert compilation.decision.selected["mode"] == "new_session"
    assert compilation.decision.selected["payload_ref"] == "handoffs/h1/payload.json"
    assert compilation.decision.selected["conversation_memory_shared"] is False
    assert compilation.new_step is not None
    assert compilation.new_step.source == "handoff"
    assert compilation.new_step.status == "ready"
    assert compilation.new_step.depends_on == ("step_source",)
    assert compilation.new_step.input_snapshot_refs == ("handoffs/h1/payload.json",)


def test_handoff_route_only_selects_existing_outgoing_step() -> None:
    request = _request(mode="route_only")

    compilation = compile_handoff_to_plan_step(
        request,
        control_policy=_policy(allowed_modes=("route_only",)),
        run_plan=_run_plan(),
        template=_template(include_target=True),
        existing_steps=(_source_step("success"), _target_step("pending")),
        timestamp="2026-06-03T00:00:00Z",
    )

    assert compilation.new_step is None
    assert compilation.route_step is not None
    assert compilation.route_step.node_id == "target"
    assert compilation.decision.selected["selected_existing_node_id"] == "target"
    assert compilation.decision.selected["mode"] == "route_only"


def test_handoff_rejects_illegal_target() -> None:
    request = _request(target_node_id="illegal")

    with pytest.raises(AccError, match="not an outgoing edge target or approved roster target"):
        compile_handoff_to_plan_step(
            request,
            control_policy=_policy(),
            run_plan=_run_plan(),
            template=_template(include_target=False),
            existing_steps=(_source_step("success"),),
            timestamp="2026-06-03T00:00:00Z",
        )


def test_handoff_resume_session_is_explicitly_rejected_in_p0() -> None:
    request = _request(mode="resume_session")

    with pytest.raises(AccError, match="resume_session is not implemented in P0"):
        compile_handoff_to_plan_step(
            request,
            control_policy=_policy(allowed_modes=("resume_session",)),
            run_plan=_run_plan(),
            template=_template(include_target=True),
            existing_steps=(_source_step("success"), _target_step("pending")),
            timestamp="2026-06-03T00:00:00Z",
        )


def _request(
    *,
    mode: str = "new_session",
    target_node_id: str = "target",
    target_callable_ref: CallableRef | None = None,
    payload_ref: str | None = "handoffs/h1/payload.json",
) -> HandoffRequest:
    return HandoffRequest(
        handoff_id="h1",
        run_id="run",
        run_plan_id="run_plan_run",
        source_plan_step_id="step_source",
        source_node_id="source",
        target_node_id=target_node_id,
        target_callable_ref=target_callable_ref or CallableRef(kind="tool_class", id="merge"),
        mode=mode,  # type: ignore[arg-type]
        input_payload={"task": "handoff"},
        payload_ref=payload_ref,
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


def _run_plan() -> RunPlan:
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
        step_count=2,
    )


def _template(*, include_target: bool) -> WorkflowFunctionTemplate:
    nodes = {
        "source": _node("source", CallableRef(kind="tool_class", id="fake_producer")),
    }
    edges: list[ControlEdge] = []
    if include_target:
        nodes["target"] = _node("target", CallableRef(kind="tool_class", id="merge"))
        edges.append(ControlEdge(source="source", target="target"))
    return WorkflowFunctionTemplate(
        id="workflow",
        version="0.1.0",
        node_invocations=nodes,
        control_edges=edges,
        data_edges=[],
    )


def _node(node_id: str, ref: CallableRef) -> NodeInvocationSpec:
    return NodeInvocationSpec(id=node_id, callable_ref=ref)


def _source_step(status: str) -> PlanStep:
    return PlanStep(
        plan_step_id="step_source",
        run_plan_id="run_plan_run",
        run_id="run",
        node_id="source",
        callable_ref=CallableRef(kind="tool_class", id="fake_producer"),
        depends_on=(),
        source="fixed",
        status=status,  # type: ignore[arg-type]
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
