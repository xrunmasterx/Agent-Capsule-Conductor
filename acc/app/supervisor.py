"""Supervisor coordination layer (REQ-A2/A3/B2)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from acc.app.capabilities import default_adapter_capabilities
from acc.app.invocation import CallableInvocationService
from acc.callable_registry import CallableRegistry
from acc.domain import (
    AccError,
    AgentClassTemplate,
    CallableRef,
    DynamicInvocationIntent,
    DynamicInvocationProposal,
    EnvironmentFrame,
    NodeInvocationSpec,
    RosterEntry,
    SupervisorDecision,
    SupervisorPlan,
    SupervisorRoster,
)
from acc.engine.supervisor import (
    parse_dynamic_invocation_intent,
    parse_supervisor_plan,
    supervisor_decision_payload,
    supervisor_plan_payload,
    validate_intent_against_roster,
    validate_supervisor_plan,
)
from acc.session import utc_now_iso
from acc.store import load_json, write_json

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
