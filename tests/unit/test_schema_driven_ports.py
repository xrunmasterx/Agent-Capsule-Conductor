from __future__ import annotations

from acc.engine.schema_ports import (
    effective_output_ports,
    project_output_port_metadata,
    schema_declares_output_port,
)
from acc.engine.workflow_validation import collect_callable_validation_issues
from acc.app.workbench_tasks import strip_canvas_runtime_state
from acc.models import (
    CallableRef,
    ControlEdge,
    DataEdge,
    DataEndpoint,
    NodeInvocationSpec,
    PortContract,
    WorkflowFunctionTemplate,
)
from acc.runtime.node_payload import output_port_ids


def _agent_node(
    *,
    output_schema: dict | None = None,
    output_ports: dict[str, PortContract] | None = None,
) -> NodeInvocationSpec:
    return NodeInvocationSpec(
        id="source",
        callable_ref=CallableRef(kind="agent_class", id="source.codex"),
        output_schema=output_schema,
        output_ports=output_ports or {},
    )


def _schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "outputs": {
                "type": "object",
                "required": ["report"],
                "properties": {
                    "report": {
                        "type": "string",
                        "title": "Report",
                        "description": "Final report text.",
                    },
                    "risk_table": {
                        "type": "array",
                        "items": {"type": "object"},
                    },
                },
            },
        },
    }


def test_workbench_canvas_strip_preserves_output_schema_status_property() -> None:
    canvas = {
        "status": "not_run",
        "workflows": [
            {
                "id": "source",
                "status": "success",
                "outputSchema": {
                    "type": "object",
                    "properties": {
                        "status": {"type": "string"},
                        "outputs": {
                            "type": "object",
                            "properties": {"report": {"type": "string"}},
                        },
                    },
                    "required": ["status", "outputs"],
                },
            }
        ],
    }

    stripped = strip_canvas_runtime_state(canvas)
    workflow = stripped["workflows"][0]

    assert "status" not in stripped
    assert "status" not in workflow
    assert workflow["outputSchema"]["properties"]["status"] == {"type": "string"}


def test_outputs_properties_project_to_main_and_named_ports() -> None:
    ports = project_output_port_metadata(_schema())

    assert list(ports) == ["main", "report", "risk_table"]
    assert ports["main"].json_path == "/"
    assert ports["report"].json_path == "/outputs/report"
    assert ports["risk_table"].json_path == "/outputs/risk_table"


def test_required_description_type_and_cardinality_are_projected() -> None:
    ports = project_output_port_metadata(_schema())

    report = ports["report"]
    risk_table = ports["risk_table"]

    assert report.required is True
    assert report.description == "Final report text."
    assert report.title == "Report"
    assert report.type == "string"
    assert report.schema_type == "string"
    assert report.cardinality == "one"
    assert risk_table.type == "array"
    assert risk_table.cardinality == "many"


