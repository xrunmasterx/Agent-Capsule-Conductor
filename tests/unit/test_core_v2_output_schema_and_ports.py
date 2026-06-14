from __future__ import annotations

from acc.callable_runner import (
    codex_sandbox_for_permissions,
    effective_permission_profile,
    hermetic_stub_output,
    normalize_output_schema_for_structured_output,
    output_schema_for_agent,
    render_agent_prompt,
    structured_output_schema_errors,
    validate_output_schema,
)
from acc.engine.workflow_validation import collect_callable_validation_issues
from acc.models import (
    AgentClassTemplate,
    CallableRef,
    ControlEdge,
    DataEdge,
    DataEndpoint,
    NodeControlPolicy,
    NodeInvocationSpec,
    PortContract,
    WorkflowCallOutputBinding,
    WorkflowFunctionTemplate,
    WorkflowInputBinding,
    WorkflowOutputBinding,
)
from acc.runtime.node_payload import MISSING_PORT_VALUE, output_value_for_port


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

    assert output_schema_for_agent(template, node) == {
        **node_schema,
        "additionalProperties": False,
    }


def test_output_schema_for_agent_normalizes_none_schema_keywords() -> None:
    node_schema = {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "ok", "items": None},
            "artifacts": {"type": "array", "items": {"type": "string"}},
            "nullable_enum": {"enum": ["ok", None]},
        },
        "required": ["summary"],
    }
    template = AgentClassTemplate(
        id="worker.codex",
        version="0.1.0",
        runtime="codex_cli",
    )
    node = NodeInvocationSpec(
        id="worker",
        callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
        output_schema=node_schema,
    )

    schema = output_schema_for_agent(template, node)

    assert "items" not in schema["properties"]["summary"]
    assert schema["properties"]["artifacts"]["items"] == {"type": "string"}
    assert schema["properties"]["nullable_enum"]["enum"] == ["ok", None]
    assert schema["additionalProperties"] is False


def test_structured_output_schema_errors_reports_unfixable_schema() -> None:
    schema = {
        "type": "object",
        "properties": {"summary": {"type": "array", "items": "bad"}},
    }

    errors = structured_output_schema_errors(
        normalize_output_schema_for_structured_output(schema)
    )

    assert errors
    assert errors[0]["code"] == "output_schema_invalid"


def test_render_agent_prompt_includes_output_schema_contract() -> None:
    template = AgentClassTemplate(
        id="worker.codex",
        version="0.1.0",
        runtime="codex_cli",
    )
    node = NodeInvocationSpec(
        id="worker",
        callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
        output_schema={
            "type": "object",
            "additionalProperties": False,
            "properties": {"ticker": {"type": "string"}},
            "required": ["ticker"],
        },
    )

    prompt = render_agent_prompt(template, node, {"main": "question"})

    assert "Do not include properties that are not declared in this schema." in prompt
    assert '"ticker"' in prompt
    assert '"additionalProperties": false' in prompt


def test_codex_local_readonly_no_sandbox_mode_uses_dangerous_bypass_with_prompt_guard() -> None:
    template = AgentClassTemplate(
        id="worker.codex",
        version="0.1.0",
        runtime="codex_cli",
        default_prompt="Read the local codebase and answer with evidence.",
    )
    node = NodeInvocationSpec(
        id="worker",
        callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
        metadata={"codex_execution_mode": "local_readonly_no_sandbox"},
    )

    permissions = effective_permission_profile(template, node)
    prompt = render_agent_prompt(template, node, {"main": "question"})

    assert permissions.dangerous is True
    assert permissions.workspace_access == "read_only"
    assert permissions.shell is True
    assert permissions.network is False
    assert codex_sandbox_for_permissions(permissions) == "danger-full-access"
    assert "Local Read-Only No-Sandbox Contract" in prompt
    assert "Do not create, edit, delete, move" in prompt


