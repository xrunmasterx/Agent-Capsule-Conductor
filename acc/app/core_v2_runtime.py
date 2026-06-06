from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
from collections.abc import Callable
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

from acc.app.core_v2_loader import load_workflow_function_template
from acc.app.human_gate import create_pending_human_gate, node_requires_human_approval
from acc.app.run_lifecycle import is_terminal_run_status, write_run_summary_status
from acc.app.workflow_refs import WorkflowCatalog
from acc.callable_registry import CallableRegistry
from acc.callable_runner import AgentExecutionContext, CallableClassRunner
from acc.domain import (
    AccError,
    ArtifactBundle,
    CallableOverride,
    DecisionRecord,
    DispatchEnvelope,
    DispatchTransitionRecord,
    EventRecord,
    ExecutionPlan,
    FailureRecord,
    FunctionInvocation,
    NodeInvocationSpec,
    PlanStep,
    PlanStepTransitionRecord,
    ResultStoreAddress,
    RunPlan,
    RunPlanStatus,
    RunRecord,
    ScopeFrame,
    SessionInstance,
    WorkflowFunctionTemplate,
    workflow_function_template_from_dict,
    workflow_function_template_to_dict,
)
from acc.engine import compile_execution_plan
from acc.engine.control_ledger import build_fixed_run_plan
from acc.hermetic_callables import HERMETIC_AGENT_CLASS_IDS, HERMETIC_TOOL_CLASS_IDS
from acc.result_store.filesystem import FilesystemResultStore
from acc.result_store.types import (
    ArtifactBundle as StoredArtifactBundle,
)
from acc.result_store.types import (
    NodeId,
    NodeResult,
    PortId,
    RunId,
)
from acc.run_index import NodeRunSummary, RunSummary, rebuild_run_index
from acc.runtime.policy import acc_run_mode
from acc.scheduler.ready_set import DAGScheduler
from acc.session import utc_now_iso
from acc.store import load_json, write_json
from acc.store.control_ledger import (
    append_control_event,
    append_decision_record,
    append_dispatch_transition,
    append_plan_step_transition,
    load_decisions,
    load_plan_steps,
    load_run_plan,
    next_dispatch_transition_sequence,
    next_plan_step_transition_sequence,
    write_run_plan,
)

FIXED_CONTROL_POLICY_ID = "fixed_control_policy"
MISSING_PORT_VALUE = object()


class ControlLedgerAuditError(AccError):
    """Raised when runtime execution evidence exists but control-ledger audit failed."""


