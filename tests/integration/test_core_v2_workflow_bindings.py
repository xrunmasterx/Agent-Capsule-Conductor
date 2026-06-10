from __future__ import annotations

import asyncio
import json
from pathlib import Path

from acc.app.runtime.orchestrator import run_core_v2_workflow_path
from acc.models import CORE_V2_SCHEMA_VERSION


def test_core_v2_explicit_bindings_and_workflow_outputs(tmp_path: Path) -> None:
    workflow_path = tmp_path / "bindings.accflow.json"
    workflow_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "bindings",
                "version": "0.1.0",
                "exposed_inputs": {"topic": {"direction": "input", "type": "json"}},
                "exposed_outputs": {"report": {"direction": "output", "type": "json"}},
                "nodes": [
                    {
                        "id": "produce",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "ports": {"inputs": {"topic": {}}, "outputs": {"main": {}}},
                    },
                    {
                        "id": "merge",
                        "callable_ref": {"kind": "tool_class", "id": "merge"},
                        "input_bindings": [
                            {
                                "source": {"node": "produce", "port": "main"},
                                "target_port": "main",
                            }
                        ],
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                    },
                ],
                "control_edges": [{"from": "produce", "to": "merge"}],
                "workflow_input_bindings": [
                    {
                        "source_port": "topic",
                        "target": {"node": "produce", "port": "topic"},
                    }
                ],
                "workflow_output_bindings": [
                    {
                        "source": {"node": "merge", "port": "main"},
                        "target_port": "report",
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    record = asyncio.run(
        run_core_v2_workflow_path(
            workflow_path,
            tmp_path / "run",
            input_payload={"topic": {"value": "chips"}},
        )
    )
    workflow_output = json.loads(
        (tmp_path / "run" / "workflow_outputs" / "report" / "output.json").read_text(
            encoding="utf-8"
        )
    )

    assert record.status == "success"
    assert workflow_output["merged"]["main"]["input"]["topic"] == {"value": "chips"}
    assert (
        tmp_path
        / "run"
        / "result_store"
        / "__workflow_outputs"
        / "report.json"
    ).exists()


def test_core_v2_workflow_input_fanout_and_output_aggregation(
    tmp_path: Path,
) -> None:
    workflow_path = tmp_path / "fanout.accflow.json"
    workflow_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "fanout",
                "version": "0.1.0",
                "exposed_inputs": {"main": {"direction": "input", "type": "json"}},
                "exposed_outputs": {"main": {"direction": "output", "type": "json"}},
                "nodes": [
                    {
                        "id": "agent_a",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                    },
                    {
                        "id": "agent_b",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                    },
                ],
                "control_edges": [],
                "workflow_input_bindings": [
                    {
                        "source_port": "main",
                        "target": {"node": "agent_a", "port": "main"},
                    },
                    {
                        "source_port": "main",
                        "target": {"node": "agent_b", "port": "main"},
                    },
                ],
                "workflow_output_bindings": [
                    {
                        "source": {"node": "agent_a", "port": "main"},
                        "target_port": "main",
                    },
                    {
                        "source": {"node": "agent_b", "port": "main"},
                        "target_port": "main",
                    },
                ],
                "policies": {"failure_mode": "fail_fast", "max_concurrency": 2},
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    record = asyncio.run(
        run_core_v2_workflow_path(
            workflow_path,
            tmp_path / "run",
            input_payload={"main": {"value": "shared"}},
        )
    )
    payload_a = json.loads(
        (tmp_path / "run" / "nodes" / "agent_a" / "agent_payload.json").read_text(
            encoding="utf-8"
        )
    )
    payload_b = json.loads(
        (tmp_path / "run" / "nodes" / "agent_b" / "agent_payload.json").read_text(
            encoding="utf-8"
        )
    )
    workflow_output = json.loads(
        (tmp_path / "run" / "workflow_outputs" / "main" / "output.json").read_text(
            encoding="utf-8"
        )
    )

    assert record.status == "success"
    assert payload_a["main"] == {"value": "shared"}
    assert payload_b["main"] == {"value": "shared"}
    assert set(workflow_output) == {"agent_a", "agent_b"}
    assert workflow_output["agent_a"]["input"]["main"] == {"value": "shared"}
    assert workflow_output["agent_b"]["input"]["main"] == {"value": "shared"}


def test_nested_workflow_receives_main_from_parent_control_edge(
    tmp_path: Path,
) -> None:
    child_path = tmp_path / "root__New_Workflow.accflow.json"
    child_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "root__New_Workflow",
                "version": "0.1.0",
                "exposed_inputs": {"main": {"direction": "input", "type": "json"}},
                "exposed_outputs": {"main": {"direction": "output", "type": "json"}},
                "nodes": [
                    {
                        "id": "agent2",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                    },
                    {
                        "id": "agent1",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                    },
                ],
                "control_edges": [{"from": "agent2", "to": "agent1"}],
                "workflow_input_bindings": [
                    {
                        "source_port": "main",
                        "target": {"node": "agent2", "port": "main"},
                    }
                ],
                "workflow_output_bindings": [
                    {
                        "source": {"node": "agent1", "port": "main"},
                        "target_port": "main",
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    root_path = tmp_path / "root.accflow.json"
    root_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "root",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "external_agent",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "overrides": {"static_input": {"seed": "parent-main"}},
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                    },
                    {
                        "id": "New_Workflow",
                        "callable_ref": {
                            "kind": "workflow_function",
                            "id": "root__New_Workflow.accflow.json",
                        },
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                        "workflow_call_output_bindings": [
                            {
                                "workflow_output": "main",
                                "parent_port": "main",
                            }
                        ],
                    },
                ],
                "control_edges": [{"from": "external_agent", "to": "New_Workflow"}],
                "workflow_output_bindings": [
                    {
                        "source": {"node": "New_Workflow", "port": "main"},
                        "target_port": "main",
                    }
                ],
                "exposed_outputs": {"main": {"direction": "output", "type": "json"}},
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    record = asyncio.run(run_core_v2_workflow_path(root_path, tmp_path / "run"))

    workflow_node_payload = json.loads(
        (tmp_path / "run" / "nodes" / "New_Workflow" / "agent_payload.json").read_text(
            encoding="utf-8"
        )
    )
    workflow_binding_manifest = json.loads(
        (tmp_path / "run" / "nodes" / "New_Workflow" / "binding_manifest.json").read_text(
            encoding="utf-8"
        )
    )
    child_run = tmp_path / "run" / "nodes" / "New_Workflow" / "nested_workflow"
    agent2_payload = json.loads(
        (child_run / "nodes" / "agent2" / "agent_payload.json").read_text(encoding="utf-8")
    )
    agent2_binding_manifest = json.loads(
        (child_run / "nodes" / "agent2" / "binding_manifest.json").read_text(
            encoding="utf-8"
        )
    )
    agent1_payload = json.loads(
        (child_run / "nodes" / "agent1" / "agent_payload.json").read_text(encoding="utf-8")
    )
    agent1_binding_manifest = json.loads(
        (child_run / "nodes" / "agent1" / "binding_manifest.json").read_text(
            encoding="utf-8"
        )
    )
    child_output = json.loads(
        (child_run / "workflow_outputs" / "main" / "output.json").read_text(
            encoding="utf-8"
        )
    )

    assert record.status == "success"
    assert workflow_node_payload["main"]["input"]["seed"] == "parent-main"
    assert workflow_binding_manifest["bindings"][0]["binding_kind"] == "control_main_default"
    assert agent2_payload["main"] == workflow_node_payload["main"]
    assert agent2_binding_manifest["bindings"][0]["binding_kind"] == "workflow_input"
    assert agent1_payload["main"]["input"]["main"] == workflow_node_payload["main"]
    assert agent1_binding_manifest["bindings"][0]["binding_kind"] == "control_main_default"
    assert child_output == json.loads(
        (child_run / "nodes" / "agent1" / "output.json").read_text(encoding="utf-8")
    )


def test_nested_workflow_call_bindings_map_non_matching_ports(tmp_path: Path) -> None:
    child_path = tmp_path / "root__child.accflow.json"
    child_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "root__child",
                "version": "0.1.0",
                "exposed_inputs": {"question": {"direction": "input", "type": "json"}},
                "exposed_outputs": {"report": {"direction": "output", "type": "json"}},
                "nodes": [
                    {
                        "id": "child_agent",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                    }
                ],
                "workflow_input_bindings": [
                    {
                        "source_port": "question",
                        "target": {"node": "child_agent", "port": "main"},
                    }
                ],
                "workflow_output_bindings": [
                    {
                        "source": {"node": "child_agent", "port": "main"},
                        "target_port": "report",
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    root_path = tmp_path / "root.accflow.json"
    root_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "root",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "external_agent",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "overrides": {"static_input": {"seed": "parent"}},
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                    },
                    {
                        "id": "child_call",
                        "callable_ref": {
                            "kind": "workflow_function",
                            "id": "root__child.accflow.json",
                        },
                        "ports": {"inputs": {"main": {}}, "outputs": {"out_main": {}}},
                        "workflow_call_input_bindings": [
                            {
                                "source": {"node": "external_agent", "port": "main"},
                                "workflow_input": "question",
                            }
                        ],
                        "workflow_call_output_bindings": [
                            {
                                "workflow_output": "report",
                                "parent_port": "out_main",
                            }
                        ],
                    },
                ],
                "control_edges": [{"from": "external_agent", "to": "child_call"}],
                "exposed_outputs": {"main": {"direction": "output", "type": "json"}},
                "workflow_output_bindings": [
                    {
                        "source": {"node": "child_call", "port": "out_main"},
                        "target_port": "main",
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    record = asyncio.run(run_core_v2_workflow_path(root_path, tmp_path / "run"))

    child_run = tmp_path / "run" / "nodes" / "child_call" / "nested_workflow"
    child_payload = json.loads(
        (child_run / "nodes" / "child_agent" / "agent_payload.json").read_text(
            encoding="utf-8"
        )
    )
    workflow_node_output = json.loads(
        (tmp_path / "run" / "nodes" / "child_call" / "output.json").read_text(
            encoding="utf-8"
        )
    )
    root_output = json.loads(
        (tmp_path / "run" / "workflow_outputs" / "main" / "output.json").read_text(
            encoding="utf-8"
        )
    )

    assert record.status == "success"
    assert child_payload["main"]["input"]["seed"] == "parent"
    assert "report" not in workflow_node_output
    assert workflow_node_output["out_main"]["input"]["main"]["input"]["seed"] == "parent"
    assert root_output == workflow_node_output["out_main"]


def test_workflow_without_boundary_outputs_runs_and_does_not_forward_main(
    tmp_path: Path,
) -> None:
    child_path = tmp_path / "root__child.accflow.json"
    child_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "root__child",
                "version": "0.1.0",
                "exposed_inputs": {"main": {"direction": "input", "type": "json"}},
                "exposed_outputs": {"main": {"direction": "output", "type": "json"}},
                "nodes": [
                    {
                        "id": "agent2",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                    },
                    {
                        "id": "agent1",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                    },
                ],
                "control_edges": [{"from": "agent2", "to": "agent1"}],
                "workflow_input_bindings": [],
                "workflow_output_bindings": [],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    root_path = tmp_path / "root.accflow.json"
    root_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "root",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "child_call",
                        "callable_ref": {
                            "kind": "workflow_function",
                            "id": "root__child.accflow.json",
                        },
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                        "workflow_call_output_bindings": [
                            {
                                "workflow_output": "main",
                                "parent_port": "main",
                                "required": False,
                            }
                        ],
                    },
                    {
                        "id": "downstream",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                    },
                ],
                "control_edges": [{"from": "child_call", "to": "downstream"}],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    record = asyncio.run(run_core_v2_workflow_path(root_path, tmp_path / "run"))

    child_run = tmp_path / "run" / "nodes" / "child_call" / "nested_workflow"
    agent2_payload = json.loads(
        (child_run / "nodes" / "agent2" / "agent_payload.json").read_text(
            encoding="utf-8"
        )
    )
    agent1_binding_manifest = json.loads(
        (child_run / "nodes" / "agent1" / "binding_manifest.json").read_text(
            encoding="utf-8"
        )
    )
    workflow_node_output = json.loads(
        (tmp_path / "run" / "nodes" / "child_call" / "output.json").read_text(
            encoding="utf-8"
        )
    )
    downstream_payload = json.loads(
        (tmp_path / "run" / "nodes" / "downstream" / "agent_payload.json").read_text(
            encoding="utf-8"
        )
    )

    assert record.status == "success"
    assert "main" not in agent2_payload
    assert agent1_binding_manifest["bindings"][0]["binding_kind"] == "control_main_default"
    assert workflow_node_output["workflow_outputs"] == {}
    assert "main" not in workflow_node_output
    assert "main" not in downstream_payload


def test_optional_workflow_input_binding_missing_source_runs_without_main(
    tmp_path: Path,
) -> None:
    child_path = tmp_path / "root__child.accflow.json"
    child_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "root__child",
                "version": "0.1.0",
                "exposed_inputs": {"main": {"direction": "input", "required": False}},
                "nodes": [
                    {
                        "id": "worker",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                    }
                ],
                "workflow_input_bindings": [
                    {
                        "source_port": "main",
                        "target": {"node": "worker", "port": "main"},
                        "required": False,
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    root_path = tmp_path / "root.accflow.json"
    root_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "root",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "child_call",
                        "callable_ref": {
                            "kind": "workflow_function",
                            "id": "root__child.accflow.json",
                        },
                        "ports": {"inputs": {"main": {}}, "outputs": {"main": {}}},
                        "workflow_call_output_bindings": [
                            {
                                "workflow_output": "main",
                                "parent_port": "main",
                                "required": False,
                            }
                        ],
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    record = asyncio.run(run_core_v2_workflow_path(root_path, tmp_path / "run"))

    worker_payload = json.loads(
        (
            tmp_path
            / "run"
            / "nodes"
            / "child_call"
            / "nested_workflow"
            / "nodes"
            / "worker"
            / "agent_payload.json"
        ).read_text(encoding="utf-8")
    )

    assert record.status == "success"
    assert "main" not in worker_payload
