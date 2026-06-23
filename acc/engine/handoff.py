from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from acc.engine._ref_utils import (
    callable_ref_key as _callable_ref_key,
)
from acc.engine._ref_utils import (
    callable_ref_payload as _callable_ref_payload,
)
from acc.models import (
    AccError,
    CallableRef,
    DecisionRecord,
    HandoffControlPolicy,
    HandoffRequest,
    PlanStep,
    RunPlan,
    WorkflowFunctionTemplate,
)


@dataclass(frozen=True)
class HandoffCompilation:
    decision: DecisionRecord
    new_step: PlanStep | None = None
    route_step: PlanStep | None = None


def compile_handoff_to_plan_step(
    request: HandoffRequest,
    *,
    control_policy: HandoffControlPolicy,
    run_plan: RunPlan,
    template: WorkflowFunctionTemplate,
    existing_steps: tuple[PlanStep, ...],
    timestamp: str,
) -> HandoffCompilation:
    _validate_policy(control_policy)
    _validate_request_header(request, control_policy, run_plan)
    if request.mode == "resume_session":
        raise AccError("Handoff mode resume_session is not implemented in P0")
    if control_policy.requires_acceptance or control_policy.requires_human_approval:
        raise AccError("Handoff acceptance is deferred in P0")

    source_step = _source_step(request, existing_steps)
    if source_step.status != "success":
        raise AccError("Handoff source PlanStep must be success before transfer")
    outgoing_targets = {
        edge.target for edge in template.control_edges if edge.source == request.source_node_id
    }
    _validate_target(
        request,
        control_policy=control_policy,
        template=template,
        outgoing_targets=outgoing_targets,
        existing_steps=existing_steps,
    )

    decision = _handoff_decision(
        request,
        control_policy=control_policy,
        run_plan=run_plan,
        timestamp=timestamp,
    )
    if request.mode == "route_only":
        return HandoffCompilation(
            decision=decision,
            route_step=_route_step(request, existing_steps),
        )
    return HandoffCompilation(
        decision=decision,
        new_step=_new_session_step(
            request,
            run_plan=run_plan,
            timestamp=timestamp,
            decision_id=decision.decision_id,
            existing_steps=existing_steps,
        ),
    )


def _validate_policy(policy: HandoffControlPolicy) -> None:
    if not policy.policy_id:
        raise AccError("HandoffControlPolicy.policy_id is required")
    if not policy.source_node_id:
        raise AccError("HandoffControlPolicy.source_node_id is required")
    expected_actor = f"node:{policy.source_node_id}"
    if policy.actor != expected_actor:
        raise AccError("HandoffControlPolicy.actor must match source node")
    if not policy.allowed_modes:
        raise AccError("HandoffControlPolicy.allowed_modes must be non-empty")
    allowed_modes = {"new_session", "resume_session", "route_only"}
    for mode in policy.allowed_modes:
        if mode not in allowed_modes:
            raise AccError(f"Invalid handoff mode in policy: {mode!r}")
    if policy.timeout_seconds is not None and policy.timeout_seconds < 0:
        raise AccError("HandoffControlPolicy.timeout_seconds must be >= 0")
    if policy.max_handoff_depth is not None and policy.max_handoff_depth < 0:
        raise AccError("HandoffControlPolicy.max_handoff_depth must be >= 0")
    if policy.max_repeat_per_target is not None and policy.max_repeat_per_target < 0:
        raise AccError("HandoffControlPolicy.max_repeat_per_target must be >= 0")
    _validate_callable_refs(policy.allowed_target_callable_refs)


def _validate_request_header(
    request: HandoffRequest,
    policy: HandoffControlPolicy,
    run_plan: RunPlan,
) -> None:
    for field_name in (
        "handoff_id",
        "run_id",
        "run_plan_id",
        "source_plan_step_id",
        "source_node_id",
        "target_node_id",
    ):
        if not getattr(request, field_name):
            raise AccError(f"HandoffRequest.{field_name} is required")
    if request.run_id != run_plan.run_id or request.run_plan_id != run_plan.run_plan_id:
        raise AccError("HandoffRequest run identity does not match run_plan")
    if request.source_node_id != policy.source_node_id:
        raise AccError("HandoffRequest source_node_id does not match policy")
    if request.mode not in policy.allowed_modes and request.mode != "resume_session":
        raise AccError(f"Handoff mode {request.mode!r} is not allowed by policy")
    _validate_callable_ref(request.target_callable_ref)