@dataclass
class FixedRunControlLedger:
    run_dir: Path
    run_id: str
    run_plan: RunPlan
    steps_by_node_id: dict[str, PlanStep]
    plan_step_sequence: int = 0
    dispatch_sequence: int = 0
    decision_sequence: int = 0
    audit_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def initialize(self, *, timestamp: str, invocation_path: Path, scope_path: Path) -> None:
        def write_initial() -> None:
            write_run_plan(self.run_dir, self.run_plan)
            for step in self.steps_by_node_id.values():
                append_plan_step_transition(
                    self.run_dir,
                    PlanStepTransitionRecord(
                        sequence=self.next_plan_step_sequence(),
                        recorded_at=timestamp,
                        plan_step_id=step.plan_step_id,
                        previous_status=None,
                        next_status=step.status,
                        snapshot=step,
                        reason="initial fixed run plan",
                    ),
                )
            decision = self.compile_decision(
                timestamp=timestamp,
                invocation_path=invocation_path,
                scope_path=scope_path,
            )
            append_decision_record(self.run_dir, decision)
            append_control_event(
                self.run_dir,
                event_type="decision_recorded",
                run_id=self.run_id,
                decision_id=decision.decision_id,
                timestamp=timestamp,
                payload={
                    "kind": decision.kind,
                    "run_plan_id": self.run_plan.run_plan_id,
                    "step_count": self.run_plan.step_count,
                },
            )

        self.write_audit("initialize fixed run control ledger", write_initial)

    def start_dispatch(
        self,
        node: NodeInvocationSpec,
        invocation: FunctionInvocation,
        scope: ScopeFrame,
    ) -> DispatchEnvelope:
        def write_start() -> DispatchEnvelope:
            self.ensure_step_ready(node.id)
            step = self.steps_by_node_id[node.id]
            decision = self.dispatch_decision(node, step)
            append_decision_record(self.run_dir, decision)
            append_control_event(
                self.run_dir,
                event_type="decision_recorded",
                run_id=self.run_id,
                node_id=node.id,
                plan_step_id=step.plan_step_id,
                decision_id=decision.decision_id,
                payload={"kind": decision.kind, "node_id": node.id},
            )
            dispatch = DispatchEnvelope(
                dispatch_id=f"dispatch_{self.run_id}_{node.id}_attempt_1",
                run_id=self.run_id,
                run_plan_id=self.run_plan.run_plan_id,
                plan_step_id=step.plan_step_id,
                node_id=node.id,
                callable_ref=node.callable_ref,
                scope_frame_id=scope.frame_id,
                invocation_id=invocation.invocation_id,
                idempotency_key=f"{self.run_id}:{step.plan_step_id}:1",
                correlation_id=decision.correlation_id or decision.decision_id,
                input_ref=f"nodes/{node.id}/input.json",
                policy_snapshot_ref="run_plan.json",
                created_by_decision_id=decision.decision_id,
                attempt=1,
                created_at=utc_now_iso(),
                status="started",
                result_refs=(),
            )
            append_dispatch_transition(
                self.run_dir,
                DispatchTransitionRecord(
                    sequence=self.next_dispatch_sequence(),
                    recorded_at=dispatch.created_at,
                    dispatch_id=dispatch.dispatch_id,
                    previous_status=None,
                    next_status="started",
                    snapshot=dispatch,
                    reason="dispatch started",
                    decision_id=decision.decision_id,
                    plan_step_id=step.plan_step_id,
                ),
            )
            self.transition_step(
                node.id,
                "dispatching",
                reason="dispatch envelope created",
                decision_id=decision.decision_id,
                dispatch_id=dispatch.dispatch_id,
            )
            append_control_event(
                self.run_dir,
                event_type="dispatch_started",
                run_id=self.run_id,
                node_id=node.id,
                plan_step_id=step.plan_step_id,
                dispatch_id=dispatch.dispatch_id,
                decision_id=decision.decision_id,
                payload={"callable_ref": asdict(node.callable_ref)},
            )
            self.transition_step(
                node.id,
                "running",
                reason="core v2 node execution started",
                decision_id=decision.decision_id,
                dispatch_id=dispatch.dispatch_id,
            )
            return dispatch

        return self.write_audit(f"start dispatch for node {node.id}", write_start)

    def complete_dispatch(self, node: NodeInvocationSpec, dispatch: DispatchEnvelope) -> None:
        def write_complete() -> None:
            session_id = read_required_session_id(self.run_dir, node.id)
            artifact_bundle_id = read_required_artifact_bundle_id(self.run_dir, node.id)
            result_refs = (
                f"nodes/{node.id}/output.json",
                f"nodes/{node.id}/artifact_bundle.json",
            )
            completed = replace(
                dispatch,
                status="completed",
                result_refs=result_refs,
            )
            append_dispatch_transition(
                self.run_dir,
                DispatchTransitionRecord(
                    sequence=self.next_dispatch_sequence(),
                    recorded_at=utc_now_iso(),
                    dispatch_id=completed.dispatch_id,
                    previous_status=dispatch.status,
                    next_status="completed",
                    snapshot=completed,
                    reason="node execution completed",
                    decision_id=dispatch.created_by_decision_id,
                    plan_step_id=dispatch.plan_step_id,
                ),
            )
            self.transition_step(
                node.id,
                "success",
                reason="node execution completed",
                decision_id=dispatch.created_by_decision_id,
                dispatch_id=dispatch.dispatch_id,
                session_id=session_id,
                artifact_bundle_id=artifact_bundle_id,
            )
            append_control_event(
                self.run_dir,
                event_type="dispatch_completed",
                run_id=self.run_id,
                node_id=node.id,
                session_id=session_id,
                plan_step_id=dispatch.plan_step_id,
                dispatch_id=dispatch.dispatch_id,
                decision_id=dispatch.created_by_decision_id,
                payload={"artifact_bundle_id": artifact_bundle_id},
            )

        self.write_audit(f"complete dispatch for node {node.id}", write_complete)

    def fail_dispatch(
        self,
        node: NodeInvocationSpec,
        dispatch: DispatchEnvelope,
        error: Exception,
    ) -> None:
        def write_failed() -> None:
            failure_id = f"failure_{self.run_id}_{node.id}"
            failed = replace(
                dispatch,
                status="failed",
                result_refs=(f"failures/{failure_id}.json",),
            )
            append_dispatch_transition(
                self.run_dir,
                DispatchTransitionRecord(
                    sequence=self.next_dispatch_sequence(),
                    recorded_at=utc_now_iso(),
                    dispatch_id=failed.dispatch_id,
                    previous_status=dispatch.status,
                    next_status="failed",
                    snapshot=failed,
                    reason=str(error),
                    decision_id=dispatch.created_by_decision_id,
                    plan_step_id=dispatch.plan_step_id,
                ),
            )
            self.transition_step(
                node.id,
                "failed",
                reason=str(error),
                decision_id=dispatch.created_by_decision_id,
                dispatch_id=dispatch.dispatch_id,
                failure_id=failure_id,
            )
            append_control_event(
                self.run_dir,
                event_type="dispatch_failed",
                run_id=self.run_id,
                node_id=node.id,
                plan_step_id=dispatch.plan_step_id,
                dispatch_id=dispatch.dispatch_id,
                decision_id=dispatch.created_by_decision_id,
                payload={"failure_id": failure_id, "error": str(error)},
            )

        self.write_audit(f"fail dispatch for node {node.id}", write_failed)

    def skip_steps(self, node_ids: tuple[str, ...], *, blocked_by_node_id: str) -> None:
        def write_skipped() -> None:
            for node_id in node_ids:
                current = self.steps_by_node_id[node_id]
                if current.status not in {"pending", "ready", "waiting_interaction"}:
                    continue
                updated = replace(
                    current,
                    status="skipped",
                    updated_at=utc_now_iso(),
                    metadata={
                        **current.metadata,
                        "skip_reason": "dependency_failed",
                        "blocked_by_step_ids": (
                            self.steps_by_node_id[blocked_by_node_id].plan_step_id,
                        ),
                    },
                )
                append_plan_step_transition(
                    self.run_dir,
                    PlanStepTransitionRecord(
                        sequence=self.next_plan_step_sequence(),
                        recorded_at=updated.updated_at or utc_now_iso(),
                        plan_step_id=updated.plan_step_id,
                        previous_status=current.status,
                        next_status="skipped",
                        snapshot=updated,
                        reason="control predecessor failed",
                    ),
                )
                self.steps_by_node_id[node_id] = updated
                append_control_event(
                    self.run_dir,
                    event_type="plan_step_skipped",
                    run_id=self.run_id,
                    node_id=node_id,
                    plan_step_id=updated.plan_step_id,
                    payload={
                        "skip_reason": "dependency_failed",
                        "blocked_by_node_id": blocked_by_node_id,
                    },
                )

        if node_ids:
            self.write_audit("skip dependency-blocked steps", write_skipped)

    def cancel_steps(self, node_ids: tuple[str, ...]) -> None:
        def write_cancelled() -> None:
            for node_id in node_ids:
                current = self.steps_by_node_id[node_id]
                if current.status not in {"pending", "ready", "waiting_interaction"}:
                    continue
                updated = replace(
                    current,
                    status="cancelled",
                    updated_at=utc_now_iso(),
                    metadata={**current.metadata, "cancel_reason": "run cancellation requested"},
                )
                append_plan_step_transition(
                    self.run_dir,
                    PlanStepTransitionRecord(
                        sequence=self.next_plan_step_sequence(),
                        recorded_at=updated.updated_at or utc_now_iso(),
                        plan_step_id=updated.plan_step_id,
                        previous_status=current.status,
                        next_status="cancelled",
                        snapshot=updated,
                        reason="run cancellation requested",
                    ),
                )
                self.steps_by_node_id[node_id] = updated
                append_control_event(
                    self.run_dir,
                    event_type="plan_step_cancelled",
                    run_id=self.run_id,
                    node_id=node_id,
                    plan_step_id=updated.plan_step_id,
                    payload={"cancel_reason": "run cancellation requested"},
                )

        if node_ids:
            self.write_audit("cancel unstarted steps", write_cancelled)

    def finalize_run_plan(self, status: RunPlanStatus) -> None:
        def write_final() -> None:
            self.run_plan = replace(self.run_plan, status=status)
            write_run_plan(self.run_dir, self.run_plan)
            append_control_event(
                self.run_dir,
                event_type="run_plan_finalized",
                run_id=self.run_id,
                payload={"status": status},
            )

        self.write_audit(f"finalize run_plan as {status}", write_final)

    def wait_for_human_approval(self, node: NodeInvocationSpec) -> None:
        def write_wait() -> None:
            self.ensure_step_ready(node.id)
            current = self.steps_by_node_id[node.id]
            interaction = create_pending_human_gate(
                self.run_dir,
                run_id=self.run_id,
                node=node,
            )
            updated = replace(
                current,
                status="waiting_interaction",
                required_interaction_id=interaction.interaction_id,
                updated_at=utc_now_iso(),
            )
            append_plan_step_transition(
                self.run_dir,
                PlanStepTransitionRecord(
                    sequence=self.next_plan_step_sequence(),
                    recorded_at=updated.updated_at or utc_now_iso(),
                    plan_step_id=updated.plan_step_id,
                    previous_status=current.status,
                    next_status="waiting_interaction",
                    snapshot=updated,
                    reason="human approval required before dispatch",
                ),
            )
            self.steps_by_node_id[node.id] = updated
            append_control_event(
                self.run_dir,
                event_type="interaction_created",
                run_id=self.run_id,
                node_id=node.id,
                plan_step_id=updated.plan_step_id,
                payload={
                    "interaction_id": interaction.interaction_id,
                    "kind": interaction.kind,
                },
            )
            write_run_summary_status(self.run_dir, "waiting_interaction")

        self.write_audit(f"wait for human approval for node {node.id}", write_wait)

    def step_has_answered_human_gate(self, node_id: str) -> bool:
        return self.steps_by_node_id[node_id].required_interaction_id is not None

    def ensure_step_ready(self, node_id: str) -> None:
        step = self.steps_by_node_id[node_id]
        if step.status == "ready":
            return
        if step.status != "pending":
            raise ControlLedgerAuditError(
                f"PlanStep {step.plan_step_id} cannot become ready from {step.status}"
            )
        self.transition_step(node_id, "ready", reason="fixed dependencies satisfied")

    def transition_step(
        self,
        node_id: str,
        next_status: str,
        *,
        reason: str,
        decision_id: str | None = None,
        dispatch_id: str | None = None,
        session_id: str | None = None,
        artifact_bundle_id: str | None = None,
        failure_id: str | None = None,
    ) -> None:
        current = self.steps_by_node_id[node_id]
        updated = replace(
            current,
            status=next_status,
            updated_at=utc_now_iso(),
            decision_id=decision_id or current.decision_id,
            dispatch_id=dispatch_id or current.dispatch_id,
            session_id=session_id or current.session_id,
            artifact_bundle_id=artifact_bundle_id or current.artifact_bundle_id,
            failure_id=failure_id or current.failure_id,
        )
        append_plan_step_transition(
            self.run_dir,
            PlanStepTransitionRecord(
                sequence=self.next_plan_step_sequence(),
                recorded_at=updated.updated_at or utc_now_iso(),
                plan_step_id=updated.plan_step_id,
                previous_status=current.status,
                next_status=updated.status,
                snapshot=updated,
                reason=reason,
                decision_id=decision_id,
                dispatch_id=dispatch_id,
            ),
        )
        self.steps_by_node_id[node_id] = updated

    def compile_decision(
        self,
        *,
        timestamp: str,
        invocation_path: Path,
        scope_path: Path,
    ) -> DecisionRecord:
        return DecisionRecord(
            decision_id=self.next_decision_id("compile_plan"),
            run_id=self.run_id,
            run_plan_id=self.run_plan.run_plan_id,
            actor="system",
            kind="compile_plan",
            timestamp=timestamp,
            policy_snapshot={"control_policy_id": self.run_plan.control_policy_id},
            candidates=({"action": "fixed_run_plan"},),
            selected={
                "run_plan_id": self.run_plan.run_plan_id,
                "step_count": self.run_plan.step_count,
            },
            rejected=(),
            rationale="Compiled deterministic fixed ExecutionPlan into control ledger RunPlan.",
            input_evidence_refs=(
                str(invocation_path.relative_to(self.run_dir)),
                str(scope_path.relative_to(self.run_dir)),
            ),
            result_refs=("run_plan.json", "plan_steps.jsonl"),
            replay_binding={"mode": "deterministic_recompile"},
        )

    def dispatch_decision(self, node: NodeInvocationSpec, step: PlanStep) -> DecisionRecord:
        decision_id = self.next_decision_id("dispatch")
        return DecisionRecord(
            decision_id=decision_id,
            run_id=self.run_id,
            run_plan_id=self.run_plan.run_plan_id,
            actor="system",
            kind="dispatch",
            timestamp=utc_now_iso(),
            policy_snapshot={"control_policy_id": self.run_plan.control_policy_id},
            candidates=({"action": "dispatch", "node_id": node.id},),
            selected={"action": "dispatch", "plan_step_id": step.plan_step_id},
            rejected=(),
            rationale=(
                "Ready-queue scheduler released this node after all control "
                "predecessors succeeded."
            ),
            input_evidence_refs=("run_plan.json", "plan_steps.jsonl"),
            result_refs=("dispatches.jsonl",),
            replay_binding={"mode": "deterministic_recompile"},
            correlation_id=decision_id,
        )

    def next_plan_step_sequence(self) -> int:
        self.plan_step_sequence += 1
        return self.plan_step_sequence

    def next_dispatch_sequence(self) -> int:
        self.dispatch_sequence += 1
        return self.dispatch_sequence

    def next_decision_id(self, kind: str) -> str:
        self.decision_sequence += 1
        return f"decision_{self.run_id}_{kind}_{self.decision_sequence}"

    def write_audit(self, description: str, operation: Callable[[], Any]) -> Any:
        try:
            return operation()
        except ControlLedgerAuditError:
            raise
        except Exception as exc:
            raise ControlLedgerAuditError(
                f"Control ledger audit failed during {description}: {exc}"
            ) from exc


