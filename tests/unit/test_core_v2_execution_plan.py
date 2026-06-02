from __future__ import annotations

import pytest

from acc.domain import CORE_V2_SCHEMA_VERSION
from acc.engine import compile_execution_plan, parse_workflow_function_template
from acc.utils import AccError


def plan_payload() -> dict:
    return {
        "schema_version": CORE_V2_SCHEMA_VERSION,
        "id": "plan_demo",
        "version": "1.0.0",
        "nodes": [
            {"id": "a", "callable_ref": {"kind": "tool_class", "id": "a.local"}},
            {"id": "b", "callable_ref": {"kind": "tool_class", "id": "b.local"}},
            {"id": "c", "callable_ref": {"kind": "agent_class", "id": "c.codex"}},
        ],
        "control_edges": [
            {"source": "a", "target": "c"},
            {"source": "b", "target": "c"},
        ],
        "data_edges": [],
    }


def test_compile_execution_plan_builds_levels_and_dependencies() -> None:
    template = parse_workflow_function_template(plan_payload())

    plan = compile_execution_plan(template, workflow_input={"topic": "chips"})

    assert plan.schema_version == CORE_V2_SCHEMA_VERSION
    assert plan.workflow_function_id == "plan_demo"
    assert plan.levels == (("a", "b"), ("c",))
    by_id = {node.node_id: node for node in plan.nodes}
    assert by_id["c"].depends_on == ("a", "b")
    assert by_id["c"].invocation.callable_ref.kind == "agent_class"


def test_compile_execution_plan_rejects_cycles() -> None:
    payload = plan_payload()
    payload["control_edges"] = [
        {"source": "a", "target": "b"},
        {"source": "b", "target": "a"},
    ]
    template = parse_workflow_function_template(payload)

    with pytest.raises(AccError, match="cycle"):
        compile_execution_plan(template)


def test_parse_workflow_function_template_rejects_data_carrying_control_edges() -> None:
    payload = plan_payload()
    payload["control_edges"] = [
        {"source": "a", "target": "c", "context": "upstream_output"}
    ]

    with pytest.raises(AccError, match="must not carry data context"):
        parse_workflow_function_template(payload)

