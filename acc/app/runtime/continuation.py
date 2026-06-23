from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import Any

from acc.app.run_lifecycle import is_terminal_run_status
from acc.app.runtime.scheduler import execute_core_v2_node_with_fixed_ledger
from acc.app.runtime.workflow_io import write_core_v2_run_summary, write_workflow_outputs
from acc.callable_registry import CallableRegistry
from acc.ledger_writer import FixedRunControlLedgerWriter
from acc.models import (
    AccError,
    CallableOverride,
    FunctionInvocation,
    NodeInvocationSpec,
    PlanStep,
    RunRecord,
    ScopeFrame,
    WorkflowFunctionTemplate,
)
from acc.result_store.filesystem import FilesystemResultStore
from acc.runtime.io import append_event, function_invocation_payload, run_record_payload
from acc.runtime.node_payload import (
    MISSING_PORT_VALUE,
    materialized_output_port_ids,
    output_value_for_port,
)
from acc.serialization import workflow_function_template_from_dict
from acc.session import utc_now_iso
from acc.store import load_json, write_json
from acc.store.control_ledger import (
    load_decisions,
    load_plan_steps,
    load_run_plan,
    next_dispatch_transition_sequence,
    next_plan_step_transition_sequence,
)


async def continue_persisted_run(
    run_dir: Path,
    *,
    reason: str | None = None,
    interaction_id: str | None = None,
    target_node_id: str | None = None,
    callable_registry: CallableRegistry | None = None,
) -> dict[str, Any]:
    """Continue a persisted run by dispatching currently eligible PlanSteps.

    This is the common continuation path for approved human gates and dynamic
    supervisor/handoff steps. Control modes should materialize ledger evidence
    first; this function owns resumed dispatch through the normal scheduler node
    execution boundary.
    """

    template = _load_template_snapshot(run_dir)
    invocation = _load_function_invocation(run_dir)
    scope = _load_scope_frame(run_dir)
    run_plan = load_run_plan(run_dir).value
    if run_plan is None:
        raise AccError("Cannot continue run without run_plan.json")
    steps = load_plan_steps(run_dir).value
    control_ledger = _reconstruct_control_ledger(run_dir, invocation, run_plan, steps)
    runtime_template = template
    dynamic_nodes: dict[str, NodeInvocationSpec] = {}
    event_log_path = run_dir / "events.jsonl"
    result_store = FilesystemResultStore(run_dir.parent)
    outputs = _load_success_outputs(runtime_template, steps, run_dir)
    dispatched_step_ids: list[str] = []
    terminal_status = "resuming"

    try:
        while True:
            _promote_ready_steps(control_ledger)
            ready_steps = _ready_steps(control_ledger.all_steps(), interaction_id, target_node_id)
            if not ready_steps:
                break
            for step in ready_steps:
                node = dynamic_nodes.get(step.node_id)
                if node is None:
                    node = _node_for_step(run_dir, runtime_template, step)
                    if step.node_id not in runtime_template.node_invocations:
                        dynamic_nodes[step.node_id] = node
                        runtime_template = replace(
                            runtime_template,
                            node_invocations={**runtime_template.node_invocations, **dynamic_nodes},
                        )
                result = await execute_core_v2_node_with_fixed_ledger(
                    runtime_template,
                    node,
                    invocation,
                    scope,
                    result_store,
                    event_log_path,
                    callable_registry,
                    control_ledger,
                    upstream_outputs=outputs,
                )
                for port_id, value in result.outputs.items():
                    outputs[(node.id, port_id)] = value
                dispatched_step_ids.append(step.plan_step_id)
                interaction_id = None
                target_node_id = None
        latest_steps = control_ledger.all_steps()
        if all(step.status == "success" for step in latest_steps):
            terminal_status = "success"
            write_workflow_outputs(
                runtime_template,
                invocation.run_id,
                run_dir,
                result_store,
                outputs,
            )
            append_event(event_log_path, invocation.run_id, "workflow_completed")
        elif any(step.status == "failed" for step in latest_steps):
            terminal_status = "failed"
    except Exception as exc:
        terminal_status = "failed"
        append_event(
            event_log_path,
            invocation.run_id,
            "workflow_failed",
            payload={"error": str(exc), "reason": reason or "continuation"},
        )

    if terminal_status in {"success", "failed", "cancelled"}:
        run_plan_status = "completed" if terminal_status == "success" else terminal_status
        async with control_ledger.audit_lock:
            control_ledger.finalize_run_plan(run_plan_status)  # type: ignore[arg-type]
    _write_final_run_state(
        run_dir,
        runtime_template,
        invocation,
        terminal_status,
        started_at=invocation.started_at,
    )
    return {
        "status": terminal_status,
        "dispatched_step_ids": dispatched_step_ids,
    }


