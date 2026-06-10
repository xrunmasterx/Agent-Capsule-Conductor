"""Pure supervisor validation (REQ-A2/A3/B2)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from acc.models import (
    AccError,
    CallableRef,
    ControlPolicy,
    DecisionRecord,
    DynamicInvocationIntent,
    DynamicInvocationProposal,
    PlanStep,
    RunPlan,
    SupervisorDecision,
    SupervisorPlan,
    SupervisorRoster,
)
from acc.engine._ref_utils import (
    callable_ref_key as _callable_ref_key,
    callable_ref_payload as _callable_ref_payload,
)

NODE_ID_SANITIZE_RE = re.compile(r"[^A-Za-z0-9_.-]+")


@dataclass(frozen=True)
class SupervisorPlanCompilation:
    decision: DecisionRecord
    steps: tuple[PlanStep, ...]


def parse_callable_ref(raw: dict[str, Any]) -> CallableRef:
    if not isinstance(raw, dict):
        raise AccError("callable_ref must be an object")
    kind = raw.get("kind")
    ref_id = raw.get("id")
    if not isinstance(kind, str) or not isinstance(ref_id, str) or not ref_id:
        raise AccError("callable_ref requires kind and id")
    version = raw.get("version")
    return CallableRef(kind=kind, id=ref_id, version=version if isinstance(version, str) else None)


def parse_dynamic_invocation_intent(raw: dict[str, Any]) -> DynamicInvocationIntent:
    if not isinstance(raw, dict):
        raise AccError("DynamicInvocationIntent must be an object")
    target = raw.get("target_callable_ref")
    correlation_id = raw.get("correlation_id")
    rationale = raw.get("rationale")
    input_payload = raw.get("input_payload")
    if not isinstance(correlation_id, str) or not correlation_id:
        raise AccError("DynamicInvocationIntent requires correlation_id")
    if not isinstance(rationale, str):
        raise AccError("DynamicInvocationIntent requires rationale")
    if not isinstance(input_payload, dict):
        raise AccError("DynamicInvocationIntent requires input_payload object")
    node_id_suggestion = raw.get("node_id_suggestion")
    return DynamicInvocationIntent(
        target_callable_ref=parse_callable_ref(target),
        input_payload=input_payload,
        rationale=rationale,
        correlation_id=correlation_id,
        node_id_suggestion=node_id_suggestion if isinstance(node_id_suggestion, str) else None,
    )


def validate_intent_against_roster(
    intent: DynamicInvocationIntent,
    roster: SupervisorRoster,
) -> None:
    known = {(entry.callable_ref.kind, entry.callable_ref.id) for entry in roster.entries}
    key = (intent.target_callable_ref.kind, intent.target_callable_ref.id)
    if key not in known:
        raise AccError(f"Intent target {key!r} is not in supervisor roster")


def parse_supervisor_plan(raw: dict[str, Any]) -> SupervisorPlan:
    if not isinstance(raw, dict):
        raise AccError("SupervisorPlan must be an object")
    plan_id = raw.get("plan_id")
    supervisor_node_id = raw.get("supervisor_node_id")
    created_at = raw.get("created_at")
    status = raw.get("status", "proposed")
    intents_raw = raw.get("intents")
    if not isinstance(plan_id, str) or not plan_id:
        raise AccError("SupervisorPlan requires plan_id")
    if not isinstance(supervisor_node_id, str) or not supervisor_node_id:
        raise AccError("SupervisorPlan requires supervisor_node_id")
    if not isinstance(created_at, str):
        raise AccError("SupervisorPlan requires created_at")
    if status not in {"proposed", "approved", "executing", "completed", "failed"}:
        raise AccError(f"Invalid SupervisorPlan status: {status!r}")
    if not isinstance(intents_raw, list):
        raise AccError("SupervisorPlan intents must be an array")
    intents = tuple(parse_dynamic_invocation_intent(item) for item in intents_raw)
    return SupervisorPlan(
        plan_id=plan_id,
        supervisor_node_id=supervisor_node_id,
        intents=intents,
        created_at=created_at,
        status=status,
    )


def validate_supervisor_plan(plan: SupervisorPlan, roster: SupervisorRoster) -> None:
    if not plan.intents:
        raise AccError("SupervisorPlan must contain at least one intent")
    for intent in plan.intents:
        validate_intent_against_roster(intent, roster)


def compile_supervisor_plan_to_steps(
    plan: SupervisorPlan,
    roster: SupervisorRoster,
    control_policy: ControlPolicy,
    run_plan: RunPlan,
    *,
    existing_steps: tuple[PlanStep, ...] = (),
    timestamp: str,
) -> SupervisorPlanCompilation:
    if plan.status != "approved":
        raise AccError(f"SupervisorPlan {plan.plan_id} is not approved")
    if control_policy.mode != "supervisor":
        raise AccError("ControlPolicy.mode must be supervisor")
    if control_policy.actor != f"supervisor:{plan.supervisor_node_id}":
        raise AccError("ControlPolicy.actor must match supervisor node")
    validate_supervisor_plan(plan, roster)
    _validate_plan_limits(plan, control_policy, existing_steps)
    known_step_ids = {step.plan_step_id for step in existing_steps}
    supervisor_step_id = _supervisor_step_id(plan, existing_steps)
    used_node_ids = {step.node_id for step in existing_steps}
    steps: list[PlanStep] = []
    for index, intent in enumerate(plan.intents):
        _validate_intent_allowed_by_policy(intent, control_policy)
        node_id = _unique_node_id(
            intent.node_id_suggestion or f"{plan.supervisor_node_id}_worker_{index + 1}",
            used_node_ids,
        )
        used_node_ids.add(node_id)
        step = PlanStep(
            plan_step_id=f"step_{node_id}",
            run_plan_id=run_plan.run_plan_id,
            run_id=run_plan.run_id,
            node_id=node_id,
            callable_ref=intent.target_callable_ref,
            depends_on=(supervisor_step_id,) if supervisor_step_id else (),
            source="supervisor",
            status="ready",
            dependency_node_ids=(plan.supervisor_node_id,) if supervisor_step_id else (),
            input_snapshot_refs=(
                f"supervisor_plans/{plan.plan_id}/intents/{intent.correlation_id}.json",
            ),
            created_at=timestamp,
            updated_at=timestamp,
        )
        if step.plan_step_id in known_step_ids:
            raise AccError(f"Supervisor PlanStep id already exists: {step.plan_step_id}")
        known_step_ids.add(step.plan_step_id)
        steps.append(step)
    decision = DecisionRecord(
        decision_id=f"decision_{run_plan.run_id}_supervisor_plan_{plan.plan_id}",
        run_id=run_plan.run_id,
        run_plan_id=run_plan.run_plan_id,
        actor=f"supervisor:{plan.supervisor_node_id}",
        kind="supervisor_plan",
        timestamp=timestamp,
        policy_snapshot=_control_policy_snapshot(control_policy),
        candidates=(
            {
                "plan_id": plan.plan_id,
                "intent_count": len(plan.intents),
            },
        ),
        selected={
            "plan_id": plan.plan_id,
            "step_ids": [step.plan_step_id for step in steps],
            "node_ids": [step.node_id for step in steps],
            "intents": [
                {
                    "correlation_id": intent.correlation_id,
                    "target_callable_ref": _callable_ref_payload(intent.target_callable_ref),
                }
                for intent in plan.intents
            ],
        },
        rationale=f"Approved SupervisorPlan {plan.plan_id} compiled to dynamic PlanStep records.",
        input_evidence_refs=("run_plan.json", f"supervisor_plans/{plan.plan_id}.json"),
        result_refs=("plan_steps.jsonl", "decisions.jsonl"),
        replay_binding={"mode": "reuse_recorded_decisions"},
        correlation_id=plan.plan_id,
    )
    return SupervisorPlanCompilation(decision=decision, steps=tuple(steps))


def _validate_plan_limits(
    plan: SupervisorPlan,
    control_policy: ControlPolicy,
    existing_steps: tuple[PlanStep, ...],
) -> None:
    if (
        control_policy.max_concurrency is not None
        and len(plan.intents) > control_policy.max_concurrency
    ):
        raise AccError("SupervisorPlan intent count exceeds policy limit")
    existing_supervisor_steps = tuple(
        step for step in existing_steps if step.source == "supervisor"
    )
    if (
        control_policy.max_dispatch_depth is not None
        and len(existing_supervisor_steps) + len(plan.intents) > control_policy.max_dispatch_depth
    ):
        raise AccError("Supervisor max dispatch depth exceeded")
    if control_policy.max_repeat_per_target is None:
        return
    for intent in plan.intents:
        existing_count = sum(
            1
            for step in existing_supervisor_steps
            if _callable_ref_key(step.callable_ref) == _callable_ref_key(intent.target_callable_ref)
        )
        requested_count = sum(
            1
            for item in plan.intents
            if _callable_ref_key(item.target_callable_ref)
            == _callable_ref_key(intent.target_callable_ref)
        )
        if existing_count + requested_count > control_policy.max_repeat_per_target:
            raise AccError("Supervisor repeat limit exceeded")


def _validate_intent_allowed_by_policy(
    intent: DynamicInvocationIntent,
    control_policy: ControlPolicy,
) -> None:
    if not control_policy.allowed_targets:
        return
    target_key = _callable_ref_key(intent.target_callable_ref)
    for target in control_policy.allowed_targets:
        if isinstance(target, CallableRef) and _callable_ref_key(target) == target_key:
            return
        if isinstance(target, str) and target == intent.target_callable_ref.id:
            return
    raise AccError(f"Intent target {target_key!r} is not allowed by supervisor policy")


def _supervisor_step_id(plan: SupervisorPlan, existing_steps: tuple[PlanStep, ...]) -> str | None:
    for step in existing_steps:
        if step.node_id == plan.supervisor_node_id:
            return step.plan_step_id
    return None


def _unique_node_id(raw: str, used_node_ids: set[str]) -> str:
    base = NODE_ID_SANITIZE_RE.sub("_", raw).strip("_.-")
    if not base:
        base = "supervisor_worker"
    candidate = base
    suffix = 2
    while candidate in used_node_ids:
        candidate = f"{base}_{suffix}"
        suffix += 1
    return candidate


def _control_policy_snapshot(policy: ControlPolicy) -> dict[str, Any]:
    return {
        "policy_id": policy.policy_id,
        "mode": policy.mode,
        "actor": policy.actor,
        "allowed_targets": [
            _callable_ref_payload(target) if isinstance(target, CallableRef) else target
            for target in policy.allowed_targets
        ],
        "max_dispatch_depth": policy.max_dispatch_depth,
        "max_repeat_per_target": policy.max_repeat_per_target,
        "max_concurrency": policy.max_concurrency,
    }


def parse_supervisor_decision(raw: dict[str, Any]) -> SupervisorDecision:
    if not isinstance(raw, dict):
        raise AccError("SupervisorDecision must be an object")
    decision = raw.get("decision")
    correlation_id = raw.get("correlation_id")
    rationale = raw.get("rationale")
    supervisor_node_id = raw.get("supervisor_node_id")
    if decision not in {"action", "no_action", "failed"}:
        raise AccError("SupervisorDecision requires decision action|no_action|failed")
    if not isinstance(correlation_id, str) or not correlation_id:
        raise AccError("SupervisorDecision requires correlation_id")
    if not isinstance(rationale, str):
        raise AccError("SupervisorDecision requires rationale")
    if not isinstance(supervisor_node_id, str) or not supervisor_node_id:
        raise AccError("SupervisorDecision requires supervisor_node_id")
    plan_id = raw.get("plan_id")
    target_raw = raw.get("target_callable_ref")
    target = parse_callable_ref(target_raw) if isinstance(target_raw, dict) else None
    parsed = SupervisorDecision(
        decision=decision,
        correlation_id=correlation_id,
        rationale=rationale,
        supervisor_node_id=supervisor_node_id,
        plan_id=plan_id if isinstance(plan_id, str) else None,
        target_callable_ref=target,
    )
    validate_supervisor_decision_semantics(parsed)
    return parsed


def validate_supervisor_decision_semantics(decision: SupervisorDecision) -> None:
    if (
        decision.decision == "action"
        and decision.target_callable_ref is None
        and not decision.plan_id
    ):
        raise AccError("action decision requires target_callable_ref or plan_id")
    if decision.decision == "no_action" and decision.target_callable_ref is not None:
        raise AccError("no_action decision must not include target_callable_ref")


def parse_dynamic_invocation_proposal(raw: dict[str, Any]) -> DynamicInvocationProposal:
    if not isinstance(raw, dict):
        raise AccError("DynamicInvocationProposal must be an object")
    proposal_id = raw.get("proposal_id")
    plan_raw = raw.get("plan")
    if not isinstance(proposal_id, str) or not proposal_id:
        raise AccError("DynamicInvocationProposal requires proposal_id")
    plan = parse_supervisor_plan(plan_raw)
    graph_patch = raw.get("graph_patch")
    if graph_patch is not None and not isinstance(graph_patch, dict):
        raise AccError("graph_patch must be an object when present")
    return DynamicInvocationProposal(
        proposal_id=proposal_id,
        plan=plan,
        graph_patch=graph_patch,
    )


def expand_data_driven_instances(
    template_node_id: str,
    instance_count: int,
) -> list[str]:
    if instance_count < 1:
        raise AccError("instance_count must be >= 1")
    if instance_count > 32:
        raise AccError("instance_count exceeds policy limit (32)")
    return [f"{template_node_id}__{index}" for index in range(instance_count)]


def supervisor_plan_payload(plan: SupervisorPlan) -> dict[str, Any]:
    return {
        "plan_id": plan.plan_id,
        "supervisor_node_id": plan.supervisor_node_id,
        "created_at": plan.created_at,
        "status": plan.status,
        "intents": [
            {
                "target_callable_ref": {
                    "kind": intent.target_callable_ref.kind,
                    "id": intent.target_callable_ref.id,
                    "version": intent.target_callable_ref.version,
                },
                "input_payload": intent.input_payload,
                "rationale": intent.rationale,
                "correlation_id": intent.correlation_id,
                "node_id_suggestion": intent.node_id_suggestion,
            }
            for intent in plan.intents
        ],
    }


def supervisor_decision_payload(decision: SupervisorDecision) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "decision": decision.decision,
        "correlation_id": decision.correlation_id,
        "rationale": decision.rationale,
        "plan_id": decision.plan_id,
    }
    if decision.target_callable_ref is not None:
        payload["target_callable_ref"] = {
            "kind": decision.target_callable_ref.kind,
            "id": decision.target_callable_ref.id,
            "version": decision.target_callable_ref.version,
        }
    return payload
