"""Pure supervisor validation (REQ-A2/A3/B2)."""

from __future__ import annotations

from typing import Any

from acc.domain import (
    AccError,
    CallableRef,
    DynamicInvocationIntent,
    DynamicInvocationProposal,
    SupervisorDecision,
    SupervisorPlan,
    SupervisorRoster,
)


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
