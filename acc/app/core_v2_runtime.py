"""Core v2 runtime entry points.

This module used to contain the entire workflow execution engine (the "God Module").
The implementation has been extracted into focused sub-modules under:

  acc/runtime/          -- pure helpers (node_payload, io, policy)
  acc/app/runtime/      -- app-layer modules (executor, scheduler, dispatch_gate,
                           nested_workflow, workflow_io)

This file retains:
  - run_core_v2_workflow_path (top-level entry point)
  - run_workflow_function_invocation (orchestrator)

All other public names are re-exported for backward compatibility.
"""

from __future__ import annotations

import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

from acc.app.core_v2_loader import load_workflow_function_template
from acc.app.run_lifecycle import is_terminal_run_status
from acc.callable_registry import CallableRegistry
from acc.engine import compile_execution_plan
from acc.engine.control_ledger import build_fixed_run_plan
from acc.ledger_writer import ControlLedgerAuditError, FixedRunControlLedgerWriter
from acc.models import (
    AccError,
    ExecutionPlan,
    FunctionInvocation,
    RunRecord,
    ScopeFrame,
    WorkflowFunctionTemplate,
)
from acc.result_store.filesystem import FilesystemResultStore
from acc.runtime.io import (
    append_event,
    function_invocation_payload,
    run_record_payload,
    scope_frame_payload,
)
from acc.serialization import workflow_function_template_to_dict
from acc.session import utc_now_iso
from acc.store import write_json

# ---------------------------------------------------------------------------
# Extracted-module re-exports (backward compatibility)
# ---------------------------------------------------------------------------

from acc.runtime.node_payload import (  # noqa: F401
    MISSING_PORT_VALUE,
    ResolvedNodePayload,
    binding_record,
    control_main_aggregate_payload,
    control_main_aggregate_record,
    is_empty_runtime_input,
    materialized_output_port_ids,
    output_port_ids,
    output_value_for_port,
    resolve_node_payload,
    sha256_json,
    should_forward_main_output_on_control,
)
from acc.runtime.io import (  # noqa: F401
    append_runtime_error_to_stderr_log,
    artifact_bundle_payload,
    event_record_payload,
    failure_record_payload,
    read_required_artifact_bundle_id,
    read_required_session_id,
    session_instance_payload,
)
from acc.app.runtime.executor import (  # noqa: F401
    execute_core_v2_callable,
    execute_core_v2_node,
    execute_hermetic_callable,
    project_root_for_agent_sessions,
    put_result_store_value,
    reject_artifact_path_escape,
    resolve_node_workflow_binding,
    validate_artifact_contract,
)
from acc.app.runtime.scheduler import (  # noqa: F401
    execute_core_v2_node_with_fixed_ledger,
    run_ready_queue_execution,
    workflow_max_concurrency,
)
from acc.app.runtime.dispatch_gate import (  # noqa: F401
    dispatch_ready_handoff_plan_steps,
    dispatch_ready_supervisor_plan_steps,
    resume_approved_human_gate_dispatch,
)
from acc.app.runtime.nested_workflow import (  # noqa: F401
    apply_workflow_call_output_bindings,
    execute_workflow_function_callable,
    infer_project_root,
    load_runtime_overlay_payloads,
    read_child_workflow_outputs,
    resolve_workflow_call_input_payload,
    resolve_workflow_function_path,
    workflow_resolution_candidates,
)
from acc.app.runtime.workflow_io import (  # noqa: F401
    node_summary_from_session_manifest,
    write_core_v2_run_summary,
    write_workflow_outputs,
)

# Backward-compatible alias
FixedRunControlLedger = FixedRunControlLedgerWriter

FIXED_CONTROL_POLICY_ID = "fixed_control_policy"


# ---------------------------------------------------------------------------
# Top-level entry points (kept in this module)
# ---------------------------------------------------------------------------


async def run_core_v2_workflow_path(
    workflow_path: Path,
    run_dir: Path,
    *,
    input_payload: dict[str, Any] | None = None,
    callable_registry: CallableRegistry | None = None,
    workspace: Path | None = None,
    binding_path: Path | None = None,
    ephemeral: bool | None = None,
    parent_invocation_id: str | None = None,
    parent_scope_frame_id: str | None = None,
    call_depth: int = 0,
    should_cancel: Callable[[], bool] | None = None,
) -> RunRecord:
    template = load_workflow_function_template(workflow_path)
    workflow_input = dict(input_payload or {})
    workspace_root = (workspace or run_dir).resolve()
    is_ephemeral = (workspace is None and binding_path is None) if ephemeral is None else ephemeral
    plan = compile_execution_plan(template, workflow_input=workflow_input)
    invocation = FunctionInvocation(
        invocation_id=f"invocation_{run_dir.name}",
        workflow_function_id=template.id,
        run_id=run_dir.name,
        status="running",
        input_payload=workflow_input,
        root_scope_frame_id=f"scope_{run_dir.name}_root",
        parent_invocation_id=parent_invocation_id,
        started_at=utc_now_iso(),
    )
    scope = ScopeFrame(
        frame_id=invocation.root_scope_frame_id,
        invocation_id=invocation.invocation_id,
        parent_frame_id=parent_scope_frame_id,
        call_depth=call_depth,
        workflow_id=template.id,
        workspace_root=workspace_root,
        environment_root=run_dir.resolve(),
        inbox_root=(run_dir / "inbox").resolve(),
        outbox_root=(run_dir / "outbox").resolve(),
        artifact_root=(run_dir / "artifacts").resolve(),
        behavior_snapshot_path=(run_dir / "behavior_snapshot").resolve(),
        ephemeral=is_ephemeral,
        binding_path=binding_path.resolve() if binding_path else None,
    )
    return await run_workflow_function_invocation(
        template,
        invocation,
        scope,
        plan,
        callable_registry=callable_registry,
        should_cancel=should_cancel,
    )