def test_codex_danger_full_access_mode_does_not_add_readonly_prompt_guard() -> None:
    template = AgentClassTemplate(
        id="worker.codex",
        version="0.1.0",
        runtime="codex_cli",
        default_prompt="Modify the workspace if needed.",
    )
    node = NodeInvocationSpec(
        id="worker",
        callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
        metadata={"codex_execution_mode": "danger_full_access"},
    )

    permissions = effective_permission_profile(template, node)
    prompt = render_agent_prompt(template, node, {"main": "question"})

    assert permissions.dangerous is True
    assert permissions.workspace_access == "writes_workspace"
    assert permissions.shell is True
    assert permissions.network is True
    assert codex_sandbox_for_permissions(permissions) == "danger-full-access"
    assert "Local Read-Only No-Sandbox Contract" not in prompt


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

    assert output_schema_for_agent(template, node) == {
        **template_schema,
        "additionalProperties": False,
    }


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


def test_hermetic_stub_output_materializes_schema_outputs_container() -> None:
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "status": {"type": "string", "enum": ["success", "partial", "failed"]},
            "summary": {"type": "string"},
            "outputs": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "alpha_signal": {"type": "string"},
                    "risk_score": {"type": "number"},
                    "watchlist": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["alpha_signal"],
            },
        },
        "required": ["status", "summary", "outputs"],
    }
    template = AgentClassTemplate(id="worker.codex", version="0.1.0", runtime="codex_cli")
    node = NodeInvocationSpec(
        id="worker",
        callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
        output_schema=schema,
    )

    output = hermetic_stub_output(template, node, {"ticker": "NVDA"})
    validate_output_schema(output, output_schema_for_agent(template, node))

    assert output["status"] == "success"
    assert output["outputs"]["alpha_signal"] == "hermetic:worker:alpha_signal"
    assert output["outputs"]["risk_score"] == 0
    assert output["outputs"]["watchlist"] == []


def test_hermetic_stub_output_respects_strict_schema_without_default_fields() -> None:
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "outputs": {
                "type": "object",
                "additionalProperties": False,
                "properties": {"verdict": {"type": "string"}},
                "required": ["verdict"],
            },
        },
        "required": ["outputs"],
    }
    template = AgentClassTemplate(id="worker.codex", version="0.1.0", runtime="codex_cli")
    node = NodeInvocationSpec(
        id="worker",
        callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
        output_schema=schema,
    )

    output = hermetic_stub_output(template, node, {"topic": "schema ports"})
    validate_output_schema(output, output_schema_for_agent(template, node))

    assert output == {"outputs": {"verdict": "hermetic:worker:verdict"}}


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
                input_ports={"main": PortContract(id="main", direction="input", required=True)},
            ),
            "right": NodeInvocationSpec(
                id="right",
                callable_ref=CallableRef(kind="agent_class", id="right.codex"),
                input_ports={"main": PortContract(id="main", direction="input", required=True)},
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
    assert not [issue for issue in issues if issue.code == "unbound_input_port"]


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


def test_control_main_does_not_satisfy_required_main_when_same_pair_has_data_edge() -> None:
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        node_invocations={
            "source": NodeInvocationSpec(
                id="source",
                callable_ref=CallableRef(kind="agent_class", id="source.codex"),
                output_ports={
                    "main": PortContract(id="main", direction="output"),
                    "detail": PortContract(id="detail", direction="output"),
                },
            ),
            "target": NodeInvocationSpec(
                id="target",
                callable_ref=CallableRef(kind="agent_class", id="target.codex"),
                input_ports={
                    "main": PortContract(id="main", direction="input", required=True),
                    "detail": PortContract(id="detail", direction="input", required=True),
                },
            ),
        },
        control_edges=[ControlEdge(source="source", target="target")],
        data_edges=[
            DataEdge(
                source=DataEndpoint(node="source", port="detail"),
                target=DataEndpoint(node="target", port="detail"),
            )
        ],
    )

    issues = collect_callable_validation_issues(template)

    assert any(
        issue.code == "unbound_input_port" and issue.node_id == "target" and issue.port == "main"
        for issue in issues
    )
    assert not [
        issue
        for issue in issues
        if issue.code == "unbound_input_port" and issue.node_id == "target" and issue.port == "detail"
    ]
    assert any(
        issue.code == "control_main_suppressed_by_data_edge"
        and issue.severity == "warning"
        and issue.node_id == "source"
        for issue in issues
    )