def test_nested_object_and_array_project_only_first_level_ports() -> None:
    schema = {
        "type": "object",
        "properties": {
            "outputs": {
                "type": "object",
                "properties": {
                    "nested": {
                        "type": "object",
                        "properties": {"inner": {"type": "string"}},
                    },
                    "items": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
            }
        },
    }

    ports = project_output_port_metadata(schema)

    assert list(ports) == ["main", "nested", "items"]
    assert ports["nested"].json_path == "/outputs/nested"
    assert "/outputs/nested/inner" not in {port.json_path for port in ports.values()}


def test_complex_schema_keywords_do_not_crash_projection() -> None:
    schema = {
        "type": "object",
        "$defs": {"report": {"type": "string"}},
        "properties": {
            "outputs": {
                "type": "object",
                "additionalProperties": {"type": "string"},
                "properties": {
                    "report": {"$ref": "#/$defs/report"},
                    "decision": {"oneOf": [{"type": "string"}, {"type": "null"}]},
                },
            }
        },
    }

    ports = project_output_port_metadata(schema)

    assert {"main", "report", "decision"} == set(ports)
    assert ports["main"].diagnostic is not None
    assert ports["report"].diagnostic is not None
    assert ports["decision"].diagnostic is not None


def test_legacy_top_level_schema_is_declared_but_not_projected() -> None:
    schema = {
        "type": "object",
        "properties": {
            "legacy_report": {"type": "string"},
        },
    }

    ports = project_output_port_metadata(schema)

    assert list(ports) == ["main"]
    assert schema_declares_output_port(schema, "legacy_report") is True


def test_schema_projection_wins_over_stale_manual_output_ports() -> None:
    node = _agent_node(
        output_schema=_schema(),
        output_ports={
            "main": PortContract(id="main", direction="output"),
            "stale": PortContract(id="stale", direction="output"),
        },
    )

    ports = effective_output_ports(node)

    assert set(ports) == {"main", "report", "risk_table"}
    assert "stale" not in ports


def test_runtime_output_port_ids_include_schema_derived_ports() -> None:
    node = _agent_node(output_schema=_schema())

    assert output_port_ids(node) == ("main", "report", "risk_table")


def test_validation_accepts_data_edge_from_schema_derived_port() -> None:
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        node_invocations={
            "source": _agent_node(output_schema=_schema()),
            "target": NodeInvocationSpec(
                id="target",
                callable_ref=CallableRef(kind="agent_class", id="target.codex"),
                input_ports={
                    "report": PortContract(id="report", direction="input"),
                },
            ),
        },
        control_edges=[ControlEdge(source="source", target="target")],
        data_edges=[
            DataEdge(
                source=DataEndpoint(node="source", port="report"),
                target=DataEndpoint(node="target", port="report"),
            )
        ],
    )

    issues = collect_callable_validation_issues(template)

    assert not [
        issue
        for issue in issues
        if issue.code == "dangling_data_edge_source" and issue.port == "report"
    ]


def test_validation_rejects_stale_edge_after_schema_port_rename() -> None:
    renamed_schema = {
        "type": "object",
        "properties": {
            "outputs": {
                "type": "object",
                "properties": {
                    "valuation_view": {"type": "string"},
                },
            }
        },
    }
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        node_invocations={
            "source": _agent_node(output_schema=renamed_schema),
            "target": NodeInvocationSpec(
                id="target",
                callable_ref=CallableRef(kind="agent_class", id="target.codex"),
                input_ports={
                    "valuation_conclusion": PortContract(
                        id="valuation_conclusion",
                        direction="input",
                    ),
                },
            ),
        },
        control_edges=[ControlEdge(source="source", target="target")],
        data_edges=[
            DataEdge(
                source=DataEndpoint(node="source", port="valuation_conclusion"),
                target=DataEndpoint(node="target", port="valuation_conclusion"),
            )
        ],
    )

    issues = collect_callable_validation_issues(template)

    assert any(
        issue.code == "dangling_data_edge_source"
        and issue.node_id == "source"
        and issue.port == "valuation_conclusion"
        for issue in issues
    )


def test_broken_schema_source_port_reports_edge_metadata() -> None:
    renamed_schema = {
        "type": "object",
        "properties": {
            "outputs": {
                "type": "object",
                "properties": {
                    "valuation_view": {"type": "string"},
                },
            }
        },
    }
    template = WorkflowFunctionTemplate(
        id="flow",
        version="0.1.0",
        node_invocations={
            "source": _agent_node(output_schema=renamed_schema),
            "target": NodeInvocationSpec(
                id="target",
                callable_ref=CallableRef(kind="agent_class", id="target.codex"),
                input_ports={
                    "valuation_conclusion": PortContract(
                        id="valuation_conclusion",
                        direction="input",
                    ),
                },
            ),
        },
        control_edges=[ControlEdge(source="source", target="target")],
        data_edges=[
            DataEdge(
                source=DataEndpoint(node="source", port="valuation_conclusion"),
                target=DataEndpoint(node="target", port="valuation_conclusion"),
            )
        ],
    )

    issue = next(
        issue
        for issue in collect_callable_validation_issues(template)
        if issue.code == "dangling_data_edge_source"
    )

    assert issue.metadata == {
        "edge_id": "source.valuation_conclusion->target.valuation_conclusion",
        "source": {"node": "source", "port": "valuation_conclusion"},
        "target": {"node": "target", "port": "valuation_conclusion"},
        "expected_schema_path": "/properties/outputs/properties/valuation_conclusion",
    }
    assert issue.as_dict()["metadata"] == issue.metadata