def _reconstruct_control_ledger(
    run_dir: Path,
    invocation: FunctionInvocation,
    run_plan,
    steps: tuple[PlanStep, ...],
) -> FixedRunControlLedgerWriter:
    return FixedRunControlLedgerWriter(
        run_dir=run_dir,
        run_id=invocation.run_id,
        run_plan=run_plan,
        steps_by_node_id={step.node_id: step for step in steps},
        plan_step_sequence=next_plan_step_transition_sequence(run_dir) - 1,
        dispatch_sequence=next_dispatch_transition_sequence(run_dir) - 1,
        decision_sequence=len(load_decisions(run_dir).value),
    )


def _promote_ready_steps(control_ledger: FixedRunControlLedgerWriter) -> None:
    steps = control_ledger.all_steps()
    by_step_id = {step.plan_step_id: step for step in steps}
    for step in steps:
        if step.status != "pending":
            continue
        if not _dependencies_succeeded(step, by_step_id):
            continue
        control_ledger.transition_step(
            step.node_id,
            "ready",
            reason=f"{step.source} dependencies satisfied",
        )


def _ready_steps(
    steps: tuple[PlanStep, ...],
    interaction_id: str | None,
    target_node_id: str | None,
) -> tuple[PlanStep, ...]:
    ready = [step for step in steps if step.status == "ready"]
    if interaction_id is not None:
        scoped = [step for step in ready if step.required_interaction_id == interaction_id]
        if scoped:
            return tuple(scoped)
    if target_node_id is not None:
        scoped = [step for step in ready if step.node_id == target_node_id]
        if scoped:
            return tuple(scoped)
    return tuple(ready)


def _dependencies_succeeded(step: PlanStep, by_step_id: dict[str, PlanStep]) -> bool:
    for dependency in step.depends_on:
        dependency_step = by_step_id.get(dependency)
        if dependency_step is None:
            raise AccError(f"Dynamic PlanStep dependency not found: {dependency}")
        if dependency_step.status != "success":
            return False
    return True


def _node_for_step(
    run_dir: Path,
    template: WorkflowFunctionTemplate,
    step: PlanStep,
) -> NodeInvocationSpec:
    node = template.node_invocations.get(step.node_id)
    if node is not None:
        return node
    if step.source == "supervisor":
        return _node_invocation_from_dynamic_step(
            run_dir,
            step,
            context="Supervisor",
            expected_kind="supervisor_intent_snapshot",
        )
    if step.source == "handoff":
        return _node_invocation_from_dynamic_step(
            run_dir,
            step,
            context="Handoff",
            expected_kind="handoff_payload_snapshot",
        )
    raise AccError(f"Continuation step references missing node: {step.node_id}")


def _node_invocation_from_dynamic_step(
    run_dir: Path,
    step: PlanStep,
    *,
    context: str,
    expected_kind: str,
) -> NodeInvocationSpec:
    payload, snapshot_ref = _load_dynamic_step_payload(
        run_dir,
        step,
        context,
        expected_kind=expected_kind,
    )
    return NodeInvocationSpec(
        id=step.node_id,
        callable_ref=step.callable_ref,
        overrides=CallableOverride(static_input=payload),
        metadata={"snapshot_input_ref": snapshot_ref} if snapshot_ref is not None else {},
    )


