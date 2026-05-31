from __future__ import annotations

import pytest

from acc.domain import (
    AccError,
    AgentCapabilities,
    CallableRef,
    DynamicInvocationIntent,
    SupervisorRoster,
)
from acc.engine.supervisor import (
    expand_data_driven_instances,
    parse_dynamic_invocation_intent,
    parse_supervisor_decision,
    parse_supervisor_plan,
    validate_intent_against_roster,
)


def _roster(*ids: str) -> SupervisorRoster:
    from acc.domain import RosterEntry
    from acc.session import utc_now_iso

    return SupervisorRoster(
        entries=tuple(
            RosterEntry(
                callable_ref=CallableRef(kind="agent_class", id=ref_id),
                title=ref_id,
                capabilities=AgentCapabilities(),
                input_ports={},
                output_ports={},
            )
            for ref_id in ids
        ),
        generated_at=utc_now_iso(),
    )


def test_parse_dynamic_invocation_intent() -> None:
    intent = parse_dynamic_invocation_intent(
        {
            "target_callable_ref": {"kind": "agent_class", "id": "worker"},
            "input_payload": {"message": "hi"},
            "rationale": "need worker",
            "correlation_id": "cid-1",
        }
    )
    assert intent.target_callable_ref.id == "worker"


def test_validate_intent_against_roster_rejects_unknown() -> None:
    intent = DynamicInvocationIntent(
        target_callable_ref=CallableRef(kind="agent_class", id="missing"),
        input_payload={},
        rationale="x",
        correlation_id="cid",
    )
    with pytest.raises(AccError, match="not in supervisor roster"):
        validate_intent_against_roster(intent, _roster("worker"))


def test_parse_supervisor_plan_and_decision() -> None:
    plan = parse_supervisor_plan(
        {
            "plan_id": "plan1",
            "supervisor_node_id": "sup",
            "created_at": "2026-05-29T00:00:00Z",
            "status": "proposed",
            "intents": [
                {
                    "target_callable_ref": {"kind": "agent_class", "id": "worker"},
                    "input_payload": {},
                    "rationale": "go",
                    "correlation_id": "c1",
                }
            ],
        }
    )
    assert len(plan.intents) == 1
    decision = parse_supervisor_decision(
        {
            "decision": "no_action",
            "correlation_id": "c1",
            "rationale": "wait",
            "supervisor_node_id": "sup",
        }
    )
    assert decision.decision == "no_action"


def test_expand_data_driven_instances() -> None:
    ids = expand_data_driven_instances("worker", 3)
    assert ids == ["worker__0", "worker__1", "worker__2"]
