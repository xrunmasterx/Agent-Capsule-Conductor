from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app
from acc.utils import load_json


def test_nested_workflow_explicit_function_call_bindings(tmp_path: Path) -> None:
    run_dir = tmp_path / "callable_nested"

    result = CliRunner().invoke(
        app,
        [
            "workflow",
            "run",
            "examples/workflows/callable_nested_function_demo.accflow.json",
            "--run-dir",
            str(run_dir),
            "--emit-json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["status"] == "success"

    child_run = run_dir / "nodes/subflow/nested_workflow"
    child_agent_input = load_json(child_run / "nodes/child_agent/input.json")
    child_input_manifest = load_json(
        child_run
        / "nodes/child_agent/inbox/main/callable_child_function__workflow_inputs_brief"
        / "inbox_manifest.json"
    )
    parent_outbox_manifest = load_json(
        run_dir / "nodes/subflow/outbox/summary/outbox_manifest.json"
    )
    final_inbox_manifest = load_json(
        run_dir / "nodes/final_merge/inbox/summary/subflow_summary/inbox_manifest.json"
    )
    workflow_call_manifest = load_json(run_dir / "nodes/subflow/workflow_call_manifest.json")

    assert child_agent_input["upstream_context"] == []
    assert child_agent_input["inbox"]["records"][0]["source_port_id"] == "brief"
    assert child_input_manifest["source_node_id"] == "callable_child_function__workflow_inputs"
    assert parent_outbox_manifest["child_workflow_output"] == "report"
    assert parent_outbox_manifest["source_workflow_output"].endswith(
        "nested_workflow\\workflow_outputs\\report"
    ) or parent_outbox_manifest["source_workflow_output"].endswith(
        "nested_workflow/workflow_outputs/report"
    )
    assert final_inbox_manifest["source_node_id"] == "subflow"
    assert final_inbox_manifest["source_port_id"] == "summary"
    assert workflow_call_manifest["input_bindings"][0]["workflow_input"] == "brief"
    assert workflow_call_manifest["output_bindings"][0]["workflow_output"] == "report"


def test_nested_workflow_missing_required_parent_binding_fails(tmp_path: Path) -> None:
    bad_workflow = tmp_path / "bad_callable_nested.accflow.json"
    bad_workflow.write_text(
        json.dumps(
            {
                "id": "bad_callable_nested",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "subflow",
                        "kind": "workflow",
                        "workflow_ref": str(
                            Path("examples/workflows/callable_child_function.accflow.json")
                            .resolve()
                        ),
                        "workflow_call_input_bindings": [
                            {
                                "source": {"node": "missing_producer", "port": "main"},
                                "workflow_input": "brief",
                                "required": True,
                            }
                        ],
                        "workflow_call_output_bindings": [
                            {"workflow_output": "report", "parent_port": "summary"}
                        ],
                    }
                ],
                "control_edges": [],
                "data_edges": [],
            }
        ),
        encoding="utf-8",
    )

    result = CliRunner().invoke(
        app,
        [
            "workflow",
            "run",
            str(bad_workflow),
            "--run-dir",
            str(tmp_path / "bad_run"),
            "--emit-json",
        ],
    )

    assert result.exit_code == 1, result.output
    payload = json.loads(result.stdout)
    assert payload["status"] == "failed"
    assert "Missing parent data for workflow call input" in payload["errors"][0]


def test_nested_workflow_rejects_binding_to_missing_child_input_port(
    tmp_path: Path,
) -> None:
    child_workflow = tmp_path / "child_optional_input.accflow.json"
    child_workflow.write_text(
        json.dumps(
            {
                "id": "child_optional_input",
                "version": "0.1.0",
                "exposed_inputs": {
                    "brief": {
                        "direction": "input",
                        "type": "artifact",
                        "required": False,
                    }
                },
                "exposed_outputs": {
                    "report": {
                        "direction": "output",
                        "type": "artifact",
                        "required": True,
                    }
                },
                "workflow_output_bindings": [
                    {
                        "source": {"node": "child_agent", "port": "summary"},
                        "target_port": "report",
                    }
                ],
                "nodes": [
                    {
                        "id": "child_agent",
                        "kind": "agent",
                        "runtime": "generic_fake_agent",
                        "output_ports": {"summary": {"type": "artifact"}},
                    }
                ],
                "control_edges": [],
                "data_edges": [],
            }
        ),
        encoding="utf-8",
    )
    bad_workflow = tmp_path / "bad_child_signature.accflow.json"
    bad_workflow.write_text(
        json.dumps(
            {
                "id": "bad_child_signature",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "producer",
                        "kind": "tool",
                        "tool": "fake_producer",
                        "output_ports": {"main": {"type": "artifact"}},
                    },
                    {
                        "id": "subflow",
                        "kind": "workflow",
                        "workflow_ref": str(child_workflow.resolve()),
                        "input_ports": {"brief": {"type": "artifact"}},
                        "output_ports": {"summary": {"type": "artifact"}},
                        "workflow_call_input_bindings": [
                            {
                                "source": {"node": "producer", "port": "main"},
                                "workflow_input": "missing_child_input",
                                "required": True,
                            }
                        ],
                        "workflow_call_output_bindings": [
                            {"workflow_output": "report", "parent_port": "summary"}
                        ],
                    },
                ],
                "control_edges": [{"from": "producer", "to": "subflow"}],
                "data_edges": [
                    {
                        "from": {"node": "producer", "port": "main"},
                        "to": {"node": "subflow", "port": "brief"},
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = CliRunner().invoke(
        app,
        [
            "workflow",
            "run",
            str(bad_workflow),
            "--run-dir",
            str(tmp_path / "bad_child_signature_run"),
            "--emit-json",
        ],
    )

    assert result.exit_code == 1, result.output
    payload = json.loads(result.stdout)
    assert payload["status"] == "failed"
    assert "missing child workflow input port" in payload["errors"][0]
