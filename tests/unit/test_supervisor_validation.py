from __future__ import annotations

import pytest

from acc.engine.supervisor import (
    compile_supervisor_plan_to_steps,
    expand_data_driven_instances,
    parse_dynamic_invocation_intent,
    parse_supervisor_decision,
    parse_supervisor_plan,
    validate_intent_against_roster,
)
from acc.models import (
    AccError,
    AgentCapabilities,
    CallableRef,
    ControlPolicy,
    DynamicInvocationIntent,
    PlanStep,
    RunPlan,
    SupervisorRoster,
)


def _roster(*ids: str) -> SupervisorRoster:
    from acc.models import RosterEntry
    from acc.session import utc_now_iso

    return SupervisorRoster(
        entries=tuple(
            RosterEntry(
                callable_ref=CallableRef(kind="agent_class", id=ref_id),
                title=ref_id,
                capabilities=AgentCapabilities(),
                input_ports={},
                output_ports={},
            )
            for ref_id in ids
        ),
        generated_at=utc_now_iso(),
    )


def test_parse_dynamic_invocation_intent() -> None:
    intent = parse_dynamic_invocation_intent(
        {
            "target_callable_ref": {"kind": "agent_class", "id": "worker"},
            "input_payload": {"message": "hi"},
            "rationale": "need worker",
            "correlation_id": "cid-1",
        }
    )
    assert intent.target_callable_ref.id == "worker"


def test_validate_intent_against_roster_rejects_unknown() -> None:
    intent = DynamicInvocationIntent(
        target_callable_ref=CallableRef(kind="agent_class", id="missing"),
        input_payload={},
        rationale="x",
        correlation_id="cid",
    )
    with pytest.raises(AccError, match="not in supervisor roster"):
        validate_intent_against_roster(intent, _roster("worker"))


def test_parse_supervisor_plan_and_decision() -> None:
    plan = parse_supervisor_plan(
        {
            "plan_id": "plan1",
            "supervisor_node_id": "sup",
            "created_at": "2026-05-29T00:00:00Z",
            "status": "proposed",
            "intents": [
                {
                    "target_callable_ref": {"kind": "agent_class", "id": "worker"},
                    "input_payload": {},
                    "rationale": "go",
                    "correlation_id": "c1",
                }
            ],
        }
    )
    assert len(plan.intents) == 1
    decision = parse_supervisor_decision(
        {
            "decision": "no_action",
            "correlation_id": "c1",
            "rationale": "wait",
            "supervisor_node_id": "sup",
        }
    )
    assert decision.decision == "no_action"


def test_expand_data_driven_instances() -> None:
    ids = expand_data_driven_instances("worker", 3)
    assert ids == ["worker__0", "worker__1", "worker__2"]


def test_compile_approved_supervisor_plan_to_steps_and_decision() -> None:
    plan = parse_supervisor_plan(
        {
            "plan_id": "plan1",
            "supervisor_node_id": "sup",
            "created_at": "2026-06-03T00:00:00Z",
            "status": "approved",
            "intents": [
                {
                    "target_callable_ref": {"kind": "agent_class", "id": "worker"},
                    "input_payload": {"task": "go"},
                    "rationale": "need worker",
                    "correlation_id": "c1",
                    "node_id_suggestion": "worker node",
                }
            ],
        }
    )

    compiled = compile_supervisor_plan_to_steps(
        plan,
        _roster("worker"),
        _policy(allowed_targets=(CallableRef(kind="agent_class", id="worker"),)),
        _run_plan(),
        existing_steps=(_supervisor_step(),),
        timestamp="2026-06-03T00:00:01Z",
    )

    assert compiled.decision.kind == "supervisor_plan"
    assert compiled.decision.actor == "supervisor:sup"
    assert compiled.steps[0].source == "supervisor"
    assert compiled.steps[0].node_id == "worker_node"
    assert compiled.steps[0].depends_on == ("step_sup",)
    assert compiled.steps[0].input_snapshot_refs == (
        "supervisor_plans/plan1/intents/c1.json",
    )
    assert compiled.steps[0].metadata["typed_input_refs"] == [
        {
            "kind": "supervisor_intent_snapshot",
            "source": "supervisor",
            "path": "supervisor_plans/plan1/intents/c1.json",
            "payload_key": "input_payload",
            "correlation_id": "c1",
        }
    ]
    assert "supervisor_plans/plan1/intents/c1.json" in compiled.decision.input_evidence_refs


