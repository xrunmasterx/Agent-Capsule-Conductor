from __future__ import annotations

from acc.app.core_v2_runtime import MISSING_PORT_VALUE, output_value_for_port
from acc.callable_runner import output_schema_for_agent
from acc.domain import (
    AgentClassTemplate,
    CallableRef,
    ControlEdge,
    DataEdge,
    DataEndpoint,
    NodeInvocationSpec,
    PortContract,
    WorkflowCallOutputBinding,
    WorkflowFunctionTemplate,
    WorkflowInputBinding,
    WorkflowOutputBinding,
)
from acc.engine.workflow_validation import collect_callable_validation_issues


def test_node_output_schema_overrides_template_output_schema() -> None:
    template_schema = {
        "type": "object",
        "properties": {"template": {"type": "string"}},
        "required": ["template"],
    }
    node_schema = {
        "type": "object",
        "properties": {"node": {"type": "string"}},
        "required": ["node"],
    }
    template = AgentClassTemplate(
        id="worker.codex",
        version="0.1.0",
        runtime="codex_cli",
        artifact_contract={"output_schema": template_schema},
    )
    node = NodeInvocationSpec(
        id="worker",
        callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
        output_schema=node_schema,
    )

    assert output_schema_for_agent(template, node) == node_schema


def test_template_output_schema_is_fallback_when_node_has_no_override() -> None:
    template_schema = {
        "type": "object",
        "properties": {"template": {"type": "string"}},
        "required": ["template"],
    }
    template = AgentClassTemplate(
        id="worker.codex",
        version="0.1.0",
        runtime="codex_cli",
        artifact_contract={"output_schema": template_schema},
    )
    node = NodeInvocationSpec(
        id="worker",
        callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
    )

    assert output_schema_for_agent(template, node) == template_schema


def test_output_value_for_port_prefers_outputs_container_over_legacy_top_level() -> None:
    output = {
        "outputs": {"risk_table": [{"risk": "structured"}]},
        "risk_table": [{"risk": "legacy"}],
    }

    assert output_value_for_port(output, "risk_table") == [{"risk": "structured"}]


def test_output_value_for_port_falls_back_to_legacy_top_level_field() -> None:
    output = {"risk_table": None}

    assert output_value_for_port(output, "risk_table") is None


def test_output_value_for_port_returns_missing_sentinel_for_absent_non_main_port() -> None:
    assert output_value_for_port({"outputs": {}}, "risk_table") is MISSING_PORT_VALUE


def test_agent_non_main_output_port_must_be_declared_by_output_schema() -> None:
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        node_invocations={
            "worker": NodeInvocationSpec(
                id="worker",
                callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
                output_ports={
                    "main": PortContract(id="main", direction="output"),
                    "risk_table": PortContract(id="risk_table", direction="output"),
                },
                output_schema={
                    "type": "object",
                    "properties": {
                        "outputs": {
                            "type": "object",
                            "properties": {},
                        }
                    },
                },
            )
        },
        control_edges=[],
        data_edges=[],
    )

    issues = collect_callable_validation_issues(template)

    assert any(
        issue.code == "output_port_schema_missing"
        and issue.node_id == "worker"
        and issue.port == "risk_table"
        for issue in issues
    )


def test_agent_non_main_output_port_accepts_outputs_container_schema() -> None:
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        node_invocations={
            "worker": NodeInvocationSpec(
                id="worker",
                callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
                output_ports={
                    "main": PortContract(id="main", direction="output"),
                    "risk_table": PortContract(id="risk_table", direction="output"),
                },
                output_schema={
                    "type": "object",
                    "properties": {
                        "outputs": {
                            "type": "object",
                            "properties": {"risk_table": {"type": "array"}},
                        }
                    },
                },
            )
        },
        control_edges=[],
        data_edges=[],
    )

    issues = collect_callable_validation_issues(template)

    assert not [issue for issue in issues if issue.code == "output_port_schema_missing"]