def test_same_source_data_edge_does_not_disable_other_control_only_target() -> None:
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        node_invocations={
            "source": NodeInvocationSpec(
                id="source",
                callable_ref=CallableRef(kind="agent_class", id="source.codex"),
                output_ports={
                    "main": PortContract(id="main", direction="output"),
                    "detail": PortContract(id="detail", direction="output"),
                },
            ),
            "data_target": NodeInvocationSpec(
                id="data_target",
                callable_ref=CallableRef(kind="agent_class", id="target.codex"),
                input_ports={"detail": PortContract(id="detail", direction="input", required=True)},
            ),
            "control_target": NodeInvocationSpec(
                id="control_target",
                callable_ref=CallableRef(kind="agent_class", id="target.codex"),
                input_ports={"main": PortContract(id="main", direction="input", required=True)},
            ),
        },
        control_edges=[
            ControlEdge(source="source", target="data_target"),
            ControlEdge(source="source", target="control_target"),
        ],
        data_edges=[
            DataEdge(
                source=DataEndpoint(node="source", port="detail"),
                target=DataEndpoint(node="data_target", port="detail"),
            )
        ],
    )

    issues = collect_callable_validation_issues(template)

    assert not [
        issue
        for issue in issues
        if issue.code == "unbound_input_port" and issue.node_id == "control_target"
    ]


def test_workflow_function_control_main_requires_required_parent_main_output() -> None:
    without_main = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        node_invocations={
            "child": NodeInvocationSpec(
                id="child",
                callable_ref=CallableRef(kind="workflow_function", id="child_flow"),
                workflow_call_output_bindings=[
                    WorkflowCallOutputBinding(workflow_output="report", parent_port="report")
                ],
            ),
            "target": NodeInvocationSpec(
                id="target",
                callable_ref=CallableRef(kind="agent_class", id="target.codex"),
                input_ports={"main": PortContract(id="main", direction="input", required=True)},
            ),
        },
        control_edges=[ControlEdge(source="child", target="target")],
        data_edges=[],
    )
    with_main = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        node_invocations={
            **without_main.node_invocations,
            "child": NodeInvocationSpec(
                id="child",
                callable_ref=CallableRef(kind="workflow_function", id="child_flow"),
                workflow_call_output_bindings=[
                    WorkflowCallOutputBinding(workflow_output="main", parent_port="main")
                ],
            ),
        },
        control_edges=without_main.control_edges,
        data_edges=[],
    )

    without_main_issues = collect_callable_validation_issues(without_main)
    with_main_issues = collect_callable_validation_issues(with_main)

    assert any(
        issue.code == "unbound_input_port" and issue.node_id == "target" and issue.port == "main"
        for issue in without_main_issues
    )
    assert not [
        issue
        for issue in with_main_issues
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


def test_multiple_control_main_sources_can_satisfy_required_main() -> None:
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
                input_ports={"main": PortContract(id="main", direction="input", required=True)},
            ),
        },
        control_edges=[
            ControlEdge(source="left", target="target"),
            ControlEdge(source="right", target="target"),
        ],
        data_edges=[],
    )

    issues = collect_callable_validation_issues(template)

    assert not [
        issue
        for issue in issues
        if issue.code in {"ambiguous_control_main_input", "unbound_input_port"}
        and issue.node_id == "target"
    ]


def test_disabled_control_main_sources_do_not_satisfy_required_main() -> None:
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        node_invocations={
            "left": NodeInvocationSpec(
                id="left",
                callable_ref=CallableRef(kind="agent_class", id="left.codex"),
                output_ports={"main": PortContract(id="main", direction="output")},
                control=NodeControlPolicy(forward_main_output_on_control=False),
            ),
            "right": NodeInvocationSpec(
                id="right",
                callable_ref=CallableRef(kind="agent_class", id="right.codex"),
                output_ports={"main": PortContract(id="main", direction="output")},
                control=NodeControlPolicy(forward_main_output_on_control=False),
            ),
            "target": NodeInvocationSpec(
                id="target",
                callable_ref=CallableRef(kind="agent_class", id="target.codex"),
                input_ports={"main": PortContract(id="main", direction="input", required=True)},
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
        issue.code == "unbound_input_port" and issue.node_id == "target" and issue.port == "main"
        for issue in issues
    )