def test_compile_supervisor_plan_rejects_unsafe_snapshot_path_segments() -> None:
    unsafe_cases = [
        ("../plan", "c1"),
        ("plan/one", "c1"),
        ("plan\\one", "c1"),
        ("C:plan", "c1"),
        ("plan1", "../c1"),
        ("plan1", "c/1"),
        ("plan1", "c\\1"),
        ("plan1", "C:c1"),
    ]
    for plan_id, correlation_id in unsafe_cases:
        plan = parse_supervisor_plan(
            {
                "plan_id": plan_id,
                "supervisor_node_id": "sup",
                "created_at": "2026-06-03T00:00:00Z",
                "status": "approved",
                "intents": [
                    {
                        "target_callable_ref": {"kind": "agent_class", "id": "worker"},
                        "input_payload": {"task": "go"},
                        "rationale": "need worker",
                        "correlation_id": correlation_id,
                    }
                ],
            }
        )

        with pytest.raises(AccError, match="safe path segment|path separators|drive"):
            compile_supervisor_plan_to_steps(
                plan,
                _roster("worker"),
                _policy(allowed_targets=(CallableRef(kind="agent_class", id="worker"),)),
                _run_plan(),
                existing_steps=(_supervisor_step(),),
                timestamp="2026-06-03T00:00:01Z",
            )



    plan = parse_supervisor_plan(
        {
            "plan_id": "plan1",
            "supervisor_node_id": "sup",
            "created_at": "2026-06-03T00:00:00Z",
            "status": "proposed",
            "intents": [
                {
                    "target_callable_ref": {"kind": "agent_class", "id": "worker"},
                    "input_payload": {},
                    "rationale": "need worker",
                    "correlation_id": "c1",
                }
            ],
        }
    )

    with pytest.raises(AccError, match="not approved"):
        compile_supervisor_plan_to_steps(
            plan,
            _roster("worker"),
            _policy(),
            _run_plan(),
            timestamp="2026-06-03T00:00:01Z",
        )


def test_compile_supervisor_plan_rejects_policy_denied_target() -> None:
    plan = parse_supervisor_plan(
        {
            "plan_id": "plan1",
            "supervisor_node_id": "sup",
            "created_at": "2026-06-03T00:00:00Z",
            "status": "approved",
            "intents": [
                {
                    "target_callable_ref": {"kind": "agent_class", "id": "worker"},
                    "input_payload": {},
                    "rationale": "need worker",
                    "correlation_id": "c1",
                }
            ],
        }
    )

    with pytest.raises(AccError, match="not allowed by supervisor policy"):
        compile_supervisor_plan_to_steps(
            plan,
            _roster("worker"),
            _policy(allowed_targets=(CallableRef(kind="agent_class", id="other"),)),
            _run_plan(),
            timestamp="2026-06-03T00:00:01Z",
        )


def test_compile_supervisor_plan_enforces_repeat_and_depth_limits() -> None:
    plan = parse_supervisor_plan(
        {
            "plan_id": "plan1",
            "supervisor_node_id": "sup",
            "created_at": "2026-06-03T00:00:00Z",
            "status": "approved",
            "intents": [
                {
                    "target_callable_ref": {"kind": "agent_class", "id": "worker"},
                    "input_payload": {},
                    "rationale": "need worker",
                    "correlation_id": "c1",
                }
            ],
        }
    )
    existing = (
        _supervisor_step(),
        _dynamic_step("step_existing", "existing", CallableRef(kind="agent_class", id="worker")),
    )

    with pytest.raises(AccError, match="repeat limit"):
        compile_supervisor_plan_to_steps(
            plan,
            _roster("worker"),
            _policy(max_repeat_per_target=1),
            _run_plan(),
            existing_steps=existing,
            timestamp="2026-06-03T00:00:01Z",
        )
    with pytest.raises(AccError, match="dispatch depth"):
        compile_supervisor_plan_to_steps(
            plan,
            _roster("worker"),
            _policy(max_dispatch_depth=1),
            _run_plan(),
            existing_steps=existing,
            timestamp="2026-06-03T00:00:01Z",
        )


def _policy(
    *,
    allowed_targets: tuple[CallableRef, ...] = (),
    max_dispatch_depth: int | None = None,
    max_repeat_per_target: int | None = None,
) -> ControlPolicy:
    return ControlPolicy(
        policy_id="policy_supervisor",
        mode="supervisor",
        actor="supervisor:sup",
        allowed_targets=allowed_targets,
        max_dispatch_depth=max_dispatch_depth,
        max_repeat_per_target=max_repeat_per_target,
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
        control_policy_id="policy_supervisor",
        created_at="2026-06-03T00:00:00Z",
        status="active",
        step_count=1,
    )


def _supervisor_step() -> PlanStep:
    return _dynamic_step("step_sup", "sup", CallableRef(kind="agent_class", id="supervisor"))


def _dynamic_step(plan_step_id: str, node_id: str, ref: CallableRef) -> PlanStep:
    return PlanStep(
        plan_step_id=plan_step_id,
        run_plan_id="run_plan_run",
        run_id="run",
        node_id=node_id,
        callable_ref=ref,
        depends_on=(),
        source="supervisor",
        status="success",
        created_at="2026-06-03T00:00:00Z",
        updated_at="2026-06-03T00:00:00Z",
    )
