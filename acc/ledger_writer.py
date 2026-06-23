"""Layer 2: Mutable runtime writer for the Runtime Control Ledger.

``FixedRunControlLedgerWriter`` is the **only** component that mutates run
state (plan-step transitions, dispatch transitions, decision records, and
control events).  Every status change is validated by the Layer-3 pure
helpers in ``acc.state_machine`` before being persisted.

External call-sites (``handoff.py``, ``supervisor.py``, ``run_lifecycle.py``)
should go through this writer or call the Layer-3 pure helpers directly --
they must never call ``append_plan_step_transition`` on their own.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Any

from acc.app.human_gate import create_pending_human_gate
from acc.app.run_lifecycle import write_run_summary_status
from acc.models import (
    AccError,
    DecisionRecord,
    DispatchEnvelope,
    FunctionInvocation,
    NodeInvocationSpec,
    PlanStep,
    PlanStepStatus,
    RunPlan,
    RunPlanStatus,
    ScopeFrame,
)
from acc.session import utc_now_iso
from acc.state_machine import (
    transition_dispatch,
    transition_dispatch_initial,
    transition_plan_step,
    transition_plan_step_initial,
)
from acc.store.control_ledger import (
    append_control_event,
    append_decision_record,
    append_dispatch_transition,
    append_plan_step_transition,
    write_run_plan,
)


class ControlLedgerAuditError(AccError):
    """Raised when runtime execution evidence exists but control-ledger audit failed."""


@dataclass
class FixedRunControlLedgerWriter:
    """Layer 2: the sole writer for the Runtime Control Ledger.

    Holds mutable run state (steps, sequence counters) and delegates all
    status validation to the Layer-3 pure helpers before persisting via
    the ``acc.store.control_ledger`` filesystem primitives.
    """

    run_dir: Path
    run_id: str
    run_plan: RunPlan
    steps_by_node_id: dict[str, PlanStep]
    plan_step_sequence: int = 0
    dispatch_sequence: int = 0
    decision_sequence: int = 0
    audit_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    # ------------------------------------------------------------------
    # Read-only accessors
    # ------------------------------------------------------------------

    def get_step(self, node_id: str) -> PlanStep:
        return self.steps_by_node_id[node_id]

    def all_steps(self) -> tuple[PlanStep, ...]:
        return tuple(self.steps_by_node_id.values())

    def steps_with_status(self, status: PlanStepStatus) -> tuple[PlanStep, ...]:
        return tuple(s for s in self.steps_by_node_id.values() if s.status == status)

    # ------------------------------------------------------------------
    # Lifecycle: initialise a fresh fixed run
    # ------------------------------------------------------------------

    def initialize(
        self,
        *,
        timestamp: str,
        invocation_path: Path,
        scope_path: Path,
    ) -> None:
        def write_initial() -> None:
            write_run_plan(self.run_dir, self.run_plan)
            for step in self.steps_by_node_id.values():
                record = transition_plan_step_initial(
                    step,
                    sequence=self._next_plan_step_seq(),
                    reason="initial fixed run plan",
                    recorded_at=timestamp,
                )
                append_plan_step_transition(self.run_dir, record)

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

    # ------------------------------------------------------------------
    # PlanStep transitions (all go through Layer 3)
    # ------------------------------------------------------------------

    def transition_step(
        self,
        node_id: str,
        next_status: PlanStepStatus,
        *,
        reason: str,
        decision_id: str | None = None,
        dispatch_id: str | None = None,
        session_id: str | None = None,
        artifact_bundle_id: str | None = None,
        failure_id: str | None = None,
    ) -> PlanStep:
        """Validate and persist a PlanStep status change.

        Delegates to ``state_machine.transition_plan_step`` for validation.
        """
        current = self.steps_by_node_id[node_id]
        record, updated = transition_plan_step(
            current,
            next_status,
            sequence=self._next_plan_step_seq(),
            reason=reason,
            decision_id=decision_id,
            dispatch_id=dispatch_id,
            session_id=session_id,
            artifact_bundle_id=artifact_bundle_id,
            failure_id=failure_id,
        )
        append_plan_step_transition(self.run_dir, record)
        self.steps_by_node_id[node_id] = updated
        return updated

    def ensure_step_ready(self, node_id: str) -> None:
        """Transition ``pending -> ready`` idempotently; raise on other states."""
        step = self.steps_by_node_id[node_id]
        if step.status == "ready":
            return
        if step.status != "pending":
            raise ControlLedgerAuditError(
                f"PlanStep {step.plan_step_id} cannot become ready from {step.status}"
            )
        self.transition_step(node_id, "ready", reason="fixed dependencies satisfied")

    # ------------------------------------------------------------------
    # Dispatch lifecycle
    # ------------------------------------------------------------------

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
            init_record = transition_dispatch_initial(
                dispatch,
                sequence=self._next_dispatch_seq(),
                reason="dispatch started",
                decision_id=decision.decision_id,
                plan_step_id=step.plan_step_id,
                recorded_at=dispatch.created_at,
            )
            append_dispatch_transition(self.run_dir, init_record)

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
            session_id = _read_required_session_id(self.run_dir, node.id)
            artifact_bundle_id = _read_required_artifact_bundle_id(self.run_dir, node.id)
            result_refs = (
                f"nodes/{node.id}/output.json",
                f"nodes/{node.id}/artifact_bundle.json",
            )
            record, _completed = transition_dispatch(
                dispatch,
                "completed",
                sequence=self._next_dispatch_seq(),
                reason="node execution completed",
                decision_id=dispatch.created_by_decision_id,
                plan_step_id=dispatch.plan_step_id,
            )
            # Override result_refs on the snapshot
            completed = replace(
                _completed,
                result_refs=result_refs,
            )
            final_record = replace(record, snapshot=completed)
            append_dispatch_transition(self.run_dir, final_record)

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
            record, _failed = transition_dispatch(
                dispatch,
                "failed",
                sequence=self._next_dispatch_seq(),
                reason=str(error),
                decision_id=dispatch.created_by_decision_id,
                plan_step_id=dispatch.plan_step_id,
            )
            failed = replace(
                _failed,
                result_refs=(f"failures/{failure_id}.json",),
            )
            final_record = replace(record, snapshot=failed)
            append_dispatch_transition(self.run_dir, final_record)

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

    # ------------------------------------------------------------------
    # Batch operations
    # ------------------------------------------------------------------

    def skip_steps(self, node_ids: tuple[str, ...], *, blocked_by_node_id: str) -> None:
        def write_skipped() -> None:
            for node_id in node_ids:
                current = self.steps_by_node_id[node_id]
                if current.status not in {"pending", "ready", "waiting_interaction"}:
                    continue
                updated_meta = {
                    **current.metadata,
                    "skip_reason": "dependency_failed",
                    "blocked_by_step_ids": (
                        self.steps_by_node_id[blocked_by_node_id].plan_step_id,
                    ),
                }
                # Build the step with metadata first, then transition
                step_with_meta = replace(current, metadata=updated_meta)
                # Use Layer 3 for the actual transition
                record, updated = transition_plan_step(
                    step_with_meta,
                    "skipped",
                    sequence=self._next_plan_step_seq(),
                    reason="control predecessor failed",
                )
                append_plan_step_transition(self.run_dir, record)
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
                step_with_meta = replace(
                    current,
                    metadata={**current.metadata, "cancel_reason": "run cancellation requested"},
                )
                record, updated = transition_plan_step(
                    step_with_meta,
                    "cancelled",
                    sequence=self._next_plan_step_seq(),
                    reason="run cancellation requested",
                )
                append_plan_step_transition(self.run_dir, record)
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

    # ------------------------------------------------------------------
    # Run-plan finalization
    # ------------------------------------------------------------------

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

    # ------------------------------------------------------------------
    # Human-approval gate
    # ------------------------------------------------------------------

    def wait_for_human_approval(self, node: NodeInvocationSpec) -> None:
        def write_wait() -> None:
            self.ensure_step_ready(node.id)
            current = self.steps_by_node_id[node.id]
            interaction = create_pending_human_gate(
                self.run_dir,
                run_id=self.run_id,
                node=node,
            )
            updated_step = replace(
                current,
                required_interaction_id=interaction.interaction_id,
            )
            record, updated = transition_plan_step(
                updated_step,
                "waiting_interaction",
                sequence=self._next_plan_step_seq(),
                reason="human approval required before dispatch",
            )
            append_plan_step_transition(self.run_dir, record)
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

    # ------------------------------------------------------------------
    # Decision-record helpers
    # ------------------------------------------------------------------

    def compile_decision(
        self,
        *,
        timestamp: str,
        invocation_path: Path,
        scope_path: Path,
    ) -> DecisionRecord:
        return DecisionRecord(
            decision_id=self._next_decision_id("compile_plan"),
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
        decision_id = self._next_decision_id("dispatch")
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

    # ------------------------------------------------------------------
    # Sequence counters
    # ------------------------------------------------------------------

    def _next_plan_step_seq(self) -> int:
        self.plan_step_sequence += 1
        return self.plan_step_sequence

    def _next_dispatch_seq(self) -> int:
        self.dispatch_sequence += 1
        return self.dispatch_sequence

    def _next_decision_id(self, kind: str) -> str:
        self.decision_sequence += 1
        return f"decision_{self.run_id}_{kind}_{self.decision_sequence}"

    # ------------------------------------------------------------------
    # Audit wrapper
    # ------------------------------------------------------------------

    def write_audit(self, description: str, operation: Callable[[], Any]) -> Any:
        try:
            return operation()
        except ControlLedgerAuditError:
            raise
        except Exception as exc:
            raise ControlLedgerAuditError(
                f"Control ledger audit failed during {description}: {exc}"
            ) from exc


# ---------------------------------------------------------------------------
# Private helpers (moved from core_v2_runtime.py)
# ---------------------------------------------------------------------------

def _read_required_session_id(run_dir: Path, node_id: str) -> str:
    import json as _json
    path = run_dir / "nodes" / node_id / "session_instance_manifest.json"
    if not path.exists():
        raise ControlLedgerAuditError(f"Session manifest missing for node {node_id}")
    manifest = _json.loads(path.read_text(encoding="utf-8"))
    session_id = manifest.get("session_id") if isinstance(manifest, dict) else None
    if not isinstance(session_id, str) or not session_id:
        raise ControlLedgerAuditError(f"Session id missing for node {node_id}")
    return session_id


def _read_required_artifact_bundle_id(run_dir: Path, node_id: str) -> str:
    import json as _json
    path = run_dir / "nodes" / node_id / "artifact_bundle.json"
    if not path.exists():
        raise ControlLedgerAuditError(f"Artifact bundle missing for node {node_id}")
    bundle = _json.loads(path.read_text(encoding="utf-8"))
    bundle_id = bundle.get("bundle_id") if isinstance(bundle, dict) else None
    if not isinstance(bundle_id, str) or not bundle_id:
        raise ControlLedgerAuditError(f"Artifact bundle id missing for node {node_id}")
    return bundle_id