def test_workflow_input_main_can_fan_out_to_multiple_nodes() -> None:
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        exposed_inputs={"main": PortContract(id="main", direction="input")},
        node_invocations={
            "left": NodeInvocationSpec(
                id="left",
                callable_ref=CallableRef(kind="agent_class", id="left.codex"),
                input_ports={"main": PortContract(id="main", direction="input")},
            ),
            "right": NodeInvocationSpec(
                id="right",
                callable_ref=CallableRef(kind="agent_class", id="right.codex"),
                input_ports={"main": PortContract(id="main", direction="input")},
            ),
        },
        control_edges=[],
        data_edges=[],
        workflow_input_bindings=[
            WorkflowInputBinding(
                source_port="main",
                target=DataEndpoint(node="left", port="main"),
            ),
            WorkflowInputBinding(
                source_port="main",
                target=DataEndpoint(node="right", port="main"),
            ),
        ],
    )

    issues = collect_callable_validation_issues(template)

    assert not [issue for issue in issues if issue.code == "unbound_workflow_input"]


def test_workflow_exposed_output_without_binding_is_allowed() -> None:
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        exposed_outputs={"main": PortContract(id="main", direction="output")},
        node_invocations={
            "worker": NodeInvocationSpec(
                id="worker",
                callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
                output_ports={"main": PortContract(id="main", direction="output")},
            )
        },
        control_edges=[],
        data_edges=[],
    )

    issues = collect_callable_validation_issues(template)

    assert not [
        issue
        for issue in issues
        if issue.code == "unbound_workflow_output" and issue.port == "main"
    ]


def test_optional_workflow_call_output_does_not_satisfy_required_downstream_main() -> None:
    template = WorkflowFunctionTemplate(
        id="root",
        version="0.1.0",
        node_invocations={
            "child": NodeInvocationSpec(
                id="child",
                callable_ref=CallableRef(kind="workflow_function", id="child.accflow.json"),
                output_ports={"main": PortContract(id="main", direction="output")},
                workflow_call_output_bindings=[
                    WorkflowCallOutputBinding(
                        workflow_output="main",
                        parent_port="main",
                        required=False,
                    )
                ],
            ),
            "downstream": NodeInvocationSpec(
                id="downstream",
                callable_ref=CallableRef(kind="agent_class", id="downstream.codex"),
                input_ports={
                    "main": PortContract(id="main", direction="input", required=True)
                },
                output_ports={"main": PortContract(id="main", direction="output")},
            ),
        },
        control_edges=[ControlEdge(source="child", target="downstream")],
        data_edges=[],
    )

    issues = collect_callable_validation_issues(template)

    assert any(
        issue.code == "unbound_input_port"
        and issue.node_id == "downstream"
        and issue.port == "main"
        for issue in issues
    )


def test_workflow_output_binding_source_port_must_exist() -> None:
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        exposed_outputs={"main": PortContract(id="main", direction="output")},
        node_invocations={
            "worker": NodeInvocationSpec(
                id="worker",
                callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
                output_ports={"main": PortContract(id="main", direction="output")},
            )
        },
        control_edges=[],
        data_edges=[],
        workflow_output_bindings=[
            WorkflowOutputBinding(
                source=DataEndpoint(node="worker", port="missing"),
                target_port="main",
            )
        ],
    )

    issues = collect_callable_validation_issues(template)

    assert any(
        issue.code == "unbound_workflow_output"
        and issue.node_id == "worker"
        and issue.port == "missing"
        for issue in issues
    )


def test_workflow_output_port_allows_multiple_source_nodes() -> None:
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        exposed_outputs={"main": PortContract(id="main", direction="output")},
        node_invocations={
            "left": NodeInvocationSpec(
                id="left",
                callable_ref=CallableRef(kind="agent_class", id="left.codex"),
                output_ports={"main": PortContract(id="main", direction="output")},
            ),
            "right": NodeInvocationSpec(
                id="right",
                callable_ref=CallableRef(kind="agent_class", id="right.codex"),
                output_ports={"main": PortContract(id="main", direction="output")},
            ),
        },
        control_edges=[],
        data_edges=[],
        workflow_output_bindings=[
            WorkflowOutputBinding(
                source=DataEndpoint(node="left", port="main"),
                target_port="main",
            ),
            WorkflowOutputBinding(
                source=DataEndpoint(node="right", port="main"),
                target_port="main",
            ),
        ],
    )

    issues = collect_callable_validation_issues(template)

    assert not [
        issue
        for issue in issues
        if issue.code
        in {"unbound_workflow_output", "duplicate_workflow_output_source"}
    ]


