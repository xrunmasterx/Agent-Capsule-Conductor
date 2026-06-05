"""Pure Runtime Control Ledger plan compilation helpers."""

from __future__ import annotations

from acc.control_ledger_codec import (
    DISPATCH_TRANSITIONS,
    PLAN_STEP_TRANSITIONS,
    parse_control_event_record,
    parse_control_policy,
    parse_decision_record,
    parse_dispatch_envelope,
    parse_dispatch_transition,
    parse_plan_step,
    parse_plan_step_transition,
    parse_replay_policy,
    parse_run_plan,
    validate_control_event_record,
    validate_control_policy,
    validate_decision_record,
    validate_dispatch_envelope,
    validate_dispatch_transition,
    validate_plan_step,
    validate_plan_step_transition,
    validate_plan_steps,
    validate_replay_policy,
    validate_run_plan,
)
from acc.domain import (
    CONTROL_LEDGER_SCHEMA_VERSION,
    AccError,
    ExecutionPlan,
    PlanStep,
    PlanStepStatus,
    RunPlan,
)

__all__ = [
    "DISPATCH_TRANSITIONS",
    "PLAN_STEP_TRANSITIONS",
    "build_fixed_run_plan",
    "fixed_plan_step_id",
    "parse_control_event_record",
    "parse_control_policy",
    "parse_decision_record",
    "parse_dispatch_envelope",
    "parse_dispatch_transition",
    "parse_plan_step",
    "parse_plan_step_transition",
    "parse_replay_policy",
    "parse_run_plan",
    "validate_control_event_record",
    "validate_control_policy",
    "validate_decision_record",
    "validate_dispatch_envelope",
    "validate_dispatch_transition",
    "validate_plan_step",
    "validate_plan_step_transition",
    "validate_plan_steps",
    "validate_replay_policy",
    "validate_run_plan",
]


def build_fixed_run_plan(
    execution_plan: ExecutionPlan,
    *,
    run_id: str,
    invocation_id: str,
    control_policy_id: str,
    template_snapshot_ref: str,
    created_at: str,
) -> tuple[RunPlan, tuple[PlanStep, ...]]:
    run_plan = RunPlan(
        run_plan_id=f"run_plan_{run_id}",
        run_id=run_id,
        workflow_function_id=execution_plan.workflow_function_id,
        invocation_id=invocation_id,
        source="fixed",
        schema_version=CONTROL_LEDGER_SCHEMA_VERSION,
        template_snapshot_ref=template_snapshot_ref,
        control_policy_id=control_policy_id,
        created_at=created_at,
        status="active",
        step_count=len(execution_plan.nodes),
        metadata={},
    )
    step_ids_by_node = {
        node.node_id: fixed_plan_step_id(node.node_id) for node in execution_plan.nodes
    }
    steps: list[PlanStep] = []
    for node in execution_plan.nodes:
        missing = [
            dependency for dependency in node.depends_on if dependency not in step_ids_by_node
        ]
        if missing:
            raise AccError(
                f"ExecutionPlan node {node.node_id!r} depends on missing node {missing[0]!r}"
            )
        dependencies = tuple(step_ids_by_node[dependency] for dependency in node.depends_on)
        status: PlanStepStatus = "pending" if dependencies else "ready"
        steps.append(
            PlanStep(
                plan_step_id=step_ids_by_node[node.node_id],
                run_plan_id=run_plan.run_plan_id,
                run_id=run_id,
                node_id=node.node_id,
                callable_ref=node.invocation.callable_ref,
                depends_on=dependencies,
                source="fixed",
                status=status,
                dependency_node_ids=node.depends_on,
                input_snapshot_refs=(),
                created_at=created_at,
                updated_at=created_at,
                metadata={},
            )
        )
    validate_run_plan(run_plan)
    validate_plan_steps(steps)
    return run_plan, tuple(steps)


def fixed_plan_step_id(node_id: str) -> str:
    return f"step_{node_id}"
