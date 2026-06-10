"""Supervisor coordination layer (REQ-A2/A3/B2)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from acc.app.capabilities import default_adapter_capabilities
from acc.app.invocation import CallableInvocationService
from acc.callable_registry import CallableRegistry
from acc.models import (
    CORE_V2_SCHEMA_VERSION,
    AccError,
    AgentClassTemplate,
    CallableRef,
    ControlPolicy,
    DynamicInvocationIntent,
    DynamicInvocationProposal,
    EnvironmentFrame,
    NodeInvocationSpec,
    PlanStepTransitionRecord,
    RosterEntry,
    RunPlan,
    SupervisorDecision,
    SupervisorPlan,
    SupervisorRoster,
)
from acc.serialization import control_ledger_to_dict
from acc.engine.supervisor import (
    compile_supervisor_plan_to_steps,
    parse_dynamic_invocation_intent,
    parse_supervisor_plan,
    supervisor_decision_payload,
    supervisor_plan_payload,
    validate_intent_against_roster,
    validate_supervisor_plan,
)
from acc.session import utc_now_iso
from acc.store import load_json, write_json
from acc.store.control_ledger import (
    append_control_event,
    append_decision_record,
    append_plan_step_transition,
    load_decisions,
    load_plan_steps,
    load_run_plan,
    next_plan_step_transition_sequence,
)

SUPERVISOR_PROTOCOL_VERSION = "1.0.0"
DEFAULT_REPEAT_LIMIT = 3
DEFAULT_MAX_DEPTH = 4


def build_supervisor_roster(callable_registry: CallableRegistry) -> SupervisorRoster:
    entries: list[RosterEntry] = []
    for asset in callable_registry.iter_assets():
        template = asset.template
        if not isinstance(template, AgentClassTemplate):
            continue
        entries.append(
            RosterEntry(
                callable_ref=CallableRef(
                    kind="agent_class",
                    id=template.id,
                    version=template.version,
                ),
                title=str(template.metadata.get("name") or template.id),
                capabilities=default_adapter_capabilities(template.runtime),
                input_ports=template.input_ports,
                output_ports=template.output_ports,
            )
        )
    return SupervisorRoster(entries=tuple(entries), generated_at=utc_now_iso())


def roster_prompt_json(roster: SupervisorRoster) -> str:
    payload = [
        {
            "callable_ref": {
                "kind": entry.callable_ref.kind,
                "id": entry.callable_ref.id,
                "version": entry.callable_ref.version,
            },
            "title": entry.title,
            "capabilities": entry.capabilities.as_dict(),
        }
        for entry in roster.entries
    ]
    return json.dumps(payload, ensure_ascii=False, indent=2)


def render_supervisor_prompt(
    *,
    base_prompt: str,
    roster: SupervisorRoster,
    user_prompt: str | None = None,
) -> str:
    sections = [
        base_prompt.strip(),
        "",
        f"supervisor_protocol_version: {SUPERVISOR_PROTOCOL_VERSION}",
        "You coordinate registered agents only. Do not execute shell commands.",
        (
            "Do not write into downstream workspaces. "
            "Output JSON matching DynamicInvocationIntent or SupervisorPlan."
        ),
        "",
        "Roster:",
        roster_prompt_json(roster),
    ]
    if user_prompt:
        sections.extend(["", "Task:", user_prompt.strip()])
    return "\n".join(sections)


def _supervisor_state_path(run_dir: Path) -> Path:
    return run_dir / "supervisor_state.json"


def load_supervisor_state(run_dir: Path) -> dict[str, Any]:
    path = _supervisor_state_path(run_dir)
    if not path.exists():
        return {"call_graph": [], "correlation_ids": {}, "repeat_counts": {}}
    payload = load_json(path)
    return payload if isinstance(payload, dict) else {}


def save_supervisor_state(run_dir: Path, state: dict[str, Any]) -> None:
    write_json(_supervisor_state_path(run_dir), state)


def supervisor_plans_dir(run_dir: Path) -> Path:
    path = run_dir / "supervisor_plans"
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_supervisor_plan(run_dir: Path, plan: SupervisorPlan) -> Path:
    path = supervisor_plans_dir(run_dir) / f"{plan.plan_id}.json"
    write_json(path, supervisor_plan_payload(plan))
    return path


def load_supervisor_plan(run_dir: Path, plan_id: str) -> SupervisorPlan:
    path = supervisor_plans_dir(run_dir) / f"{plan_id}.json"
    return parse_supervisor_plan(load_json(path))


def materialize_supervisor_plan_steps(
    run_dir: Path,
    *,
    plan: SupervisorPlan,
    roster: SupervisorRoster,
    control_policy: ControlPolicy,
    run_plan: RunPlan,
) -> dict[str, Any]:
    existing_steps = load_plan_steps(run_dir).value
    compilation = compile_supervisor_plan_to_steps(
        plan,
        roster,
        control_policy,
        run_plan,
        existing_steps=existing_steps,
        timestamp=utc_now_iso(),
    )
    write_supervisor_plan(run_dir, plan)
    _write_supervisor_intent_snapshots(run_dir, plan)
    append_decision_record(run_dir, compilation.decision)
    append_control_event(
        run_dir,
        event_type="decision_recorded",
        run_id=run_plan.run_id,
        node_id=plan.supervisor_node_id,
        decision_id=compilation.decision.decision_id,
        payload={"kind": "supervisor_plan", "plan_id": plan.plan_id},
    )
    sequence = next_plan_step_transition_sequence(run_dir)
    for step in compilation.steps:
        append_plan_step_transition(
            run_dir,
            PlanStepTransitionRecord(
                sequence=sequence,
                recorded_at=step.created_at or utc_now_iso(),
                plan_step_id=step.plan_step_id,
                previous_status=None,
                next_status=step.status,
                snapshot=step,
                reason=f"approved SupervisorPlan {plan.plan_id}",
                decision_id=compilation.decision.decision_id,
            ),
        )
        sequence += 1
    return {
        "decision": control_ledger_to_dict(compilation.decision),
        "steps": [control_ledger_to_dict(step) for step in compilation.steps],
    }


def _write_supervisor_intent_snapshots(run_dir: Path, plan: SupervisorPlan) -> None:
    for intent in plan.intents:
        write_json(
            supervisor_plans_dir(run_dir)
            / plan.plan_id
            / "intents"
            / f"{intent.correlation_id}.json",
            {
                "correlation_id": intent.correlation_id,
                "target_callable_ref": {
                    "kind": intent.target_callable_ref.kind,
                    "id": intent.target_callable_ref.id,
                    "version": intent.target_callable_ref.version,
                },
                "input_payload": intent.input_payload,
                "rationale": intent.rationale,
                "node_id_suggestion": intent.node_id_suggestion,
            },
        )


def replay_supervisor_plan_from_recorded_decision(
    run_dir: Path,
    *,
    plan_id: str | None = None,
    decision_id: str | None = None,
) -> dict[str, Any]:
    run_plan = load_run_plan(run_dir).value
    if run_plan is None:
        raise AccError("Supervisor replay requires run_plan.json")
    _validate_replay_template_snapshot(run_dir, run_plan.workflow_function_id)
    decision = _find_supervisor_plan_decision(
        load_decisions(run_dir).value,
        plan_id=plan_id,
        decision_id=decision_id,
    )
    if decision.run_id != run_plan.run_id or decision.run_plan_id != run_plan.run_plan_id:
        raise AccError("Recorded supervisor decision is incompatible with run_plan.json")
    selected_step_ids = decision.selected.get("step_ids")
    selected_node_ids = decision.selected.get("node_ids")
    if not isinstance(selected_step_ids, list) or not all(
        isinstance(step_id, str) for step_id in selected_step_ids
    ):
        raise AccError("Recorded supervisor decision missing selected.step_ids")
    if not isinstance(selected_node_ids, list) or not all(
        isinstance(node_id, str) for node_id in selected_node_ids
    ):
        raise AccError("Recorded supervisor decision missing selected.node_ids")
    if len(selected_step_ids) != len(selected_node_ids):
        raise AccError("Recorded supervisor decision step/node selection is incompatible")
    steps_by_id = {step.plan_step_id: step for step in load_plan_steps(run_dir).value}
    replay_steps = []
    for step_id, node_id in zip(selected_step_ids, selected_node_ids, strict=False):
        step = steps_by_id.get(step_id)
        if step is None:
            raise AccError(f"Recorded supervisor PlanStep not found: {step_id}")
        if step.source != "supervisor" or step.node_id != node_id:
            raise AccError(f"Recorded supervisor PlanStep is incompatible: {step_id}")
        replay_steps.append(step)
    payload = {
        "mode": "reuse_recorded_decisions",
        "decision_id": decision.decision_id,
        "plan_id": decision.selected.get("plan_id"),
        "run_id": run_plan.run_id,
        "run_plan_id": run_plan.run_plan_id,
        "steps": [control_ledger_to_dict(step) for step in replay_steps],
    }
    write_json(run_dir / "supervisor_replay_manifest.json", payload)
    return payload


def _validate_replay_template_snapshot(run_dir: Path, workflow_function_id: str) -> None:
    run_plan = load_run_plan(run_dir).value
    if run_plan is None:
        raise AccError("Supervisor replay requires run_plan.json")
    snapshot_path = run_dir / run_plan.template_snapshot_ref
    if not snapshot_path.exists():
        raise AccError("Supervisor replay template snapshot is missing")
    payload = load_json(snapshot_path)
    if not isinstance(payload, dict):
        raise AccError("Supervisor replay template snapshot must be an object")
    if payload.get("schema_version") != CORE_V2_SCHEMA_VERSION:
        raise AccError("Supervisor replay template snapshot schema is incompatible")
    if payload.get("id") != workflow_function_id:
        raise AccError("Supervisor replay template snapshot workflow is incompatible")


def _find_supervisor_plan_decision(
    decisions: tuple[Any, ...],
    *,
    plan_id: str | None,
    decision_id: str | None,
):
    candidates = [decision for decision in decisions if decision.kind == "supervisor_plan"]
    if decision_id is not None:
        candidates = [decision for decision in candidates if decision.decision_id == decision_id]
    if plan_id is not None:
        candidates = [
            decision for decision in candidates if decision.selected.get("plan_id") == plan_id
        ]
    if not candidates:
        raise AccError("Recorded supervisor_plan decision not found")
    return candidates[-1]


class SupervisorRouter:
    def __init__(
        self,
        *,
        callable_registry: CallableRegistry,
        callable_service: CallableInvocationService,
        run_dir: Path,
        supervisor_node_id: str,
        repeat_limit: int = DEFAULT_REPEAT_LIMIT,
        max_depth: int = DEFAULT_MAX_DEPTH,
    ) -> None:
        self.callable_registry = callable_registry
        self.callable_service = callable_service
        self.run_dir = run_dir
        self.supervisor_node_id = supervisor_node_id
        self.repeat_limit = repeat_limit
        self.max_depth = max_depth
        self.roster = build_supervisor_roster(callable_registry)

    def validate_intent(self, intent: DynamicInvocationIntent) -> None:
        validate_intent_against_roster(intent, self.roster)

    def check_dispatch_policy(
        self, intent: DynamicInvocationIntent, *, force_retry: bool = False
    ) -> None:
        state = load_supervisor_state(self.run_dir)
        correlation_ids = state.get("correlation_ids")
        if (
            isinstance(correlation_ids, dict)
            and intent.correlation_id in correlation_ids
            and not force_retry
        ):
            return
        repeat_counts = state.get("repeat_counts")
        if not isinstance(repeat_counts, dict):
            repeat_counts = {}
        repeat_key = (
            f"{self.supervisor_node_id}:"
            f"{intent.target_callable_ref.kind}:"
            f"{intent.target_callable_ref.id}"
        )
        count = int(repeat_counts.get(repeat_key, 0)) + 1
        if count > self.repeat_limit and not force_retry:
            raise AccError(f"Supervisor repeat limit exceeded for {repeat_key}")
        call_graph = state.get("call_graph")
        if isinstance(call_graph, list) and len(call_graph) >= self.max_depth:
            raise AccError("Supervisor max dispatch depth exceeded")

    def record_dispatch(
        self,
        intent: DynamicInvocationIntent,
        *,
        session_id: str | None,
        rejected_reason: str | None = None,
    ) -> None:
        state = load_supervisor_state(self.run_dir)
        call_graph = state.setdefault("call_graph", [])
        if isinstance(call_graph, list):
            call_graph.append(
                {
                    "from": self.supervisor_node_id,
                    "to": intent.target_callable_ref.id,
                    "correlation_id": intent.correlation_id,
                    "rejected_reason": rejected_reason,
                }
            )
        if session_id:
            correlation_ids = state.setdefault("correlation_ids", {})
            if isinstance(correlation_ids, dict):
                correlation_ids[intent.correlation_id] = session_id
            repeat_key = (
                f"{self.supervisor_node_id}:"
                f"{intent.target_callable_ref.kind}:"
                f"{intent.target_callable_ref.id}"
            )
            repeat_counts = state.setdefault("repeat_counts", {})
            if isinstance(repeat_counts, dict):
                repeat_counts[repeat_key] = int(repeat_counts.get(repeat_key, 0)) + 1
        save_supervisor_state(self.run_dir, state)

    def existing_session_for_correlation(self, correlation_id: str) -> str | None:
        state = load_supervisor_state(self.run_dir)
        correlation_ids = state.get("correlation_ids")
        if isinstance(correlation_ids, dict):
            value = correlation_ids.get(correlation_id)
            return value if isinstance(value, str) else None
        return None

    async def invoke_from_intent(
        self,
        intent: DynamicInvocationIntent,
        *,
        node: NodeInvocationSpec,
        workflow_path: Path,
        node_dir: Path,
        frame: EnvironmentFrame,
        force_retry: bool = False,
    ) -> dict[str, Any]:
        existing = self.existing_session_for_correlation(intent.correlation_id)
        if existing and not force_retry:
            output_path = node_dir / "output.json"
            if output_path.exists():
                payload = load_json(output_path)
                return (
                    payload
                    if isinstance(payload, dict)
                    else {"status": "success", "summary": "idempotent replay"}
                )
        self.validate_intent(intent)
        self.check_dispatch_policy(intent, force_retry=force_retry)
        result = await self.callable_service.execute_node(
            node,
            workflow_path,
            self.run_dir,
            node_dir,
            frame,
        )
        self.record_dispatch(intent, session_id=node_dir.name)
        return result

    def emit_decision(
        self,
        store: Any,
        decision: SupervisorDecision,
    ) -> None:
        payload = supervisor_decision_payload(decision)
        store.write_node_event(
            self.supervisor_node_id,
            "supervisor_decision",
            status="recorded",
            payload=payload,
        )
        store.write_workflow_event(
            "supervisor_decision",
            status="recorded",
            node_id=self.supervisor_node_id,
            payload=payload,
        )


def parse_intent_from_llm_output(raw: dict[str, Any]) -> DynamicInvocationIntent:
    if "intents" in raw:
        plan = parse_supervisor_plan({**raw, "plan_id": raw.get("plan_id", uuid4().hex)})
        if not plan.intents:
            raise AccError("SupervisorPlan has no intents")
        return plan.intents[0]
    return parse_dynamic_invocation_intent(raw)


async def execute_supervisor_plan(
    router: SupervisorRouter,
    plan: SupervisorPlan,
    *,
    node_factory: Any,
    workflow_path: Path,
    frame: EnvironmentFrame,
    store: Any,
) -> dict[str, Any]:
    if plan.status not in {"approved", "executing"}:
        raise AccError(f"SupervisorPlan {plan.plan_id} is not approved")
    validate_supervisor_plan(plan, router.roster)
    results: list[dict[str, Any]] = []
    for index, intent in enumerate(plan.intents):
        node_id = intent.node_id_suggestion or f"{plan.supervisor_node_id}_worker_{index}"
        node = node_factory(node_id, intent)
        node_dir = router.run_dir / "nodes" / node_id
        node_dir.mkdir(parents=True, exist_ok=True)
        write_json(node_dir / "input.json", intent.input_payload)
        output = await router.invoke_from_intent(
            intent,
            node=node,
            workflow_path=workflow_path,
            node_dir=node_dir,
            frame=frame,
        )
        results.append(
            {"node_id": node_id, "correlation_id": intent.correlation_id, "output": output}
        )
    router.emit_decision(
        store,
        SupervisorDecision(
            decision="action",
            correlation_id=plan.plan_id,
            rationale=f"Executed plan with {len(plan.intents)} intents",
            supervisor_node_id=plan.supervisor_node_id,
            plan_id=plan.plan_id,
        ),
    )
    return {"plan_id": plan.plan_id, "status": "completed", "results": results}


def proposal_to_graphops_patch(
    proposal: DynamicInvocationProposal, *, target_path: str
) -> dict[str, Any]:
    operations: list[dict[str, Any]] = []
    if proposal.graph_patch and isinstance(proposal.graph_patch.get("operations"), list):
        operations = proposal.graph_patch["operations"]
    else:
        for intent in proposal.plan.intents:
            node_id = intent.node_id_suggestion or intent.correlation_id
            operations.append(
                {
                    "op": "add_node",
                    "node_id": node_id,
                    "callable_ref": {
                        "kind": intent.target_callable_ref.kind,
                        "id": intent.target_callable_ref.id,
                        "version": intent.target_callable_ref.version,
                    },
                }
            )
    return {
        "patch_id": proposal.proposal_id,
        "target_type": "workflow",
        "target_path": target_path,
        "author": "supervisor",
        "rationale": f"Supervisor proposal {proposal.proposal_id}",
        "operations": operations,
    }
