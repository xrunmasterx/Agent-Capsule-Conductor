from __future__ import annotations

import json
from pathlib import Path

import pytest

from acc.app.core_v2_loader import load_workflow_function_template
from acc.models import (
    CORE_V2_SCHEMA_VERSION,
    NodeInvocationSpec,
    WorkflowFunctionTemplate,
)
from acc.validation import validate_core_v2_workflow_function_template
from acc.engine import parse_workflow_function_template
from acc.models import AccError


def v2_payload() -> dict:
    return {
        "schema_version": CORE_V2_SCHEMA_VERSION,
        "id": "core_v2_loader_demo",
        "version": "1.0.0",
        "nodes": [
            {
                "id": "producer",
                "callable_ref": {"kind": "tool_class", "id": "producer.local"},
                "ports": {"outputs": {"main": {"type": "artifact"}}},
                "artifact_contract": {"required_paths": ["report.json"]},
            },
            {
                "id": "consumer",
                "callable_ref": {"kind": "agent_class", "id": "consumer.codex"},
                "ports": {"inputs": {"main": {"type": "artifact"}}},
                "input_bindings": [
                    {"source": {"node": "producer", "port": "main"}, "target_port": "main"}
                ],
            },
        ],
        "control_edges": [{"source": "producer", "target": "consumer"}],
        "data_edges": [
            {
                "source": {"node": "producer", "port": "main"},
                "target": {"node": "consumer", "port": "main"},
            }
        ],
        "metadata": {"label": "Core v2 loader demo"},
    }


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_parse_workflow_function_template_directly_builds_core_v2_model() -> None:
    template = parse_workflow_function_template(v2_payload())

    assert isinstance(template, WorkflowFunctionTemplate)
    assert isinstance(template.node_invocations["producer"], NodeInvocationSpec)
    assert template.node_invocations["producer"].callable_ref.kind == "tool_class"
    assert template.node_invocations["consumer"].input_bindings[0].source.node == "producer"


def test_parse_workflow_function_template_allows_noop_workflow() -> None:
    template = parse_workflow_function_template(
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "noop_workflow",
            "version": "1.0.0",
            "nodes": [],
            "control_edges": [],
            "data_edges": [],
            "exposed_inputs": {"main": {"direction": "input", "required": False}},
            "exposed_outputs": {"main": {"direction": "output", "required": False}},
        }
    )

    assert template.node_invocations == {}
    validate_core_v2_workflow_function_template(template)


def test_parse_workflow_function_template_reads_typed_node_control_policy() -> None:
    payload = v2_payload()
    payload["nodes"][1]["control"] = {
        "require_human_approval": True,
        "approval_prompt": "Approve consumer?",
        "forward_main_output_on_control": False,
    }
    payload["nodes"][1]["output_schema"] = {
        "type": "object",
        "properties": {"summary": {"type": "string"}},
        "required": ["summary"],
    }

    template = parse_workflow_function_template(payload)

    control = template.node_invocations["consumer"].control
    assert control.require_human_approval is True
    assert control.approval_prompt == "Approve consumer?"
    assert control.forward_main_output_on_control is False
    assert template.node_invocations["consumer"].output_schema["required"] == ["summary"]


def test_load_workflow_function_template_reads_accflow_json(tmp_path: Path) -> None:
    path = tmp_path / "demo.accflow.json"
    write_json(path, v2_payload())

    template = load_workflow_function_template(path)

    assert template.id == "core_v2_loader_demo"
    assert template.source_path == path


def test_parse_workflow_function_callable_ref_accepts_accflow_path() -> None:
    payload = v2_payload()
    payload["nodes"][0]["callable_ref"] = {
        "kind": "workflow_function",
        "id": "workflows/child.accflow.json",
    }

    template = parse_workflow_function_template(payload)

    assert template.node_invocations["producer"].callable_ref.id == "workflows/child.accflow.json"


def test_parse_agent_callable_ref_rejects_path_like_id() -> None:
    payload = v2_payload()
    payload["nodes"][0]["callable_ref"] = {
        "kind": "agent_class",
        "id": "callables/agent.codex",
    }

    with pytest.raises(AccError, match="callable_ref.id must match"):
        parse_workflow_function_template(payload)


@pytest.mark.parametrize(
    "field,value",
    [
        ("kind", "agent"),
        ("runtime", "codex"),
        ("tool", "fake"),
        ("workflow_ref", "child.accflow.json"),
        ("input_mapping", {}),
        ("legacy_value_edges", []),
        ("raw", {}),
    ],
)
def test_parse_workflow_function_template_rejects_legacy_node_fields(
    field: str,
    value: object,
) -> None:
    payload = v2_payload()
    payload["nodes"][0][field] = value

    with pytest.raises(AccError, match="unsupported field"):
        parse_workflow_function_template(payload)


def test_validate_workflow_function_template_rejects_runtime_metadata() -> None:
    payload = v2_payload()
    payload["metadata"] = {"run_dir": "runs/not-template-state"}

    template = parse_workflow_function_template(payload)
    with pytest.raises(AccError, match="executable metadata key"):
        validate_core_v2_workflow_function_template(template)