def _load_dynamic_step_payload(
    run_dir: Path,
    step: PlanStep,
    context: str,
    *,
    expected_kind: str,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    snapshot_ref = _typed_snapshot_input_ref(step, expected_kind, context)
    if snapshot_ref is None:
        if not step.input_snapshot_refs:
            return {}, None
        path_ref = step.input_snapshot_refs[0]
        snapshot_ref = {
            "kind": expected_kind,
            "source": step.source,
            "path": path_ref,
            "payload_key": "input_payload",
            "legacy": True,
        }
    else:
        path_ref = str(snapshot_ref.get("path") or "")
        if not path_ref:
            raise AccError(f"{context} typed input snapshot missing path")
    snapshot_path = (run_dir / path_ref).resolve()
    run_root = run_dir.resolve()
    if snapshot_path != run_root and run_root not in snapshot_path.parents:
        raise AccError(f"{context} input snapshot escapes run dir: {path_ref}")
    payload = load_json(snapshot_path)
    if not isinstance(payload, dict):
        raise AccError(f"{context} input snapshot must contain an object")
    payload_key = str(snapshot_ref.get("payload_key") or "input_payload")
    input_payload = payload.get(payload_key)
    if not isinstance(input_payload, dict):
        raise AccError(f"{context} input snapshot missing {payload_key} object")
    return input_payload, snapshot_ref


def _typed_snapshot_input_ref(
    step: PlanStep,
    expected_kind: str,
    context: str,
) -> dict[str, Any] | None:
    raw_refs = step.metadata.get("typed_input_refs")
    if raw_refs is None:
        return None
    if not isinstance(raw_refs, list):
        raise AccError(f"{context} typed_input_refs must be an array")
    matches: list[dict[str, Any]] = []
    for raw in raw_refs:
        if not isinstance(raw, dict):
            raise AccError(f"{context} typed input ref must be an object")
        kind = raw.get("kind")
        source = raw.get("source")
        path = raw.get("path")
        payload_key = raw.get("payload_key", "input_payload")
        if kind != expected_kind:
            raise AccError(
                f"{context} typed input ref kind {kind!r} does not match {expected_kind!r}"
            )
        if source != step.source:
            raise AccError(
                f"{context} typed input ref source {source!r} does not match "
                f"step source {step.source!r}"
            )
        if not isinstance(path, str) or not path:
            raise AccError(f"{context} typed input snapshot missing path")
        if path not in step.input_snapshot_refs:
            raise AccError(
                f"{context} typed input snapshot path is not listed in input_snapshot_refs"
            )
        if payload_key != "input_payload":
            raise AccError(f"{context} typed input snapshot payload_key must be input_payload")
        matches.append(raw)
    if len(matches) > 1:
        raise AccError(f"{context} has multiple typed payload input refs")
    return matches[0] if matches else None


def _load_template_snapshot(run_dir: Path) -> WorkflowFunctionTemplate:
    snapshot_path = run_dir / "behavior_snapshot" / "workflow_function_template.json"
    payload = load_json(snapshot_path)
    if not isinstance(payload, dict):
        raise AccError("workflow_function_template.json must contain an object")
    return workflow_function_template_from_dict(payload)


def _load_function_invocation(run_dir: Path) -> FunctionInvocation:
    payload = load_json(run_dir / "function_invocation.json")
    if not isinstance(payload, dict):
        raise AccError("function_invocation.json must contain an object")
    input_payload = payload.get("input_payload")
    return FunctionInvocation(
        invocation_id=str(payload["invocation_id"]),
        workflow_function_id=str(payload["workflow_function_id"]),
        run_id=str(payload["run_id"]),
        status=str(payload["status"]),
        input_payload=input_payload if isinstance(input_payload, dict) else {},
        root_scope_frame_id=str(payload["root_scope_frame_id"]),
        parent_invocation_id=(
            str(payload["parent_invocation_id"]) if payload.get("parent_invocation_id") else None
        ),
        started_at=(
            payload.get("started_at") if isinstance(payload.get("started_at"), str) else None
        ),
        ended_at=payload.get("ended_at") if isinstance(payload.get("ended_at"), str) else None,
    )


def _load_scope_frame(run_dir: Path) -> ScopeFrame:
    payload = load_json(run_dir / "scope_frame.json")
    if not isinstance(payload, dict):
        raise AccError("scope_frame.json must contain an object")
    binding_path = payload.get("binding_path")
    return ScopeFrame(
        frame_id=str(payload["frame_id"]),
        invocation_id=str(payload["invocation_id"]),
        parent_frame_id=str(payload["parent_frame_id"]) if payload.get("parent_frame_id") else None,
        call_depth=int(payload["call_depth"]),
        workflow_id=str(payload["workflow_id"]),
        workspace_root=Path(str(payload["workspace_root"])),
        environment_root=Path(str(payload["environment_root"])),
        inbox_root=Path(str(payload["inbox_root"])),
        outbox_root=Path(str(payload["outbox_root"])),
        artifact_root=Path(str(payload["artifact_root"])),
        behavior_snapshot_path=Path(str(payload["behavior_snapshot_path"])),
        ephemeral=bool(payload["ephemeral"]),
        binding_path=Path(str(binding_path)) if binding_path else None,
    )


def _load_success_outputs(
    template: WorkflowFunctionTemplate,
    steps: tuple[PlanStep, ...],
    run_dir: Path,
) -> dict[tuple[str, str], Any]:
    outputs: dict[tuple[str, str], Any] = {}
    for step in steps:
        if step.status != "success":
            continue
        node = template.node_invocations.get(step.node_id)
        if node is None:
            continue
        output_path = run_dir / "nodes" / step.node_id / "output.json"
        if not output_path.exists():
            continue
        output = load_json(output_path)
        for port_id in materialized_output_port_ids(node, output):
            value = output_value_for_port(output, port_id)
            if value is not MISSING_PORT_VALUE:
                outputs[(step.node_id, port_id)] = value
    return outputs


def _write_final_run_state(
    run_dir: Path,
    template: WorkflowFunctionTemplate,
    invocation: FunctionInvocation,
    terminal_status: str,
    *,
    started_at: str | None,
) -> None:
    ended_at = utc_now_iso() if is_terminal_run_status(terminal_status) else None
    final_record = RunRecord(
        run_id=invocation.run_id,
        workflow_function_id=template.id,
        invocation_id=invocation.invocation_id,
        status=terminal_status,
        event_log_path=run_dir / "events.jsonl",
        result_store_root=run_dir / "result_store",
        started_at=started_at,
        ended_at=ended_at,
    )
    write_json(run_dir / "run_record.json", run_record_payload(final_record))
    final_invocation = FunctionInvocation(
        **{
            **invocation.__dict__,
            "status": terminal_status,
            "ended_at": ended_at,
        }
    )
    write_json(run_dir / "function_invocation.json", function_invocation_payload(final_invocation))
    write_core_v2_run_summary(
        run_dir,
        template,
        invocation.run_id,
        terminal_status,
        started_at=started_at,
        ended_at=ended_at,
    )
