"""Top-level workflow orchestration: setup, run, and finalize a workflow invocation.

Extracted from core_v2_runtime.py to complete the God Module split.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from acc.app.core_v2_loader import load_workflow_function_template
from acc.app.run_lifecycle import is_terminal_run_status
from acc.app.runtime.context import ExecutionContext, build_execution_context
from acc.app.runtime.repository import RunRepository
from acc.app.runtime.scheduler import run_ready_queue_execution
from acc.callable_registry import CallableRegistry
from acc.engine import compile_execution_plan
from acc.engine.control_ledger import build_fixed_run_plan
from acc.ledger_writer import ControlLedgerAuditError, FixedRunControlLedgerWriter
from acc.models import (
    ExecutionPlan,
    FunctionInvocation,
    RunRecord,
    ScopeFrame,
    WorkflowFunctionTemplate,
)
from acc.result_store.filesystem import FilesystemResultStore
from acc.session import utc_now_iso

FIXED_CONTROL_POLICY_ID = "fixed_control_policy"


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
    execution_context: ExecutionContext | None = None,
) -> RunRecord:
    """Load a workflow template and execute it to completion."""
    template = load_workflow_function_template(workflow_path)
    workflow_input = dict(input_payload or {})
    context = execution_context or build_execution_context(
        workflow_path=workflow_path,
        run_dir=run_dir,
        callable_registry=callable_registry,
    )
    resolved_callable_registry = callable_registry or context.project.callable_registry
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
        callable_registry=resolved_callable_registry,
        should_cancel=should_cancel,
        execution_context=context.with_run_dir(run_dir),
    )


async def run_workflow_function_invocation(
    template: WorkflowFunctionTemplate,
    invocation: FunctionInvocation,
    scope: ScopeFrame,
    plan: ExecutionPlan,
    *,
    callable_registry: CallableRegistry | None = None,
    should_cancel: Callable[[], bool] | None = None,
    execution_context: ExecutionContext | None = None,
) -> RunRecord:
    """Set up run directory, execute the DAG scheduler, and finalize the run."""
    run_dir = scope.environment_root
    context = execution_context or build_execution_context(
        workflow_path=template.source_path,
        run_dir=run_dir,
        callable_registry=callable_registry,
    )
    project_root = context.project.project_root
    resolved_callable_registry = callable_registry or context.project.callable_registry
    run_repository = RunRepository(run_dir, project_root=project_root)
    run_repository.prepare(scope)

    event_log_path = run_repository.event_log_path
    result_store = FilesystemResultStore(run_dir.parent)
    invocation_path = run_repository.write_invocation(invocation)
    scope_path = run_repository.write_scope(scope)
    template_snapshot_path = run_repository.write_template_snapshot(template)

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
    run_repository.write_run_record(run_record)
    run_repository.write_run_summary(
        template,
        invocation.run_id,
        "running",
        started_at=started_at,
    )
    run_repository.append_event(invocation.run_id, "workflow_started")

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
        workflow_result = await run_ready_queue_execution(
            template,
            invocation,
            scope,
            plan,
            result_store,
            event_log_path,
            resolved_callable_registry,
            control_ledger,
            should_cancel=should_cancel,
            execution_context=context,
        )
        terminal_status = workflow_result.status
        if terminal_status == "success":
            run_repository.write_workflow_outputs(
                template,
                invocation.run_id,
                result_store,
                workflow_result.outputs,
            )
            run_repository.append_event(invocation.run_id, "workflow_completed")
        elif terminal_status == "failed":
            run_repository.append_event(
                invocation.run_id,
                "workflow_failed",
                payload={"error": "one or more control branches failed"},
            )
        elif terminal_status == "waiting_interaction":
            run_repository.append_event(invocation.run_id, "workflow_waiting")
        if terminal_status in {"success", "failed", "cancelled"}:
            run_plan_status = (
                "completed" if terminal_status == "success" else terminal_status
            )
            async with control_ledger.audit_lock:
                control_ledger.finalize_run_plan(run_plan_status)
    except Exception as exc:
        terminal_status = "crashed" if isinstance(exc, ControlLedgerAuditError) else "failed"
        run_repository.append_event(
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
    run_repository.write_run_record(final_record)
    final_invocation = FunctionInvocation(
        **{
            **invocation.__dict__,
            "status": terminal_status,
            "ended_at": ended_at,
        }
    )
    run_repository.write_invocation(final_invocation)
    run_repository.write_run_summary(
        template,
        invocation.run_id,
        terminal_status,
        started_at=started_at,
        ended_at=ended_at,
    )
    return final_record
