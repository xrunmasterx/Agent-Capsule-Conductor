"""Dispatch gate: deduplicated dispatch logic for human-gate, supervisor, and handoff.

The three dispatch functions (resume_approved_human_gate_dispatch,
dispatch_ready_supervisor_plan_steps, dispatch_ready_handoff_plan_steps)
shared ~95% identical boilerplate. This module extracts the common skeleton
into ``_dispatch_steps`` and exposes each original function as a thin wrapper.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from typing import Any

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
from acc.runtime.io import (
    append_event,
    function_invocation_payload,
    run_record_payload,
)
from acc.runtime.node_payload import (
    MISSING_PORT_VALUE,
    materialized_output_port_ids,
    output_value_for_port,
)
from acc.app.runtime.scheduler import execute_core_v2_node_with_fixed_ledger
from acc.app.runtime.workflow_io import write_core_v2_run_summary, write_workflow_outputs
from acc.serialization import workflow_function_template_from_dict
from acc.session import utc_now_iso
from acc.app.run_lifecycle import is_terminal_run_status
from acc.store import load_json, write_json
from acc.store.control_ledger import (
    load_decisions,
    load_plan_steps,
    load_run_plan,
    next_dispatch_transition_sequence,
    next_plan_step_transition_sequence,
)


# ---------------------------------------------------------------------------
# Common dispatch skeleton
# ---------------------------------------------------------------------------


async def _dispatch_steps(
    run_dir: Path,
    *,
    step_filter_fn: Callable[
        [FixedRunControlLedgerWriter, tuple[PlanStep, ...]],
        tuple[PlanStep, ...],
    ],
    node_builder_fn: Callable[[Path, PlanStep], NodeInvocationSpec] | None = None,
    template_override_fn: Callable[
        [WorkflowFunctionTemplate, dict[str, NodeInvocationSpec]],
        WorkflowFunctionTemplate,
    ]
    | None = None,
    callable_registry: CallableRegistry | None = None,
) -> dict[str, Any]:
    """Common dispatch skeleton shared by all three dispatch functions."""
    template = _load_template_snapshot(run_dir)
    invocation = _load_function_invocation(run_dir)
    scope = _load_scope_frame(run_dir)
    run_plan = load_run_plan(run_dir).value
    if run_plan is None:
        raise AccError("Cannot dispatch steps without run_plan.json")
    steps = load_plan_steps(run_dir).value

    control_ledger = FixedRunControlLedgerWriter(
        run_dir=run_dir,
        run_id=invocation.run_id,
        run_plan=run_plan,
        steps_by_node_id={step.node_id: step for step in steps},
        plan_step_sequence=next_plan_step_transition_sequence(run_dir) - 1,
        dispatch_sequence=next_dispatch_transition_sequence(run_dir) - 1,
        decision_sequence=len(load_decisions(run_dir).value),
    )

    # --- Step filtering (injected) ---
    ready_steps = step_filter_fn(control_ledger, steps)
    if not ready_steps:
        return {"status": "resuming", "dispatched_step_ids": []}

    # --- Node building (injected or template lookup) ---
    if node_builder_fn is not None:
        dynamic_nodes = {
            step.node_id: node_builder_fn(run_dir, step)
            for step in ready_steps
        }
    else:
        dynamic_nodes = {}

    runtime_template = (
        template_override_fn(template, dynamic_nodes)
        if template_override_fn is not None
        else template
    )

    event_log_path = run_dir / "events.jsonl"
    result_store = FilesystemResultStore(run_dir.parent)
    outputs = _load_success_outputs(runtime_template, steps, run_dir)
    node_by_id = runtime_template.node_invocations
    dispatched_step_ids: list[str] = []
    terminal_status = "resuming"

    try:
        for step in ready_steps:
            node = dynamic_nodes.get(step.node_id) or node_by_id.get(step.node_id)
            if node is None:
                raise AccError(f"Dispatch step references missing node: {step.node_id}")
            await execute_core_v2_node_with_fixed_ledger(
                runtime_template,
                node,
                invocation,
                scope,
                result_store,
                outputs,
                event_log_path,
                callable_registry,
                control_ledger,
            )
            dispatched_step_ids.append(step.plan_step_id)
        latest_steps = load_plan_steps(run_dir).value
        if all(step.status == "success" for step in latest_steps):
            terminal_status = "success"
            write_workflow_outputs(runtime_template, invocation.run_id, run_dir, result_store, outputs)
            append_event(event_log_path, invocation.run_id, "workflow_completed")
    except Exception as exc:
        terminal_status = "failed"
        append_event(
            event_log_path,
            invocation.run_id,
            "workflow_failed",
            payload={"error": str(exc)},
        )

    # --- Shared final-record writing ---
    ended_at = utc_now_iso() if is_terminal_run_status(terminal_status) else None
    final_record = RunRecord(
        run_id=invocation.run_id,
        workflow_function_id=template.id,
        invocation_id=invocation.invocation_id,
        status=terminal_status,
        event_log_path=event_log_path,
        result_store_root=run_dir / "result_store",
        started_at=invocation.started_at,
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
        runtime_template,
        invocation.run_id,
        terminal_status,
        started_at=invocation.started_at,
        ended_at=ended_at,
    )
    return {
        "status": terminal_status,
        "dispatched_step_ids": dispatched_step_ids,
    }


# ---------------------------------------------------------------------------
# Public dispatch functions (thin wrappers)
# ---------------------------------------------------------------------------


async def resume_approved_human_gate_dispatch(
    run_dir: Path,
    *,
    interaction_id: str,
    callable_registry: CallableRegistry | None = None,
) -> dict[str, Any]:
    def filter_fn(
        _ledger: FixedRunControlLedgerWriter,
        steps: tuple[PlanStep, ...],
    ) -> tuple[PlanStep, ...]:
        return tuple(
            step
            for step in steps
            if step.required_interaction_id == interaction_id and step.status == "ready"
        )

    return await _dispatch_steps(
        run_dir,
        step_filter_fn=filter_fn,
        callable_registry=callable_registry,
    )


async def dispatch_ready_supervisor_plan_steps(
    run_dir: Path,
    *,
    callable_registry: CallableRegistry | None = None,
) -> dict[str, Any]:
    return await _dispatch_steps(
        run_dir,
        step_filter_fn=_ready_supervisor_steps,
        node_builder_fn=_node_invocation_from_supervisor_step,
        template_override_fn=lambda t, nodes: replace(
            t, node_invocations={**t.node_invocations, **nodes}
        ),
        callable_registry=callable_registry,
    )


async def dispatch_ready_handoff_plan_steps(
    run_dir: Path,
    *,
    callable_registry: CallableRegistry | None = None,
) -> dict[str, Any]:
    return await _dispatch_steps(
        run_dir,
        step_filter_fn=_ready_handoff_steps,
        node_builder_fn=_node_invocation_from_handoff_step,
        template_override_fn=lambda t, nodes: replace(
            t, node_invocations={**t.node_invocations, **nodes}
        ),
        callable_registry=callable_registry,
    )


# ---------------------------------------------------------------------------
# Step-filter helpers
# ---------------------------------------------------------------------------


def _ready_supervisor_steps(
    control_ledger: FixedRunControlLedgerWriter,
    steps: tuple[PlanStep, ...],
) -> tuple[PlanStep, ...]:
    by_step_id = {step.plan_step_id: step for step in steps}
    ready: list[PlanStep] = []
    for step in steps:
        if step.source != "supervisor":
            continue
        if not _dependencies_succeeded(step, by_step_id):
            continue
        if step.status == "pending":
            control_ledger.transition_step(
                step.node_id,
                "ready",
                reason="supervisor dependencies satisfied",
            )
            step = control_ledger.steps_by_node_id[step.node_id]
        if step.status == "ready":
            ready.append(step)
    return tuple(ready)


def _ready_handoff_steps(
    control_ledger: FixedRunControlLedgerWriter,
    steps: tuple[PlanStep, ...],
) -> tuple[PlanStep, ...]:
    by_step_id = {step.plan_step_id: step for step in steps}
    ready: list[PlanStep] = []
    for step in steps:
        if step.source != "handoff":
            continue
        if not _dependencies_succeeded(step, by_step_id):
            continue
        if step.status == "pending":
            control_ledger.transition_step(
                step.node_id,
                "ready",
                reason="handoff dependencies satisfied",
            )
            step = control_ledger.steps_by_node_id[step.node_id]
        if step.status == "ready":
            ready.append(step)
    return tuple(ready)


def _dependencies_succeeded(step: PlanStep, by_step_id: dict[str, PlanStep]) -> bool:
    for dependency in step.depends_on:
        dependency_step = by_step_id.get(dependency)
        if dependency_step is None:
            raise AccError(f"Dynamic PlanStep dependency not found: {dependency}")
        if dependency_step.status != "success":
            return False
    return True


# ---------------------------------------------------------------------------
# Node-builder helpers
# ---------------------------------------------------------------------------


def _node_invocation_from_supervisor_step(run_dir: Path, step: PlanStep) -> NodeInvocationSpec:
    return NodeInvocationSpec(
        id=step.node_id,
        callable_ref=step.callable_ref,
        overrides=CallableOverride(
            static_input=_load_dynamic_step_payload(run_dir, step, "Supervisor")
        ),
    )


def _node_invocation_from_handoff_step(run_dir: Path, step: PlanStep) -> NodeInvocationSpec:
    return NodeInvocationSpec(
        id=step.node_id,
        callable_ref=step.callable_ref,
        overrides=CallableOverride(
            static_input=_load_dynamic_step_payload(run_dir, step, "Handoff")
        ),
    )


def _load_dynamic_step_payload(
    run_dir: Path,
    step: PlanStep,
    context: str,
) -> dict[str, Any]:
    if not step.input_snapshot_refs:
        return {}
    snapshot_path = (run_dir / step.input_snapshot_refs[0]).resolve()
    run_root = run_dir.resolve()
    if snapshot_path != run_root and run_root not in snapshot_path.parents:
        raise AccError(f"{context} input snapshot escapes run dir: {step.input_snapshot_refs[0]}")
    payload = load_json(snapshot_path)
    if not isinstance(payload, dict):
        raise AccError(f"{context} input snapshot must contain an object")
    input_payload = payload.get("input_payload")
    if not isinstance(input_payload, dict):
        raise AccError(f"{context} input snapshot missing input_payload object")
    return input_payload


# ---------------------------------------------------------------------------
# Snapshot loaders
# ---------------------------------------------------------------------------


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