def _validate_target(
    request: HandoffRequest,
    *,
    control_policy: HandoffControlPolicy,
    template: WorkflowFunctionTemplate,
    outgoing_targets: set[str],
    existing_steps: tuple[PlanStep, ...],
) -> None:
    target_is_outgoing = request.target_node_id in outgoing_targets
    target_is_policy_node = request.target_node_id in control_policy.allowed_target_node_ids
    target_is_policy_callable = any(
        _callable_ref_key(item) == _callable_ref_key(request.target_callable_ref)
        for item in control_policy.allowed_target_callable_refs
    )
    if not (target_is_outgoing or target_is_policy_node or target_is_policy_callable):
        raise AccError(
            f"Handoff target {request.target_node_id!r} is not an outgoing edge "
            "target or approved roster target"
        )
    if request.mode == "route_only":
        if not target_is_outgoing:
            raise AccError("route_only handoff target must be an outgoing edge target")
        if request.target_node_id not in template.node_invocations:
            raise AccError("route_only handoff target node is not in workflow template")
        template_ref = template.node_invocations[request.target_node_id].callable_ref
        if _callable_ref_key(template_ref) != _callable_ref_key(request.target_callable_ref):
            raise AccError("route_only handoff target callable_ref does not match template")
        step = _route_step(request, existing_steps)
        if step.status not in {"pending", "ready"}:
            raise AccError("route_only handoff target PlanStep must be pending or ready")


def _source_step(request: HandoffRequest, existing_steps: tuple[PlanStep, ...]) -> PlanStep:
    for step in existing_steps:
        if step.plan_step_id == request.source_plan_step_id:
            if step.node_id != request.source_node_id:
                raise AccError("Handoff source PlanStep node_id mismatch")
            return step
    raise AccError(f"Handoff source PlanStep not found: {request.source_plan_step_id}")


def _route_step(request: HandoffRequest, existing_steps: tuple[PlanStep, ...]) -> PlanStep:
    for step in existing_steps:
        if step.node_id == request.target_node_id:
            if _callable_ref_key(step.callable_ref) != _callable_ref_key(
                request.target_callable_ref
            ):
                raise AccError("route_only handoff target callable_ref does not match PlanStep")
            return step
    raise AccError(f"route_only handoff target PlanStep not found: {request.target_node_id}")


def _new_session_step(
    request: HandoffRequest,
    *,
    run_plan: RunPlan,
    timestamp: str,
    decision_id: str,
    existing_steps: tuple[PlanStep, ...],
) -> PlanStep:
    plan_step_id = f"step_{request.target_node_id}"
    if any(
        step.plan_step_id == plan_step_id or step.node_id == request.target_node_id
        for step in existing_steps
    ):
        raise AccError(f"Handoff PlanStep id already exists: {plan_step_id}")
    input_refs = (request.payload_ref,) if request.payload_ref else ()
    typed_input_refs = []
    if request.payload_ref:
        typed_input_refs.append(
            {
                "kind": "handoff_payload_snapshot",
                "source": "handoff",
                "path": request.payload_ref,
                "payload_key": "input_payload",
                "handoff_id": request.handoff_id,
            }
        )
    return PlanStep(
        plan_step_id=plan_step_id,
        run_plan_id=run_plan.run_plan_id,
        run_id=run_plan.run_id,
        node_id=request.target_node_id,
        callable_ref=request.target_callable_ref,
        depends_on=(request.source_plan_step_id,),
        source="handoff",
        status="ready",
        dependency_node_ids=(request.source_node_id,),
        input_snapshot_refs=input_refs,
        decision_id=decision_id,
        created_at=timestamp,
        updated_at=timestamp,
        metadata={
            "handoff_id": request.handoff_id,
            "handoff_mode": request.mode,
            "typed_input_refs": typed_input_refs,
        },
    )


