from __future__ import annotations

import pytest

from acc.app.legacy_compat import (
    capsule_spec_to_callable_ref,
    capsule_spec_to_class_template,
)
from acc.domain import (
    AgentClassTemplate,
    ToolClassTemplate,
    WorkflowFunctionTemplate,
)
from acc.engine import (
    normalize_node_invocation_spec,
    normalize_workflow_function_template,
    parse_clean_workflow_template,
)
from acc.schemas import CapsuleSpec
from acc.utils import AccError


def capsule_payload(**updates):
    payload = {
        "id": "example.generic",
        "version": "0.1.0",
        "name": "Example",
        "description": "Example capsule",
        "kind": "agent_session",
        "runtime": {"type": "generic_cli", "command": "python"},
        "workspace": {"mode": "existing_dir"},
        "permissions": {
            "sandbox": "read-only",
            "network": False,
            "write_files": False,
            "timeout_seconds": 30,
            "allow_dangerous": False,
        },
        "prompt": {"template": "prompt_template.md"},
        "schema": {"input": "input_schema.json", "output": "output_schema.json"},
        "artifacts": {"manifest": "artifact_manifest.yaml"},
    }
    payload.update(updates)
    return payload


def test_legacy_agent_node_normalizes_to_agent_class_invocation() -> None:
    template = parse_clean_workflow_template(
        {
            "id": "normalize_demo",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "reviewer",
                    "kind": "agent",
                    "runtime": "generic_fake_agent",
                    "prompt": "Review only the source facts.",
                    "permission_profile": {
                        "workspace_access": "read_only",
                        "network": False,
                        "shell": False,
                        "dangerous": False,
                        "timeout_seconds": 30,
                    },
                    "ports": {
                        "inputs": {"main": {"type": "artifact"}},
                        "outputs": {"report": {"type": "artifact"}},
                    },
                }
            ],
            "control_edges": [],
            "data_edges": [],
        }
    )

    node = normalize_node_invocation_spec(template.nodes["reviewer"])

    assert node.callable_ref.kind == "agent_class"
    assert node.callable_ref.id == "generic_fake_agent"
    assert node.overrides.prompt == "Review only the source facts."
    assert node.overrides.permission_profile is not None
    assert node.input_ports["main"].type == "artifact"
    assert node.output_ports["report"].type == "artifact"
    assert node.metadata["legacy_node_kind"] == "agent"


def test_legacy_tool_and_workflow_nodes_normalize_to_callable_refs() -> None:
    template = parse_clean_workflow_template(
        {
            "id": "normalize_demo",
            "version": "0.1.0",
            "nodes": [
                {"id": "producer", "kind": "tool", "tool": "fake_producer"},
                {
                    "id": "subflow",
                    "kind": "workflow",
                    "workflow_ref": "child.accflow.json",
                    "workflow_call_input_bindings": [
                        {
                            "source": {"node": "producer", "port": "main"},
                            "workflow_input": "brief",
                        }
                    ],
                    "workflow_call_output_bindings": [
                        {"workflow_output": "report", "parent_port": "summary"}
                    ],
                },
            ],
            "control_edges": [{"from": "producer", "to": "subflow"}],
            "data_edges": [],
        }
    )

    callable_template = normalize_workflow_function_template(template)
    producer = callable_template.node_invocations["producer"]
    subflow = callable_template.node_invocations["subflow"]

    assert producer.callable_ref.kind == "tool_class"
    assert producer.callable_ref.id == "fake_producer"
    assert subflow.callable_ref.kind == "workflow_function"
    assert subflow.callable_ref.id == "child.accflow.json"
    assert subflow.workflow_call_input_bindings[0].workflow_input == "brief"
    assert subflow.workflow_call_output_bindings[0].parent_port == "summary"
    assert callable_template.control_edges[0].source == "producer"


def test_invalid_workflow_call_binding_fails_during_normalization() -> None:
    template = parse_clean_workflow_template(
        {
            "id": "bad_binding",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "subflow",
                    "kind": "workflow",
                    "workflow_ref": "child.accflow.json",
                    "workflow_call_input_bindings": [{"source": {"node": "a"}}],
                }
            ],
            "control_edges": [],
            "data_edges": [],
        }
    )

    with pytest.raises(AccError, match="workflow_input"):
        normalize_node_invocation_spec(template.nodes["subflow"])


def test_capsule_spec_agent_maps_to_agent_class_template() -> None:
    capsule = CapsuleSpec.model_validate(capsule_payload())

    ref = capsule_spec_to_callable_ref(capsule)
    mapped = capsule_spec_to_class_template(capsule)

    assert ref.kind == "agent_class"
    assert isinstance(mapped, AgentClassTemplate)
    assert mapped.id == capsule.id
    assert mapped.default_prompt == "prompt_template.md"
    assert mapped.default_permissions.workspace_access == "read_only"


def test_capsule_spec_atomic_maps_to_tool_class_template() -> None:
    capsule = CapsuleSpec.model_validate(capsule_payload(kind="atomic", prompt=None))

    ref = capsule_spec_to_callable_ref(capsule)
    mapped = capsule_spec_to_class_template(capsule)

    assert ref.kind == "tool_class"
    assert isinstance(mapped, ToolClassTemplate)
    assert mapped.runner == "generic_cli"


def test_capsule_spec_acc_workflow_maps_to_workflow_function_template() -> None:
    capsule = CapsuleSpec.model_validate(
        capsule_payload(
            kind="acc_workflow",
            runtime={"type": "acc_workflow"},
            prompt=None,
            workflow={"type": "acc_graph", "path": "workflow.graph.json"},
        )
    )

    ref = capsule_spec_to_callable_ref(capsule)
    mapped = capsule_spec_to_class_template(capsule)

    assert ref.kind == "workflow_function"
    assert isinstance(mapped, WorkflowFunctionTemplate)
    assert mapped.metadata["legacy_workflow_path"] == "workflow.graph.json"