async def run_core_v2_workflow_path(
    workflow_path: Path,
    run_dir: Path,
    *,
    input_payload: dict[str, Any] | None = None,
    callable_registry: CallableRegistry | None = None,
    workspace: Path | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> RunRecord:
    template = load_workflow_function_template(workflow_path)
    workflow_input = dict(input_payload or {})
    plan = compile_execution_plan(template, workflow_input=workflow_input)
    invocation = FunctionInvocation(
        invocation_id=f"invocation_{run_dir.name}",
        workflow_function_id=template.id,
        run_id=run_dir.name,
        status="running",
        input_payload=workflow_input,
        root_scope_frame_id=f"scope_{run_dir.name}_root",
        started_at=utc_now_iso(),
    )
    scope = ScopeFrame(
        frame_id=invocation.root_scope_frame_id,
        invocation_id=invocation.invocation_id,
        parent_frame_id=None,
        call_depth=0,
        workflow_id=template.id,
        workspace_root=(workspace or run_dir).resolve(),
        environment_root=run_dir.resolve(),
        inbox_root=(run_dir / "inbox").resolve(),
        outbox_root=(run_dir / "outbox").resolve(),
        artifact_root=(run_dir / "artifacts").resolve(),
        behavior_snapshot_path=(run_dir / "behavior_snapshot").resolve(),
        ephemeral=True,
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
        control_ledger = FixedRunControlLedger(
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
            run_plan_status: RunPlanStatus = (
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


async def run_ready_queue_execution(
    template: WorkflowFunctionTemplate,
    invocation: FunctionInvocation,
    scope: ScopeFrame,
    plan: ExecutionPlan,
    result_store: FilesystemResultStore,
    outputs: dict[tuple[str, str], Any],
    event_log_path: Path,
    callable_registry: CallableRegistry | None,
    control_ledger: FixedRunControlLedger,
    *,
    should_cancel: Callable[[], bool] | None,
) -> str:
    node_by_id = {node.node_id: node.invocation for node in plan.nodes}
    scheduler = DAGScheduler(
        node_order=tuple(node.node_id for node in plan.nodes),
        dependencies={node.node_id: node.depends_on for node in plan.nodes},
    )
    max_concurrency = workflow_max_concurrency(template)
    running: dict[asyncio.Task[str], str] = {}
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
                            outputs,
                            event_log_path,
                            callable_registry,
                            control_ledger,
                        )
                    )
                    running[task] = node_id

        if not running:
            if terminal_status == "waiting_interaction":
                return terminal_status
            if cancellation_requested:
                return "cancelled"
            if scheduler.has_failures_or_skips():
                return "failed"
            if scheduler.has_pending_nodes():
                raise AccError("Ready-queue scheduler stalled with pending nodes")
            return "success"

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

            if result == "waiting_interaction":
                scheduler.mark_waiting(node_id)
                terminal_status = "waiting_interaction"
                stop_launching = True
                continue
            scheduler.mark_success(node_id)


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
    outputs: dict[tuple[str, str], Any],
    event_log_path: Path,
    callable_registry: CallableRegistry | None,
    control_ledger: FixedRunControlLedger,
) -> str:
    if node_requires_human_approval(node) and not control_ledger.step_has_answered_human_gate(
        node.id
    ):
        async with control_ledger.audit_lock:
            control_ledger.wait_for_human_approval(node)
        return "waiting_interaction"
    async with control_ledger.audit_lock:
        dispatch = control_ledger.start_dispatch(node, invocation, scope)
    try:
        await execute_core_v2_node(
            template,
            node,
            invocation,
            scope,
            result_store,
            outputs,
            event_log_path,
            callable_registry,
        )
    except Exception as exc:
        async with control_ledger.audit_lock:
            control_ledger.fail_dispatch(node, dispatch, exc)
        raise
    async with control_ledger.audit_lock:
        control_ledger.complete_dispatch(node, dispatch)
    return "success"


async def resume_approved_human_gate_dispatch(
    run_dir: Path,
    *,
    interaction_id: str,
    callable_registry: CallableRegistry | None = None,
) -> dict[str, Any]:
    template = _load_template_snapshot(run_dir)
    invocation = _load_function_invocation(run_dir)
    scope = _load_scope_frame(run_dir)
    run_plan = load_run_plan(run_dir).value
    if run_plan is None:
        raise AccError("Cannot resume approved gate without run_plan.json")
    steps = load_plan_steps(run_dir).value
    target_steps = tuple(
        step
        for step in steps
        if step.required_interaction_id == interaction_id and step.status == "ready"
    )
    if not target_steps:
        return {
            "status": "resuming",
            "dispatched_step_ids": [],
            "reason": "no approved ready step",
        }

    control_ledger = FixedRunControlLedger(
        run_dir=run_dir,
        run_id=invocation.run_id,
        run_plan=run_plan,
        steps_by_node_id={step.node_id: step for step in steps},
        plan_step_sequence=next_plan_step_transition_sequence(run_dir) - 1,
        dispatch_sequence=next_dispatch_transition_sequence(run_dir) - 1,
        decision_sequence=len(load_decisions(run_dir).value),
    )
    event_log_path = run_dir / "events.jsonl"
    result_store = FilesystemResultStore(run_dir.parent)
    outputs = _load_success_outputs(template, steps, run_dir)
    node_by_id = template.node_invocations
    dispatched_step_ids: list[str] = []
    terminal_status = "resuming"
    try:
        for step in target_steps:
            node = node_by_id.get(step.node_id)
            if node is None:
                raise AccError(f"Approved PlanStep references missing node: {step.node_id}")
            await execute_core_v2_node_with_fixed_ledger(
                template,
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
            write_workflow_outputs(template, invocation.run_id, run_dir, result_store, outputs)
            append_event(event_log_path, invocation.run_id, "workflow_completed")
    except Exception as exc:
        terminal_status = "failed"
        append_event(
            event_log_path,
            invocation.run_id,
            "workflow_failed",
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
        template,
        invocation.run_id,
        terminal_status,
        started_at=invocation.started_at,
        ended_at=ended_at,
    )
    return {
        "status": terminal_status,
        "dispatched_step_ids": dispatched_step_ids,
    }


async def dispatch_ready_supervisor_plan_steps(
    run_dir: Path,
    *,
    callable_registry: CallableRegistry | None = None,
) -> dict[str, Any]:
    template = _load_template_snapshot(run_dir)
    invocation = _load_function_invocation(run_dir)
    scope = _load_scope_frame(run_dir)
    run_plan = load_run_plan(run_dir).value
    if run_plan is None:
        raise AccError("Cannot dispatch supervisor steps without run_plan.json")
    steps = load_plan_steps(run_dir).value
    control_ledger = FixedRunControlLedger(
        run_dir=run_dir,
        run_id=invocation.run_id,
        run_plan=run_plan,
        steps_by_node_id={step.node_id: step for step in steps},
        plan_step_sequence=next_plan_step_transition_sequence(run_dir) - 1,
        dispatch_sequence=next_dispatch_transition_sequence(run_dir) - 1,
        decision_sequence=len(load_decisions(run_dir).value),
    )
    ready_steps = _ready_supervisor_steps(control_ledger, steps)
    if not ready_steps:
        return {"status": "resuming", "dispatched_step_ids": []}

    dynamic_nodes = {
        step.node_id: _node_invocation_from_supervisor_step(run_dir, step)
        for step in ready_steps
    }
    runtime_template = replace(
        template,
        node_invocations={**template.node_invocations, **dynamic_nodes},
    )
    event_log_path = run_dir / "events.jsonl"
    result_store = FilesystemResultStore(run_dir.parent)
    outputs = _load_success_outputs(runtime_template, steps, run_dir)
    dispatched_step_ids: list[str] = []
    terminal_status = "resuming"
    try:
        for step in ready_steps:
            await execute_core_v2_node_with_fixed_ledger(
                runtime_template,
                dynamic_nodes[step.node_id],
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
            write_workflow_outputs(
                runtime_template,
                invocation.run_id,
                run_dir,
                result_store,
                outputs,
            )
            append_event(event_log_path, invocation.run_id, "workflow_completed")
    except Exception as exc:
        terminal_status = "failed"
        append_event(
            event_log_path,
            invocation.run_id,
            "workflow_failed",
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


async def dispatch_ready_handoff_plan_steps(
    run_dir: Path,
    *,
    callable_registry: CallableRegistry | None = None,
) -> dict[str, Any]:
    template = _load_template_snapshot(run_dir)
    invocation = _load_function_invocation(run_dir)
    scope = _load_scope_frame(run_dir)
    run_plan = load_run_plan(run_dir).value
    if run_plan is None:
        raise AccError("Cannot dispatch handoff steps without run_plan.json")
    steps = load_plan_steps(run_dir).value
    control_ledger = FixedRunControlLedger(
        run_dir=run_dir,
        run_id=invocation.run_id,
        run_plan=run_plan,
        steps_by_node_id={step.node_id: step for step in steps},
        plan_step_sequence=next_plan_step_transition_sequence(run_dir) - 1,
        dispatch_sequence=next_dispatch_transition_sequence(run_dir) - 1,
        decision_sequence=len(load_decisions(run_dir).value),
    )
    ready_steps = _ready_handoff_steps(control_ledger, steps)
    if not ready_steps:
        return {"status": "resuming", "dispatched_step_ids": []}

    dynamic_nodes = {
        step.node_id: _node_invocation_from_handoff_step(run_dir, step)
        for step in ready_steps
    }
    runtime_template = replace(
        template,
        node_invocations={**template.node_invocations, **dynamic_nodes},
    )
    event_log_path = run_dir / "events.jsonl"
    result_store = FilesystemResultStore(run_dir.parent)
    outputs = _load_success_outputs(runtime_template, steps, run_dir)
    dispatched_step_ids: list[str] = []
    terminal_status = "resuming"
    try:
        for step in ready_steps:
            await execute_core_v2_node_with_fixed_ledger(
                runtime_template,
                dynamic_nodes[step.node_id],
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
            write_workflow_outputs(
                runtime_template,
                invocation.run_id,
                run_dir,
                result_store,
                outputs,
            )
            append_event(event_log_path, invocation.run_id, "workflow_completed")
    except Exception as exc:
        terminal_status = "failed"
        append_event(
            event_log_path,
            invocation.run_id,
            "workflow_failed",
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


def _ready_supervisor_steps(
    control_ledger: FixedRunControlLedger,
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
    control_ledger: FixedRunControlLedger,
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


async def execute_core_v2_node(
    template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
    invocation: FunctionInvocation,
    scope: ScopeFrame,
    result_store: FilesystemResultStore,
    outputs: dict[tuple[str, str], Any],
    event_log_path: Path,
    callable_registry: CallableRegistry | None,
) -> None:
    node_dir = scope.environment_root / "nodes" / node.id
    for path in (node_dir, node_dir / "artifacts"):
        path.mkdir(parents=True, exist_ok=True)
    (node_dir / "events.jsonl").write_text("", encoding="utf-8")
    for log_name in ("stdout.log", "stderr.log", "stdout.txt", "stderr.txt"):
        (node_dir / log_name).write_text("", encoding="utf-8")
    append_event(event_log_path, invocation.run_id, "node_started", node_id=node.id)

    started_at = utc_now_iso()
    session = SessionInstance(
        session_id=f"session_{invocation.run_id}_{node.id}",
        invocation_id=invocation.invocation_id,
        scope_frame_id=scope.frame_id,
        node_id=node.id,
        callable_ref=node.callable_ref,
        callable_kind=node.callable_ref.kind,
        status="running",
        cwd=scope.workspace_root,
        env_keys=(),
        input_path=node_dir / "agent_payload.json",
        output_path=node_dir / "output.json",
        artifact_dir=node_dir / "artifacts",
        event_log_path=node_dir / "events.jsonl",
        started_at=started_at,
    )
    write_json(node_dir / "session_instance_manifest.json", session_instance_payload(session))
    try:
        resolved_payload = resolve_node_payload(
            template,
            node,
            invocation.input_payload,
            outputs,
            run_dir=scope.environment_root,
        )
        agent_payload = resolved_payload.payload
        runtime_payload = {
            "run_id": invocation.run_id,
            "workflow_function_id": template.id,
            "scope_frame_id": scope.frame_id,
            "node_id": node.id,
            "callable_ref": asdict(node.callable_ref),
            "execution_mode": acc_run_mode(),
            "binding_materializations": resolved_payload.binding_records,
        }
        write_json(node_dir / "agent_payload.json", agent_payload)
        write_json(node_dir / "input.json", agent_payload)
        write_json(node_dir / "runtime_payload.json", runtime_payload)
        write_json(node_dir / "runtime.json", runtime_payload)
        write_json(
            node_dir / "binding_manifest.json",
            {
                "inputs": sorted(agent_payload),
                "bindings": resolved_payload.binding_records,
            },
        )
        for record in resolved_payload.binding_records:
            append_event(
                event_log_path,
                invocation.run_id,
                "input_materialized",
                node_id=node.id,
                payload=record,
            )

        output = await execute_core_v2_callable(
            template,
            node,
            agent_payload,
            node_dir,
            scope,
            session,
            resolved_payload.binding_records,
            callable_registry,
        )
        write_json(node_dir / "output.json", output)
        write_json(node_dir / "artifacts" / "payload.json", output)
        validate_artifact_contract(node, node_dir)

        materialized_ports = materialized_output_port_ids(node, output)
        for port_id in materialized_ports:
            value = output_value_for_port(output, port_id)
            if value is MISSING_PORT_VALUE:
                raise AccError(f"Required output port missing for node {node.id}: {port_id}")
            outputs[(node.id, port_id)] = value
            put_result_store_value(
                result_store,
                invocation.run_id,
                node.id,
                port_id,
                value,
            )

        bundle = ArtifactBundle(
            bundle_id=f"bundle_{invocation.run_id}_{node.id}",
            node_id=node.id,
            run_id=invocation.run_id,
            outputs={port_id: outputs[(node.id, port_id)] for port_id in materialized_ports},
            files=[],
            created_at=utc_now_iso(),
            provenance={"workflow_function_id": template.id},
        )
        write_json(node_dir / "artifact_bundle.json", artifact_bundle_payload(bundle))

        ended_at = utc_now_iso()
        completed_session = SessionInstance(
            **{
                **session.__dict__,
                "status": "success",
                "ended_at": ended_at,
            }
        )
        write_json(
            node_dir / "session_instance_manifest.json",
            session_instance_payload(completed_session),
        )
        append_event(event_log_path, invocation.run_id, "node_completed", node_id=node.id)
    except Exception as exc:
        ended_at = utc_now_iso()
        failed_session = SessionInstance(
            **{
                **session.__dict__,
                "status": "failed",
                "ended_at": ended_at,
                "error": str(exc),
            }
        )
        write_json(
            node_dir / "session_instance_manifest.json",
            session_instance_payload(failed_session),
        )
        failure = FailureRecord(
            failure_id=f"failure_{invocation.run_id}_{node.id}",
            run_id=invocation.run_id,
            layer="adapter",
            message=str(exc),
            node_id=node.id,
            evidence_paths=(
                node_dir / "session_instance_manifest.json",
                node_dir / "stderr.txt",
            ),
        )
        write_json(
            scope.environment_root / "failures" / f"{failure.failure_id}.json",
            failure_record_payload(failure),
        )
        (node_dir / "stderr.txt").write_text(str(exc), encoding="utf-8")
        append_runtime_error_to_stderr_log(node_dir / "stderr.log", str(exc))
        append_event(
            event_log_path,
            invocation.run_id,
            "node_failed",
            node_id=node.id,
            payload={"failure_id": failure.failure_id, "error": str(exc)},
        )
        raise


@dataclass(frozen=True)
class ResolvedNodePayload:
    payload: dict[str, Any]
    binding_records: list[dict[str, Any]]


def resolve_node_payload(
    template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
    workflow_input: dict[str, Any],
    outputs: dict[tuple[str, str], Any],
    *,
    run_dir: Path,
) -> ResolvedNodePayload:
    payload: dict[str, Any] = dict(node.overrides.static_input)
    records: list[dict[str, Any]] = [
        {
            "binding_kind": "static_input",
            "target_node": node.id,
            "target_port": port,
        }
        for port in sorted(payload)
    ]
    for binding in template.workflow_input_bindings:
        if binding.target.node != node.id:
            continue
        if binding.source_port not in workflow_input:
            if binding.required:
                raise AccError(f"Missing workflow input: {binding.source_port}")
            continue
        payload[binding.target.port] = workflow_input[binding.source_port]
        records.append(
            {
                "binding_kind": "workflow_input",
                "source_port": binding.source_port,
                "target_node": node.id,
                "target_port": binding.target.port,
                "materialization": binding.materialization,
            }
        )
    for binding in node.input_bindings:
        if binding.static_value is not None:
            payload[binding.target_port] = binding.static_value
            records.append(
                {
                    "binding_kind": "input_binding_static",
                    "target_node": node.id,
                    "target_port": binding.target_port,
                }
            )
            continue
        if binding.source is None:
            continue
        key = (binding.source.node, binding.source.port)
        if key not in outputs:
            if binding.required:
                raise AccError(
                    f"Missing binding source {binding.source.node}.{binding.source.port}"
                )
            continue
        payload[binding.target_port] = outputs[key]
        records.append(
            binding_record(
                binding_kind="input_binding",
                source_node=binding.source.node,
                source_port=binding.source.port,
                target_node=node.id,
                target_port=binding.target_port,
                materialization=binding.materialization,
                value=outputs[key],
                run_dir=run_dir,
            )
        )
    for edge in template.data_edges:
        if edge.target.node != node.id:
            continue
        key = (edge.source.node, edge.source.port)
        if key not in outputs:
            raise AccError(
                f"Missing data edge source {edge.source.node}.{edge.source.port} "
                f"for {node.id}.{edge.target.port}"
            )
        payload[edge.target.port] = outputs[key]
        records.append(
            binding_record(
                binding_kind="data_edge",
                source_node=edge.source.node,
                source_port=edge.source.port,
                target_node=node.id,
                target_port=edge.target.port,
                materialization=edge.materialization,
                value=outputs[key],
                run_dir=run_dir,
            )
        )
    if "main" not in payload:
        control_main_sources: list[tuple[str, Any]] = []
        for edge in template.control_edges:
            if edge.target != node.id:
                continue
            source_node = template.node_invocations.get(edge.source)
            if source_node is None or not should_forward_main_output_on_control(source_node):
                continue
            key = (edge.source, "main")
            if key not in outputs:
                continue
            control_main_sources.append((edge.source, outputs[key]))
        if len(control_main_sources) == 1:
            source_node_id, value = control_main_sources[0]
            payload["main"] = value
            records.append(
                binding_record(
                    binding_kind="control_main_default",
                    source_node=source_node_id,
                    source_port="main",
                    target_node=node.id,
                    target_port="main",
                    materialization="copy",
                    value=value,
                    run_dir=run_dir,
                )
            )
        elif len(control_main_sources) > 1:
            aggregate = control_main_aggregate_payload(control_main_sources)
            payload["main"] = aggregate
            for source_node_id, value in control_main_sources:
                records.append(
                    binding_record(
                        binding_kind="control_main_default",
                        source_node=source_node_id,
                        source_port="main",
                        target_node=node.id,
                        target_port="main",
                        materialization="copy",
                        value=value,
                        run_dir=run_dir,
                    )
                )
            records.append(
                control_main_aggregate_record(
                    source_values=control_main_sources,
                    target_node=node.id,
                    target_port="main",
                    aggregate=aggregate,
                    run_dir=run_dir,
                )
            )
    return ResolvedNodePayload(payload=payload, binding_records=records)


def should_forward_main_output_on_control(node: NodeInvocationSpec) -> bool:
    return node.control.forward_main_output_on_control is not False


def control_main_aggregate_payload(source_values: list[tuple[str, Any]]) -> dict[str, Any]:
    return {
        "schema_version": "acc.control_main.aggregate.v1",
        "kind": "control_main_aggregate",
        "order": [source_node for source_node, _ in source_values],
        "sources": {source_node: value for source_node, value in source_values},
    }


def output_value_for_port(output: Any, port_id: str) -> Any:
    if port_id in {"default", "main"}:
        return output
    if not isinstance(output, dict):
        return MISSING_PORT_VALUE
    outputs = output.get("outputs")
    if isinstance(outputs, dict) and port_id in outputs:
        return outputs[port_id]
    if port_id in output:
        return output[port_id]
    return MISSING_PORT_VALUE


def binding_record(
    *,
    binding_kind: str,
    source_node: str,
    source_port: str,
    target_node: str,
    target_port: str,
    materialization: str,
    value: Any,
    run_dir: Path,
) -> dict[str, Any]:
    return {
        "binding_kind": binding_kind,
        "source_node": source_node,
        "source_port": source_port,
        "target_node": target_node,
        "target_port": target_port,
        "materialization": materialization,
        "source_output_path": str((run_dir / "nodes" / source_node / "output.json").resolve()),
        "source_result_sha256": sha256_json(value),
    }


def control_main_aggregate_record(
    *,
    source_values: list[tuple[str, Any]],
    target_node: str,
    target_port: str,
    aggregate: dict[str, Any],
    run_dir: Path,
) -> dict[str, Any]:
    return {
        "binding_kind": "control_main_aggregate",
        "target_node": target_node,
        "target_port": target_port,
        "materialization": "copy",
        "aggregate_order": [source_node for source_node, _ in source_values],
        "aggregate_sha256": sha256_json(aggregate),
        "sources": [
            {
                "source_node": source_node,
                "source_port": "main",
                "source_output_path": str(
                    (run_dir / "nodes" / source_node / "output.json").resolve()
                ),
                "source_result_sha256": sha256_json(value),
            }
            for source_node, value in source_values
        ],
    }


def sha256_json(value: Any) -> str:
    inline = json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(inline).hexdigest()


async def execute_core_v2_callable(
    template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
    payload: dict[str, Any],
    node_dir: Path,
    scope: ScopeFrame,
    session: SessionInstance,
    binding_materializations: list[dict[str, Any]],
    callable_registry: CallableRegistry | None,
) -> dict[str, Any]:
    if node.callable_ref.kind == "workflow_function":
        return await execute_workflow_function_callable(
            template,
            node,
            payload,
            node_dir,
            callable_registry,
        )
    if callable_registry is not None and node.callable_ref.kind == "agent_class":
        try:
            asset = callable_registry.resolve(node.callable_ref)
        except AccError:
            pass
        else:
            return await CallableClassRunner().run_agent_class(
                asset,
                payload,
                node_dir,
                AgentExecutionContext(
                    node=node,
                    scope=scope,
                    session=session,
                    binding_materializations=binding_materializations,
                ),
            )
    return execute_hermetic_callable(node, payload, scope, callable_registry)


async def execute_workflow_function_callable(
    template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
    payload: dict[str, Any],
    node_dir: Path,
    callable_registry: CallableRegistry | None,
) -> dict[str, Any]:
    child_path = resolve_workflow_function_path(template, node.callable_ref.id)
    child_run_dir = node_dir / "nested_workflow"
    child_input_payload = resolve_workflow_call_input_payload(node, payload)
    child_record = await run_core_v2_workflow_path(
        child_path,
        child_run_dir,
        input_payload=child_input_payload,
        callable_registry=callable_registry,
    )
    if child_record.status != "success":
        raise AccError(
            f"Nested workflow {child_record.workflow_function_id} failed for node {node.id}"
        )
    workflow_outputs = read_child_workflow_outputs(child_run_dir)
    mapped_outputs = apply_workflow_call_output_bindings(node, workflow_outputs)
    return {
        "status": "success",
        "summary": f"Nested workflow {child_record.workflow_function_id} success",
        "child_workflow_id": child_record.workflow_function_id,
        "child_workflow_run_dir": str(child_run_dir.resolve()),
        "workflow_outputs": workflow_outputs,
        **mapped_outputs,
    }


def resolve_workflow_call_input_payload(
    node: NodeInvocationSpec,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if not node.workflow_call_input_bindings:
        return payload
    child_input: dict[str, Any] = {}
    for binding in node.workflow_call_input_bindings:
        if binding.static_value is not None:
            child_input[binding.workflow_input] = binding.static_value
            continue
        if binding.source is None:
            if binding.required:
                raise AccError(
                    f"Workflow call input {binding.workflow_input!r} on node {node.id} "
                    "requires a source or static_value"
                )
            continue
        if binding.source.port not in payload:
            if binding.required:
                raise AccError(
                    f"Missing workflow call input source {binding.source.node}."
                    f"{binding.source.port} for {node.id}.{binding.workflow_input}"
                )
            continue
        child_input[binding.workflow_input] = payload[binding.source.port]
    return child_input


def apply_workflow_call_output_bindings(
    node: NodeInvocationSpec,
    workflow_outputs: dict[str, Any],
) -> dict[str, Any]:
    if not node.workflow_call_output_bindings:
        return dict(workflow_outputs)
    mapped: dict[str, Any] = {}
    for binding in node.workflow_call_output_bindings:
        if binding.workflow_output not in workflow_outputs:
            if binding.required:
                raise AccError(
                    f"Missing workflow call output {binding.workflow_output!r} "
                    f"for node {node.id}.{binding.parent_port}"
                )
            continue
        mapped[binding.parent_port] = workflow_outputs[binding.workflow_output]
    return mapped


def resolve_workflow_function_path(template: WorkflowFunctionTemplate, ref_id: str) -> Path:
    template_source_path = template.source_path
    base_dir = template_source_path.parent if template_source_path is not None else Path.cwd()
    project_root = infer_project_root(base_dir)
    workflows_dir = project_root / "workflows"
    overlay_payloads = load_runtime_overlay_payloads(base_dir)
    catalog = WorkflowCatalog(
        project_root=project_root,
        workflows_dir=workflows_dir,
        overlay_payloads=overlay_payloads,
    )
    try:
        return catalog.resolve(
            ref_id,
            template_source_path=template_source_path,
            mode="runtime",
        ).resolved_path
    except AccError as exc:
        candidates = workflow_resolution_candidates(base_dir, workflows_dir, ref_id)
        raise AccError(
            "Nested workflow not found: "
            f"node_ref={ref_id!r}; template_source_path={template_source_path}; "
            f"resolution_candidates={candidates}; "
            f"detail={exc}"
        ) from exc


def infer_project_root(base_dir: Path) -> Path:
    current = base_dir.resolve()
    for candidate in (current, *current.parents):
        if (candidate / "workflows").exists() or (candidate / "pyproject.toml").exists():
            return candidate
    return Path.cwd().resolve()


def load_runtime_overlay_payloads(base_dir: Path) -> dict[Path, dict[str, Any]]:
    payloads: dict[Path, dict[str, Any]] = {}
    if not base_dir.exists():
        return payloads
    for path in sorted(base_dir.glob("*.accflow.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict):
            payloads[path.resolve()] = payload
    return payloads


def workflow_resolution_candidates(base_dir: Path, workflows_dir: Path, ref_id: str) -> list[str]:
    path = Path(ref_id)
    candidates = [path] if path.is_absolute() else [base_dir / path, workflows_dir / path.name]
    return [str(candidate.resolve()) for candidate in candidates]


def read_child_workflow_outputs(child_run_dir: Path) -> dict[str, Any]:
    outputs: dict[str, Any] = {}
    outputs_dir = child_run_dir / "workflow_outputs"
    if not outputs_dir.exists():
        return outputs
    for output_path in sorted(outputs_dir.glob("*/output.json")):
        outputs[output_path.parent.name] = json.loads(output_path.read_text(encoding="utf-8"))
    return outputs


def read_required_session_id(run_dir: Path, node_id: str) -> str:
    manifest_path = run_dir / "nodes" / node_id / "session_instance_manifest.json"
    if not manifest_path.exists():
        raise ControlLedgerAuditError(f"Session manifest missing for node {node_id}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    session_id = manifest.get("session_id") if isinstance(manifest, dict) else None
    if not isinstance(session_id, str) or not session_id:
        raise ControlLedgerAuditError(f"Session id missing for node {node_id}")
    return session_id


def read_required_artifact_bundle_id(run_dir: Path, node_id: str) -> str:
    bundle_path = run_dir / "nodes" / node_id / "artifact_bundle.json"
    if not bundle_path.exists():
        raise ControlLedgerAuditError(f"Artifact bundle missing for node {node_id}")
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    bundle_id = bundle.get("bundle_id") if isinstance(bundle, dict) else None
    if not isinstance(bundle_id, str) or not bundle_id:
        raise ControlLedgerAuditError(f"Artifact bundle id missing for node {node_id}")
    return bundle_id


def validate_artifact_contract(node: NodeInvocationSpec, node_dir: Path) -> None:
    artifacts_dir = node_dir / "artifacts"
    for rel_path in (
        *node.artifact_contract.required_paths,
        *node.artifact_contract.optional_paths,
    ):
        reject_artifact_path_escape(rel_path)
    for rel_path in node.artifact_contract.required_paths:
        if not (artifacts_dir / rel_path).exists():
            raise AccError(f"Required artifact missing for node {node.id}: {rel_path}")


def reject_artifact_path_escape(rel_path: str) -> None:
    path = Path(rel_path)
    if (
        path.is_absolute()
        or PurePosixPath(rel_path).is_absolute()
        or PureWindowsPath(rel_path).is_absolute()
        or ".." in path.parts
        or ".." in PurePosixPath(rel_path).parts
        or ".." in PureWindowsPath(rel_path).parts
    ):
        raise AccError(f"Artifact path escapes node artifact directory: {rel_path}")


def append_runtime_error_to_stderr_log(path: Path, message: str) -> None:
    prefix = "\n" if path.exists() and path.stat().st_size > 0 else ""
    with path.open("a", encoding="utf-8") as file:
        file.write(f"{prefix}ACC runtime error: {message}\n")


def execute_hermetic_callable(
    node: NodeInvocationSpec,
    payload: dict[str, Any],
    scope: ScopeFrame,
    callable_registry: CallableRegistry | None,
) -> dict[str, Any]:
    ref = node.callable_ref
    if ref.kind == "tool_class" and ref.id in HERMETIC_TOOL_CLASS_IDS:
        if ref.id in {"fake_producer", "fake"}:
            return {
                "status": "success",
                "summary": f"Produced artifact from {node.id}",
                "producer_node_id": node.id,
                "input": payload,
                "cwd": str(scope.workspace_root),
            }
        if ref.id == "merge":
            return {
                "status": "success",
                "summary": f"Merged input for {node.id}",
                "merged": payload,
                "cwd": str(scope.workspace_root),
            }
        if ref.id == "fail":
            raise AccError(f"Tool node {node.id} failed by configuration")
    if ref.kind == "agent_class" and ref.id in HERMETIC_AGENT_CLASS_IDS:
        return {
            "status": "success",
            "summary": f"Fake agent {node.id} ran in {scope.workspace_root}",
            "input": payload,
            "prompt": node.prompt_policy.user_prompt or node.overrides.prompt or "",
            "cwd": str(scope.workspace_root),
        }
    if callable_registry is not None:
        try:
            callable_registry.resolve(ref)
        except AccError:
            pass
        else:
            return {
                "status": "success",
                "summary": f"Callable {ref.kind}:{ref.id} executed by Core v2 adapter stub",
                "input": payload,
                "callable_ref": asdict(ref),
                "cwd": str(scope.workspace_root),
            }
    raise AccError(f"Unsupported Core v2 callable: {ref.kind}:{ref.id}")


def write_workflow_outputs(
    template: WorkflowFunctionTemplate,
    run_id: str,
    run_dir: Path,
    result_store: FilesystemResultStore,
    outputs: dict[tuple[str, str], Any],
) -> None:
    grouped: dict[str, list[tuple[str, Any]]] = {}
    for binding in template.workflow_output_bindings:
        key = (binding.source.node, binding.source.port)
        if key not in outputs:
            if binding.required:
                raise AccError(
                    f"Missing workflow output source {binding.source.node}.{binding.source.port}"
                )
            continue
        grouped.setdefault(binding.target_port, []).append((binding.source.node, outputs[key]))

    for target_port, values in grouped.items():
        if len(values) == 1:
            value: Any = values[0][1]
        else:
            value = {source_node: output_value for source_node, output_value in values}
        output_dir = run_dir / "workflow_outputs" / target_port
        output_dir.mkdir(parents=True, exist_ok=True)
        write_json(output_dir / "output.json", value)
        put_result_store_value(
            result_store,
            run_id,
            "__workflow_outputs",
            target_port,
            value,
        )


def output_port_ids(node: NodeInvocationSpec) -> tuple[str, ...]:
    if node.workflow_call_output_bindings:
        return tuple(binding.parent_port for binding in node.workflow_call_output_bindings)
    if node.output_bindings:
        return tuple(binding.source_port for binding in node.output_bindings)
    if node.output_ports:
        return tuple(node.output_ports)
    return ("default", "main")


def materialized_output_port_ids(
    node: NodeInvocationSpec,
    output: Any,
) -> tuple[str, ...]:
    if not node.workflow_call_output_bindings:
        return output_port_ids(node)
    workflow_outputs = output.get("workflow_outputs") if isinstance(output, dict) else None
    if not isinstance(workflow_outputs, dict):
        return output_port_ids(node)
    ports: list[str] = []
    for binding in node.workflow_call_output_bindings:
        if binding.required or binding.workflow_output in workflow_outputs:
            ports.append(binding.parent_port)
    return tuple(ports)


def put_result_store_value(
    result_store: FilesystemResultStore,
    run_id: str,
    node_id: str,
    port_id: str,
    value: Any,
) -> ResultStoreAddress:
    inline = json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(inline).hexdigest()
    result = NodeResult(
        run_id=RunId(run_id),
        node_id=NodeId(node_id),
        port_id=PortId(port_id),
        bundle=StoredArtifactBundle(
            bundle_id=f"bundle_{run_id}_{node_id}_{port_id}",
            relative_path=f"{run_id}/result_store/{node_id}/{port_id}.bin",
            sha256=digest,
            size_bytes=len(inline),
            materialization_mode="inline",
        ),
        inline_value=inline,
        produced_at=utc_now_iso(),
    )
    result_store.put(result)
    return ResultStoreAddress(run_id=run_id, node_id=node_id, port_id=port_id)


def write_core_v2_run_summary(
    run_dir: Path,
    template: WorkflowFunctionTemplate,
    run_id: str,
    status: str,
    *,
    started_at: str | None = None,
    ended_at: str | None = None,
) -> None:
    nodes = [
        node_summary_from_session_manifest(run_dir, node_id)
        for node_id in sorted(template.node_invocations)
        if (run_dir / "nodes" / node_id / "session_instance_manifest.json").exists()
    ]
    failed_nodes = [node.node_id for node in nodes if node.status != "success"]
    summary = RunSummary(
        run_id=run_id,
        workflow_id=template.id,
        status=status,
        started_at=started_at,
        ended_at=ended_at,
        run_dir=str(run_dir.resolve()),
        node_count=len(nodes),
        failed_nodes=failed_nodes,
        output_path=str((run_dir / "workflow_outputs").resolve())
        if (run_dir / "workflow_outputs").exists()
        else None,
        artifact_dir=str((run_dir / "artifacts").resolve())
        if (run_dir / "artifacts").exists()
        else None,
        nodes=nodes,
    )
    write_json(run_dir / "run_summary.json", summary.model_dump())
    if run_dir.parent.name == "runs":
        write_json(run_dir.parent / "index.json", rebuild_run_index(run_dir.parent).model_dump())


def node_summary_from_session_manifest(run_dir: Path, node_id: str) -> NodeRunSummary:
    node_dir = run_dir / "nodes" / node_id
    manifest = json.loads((node_dir / "session_instance_manifest.json").read_text(encoding="utf-8"))
    status = str(manifest.get("status") or "unknown")
    error = manifest.get("error")
    return NodeRunSummary(
        node_id=node_id,
        callable_id=str((manifest.get("callable_ref") or {}).get("id") or "unknown"),
        session_id=manifest.get("session_id"),
        status=status,
        summary=str(error or ""),
        run_dir=str(run_dir.resolve()),
        input_path=str((node_dir / "agent_payload.json").resolve())
        if (node_dir / "agent_payload.json").exists()
        else None,
        prompt_path=str((node_dir / "resolved_prompt.md").resolve())
        if (node_dir / "resolved_prompt.md").exists()
        else None,
        output_path=str((node_dir / "output.json").resolve())
        if (node_dir / "output.json").exists()
        else None,
        artifact_dir=str((node_dir / "artifacts").resolve())
        if (node_dir / "artifacts").exists()
        else None,
        event_log=str((node_dir / "events.jsonl").resolve())
        if (node_dir / "events.jsonl").exists()
        else None,
        stdout_log=str((node_dir / "stdout.log").resolve())
        if (node_dir / "stdout.log").exists()
        else None,
        stderr_log=str((node_dir / "stderr.log").resolve())
        if (node_dir / "stderr.log").exists()
        else None,
    )


def append_event(
    event_log_path: Path,
    run_id: str,
    event_type: str,
    *,
    node_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    timestamp = utc_now_iso()
    event = EventRecord(
        event_id=f"event_{timestamp}_{event_type}",
        run_id=run_id,
        type=event_type,
        timestamp=timestamp,
        node_id=node_id,
        payload=payload or {},
    )
    with event_log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event_record_payload(event), ensure_ascii=False) + "\n")


def function_invocation_payload(invocation: FunctionInvocation) -> dict[str, Any]:
    return asdict(invocation)


def scope_frame_payload(scope: ScopeFrame) -> dict[str, Any]:
    payload = asdict(scope)
    for key in (
        "workspace_root",
        "environment_root",
        "inbox_root",
        "outbox_root",
        "artifact_root",
        "behavior_snapshot_path",
        "binding_path",
    ):
        if payload[key] is not None:
            payload[key] = str(payload[key])
    return payload


def session_instance_payload(session: SessionInstance) -> dict[str, Any]:
    payload = asdict(session)
    payload["cwd"] = str(session.cwd)
    payload["input_path"] = str(session.input_path)
    payload["output_path"] = str(session.output_path)
    payload["artifact_dir"] = str(session.artifact_dir)
    payload["event_log_path"] = str(session.event_log_path)
    return payload


def artifact_bundle_payload(bundle: ArtifactBundle) -> dict[str, Any]:
    return asdict(bundle)


def run_record_payload(record: RunRecord) -> dict[str, Any]:
    payload = asdict(record)
    payload["event_log_path"] = str(record.event_log_path)
    payload["result_store_root"] = str(record.result_store_root)
    return payload


def event_record_payload(event: EventRecord) -> dict[str, Any]:
    return asdict(event)


def failure_record_payload(failure: FailureRecord) -> dict[str, Any]:
    payload = asdict(failure)
    payload["evidence_paths"] = [str(path) for path in failure.evidence_paths]
    return payload