def _handoff_decision(
    request: HandoffRequest,
    *,
    control_policy: HandoffControlPolicy,
    run_plan: RunPlan,
    timestamp: str,
) -> DecisionRecord:
    decision_id = f"decision_{run_plan.run_id}_handoff_{request.handoff_id}"
    selected: dict[str, Any] = {
        "handoff_id": request.handoff_id,
        "source_plan_step_id": request.source_plan_step_id,
        "source_node_id": request.source_node_id,
        "target_node_id": request.target_node_id,
        "target_callable_ref": _callable_ref_payload(request.target_callable_ref),
        "mode": request.mode,
        "payload_ref": request.payload_ref,
        "artifact_refs": list(request.artifact_refs),
        "scope_ref": request.scope_ref,
        "acceptance_required": control_policy.requires_acceptance,
        "acceptance_status": "pending"
        if control_policy.requires_acceptance
        else "not_required",
        "acceptance_refs": list(request.acceptance_refs),
        "timeout_policy": {
            "timeout_seconds": control_policy.timeout_seconds,
            "fallback_target_node_id": control_policy.fallback_target_node_id,
        },
        "conversation_memory_shared": False,
    }
    if request.mode == "new_session":
        selected["result_plan_step_id"] = f"step_{request.target_node_id}"
    else:
        selected["selected_existing_node_id"] = request.target_node_id
    input_refs = tuple(
        ref
        for ref in (
            "run_plan.json",
            "plan_steps.jsonl",
            request.payload_ref,
            *request.artifact_refs,
            *request.acceptance_refs,
        )
        if ref
    )
    return DecisionRecord(
        decision_id=decision_id,
        run_id=run_plan.run_id,
        run_plan_id=run_plan.run_plan_id,
        actor=control_policy.actor,
        kind="handoff",
        timestamp=timestamp,
        policy_snapshot=_control_policy_snapshot(control_policy),
        candidates=(
            {
                "source_node_id": request.source_node_id,
                "target_node_id": request.target_node_id,
                "target_callable_ref": _callable_ref_payload(request.target_callable_ref),
                "mode": request.mode,
            },
        ),
        selected=selected,
        rejected=(),
        rationale="Typed handoff P0 selected a target and mode under policy validation.",
        input_evidence_refs=input_refs,
        result_refs=("decisions.jsonl", "plan_steps.jsonl"),
        replay_binding={
            "mode": control_policy.replay_mode,
            "handoff_id": request.handoff_id,
        },
        correlation_id=request.handoff_id,
    )


def _validate_callable_refs(refs: tuple[CallableRef, ...]) -> None:
    for ref in refs:
        _validate_callable_ref(ref)


def _validate_callable_ref(ref: CallableRef) -> None:
    if ref.kind not in {"agent_class", "tool_class", "workflow_function"}:
        raise AccError(f"Unsupported handoff target callable kind: {ref.kind!r}")
    if not ref.id:
        raise AccError("Handoff target CallableRef.id is required")


def _control_policy_snapshot(policy: HandoffControlPolicy) -> dict[str, Any]:
    return {
        "policy_id": policy.policy_id,
        "mode": "handoff",
        "actor": policy.actor,
        "source_node_id": policy.source_node_id,
        "allowed_target_node_ids": list(policy.allowed_target_node_ids),
        "allowed_target_callable_refs": [
            _callable_ref_payload(ref) for ref in policy.allowed_target_callable_refs
        ],
        "allowed_modes": list(policy.allowed_modes),
        "requires_acceptance": policy.requires_acceptance,
        "requires_human_approval": policy.requires_human_approval,
        "timeout_seconds": policy.timeout_seconds,
        "fallback_target_node_id": policy.fallback_target_node_id,
        "max_handoff_depth": policy.max_handoff_depth,
        "max_repeat_per_target": policy.max_repeat_per_target,
        "replay_mode": policy.replay_mode,
    }
