from __future__ import annotations

from dataclasses import replace
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

from acc.engine.handoff import compile_handoff_to_plan_step
from acc.models import (
    AccError,
    HandoffControlPolicy,
    HandoffRequest,
    PlanStep,
    RunPlan,
    WorkflowFunctionTemplate,
)
from acc.serialization import control_ledger_to_dict
from acc.session import utc_now_iso
from acc.state_machine import transition_plan_step, transition_plan_step_initial
from acc.store import load_json, safe_child_path, write_json
from acc.store.control_ledger import (
    append_control_event,
    append_decision_record,
    append_plan_step_transition,
    load_plan_steps,
    next_plan_step_transition_sequence,
)


def materialize_handoff_plan_step(
    run_dir: Path,
    *,
    request: HandoffRequest,
    control_policy: HandoffControlPolicy,
    run_plan: RunPlan,
    template: WorkflowFunctionTemplate,
) -> dict[str, Any]:
    timestamp = utc_now_iso()
    prepared_request, generated_payload_ref = _prepare_request(
        request,
        timestamp=timestamp,
    )
    _validate_existing_refs(
        run_dir,
        prepared_request,
        generated_payload_ref=generated_payload_ref,
    )
    existing_steps = load_plan_steps(run_dir).value
    compilation = compile_handoff_to_plan_step(
        prepared_request,
        control_policy=control_policy,
        run_plan=run_plan,
        template=template,
        existing_steps=existing_steps,
        timestamp=timestamp,
    )

    if generated_payload_ref is not None:
        _write_handoff_payload_snapshot(
            run_dir,
            prepared_request,
            payload_ref=generated_payload_ref,
            timestamp=timestamp,
        )
    else:
        _validate_payload_snapshot(run_dir, prepared_request.payload_ref)

    append_decision_record(run_dir, compilation.decision)
    append_control_event(
        run_dir,
        event_type="decision_recorded",
        run_id=run_plan.run_id,
        node_id=prepared_request.source_node_id,
        decision_id=compilation.decision.decision_id,
        payload={
            "kind": "handoff",
            "handoff_id": prepared_request.handoff_id,
            "mode": prepared_request.mode,
            "target_node_id": prepared_request.target_node_id,
        },
    )
    sequence = next_plan_step_transition_sequence(run_dir)
    emitted_step = None
    if compilation.new_step is not None:
        emitted_step = compilation.new_step
        record = transition_plan_step_initial(
            emitted_step,
            sequence=sequence,
            reason=f"handoff new_session {prepared_request.handoff_id}",
            recorded_at=timestamp,
        )
        append_plan_step_transition(run_dir, record)
    elif compilation.route_step is not None:
        emitted_step = _materialize_route_only_selection(
            run_dir,
            compilation.route_step,
            sequence=sequence,
            timestamp=timestamp,
            decision_id=compilation.decision.decision_id,
        )
    append_control_event(
        run_dir,
        event_type="handoff_selected",
        run_id=run_plan.run_id,
        node_id=prepared_request.source_node_id,
        plan_step_id=emitted_step.plan_step_id if emitted_step is not None else None,
        decision_id=compilation.decision.decision_id,
        payload={
            "handoff_id": prepared_request.handoff_id,
            "target_node_id": prepared_request.target_node_id,
            "mode": prepared_request.mode,
            "created_new_step": compilation.new_step is not None,
        },
    )
    return {
        "decision": control_ledger_to_dict(compilation.decision),
        "step": control_ledger_to_dict(emitted_step) if emitted_step is not None else None,
        "created_new_step": compilation.new_step is not None,
        "payload_ref": prepared_request.payload_ref,
    }


def _prepare_request(
    request: HandoffRequest,
    *,
    timestamp: str,
) -> tuple[HandoffRequest, str | None]:
    if request.payload_ref:
        return (
            replace(request, created_at=request.created_at or timestamp),
            None,
        )
    payload_ref = f"handoffs/{request.handoff_id}/payload.json"
    return (
        replace(
            request,
            payload_ref=payload_ref,
            created_at=request.created_at or timestamp,
        ),
        payload_ref,
    )


def _write_handoff_payload_snapshot(
    run_dir: Path,
    request: HandoffRequest,
    *,
    payload_ref: str,
    timestamp: str,
) -> None:
    payload_path = _run_relative_path(run_dir, payload_ref, must_exist=False)
    write_json(
        payload_path,
        {
            "handoff_id": request.handoff_id,
            "source_plan_step_id": request.source_plan_step_id,
            "source_node_id": request.source_node_id,
            "target_node_id": request.target_node_id,
            "target_callable_ref": control_ledger_to_dict(request.target_callable_ref),
            "mode": request.mode,
            "input_payload": request.input_payload,
            "artifact_refs": list(request.artifact_refs),
            "acceptance_refs": list(request.acceptance_refs),
            "created_at": timestamp,
        },
    )


def _materialize_route_only_selection(
    run_dir: Path,
    step: PlanStep,
    *,
    sequence: int,
    timestamp: str,
    decision_id: str,
) -> PlanStep:
    if step.status == "ready":
        return step
    record, updated = transition_plan_step(
        step,
        "ready",
        sequence=sequence,
        reason="handoff route_only selected existing target",
        decision_id=decision_id,
        context={"recorded_at": timestamp},
    )
    append_plan_step_transition(run_dir, record)
    return updated


def _validate_existing_refs(
    run_dir: Path,
    request: HandoffRequest,
    *,
    generated_payload_ref: str | None,
) -> None:
    if request.payload_ref and request.payload_ref != generated_payload_ref:
        _run_relative_path(run_dir, request.payload_ref, must_exist=True)
    if request.scope_ref:
        _run_relative_path(run_dir, request.scope_ref, must_exist=True)
    for ref in (*request.artifact_refs, *request.acceptance_refs):
        _run_relative_path(run_dir, ref, must_exist=True)


def _validate_payload_snapshot(run_dir: Path, payload_ref: str | None) -> None:
    if not payload_ref:
        return
    payload = load_json(_run_relative_path(run_dir, payload_ref, must_exist=True))
    if not isinstance(payload, dict):
        raise AccError("Handoff payload_ref must point to a JSON object")


def _run_relative_path(run_dir: Path, ref: str, *, must_exist: bool) -> Path:
    if not ref:
        raise AccError("Handoff ref must be non-empty")
    if (
        Path(ref).is_absolute()
        or PurePosixPath(ref).is_absolute()
        or PureWindowsPath(ref).is_absolute()
        or ".." in Path(ref).parts
        or ".." in PurePosixPath(ref).parts
        or ".." in PureWindowsPath(ref).parts
    ):
        raise AccError(f"Handoff ref escapes run dir: {ref}")
    path = run_dir / ref
    safe_child_path(path, run_dir)
    if must_exist and not path.exists():
        raise AccError(f"Handoff ref does not exist: {ref}")
    return path
