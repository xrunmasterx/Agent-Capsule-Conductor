"""Pure Runtime Control Ledger parsing and validation.

Goal 01 intentionally keeps these helpers out of the runtime hot path. They
validate the control-ledger ABI so later goals can wire the runtime through it.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any, TypeVar, cast, get_args

from acc.domain import (
    CORE_CALLABLE_KINDS,
    EXECUTABLE_METADATA_KEYS,
    AccError,
    CallableRef,
    ControlEventRecord,
    ControlPolicy,
    ControlPolicyMode,
    DecisionKind,
    DecisionRecord,
    DispatchEnvelope,
    DispatchStatus,
    DispatchTransitionRecord,
    PlanStep,
    PlanStepSource,
    PlanStepStatus,
    PlanStepTransitionRecord,
    ReplayMode,
    ReplayPolicy,
    RunPlan,
    RunPlanSource,
    RunPlanStatus,
)

T = TypeVar("T", bound=str)

CONTROL_POLICY_FIELDS = frozenset(
    {
        "policy_id",
        "mode",
        "actor",
        "allowed_targets",
        "requires_human_approval",
        "allow_dynamic_dispatch",
        "allow_handoff",
        "max_dispatch_depth",
        "max_repeat_per_target",
        "max_concurrency",
        "replay_policy_ref",
        "metadata",
    }
)
RUN_PLAN_FIELDS = frozenset(
    {
        "run_plan_id",
        "run_id",
        "workflow_function_id",
        "invocation_id",
        "source",
        "schema_version",
        "template_snapshot_ref",
        "control_policy_id",
        "created_at",
        "status",
        "step_count",
        "metadata",
    }
)
PLAN_STEP_FIELDS = frozenset(
    {
        "plan_step_id",
        "run_plan_id",
        "run_id",
        "node_id",
        "callable_ref",
        "depends_on",
        "source",
        "status",
        "dependency_node_ids",
        "input_snapshot_refs",
        "required_interaction_id",
        "dispatch_id",
        "decision_id",
        "session_id",
        "artifact_bundle_id",
        "failure_id",
        "created_at",
        "updated_at",
        "metadata",
    }
)
DISPATCH_FIELDS = frozenset(
    {
        "dispatch_id",
        "run_id",
        "run_plan_id",
        "plan_step_id",
        "node_id",
        "callable_ref",
        "scope_frame_id",
        "invocation_id",
        "idempotency_key",
        "correlation_id",
        "input_ref",
        "policy_snapshot_ref",
        "created_by_decision_id",
        "attempt",
        "created_at",
        "status",
        "result_refs",
        "metadata",
    }
)
DECISION_FIELDS = frozenset(
    {
        "decision_id",
        "run_id",
        "run_plan_id",
        "actor",
        "kind",
        "timestamp",
        "policy_snapshot",
        "candidates",
        "selected",
        "rejected",
        "rationale",
        "input_evidence_refs",
        "result_refs",
        "replay_binding",
        "correlation_id",
        "metadata",
    }
)
REPLAY_POLICY_FIELDS = frozenset(
    {
        "replay_policy_id",
        "mode",
        "template_snapshot_required",
        "reuse_human_answers",
        "reuse_supervisor_decisions",
        "reuse_handoff_decisions",
        "graphops_apply_allowed",
        "metadata",
    }
)
PLAN_STEP_TRANSITION_FIELDS = frozenset(
    {
        "sequence",
        "recorded_at",
        "plan_step_id",
        "previous_status",
        "next_status",
        "snapshot",
        "reason",
        "decision_id",
        "dispatch_id",
    }
)
DISPATCH_TRANSITION_FIELDS = frozenset(
    {
        "sequence",
        "recorded_at",
        "dispatch_id",
        "previous_status",
        "next_status",
        "snapshot",
        "reason",
        "decision_id",
        "plan_step_id",
    }
)
CONTROL_EVENT_FIELDS = frozenset(
    {
        "event_id",
        "type",
        "timestamp",
        "run_id",
        "scope_frame_id",
        "node_id",
        "session_id",
        "plan_step_id",
        "dispatch_id",
        "decision_id",
        "payload",
    }
)

CONTROL_LEDGER_EXECUTABLE_METADATA_KEYS = EXECUTABLE_METADATA_KEYS | frozenset(
    {
        "actor",
        "allowed_targets",
        "allow_dynamic_dispatch",
        "allow_handoff",
        "artifact_bundle_id",
        "callable_ref",
        "candidates",
        "created_by_decision_id",
        "decision_id",
        "depends_on",
        "dispatch_id",
        "failure_id",
        "input_evidence_refs",
        "input_ref",
        "input_snapshot_refs",
        "next_status",
        "node_id",
        "plan_step_id",
        "policy_snapshot",
        "previous_status",
        "rejected",
        "replay_binding",
        "required_interaction_id",
        "result_refs",
        "selected",
        "session_id",
        "status",
    }
)

PLAN_STEP_TRANSITIONS: dict[PlanStepStatus | None, frozenset[PlanStepStatus]] = {
    None: frozenset({"pending", "ready", "waiting_interaction"}),
    "pending": frozenset({"ready", "waiting_interaction", "failed", "skipped", "cancelled"}),
    "ready": frozenset(
        {"waiting_interaction", "dispatching", "failed", "skipped", "cancelled"}
    ),
    "waiting_interaction": frozenset({"ready", "skipped", "cancelled"}),
    "dispatching": frozenset({"running", "failed", "cancelled"}),
    "running": frozenset({"success", "failed", "cancelled"}),
    "success": frozenset(),
    "failed": frozenset(),
    "skipped": frozenset(),
    "cancelled": frozenset(),
}
DISPATCH_TRANSITIONS: dict[DispatchStatus | None, frozenset[DispatchStatus]] = {
    None: frozenset({"pending", "started"}),
    "pending": frozenset({"started", "failed", "cancelled"}),
    "started": frozenset({"completed", "failed", "cancelled"}),
    "completed": frozenset(),
    "failed": frozenset(),
    "cancelled": frozenset(),
}

def parse_control_policy(payload: dict[str, Any]) -> ControlPolicy:
    _reject_unknown_fields(payload, CONTROL_POLICY_FIELDS, "ControlPolicy")
    policy = ControlPolicy(
        policy_id=_required_string(payload, "policy_id", "ControlPolicy"),
        mode=_literal(payload.get("mode"), ControlPolicyMode, "ControlPolicy.mode"),
        actor=_required_string(payload, "actor", "ControlPolicy"),
        allowed_targets=_parse_allowed_targets(payload.get("allowed_targets")),
        requires_human_approval=_optional_bool(payload, "requires_human_approval", False),
        allow_dynamic_dispatch=_optional_bool(payload, "allow_dynamic_dispatch", False),
        allow_handoff=_optional_bool(payload, "allow_handoff", False),
        max_dispatch_depth=_optional_nonnegative_int(payload, "max_dispatch_depth"),
        max_repeat_per_target=_optional_nonnegative_int(payload, "max_repeat_per_target"),
        max_concurrency=_optional_nonnegative_int(payload, "max_concurrency"),
        replay_policy_ref=_optional_string(payload, "replay_policy_ref"),
        metadata=_optional_mapping(payload.get("metadata"), "ControlPolicy.metadata"),
    )
    validate_control_policy(policy)
    return policy


def parse_run_plan(payload: dict[str, Any]) -> RunPlan:
    _reject_unknown_fields(payload, RUN_PLAN_FIELDS, "RunPlan")
    plan = RunPlan(
        run_plan_id=_required_string(payload, "run_plan_id", "RunPlan"),
        run_id=_required_string(payload, "run_id", "RunPlan"),
        workflow_function_id=_required_string(payload, "workflow_function_id", "RunPlan"),
        invocation_id=_required_string(payload, "invocation_id", "RunPlan"),
        source=_literal(payload.get("source"), RunPlanSource, "RunPlan.source"),
        schema_version=_required_string(payload, "schema_version", "RunPlan"),
        template_snapshot_ref=_required_string(payload, "template_snapshot_ref", "RunPlan"),
        control_policy_id=_required_string(payload, "control_policy_id", "RunPlan"),
        created_at=_required_string(payload, "created_at", "RunPlan"),
        status=_literal(payload.get("status"), RunPlanStatus, "RunPlan.status"),
        step_count=_required_nonnegative_int(payload, "step_count", "RunPlan"),
        metadata=_optional_mapping(payload.get("metadata"), "RunPlan.metadata"),
    )
    validate_run_plan(plan)
    return plan


def parse_plan_step(payload: dict[str, Any]) -> PlanStep:
    _reject_unknown_fields(payload, PLAN_STEP_FIELDS, "PlanStep")
    step = PlanStep(
        plan_step_id=_required_string(payload, "plan_step_id", "PlanStep"),
        run_plan_id=_required_string(payload, "run_plan_id", "PlanStep"),
        run_id=_required_string(payload, "run_id", "PlanStep"),
        node_id=_required_string(payload, "node_id", "PlanStep"),
        callable_ref=_parse_callable_ref(
            _required_mapping(payload.get("callable_ref"), "PlanStep.callable_ref")
        ),
        depends_on=_string_tuple(payload.get("depends_on"), "PlanStep.depends_on"),
        source=_literal(payload.get("source"), PlanStepSource, "PlanStep.source"),
        status=_literal(payload.get("status"), PlanStepStatus, "PlanStep.status"),
        dependency_node_ids=_string_tuple(
            payload.get("dependency_node_ids"),
            "PlanStep.dependency_node_ids",
        ),
        input_snapshot_refs=_string_tuple(
            payload.get("input_snapshot_refs"),
            "PlanStep.input_snapshot_refs",
        ),
        required_interaction_id=_optional_string(payload, "required_interaction_id"),
        dispatch_id=_optional_string(payload, "dispatch_id"),
        decision_id=_optional_string(payload, "decision_id"),
        session_id=_optional_string(payload, "session_id"),
        artifact_bundle_id=_optional_string(payload, "artifact_bundle_id"),
        failure_id=_optional_string(payload, "failure_id"),
        created_at=_optional_string(payload, "created_at"),
        updated_at=_optional_string(payload, "updated_at"),
        metadata=_optional_mapping(payload.get("metadata"), "PlanStep.metadata"),
    )
    validate_plan_step(step)
    return step


def parse_dispatch_envelope(payload: dict[str, Any]) -> DispatchEnvelope:
    _reject_unknown_fields(payload, DISPATCH_FIELDS, "DispatchEnvelope")
    dispatch = DispatchEnvelope(
        dispatch_id=_required_string(payload, "dispatch_id", "DispatchEnvelope"),
        run_id=_required_string(payload, "run_id", "DispatchEnvelope"),
        run_plan_id=_required_string(payload, "run_plan_id", "DispatchEnvelope"),
        plan_step_id=_required_string(payload, "plan_step_id", "DispatchEnvelope"),
        node_id=_required_string(payload, "node_id", "DispatchEnvelope"),
        callable_ref=_parse_callable_ref(
            _required_mapping(payload.get("callable_ref"), "DispatchEnvelope.callable_ref")
        ),
        scope_frame_id=_required_string(payload, "scope_frame_id", "DispatchEnvelope"),
        invocation_id=_required_string(payload, "invocation_id", "DispatchEnvelope"),
        idempotency_key=_required_string(payload, "idempotency_key", "DispatchEnvelope"),
        correlation_id=_required_string(payload, "correlation_id", "DispatchEnvelope"),
        input_ref=_required_string(payload, "input_ref", "DispatchEnvelope"),
        policy_snapshot_ref=_required_string(payload, "policy_snapshot_ref", "DispatchEnvelope"),
        created_by_decision_id=_required_string(
            payload,
            "created_by_decision_id",
            "DispatchEnvelope",
        ),
        attempt=_required_nonnegative_int(payload, "attempt", "DispatchEnvelope"),
        created_at=_required_string(payload, "created_at", "DispatchEnvelope"),
        status=_literal(payload.get("status"), DispatchStatus, "DispatchEnvelope.status"),
        result_refs=_string_tuple(payload.get("result_refs"), "DispatchEnvelope.result_refs"),
        metadata=_optional_mapping(payload.get("metadata"), "DispatchEnvelope.metadata"),
    )
    validate_dispatch_envelope(dispatch)
    return dispatch


def parse_decision_record(payload: dict[str, Any]) -> DecisionRecord:
    _reject_unknown_fields(payload, DECISION_FIELDS, "DecisionRecord")
    decision = DecisionRecord(
        decision_id=_required_string(payload, "decision_id", "DecisionRecord"),
        run_id=_required_string(payload, "run_id", "DecisionRecord"),
        actor=_required_string(payload, "actor", "DecisionRecord"),
        kind=_literal(payload.get("kind"), DecisionKind, "DecisionRecord.kind"),
        timestamp=_required_string(payload, "timestamp", "DecisionRecord"),
        input_evidence_refs=_required_string_tuple(
            payload.get("input_evidence_refs"),
            "DecisionRecord.input_evidence_refs",
        ),
        run_plan_id=_optional_string(payload, "run_plan_id"),
        policy_snapshot=_optional_mapping(
            payload.get("policy_snapshot"),
            "DecisionRecord.policy_snapshot",
        ),
        candidates=_mapping_tuple(payload.get("candidates"), "DecisionRecord.candidates"),
        selected=_optional_mapping(payload.get("selected"), "DecisionRecord.selected"),
        rejected=_mapping_tuple(payload.get("rejected"), "DecisionRecord.rejected"),
        rationale=_optional_string(payload, "rationale"),
        result_refs=_string_tuple(payload.get("result_refs"), "DecisionRecord.result_refs"),
        replay_binding=_optional_mapping(
            payload.get("replay_binding"),
            "DecisionRecord.replay_binding",
        ),
        correlation_id=_optional_string(payload, "correlation_id"),
        metadata=_optional_mapping(payload.get("metadata"), "DecisionRecord.metadata"),
    )
    validate_decision_record(decision)
    return decision


def parse_replay_policy(payload: dict[str, Any]) -> ReplayPolicy:
    _reject_unknown_fields(payload, REPLAY_POLICY_FIELDS, "ReplayPolicy")
    policy = ReplayPolicy(
        replay_policy_id=_required_string(payload, "replay_policy_id", "ReplayPolicy"),
        mode=_literal(payload.get("mode"), ReplayMode, "ReplayPolicy.mode"),
        template_snapshot_required=_required_bool(
            payload,
            "template_snapshot_required",
            "ReplayPolicy",
        ),
        reuse_human_answers=_optional_bool(payload, "reuse_human_answers", True),
        reuse_supervisor_decisions=_optional_bool(
            payload,
            "reuse_supervisor_decisions",
            True,
        ),
        reuse_handoff_decisions=_optional_bool(payload, "reuse_handoff_decisions", True),
        graphops_apply_allowed=_optional_bool(payload, "graphops_apply_allowed", False),
        metadata=_optional_mapping(payload.get("metadata"), "ReplayPolicy.metadata"),
    )
    validate_replay_policy(policy)
    return policy


def parse_plan_step_transition(payload: dict[str, Any]) -> PlanStepTransitionRecord:
    _reject_unknown_fields(payload, PLAN_STEP_TRANSITION_FIELDS, "PlanStepTransitionRecord")
    transition = PlanStepTransitionRecord(
        sequence=_required_nonnegative_int(payload, "sequence", "PlanStepTransitionRecord"),
        recorded_at=_required_string(payload, "recorded_at", "PlanStepTransitionRecord"),
        plan_step_id=_required_string(payload, "plan_step_id", "PlanStepTransitionRecord"),
        previous_status=_optional_literal(
            payload,
            "previous_status",
            PlanStepStatus,
            "PlanStepTransitionRecord.previous_status",
            require_key=True,
        ),
        next_status=_literal(
            payload.get("next_status"),
            PlanStepStatus,
            "PlanStepTransitionRecord.next_status",
        ),
        snapshot=parse_plan_step(
            _required_mapping(payload.get("snapshot"), "PlanStepTransitionRecord.snapshot")
        ),
        reason=_required_string(payload, "reason", "PlanStepTransitionRecord"),
        decision_id=_optional_string(payload, "decision_id"),
        dispatch_id=_optional_string(payload, "dispatch_id"),
    )
    validate_plan_step_transition(transition)
    return transition


def parse_dispatch_transition(payload: dict[str, Any]) -> DispatchTransitionRecord:
    _reject_unknown_fields(payload, DISPATCH_TRANSITION_FIELDS, "DispatchTransitionRecord")
    transition = DispatchTransitionRecord(
        sequence=_required_nonnegative_int(payload, "sequence", "DispatchTransitionRecord"),
        recorded_at=_required_string(payload, "recorded_at", "DispatchTransitionRecord"),
        dispatch_id=_required_string(payload, "dispatch_id", "DispatchTransitionRecord"),
        previous_status=_optional_literal(
            payload,
            "previous_status",
            DispatchStatus,
            "DispatchTransitionRecord.previous_status",
            require_key=True,
        ),
        next_status=_literal(
            payload.get("next_status"),
            DispatchStatus,
            "DispatchTransitionRecord.next_status",
        ),
        snapshot=parse_dispatch_envelope(
            _required_mapping(payload.get("snapshot"), "DispatchTransitionRecord.snapshot")
        ),
        reason=_required_string(payload, "reason", "DispatchTransitionRecord"),
        decision_id=_optional_string(payload, "decision_id"),
        plan_step_id=_optional_string(payload, "plan_step_id"),
    )
    validate_dispatch_transition(transition)
    return transition


def parse_control_event_record(payload: dict[str, Any]) -> ControlEventRecord:
    _reject_unknown_fields(payload, CONTROL_EVENT_FIELDS, "ControlEventRecord")
    event = ControlEventRecord(
        event_id=_required_string(payload, "event_id", "ControlEventRecord"),
        type=_required_string(payload, "type", "ControlEventRecord"),
        timestamp=_required_string(payload, "timestamp", "ControlEventRecord"),
        run_id=_required_string(payload, "run_id", "ControlEventRecord"),
        scope_frame_id=_optional_string(payload, "scope_frame_id"),
        node_id=_optional_string(payload, "node_id"),
        session_id=_optional_string(payload, "session_id"),
        plan_step_id=_optional_string(payload, "plan_step_id"),
        dispatch_id=_optional_string(payload, "dispatch_id"),
        decision_id=_optional_string(payload, "decision_id"),
        payload=_optional_mapping(payload.get("payload"), "ControlEventRecord.payload"),
    )
    validate_control_event_record(event)
    return event


def validate_control_policy(policy: ControlPolicy) -> None:
    _require_nonempty(policy.policy_id, "ControlPolicy.policy_id")
    _validate_actor(policy.actor, "ControlPolicy.actor")
    _validate_metadata(policy.metadata, "ControlPolicy.metadata")
    for target in policy.allowed_targets:
        if isinstance(target, CallableRef):
            _validate_callable_ref(target)
        elif not target:
            raise AccError("ControlPolicy.allowed_targets cannot contain empty target")


def validate_run_plan(plan: RunPlan) -> None:
    for key in (
        "run_plan_id",
        "run_id",
        "workflow_function_id",
        "invocation_id",
        "schema_version",
        "template_snapshot_ref",
        "control_policy_id",
        "created_at",
    ):
        _require_nonempty(str(getattr(plan, key)), f"RunPlan.{key}")
    if plan.step_count < 0:
        raise AccError("RunPlan.step_count must be >= 0")
    _validate_metadata(plan.metadata, "RunPlan.metadata")


def validate_plan_step(step: PlanStep) -> None:
    for key in ("plan_step_id", "run_plan_id", "run_id", "node_id"):
        _require_nonempty(str(getattr(step, key)), f"PlanStep.{key}")
    _validate_callable_ref(step.callable_ref)
    _validate_metadata(step.metadata, "PlanStep.metadata")


def validate_plan_steps(steps: Iterable[PlanStep]) -> None:
    items = tuple(steps)
    ids = [step.plan_step_id for step in items]
    duplicates = sorted({step_id for step_id in ids if ids.count(step_id) > 1})
    if duplicates:
        raise AccError(f"Duplicate PlanStep id: {duplicates[0]}")
    known = set(ids)
    for step in items:
        missing = [dependency for dependency in step.depends_on if dependency not in known]
        if missing:
            raise AccError(
                f"PlanStep {step.plan_step_id!r} depends on missing step {missing[0]!r}"
            )


def validate_dispatch_envelope(dispatch: DispatchEnvelope) -> None:
    for key in (
        "dispatch_id",
        "run_id",
        "run_plan_id",
        "plan_step_id",
        "node_id",
        "scope_frame_id",
        "invocation_id",
        "idempotency_key",
        "correlation_id",
        "input_ref",
        "policy_snapshot_ref",
        "created_by_decision_id",
        "created_at",
    ):
        _require_nonempty(str(getattr(dispatch, key)), f"DispatchEnvelope.{key}")
    if dispatch.attempt < 0:
        raise AccError("DispatchEnvelope.attempt must be >= 0")
    _validate_callable_ref(dispatch.callable_ref)
    _validate_metadata(dispatch.metadata, "DispatchEnvelope.metadata")


def validate_decision_record(decision: DecisionRecord) -> None:
    for key in ("decision_id", "run_id", "actor", "timestamp"):
        _require_nonempty(str(getattr(decision, key)), f"DecisionRecord.{key}")
    _validate_actor(decision.actor, "DecisionRecord.actor")
    if not decision.input_evidence_refs:
        raise AccError("DecisionRecord.input_evidence_refs must be non-empty")
    _validate_metadata(decision.metadata, "DecisionRecord.metadata")


def validate_replay_policy(policy: ReplayPolicy) -> None:
    _require_nonempty(policy.replay_policy_id, "ReplayPolicy.replay_policy_id")
    if policy.graphops_apply_allowed:
        raise AccError("ReplayPolicy.graphops_apply_allowed must be false")
    _validate_metadata(policy.metadata, "ReplayPolicy.metadata")


def validate_plan_step_transition(transition: PlanStepTransitionRecord) -> None:
    if transition.snapshot.plan_step_id != transition.plan_step_id:
        raise AccError("PlanStepTransitionRecord snapshot.plan_step_id mismatch")
    if transition.snapshot.status != transition.next_status:
        raise AccError("PlanStepTransitionRecord snapshot.status must equal next_status")
    allowed = PLAN_STEP_TRANSITIONS.get(transition.previous_status, frozenset())
    if transition.next_status not in allowed:
        raise AccError(
            "Invalid PlanStep status transition: "
            f"{transition.previous_status!r} -> {transition.next_status!r}"
        )


def validate_dispatch_transition(transition: DispatchTransitionRecord) -> None:
    if transition.snapshot.dispatch_id != transition.dispatch_id:
        raise AccError("DispatchTransitionRecord snapshot.dispatch_id mismatch")
    if transition.snapshot.status != transition.next_status:
        raise AccError("DispatchTransitionRecord snapshot.status must equal next_status")
    allowed = DISPATCH_TRANSITIONS.get(transition.previous_status, frozenset())
    if transition.next_status not in allowed:
        raise AccError(
            "Invalid DispatchEnvelope status transition: "
            f"{transition.previous_status!r} -> {transition.next_status!r}"
        )


def validate_control_event_record(event: ControlEventRecord) -> None:
    for key in ("event_id", "type", "timestamp", "run_id"):
        _require_nonempty(str(getattr(event, key)), f"ControlEventRecord.{key}")


def _reject_unknown_fields(
    payload: dict[str, Any],
    allowed_fields: frozenset[str],
    context: str,
) -> None:
    unknown = sorted(set(payload) - allowed_fields)
    if unknown:
        raise AccError(f"{context} contains unknown field: {unknown[0]}")


def _literal(value: Any, literal_type: object, context: str) -> T:
    allowed = set(get_args(literal_type))
    if value not in allowed:
        raise AccError(f"Invalid {context}: {value!r}")
    return cast(T, value)


def _optional_literal(
    payload: dict[str, Any],
    key: str,
    literal_type: object,
    context: str,
    *,
    require_key: bool = False,
) -> T | None:
    if key not in payload:
        if require_key:
            raise AccError(f"{context} is required")
        return None
    value = payload.get(key)
    if value is None:
        return None
    return _literal(value, literal_type, context)


def _parse_callable_ref(payload: dict[str, Any]) -> CallableRef:
    _reject_unknown_fields(payload, frozenset({"kind", "id", "version"}), "CallableRef")
    kind = payload.get("kind")
    if kind not in CORE_CALLABLE_KINDS:
        raise AccError(f"Unsupported callable_ref.kind: {kind!r}")
    version = payload.get("version")
    ref = CallableRef(
        kind=cast(Any, kind),
        id=_required_string(payload, "id", "CallableRef"),
        version=version if isinstance(version, str) else None,
    )
    _validate_callable_ref(ref)
    return ref


def _validate_callable_ref(ref: CallableRef) -> None:
    if ref.kind not in CORE_CALLABLE_KINDS:
        raise AccError(f"Unsupported callable_ref.kind: {ref.kind!r}")
    _require_nonempty(ref.id, "CallableRef.id")


def _parse_allowed_targets(value: Any) -> tuple[str | CallableRef, ...]:
    if value is None:
        return ()
    if not isinstance(value, Sequence) or isinstance(value, str):
        raise AccError("ControlPolicy.allowed_targets must be an array")
    targets: list[str | CallableRef] = []
    for index, item in enumerate(value):
        if isinstance(item, str) and item:
            targets.append(item)
            continue
        if isinstance(item, dict):
            targets.append(_parse_callable_ref(item))
            continue
        raise AccError(
            f"ControlPolicy.allowed_targets[{index}] must be target string or CallableRef"
        )
    return tuple(targets)


def _required_string(payload: dict[str, Any], key: str, context: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise AccError(f"{context} requires string field {key}")
    return value


def _optional_string(payload: dict[str, Any], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        raise AccError(f"Field {key} must be a non-empty string when present")
    return value


def _required_mapping(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AccError(f"{context} must be an object")
    return value


def _optional_mapping(value: Any, context: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise AccError(f"{context} must be an object")
    return value


def _mapping_tuple(value: Any, context: str) -> tuple[dict[str, Any], ...]:
    if value is None:
        return ()
    if not isinstance(value, Sequence) or isinstance(value, str):
        raise AccError(f"{context} must be an array")
    items: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise AccError(f"{context}[{index}] must be an object")
        items.append(item)
    return tuple(items)


def _string_tuple(value: Any, context: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, Sequence) or isinstance(value, str):
        raise AccError(f"{context} must be an array")
    items: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item:
            raise AccError(f"{context}[{index}] must be a non-empty string")
        items.append(item)
    return tuple(items)


def _required_string_tuple(value: Any, context: str) -> tuple[str, ...]:
    items = _string_tuple(value, context)
    if not items:
        raise AccError(f"{context} must be a non-empty array")
    return items


def _required_nonnegative_int(payload: dict[str, Any], key: str, context: str) -> int:
    value = payload.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise AccError(f"{context} requires non-negative integer field {key}")
    return value


def _optional_nonnegative_int(payload: dict[str, Any], key: str) -> int | None:
    value = payload.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise AccError(f"{key} must be a non-negative integer when present")
    return value


def _required_bool(payload: dict[str, Any], key: str, context: str) -> bool:
    value = payload.get(key)
    if not isinstance(value, bool):
        raise AccError(f"{context} requires bool field {key}")
    return value


def _optional_bool(payload: dict[str, Any], key: str, default: bool) -> bool:
    if key not in payload:
        return default
    value = payload.get(key)
    if not isinstance(value, bool):
        raise AccError(f"{key} must be a bool when present")
    return value


def _validate_actor(actor: str, context: str) -> None:
    if actor in {"system", "human"}:
        return
    for prefix in ("supervisor:", "node:"):
        if actor.startswith(prefix) and actor.removeprefix(prefix):
            return
    raise AccError(f"{context} must be system, human, supervisor:<node_id>, or node:<node_id>")


def _validate_metadata(metadata: dict[str, Any], context: str) -> None:
    forbidden = sorted(set(metadata) & CONTROL_LEDGER_EXECUTABLE_METADATA_KEYS)
    if forbidden:
        raise AccError(f"{context} contains executable semantic key: {forbidden[0]}")


def _require_nonempty(value: str, context: str) -> None:
    if not value:
        raise AccError(f"{context} is required")