async def run_workflow_function_invocation(
    template: WorkflowFunctionTemplate,
    invocation: FunctionInvocation,
    scope: ScopeFrame,
    plan: ExecutionPlan,
    *,
    callable_registry: CallableRegistry | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> RunRecord:
    run_dir = scope.environment_root
    runs_root = run_dir.parent
    if run_dir.exists():
        shutil.rmtree(run_dir)
    for path in (
        run_dir,
        scope.inbox_root,
        scope.outbox_root,
        scope.artifact_root,
        scope.behavior_snapshot_path,
        run_dir / "failures",
    ):
        path.mkdir(parents=True, exist_ok=True)

    event_log_path = run_dir / "events.jsonl"
    event_log_path.write_text("", encoding="utf-8")
    result_store = FilesystemResultStore(runs_root)
    invocation_path = run_dir / "function_invocation.json"
    scope_path = run_dir / "scope_frame.json"
    template_snapshot_path = scope.behavior_snapshot_path / "workflow_function_template.json"
    write_json(invocation_path, function_invocation_payload(invocation))
    write_json(scope_path, scope_frame_payload(scope))
    write_json(template_snapshot_path, workflow_function_template_to_dict(template))

    started_at = utc_now_iso()
    run_record = RunRecord(
        run_id=invocation.run_id,
        workflow_function_id=template.id,
        invocation_id=invocation.invocation_id,
        status="running",
        event_log_path=event_log_path,
        result_store_root=run_dir / "result_store",
        started_at=started_at,
    )
    write_json(run_dir / "run_record.json", run_record_payload(run_record))
    write_core_v2_run_summary(
        run_dir,
        template,
        invocation.run_id,
        "running",
        started_at=started_at,
    )
    append_event(event_log_path, invocation.run_id, "workflow_started")

    outputs: dict[tuple[str, str], Any] = {}
    terminal_status = "success"
    try:
        run_plan, plan_steps = build_fixed_run_plan(
            plan,
            run_id=invocation.run_id,
            invocation_id=invocation.invocation_id,
            control_policy_id=FIXED_CONTROL_POLICY_ID,
            template_snapshot_ref=str(template_snapshot_path.relative_to(run_dir)),
            created_at=started_at,
        )
        control_ledger = FixedRunControlLedgerWriter(
            run_dir=run_dir,
            run_id=invocation.run_id,
            run_plan=run_plan,
            steps_by_node_id={step.node_id: step for step in plan_steps},
        )
        control_ledger.initialize(
            timestamp=started_at,
            invocation_path=invocation_path,
            scope_path=scope_path,
        )
        terminal_status = await run_ready_queue_execution(
            template,
            invocation,
            scope,
            plan,
            result_store,
            outputs,
            event_log_path,
            callable_registry,
            control_ledger,
            should_cancel=should_cancel,
        )
        if terminal_status == "success":
            write_workflow_outputs(
                template,
                invocation.run_id,
                run_dir,
                result_store,
                outputs,
            )
            append_event(event_log_path, invocation.run_id, "workflow_completed")
        elif terminal_status == "failed":
            append_event(
                event_log_path,
                invocation.run_id,
                "workflow_failed",
                payload={"error": "one or more control branches failed"},
            )
        elif terminal_status == "waiting_interaction":
            append_event(event_log_path, invocation.run_id, "workflow_waiting")
        if terminal_status in {"success", "failed", "cancelled"}:
            run_plan_status = (
                "completed" if terminal_status == "success" else terminal_status
            )
            async with control_ledger.audit_lock:
                control_ledger.finalize_run_plan(run_plan_status)
    except Exception as exc:
        terminal_status = "crashed" if isinstance(exc, ControlLedgerAuditError) else "failed"
        append_event(
            event_log_path,
            invocation.run_id,
            "workflow_crashed" if terminal_status == "crashed" else "workflow_failed",
            payload={"error": str(exc)},
        )

    ended_at = utc_now_iso() if is_terminal_run_status(terminal_status) else None
    final_record = RunRecord(
        run_id=invocation.run_id,
        workflow_function_id=template.id,
        invocation_id=invocation.invocation_id,
        status=terminal_status,
        event_log_path=event_log_path,
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
    write_json(invocation_path, function_invocation_payload(final_invocation))
    write_core_v2_run_summary(
        run_dir,
        template,
        invocation.run_id,
        terminal_status,
        started_at=started_at,
        ended_at=ended_at,
    )
    return final_record