def test_workflow_output_port_rejects_duplicate_source_node() -> None:
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        exposed_outputs={"main": PortContract(id="main", direction="output")},
        node_invocations={
            "worker": NodeInvocationSpec(
                id="worker",
                callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
                output_ports={
                    "main": PortContract(id="main", direction="output"),
                    "report": PortContract(id="report", direction="output"),
                },
            )
        },
        control_edges=[],
        data_edges=[],
        workflow_output_bindings=[
            WorkflowOutputBinding(
                source=DataEndpoint(node="worker", port="main"),
                target_port="main",
            ),
            WorkflowOutputBinding(
                source=DataEndpoint(node="worker", port="report"),
                target_port="main",
            ),
        ],
    )

    issues = collect_callable_validation_issues(template)

    assert any(
        issue.code == "duplicate_workflow_output_source"
        and issue.node_id == "worker"
        and issue.port == "main"
        for issue in issues
    )


def test_required_main_input_can_be_satisfied_by_control_main_default() -> None:
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        node_invocations={
            "source": NodeInvocationSpec(
                id="source",
                callable_ref=CallableRef(kind="agent_class", id="source.codex"),
                output_ports={"main": PortContract(id="main", direction="output")},
            ),
            "target": NodeInvocationSpec(
                id="target",
                callable_ref=CallableRef(kind="agent_class", id="target.codex"),
                input_ports={
                    "main": PortContract(id="main", direction="input", required=True)
                },
            ),
        },
        control_edges=[ControlEdge(source="source", target="target")],
        data_edges=[],
    )

    issues = collect_callable_validation_issues(template)

    assert not [
        issue
        for issue in issues
        if issue.code == "unbound_input_port" and issue.node_id == "target"
    ]


def test_data_edge_source_output_port_must_exist() -> None:
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        node_invocations={
            "source": NodeInvocationSpec(
                id="source",
                callable_ref=CallableRef(kind="agent_class", id="source.codex"),
                output_ports={"main": PortContract(id="main", direction="output")},
            ),
            "target": NodeInvocationSpec(
                id="target",
                callable_ref=CallableRef(kind="agent_class", id="target.codex"),
                input_ports={"main": PortContract(id="main", direction="input")},
            ),
        },
        control_edges=[ControlEdge(source="source", target="target")],
        data_edges=[
            DataEdge(
                source=DataEndpoint(node="source", port="missing"),
                target=DataEndpoint(node="target", port="main"),
            )
        ],
    )

    issues = collect_callable_validation_issues(template)

    assert any(
        issue.code == "dangling_data_edge_source"
        and issue.node_id == "source"
        and issue.port == "missing"
        for issue in issues
    )


def test_multiple_control_main_sources_are_ambiguous_without_explicit_main_binding() -> None:
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        node_invocations={
            "left": NodeInvocationSpec(
                id="left",
                callable_ref=CallableRef(kind="agent_class", id="left.codex"),
                output_ports={"main": PortContract(id="main", direction="output")},
            ),
            "right": NodeInvocationSpec(
                id="right",
                callable_ref=CallableRef(kind="agent_class", id="right.codex"),
                output_ports={"main": PortContract(id="main", direction="output")},
            ),
            "target": NodeInvocationSpec(
                id="target",
                callable_ref=CallableRef(kind="agent_class", id="target.codex"),
                input_ports={"main": PortContract(id="main", direction="input")},
            ),
        },
        control_edges=[
            ControlEdge(source="left", target="target"),
            ControlEdge(source="right", target="target"),
        ],
        data_edges=[],
    )

    issues = collect_callable_validation_issues(template)

    assert any(
        issue.code == "ambiguous_control_main_input" and issue.node_id == "target"
        for issue in issues
    )
