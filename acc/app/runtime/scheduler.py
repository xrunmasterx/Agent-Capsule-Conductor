"""DAG-based ready-queue scheduler for workflow node execution.

Extracted from the God Module core_v2_runtime.py.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from pathlib import Path
from typing import Any

from acc.app.runtime.context import ExecutionContext
from acc.app.runtime.results import NodeExecutionResult, WorkflowExecutionResult
from acc.callable_registry import CallableRegistry
from acc.ledger_writer import ControlLedgerAuditError, FixedRunControlLedgerWriter
from acc.models import (
    AccError,
    ExecutionPlan,
    FunctionInvocation,
    NodeInvocationSpec,
    ScopeFrame,
    WorkflowFunctionTemplate,
)
from acc.result_store.filesystem import FilesystemResultStore
from acc.runtime.io import append_event
from acc.scheduler.ready_set import DAGScheduler


async def run_ready_queue_execution(
    template: WorkflowFunctionTemplate,
    invocation: FunctionInvocation,
    scope: ScopeFrame,
    plan: ExecutionPlan,
    result_store: FilesystemResultStore,
    event_log_path: Path,
    callable_registry: CallableRegistry | None,
    control_ledger: FixedRunControlLedgerWriter,
    *,
    should_cancel: Callable[[], bool] | None,
    execution_context: ExecutionContext | None = None,
) -> WorkflowExecutionResult:
    node_by_id = {node.node_id: node.invocation for node in plan.nodes}
    scheduler = DAGScheduler(
        node_order=tuple(node.node_id for node in plan.nodes),
        dependencies={node.node_id: node.depends_on for node in plan.nodes},
    )
    max_concurrency = workflow_max_concurrency(template)
    running: dict[asyncio.Task[NodeExecutionResult], str] = {}
    node_results: dict[str, NodeExecutionResult] = {}
    outputs: dict[tuple[str, str], Any] = {}
    terminal_status = "success"
    stop_launching = False
    cancellation_requested = False

    while True:
        if should_cancel is not None and should_cancel() and not cancellation_requested:
            cancellation_requested = True
            stop_launching = True
            terminal_status = "cancelled"
            cancelled = scheduler.cancel_unstarted()
            async with control_ledger.audit_lock:
                control_ledger.cancel_steps(cancelled)
            append_event(event_log_path, invocation.run_id, "workflow_cancelled")

        if not stop_launching:
            capacity = (
                len(node_by_id)
                if max_concurrency is None
                else max_concurrency - len(running)
            )
            if capacity > 0:
                for node_id in scheduler.ready_nodes()[:capacity]:
                    scheduler.mark_running(node_id)
                    task = asyncio.create_task(
                        execute_core_v2_node_with_fixed_ledger(
                            template,
                            node_by_id[node_id],
                            invocation,
                            scope,
                            result_store,
                            event_log_path,
                            callable_registry,
                            control_ledger,
                            execution_context=execution_context,
                            upstream_outputs=outputs,
                        )
                    )
                    running[task] = node_id

        if not running:
            if terminal_status in {"waiting_interaction", "waiting_handoff", "waiting_timer"}:
                return WorkflowExecutionResult.from_parts(
                    status=terminal_status,
                    outputs=outputs,
                    node_results=node_results,
                )
            if terminal_status in {"cancelled", "timeout"}:
                return WorkflowExecutionResult.from_parts(
                    status=terminal_status,
                    outputs=outputs,
                    node_results=node_results,
                )
            if cancellation_requested:
                return WorkflowExecutionResult.from_parts(
                    status="cancelled",
                    outputs=outputs,
                    node_results=node_results,
                )
            if scheduler.has_failures_or_skips():
                return WorkflowExecutionResult.from_parts(
                    status="failed",
                    outputs=outputs,
                    node_results=node_results,
                )
            if scheduler.has_pending_nodes():
                raise AccError("Ready-queue scheduler stalled with pending nodes")
            return WorkflowExecutionResult.from_parts(
                status="success",
                outputs=outputs,
                node_results=node_results,
            )

        done, _ = await asyncio.wait(
            running.keys(),
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in done:
            node_id = running.pop(task)
            try:
                result = task.result()
            except ControlLedgerAuditError:
                raise
            except Exception:
                skipped = scheduler.mark_failed_and_skip_descendants(node_id)
                async with control_ledger.audit_lock:
                    control_ledger.skip_steps(skipped, blocked_by_node_id=node_id)
                terminal_status = "failed"
                continue

            if result.status == "success":
                scheduler.mark_success(node_id)
                node_results[node_id] = result
                for port_id, value in result.outputs.items():
                    outputs[(node_id, port_id)] = value
                continue
            if result.status in {"waiting_interaction", "waiting_handoff", "waiting_timer"}:
                scheduler.mark_waiting(node_id)
                node_results[node_id] = result
                terminal_status = result.status
                stop_launching = True
                continue
            if result.status in {"failed", "cancelled", "timeout"}:
                skipped = scheduler.mark_failed_and_skip_descendants(node_id)
                async with control_ledger.audit_lock:
                    control_ledger.skip_steps(skipped, blocked_by_node_id=node_id)
                node_results[node_id] = result
                terminal_status = result.status
                if result.status in {"cancelled", "timeout"}:
                    stop_launching = True
                continue
            raise AccError(f"Unsupported node execution status for {node_id}: {result.status}")

def workflow_max_concurrency(template: WorkflowFunctionTemplate) -> int | None:
    raw = template.policies.get("max_concurrency")
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise AccError("Workflow policy max_concurrency must be a positive integer")
    if raw <= 0:
        raise AccError("Workflow policy max_concurrency must be a positive integer")
    return raw


async def execute_core_v2_node_with_fixed_ledger(
    template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
    invocation: FunctionInvocation,
    scope: ScopeFrame,
    result_store: FilesystemResultStore,
    event_log_path: Path,
    callable_registry: CallableRegistry | None,
    control_ledger: FixedRunControlLedgerWriter,
    *,
    execution_context: ExecutionContext | None = None,
    upstream_outputs: dict[tuple[str, str], Any] | None = None,
) -> NodeExecutionResult:
    from acc.app.human_gate import node_requires_human_approval
    from acc.app.runtime.executor import execute_core_v2_node

    if node_requires_human_approval(node) and not control_ledger.step_has_answered_human_gate(
        node.id
    ):
        async with control_ledger.audit_lock:
            control_ledger.wait_for_human_approval(node)
        return NodeExecutionResult.waiting_interaction(node_id=node.id)
    async with control_ledger.audit_lock:
        dispatch = control_ledger.start_dispatch(node, invocation, scope)
    try:
        result = await execute_core_v2_node(
            template,
            node,
            invocation,
            scope,
            result_store,
            event_log_path,
            callable_registry,
            execution_context=execution_context,
            upstream_outputs=upstream_outputs,
        )
    except Exception as exc:
        async with control_ledger.audit_lock:
            control_ledger.fail_dispatch(node, dispatch, exc)
        raise
    async with control_ledger.audit_lock:
        control_ledger.complete_dispatch(node, dispatch)
    return result
