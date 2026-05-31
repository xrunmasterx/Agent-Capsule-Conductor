from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app
from acc.utils import load_json


def assert_single_json_stdout(stdout: str) -> dict:
    stripped = stdout.strip()
    assert stripped.startswith("{")
    assert stripped.endswith("}")
    return json.loads(stripped)


def test_architecture_feasibility_capsule_workflow_inspect_and_graphops(
    tmp_path: Path,
) -> None:
    runner = CliRunner()

    capsule_run_dir = tmp_path / "capsule_session"
    capsule_result = runner.invoke(
        app,
        [
            "run",
            "echo-test.generic",
            "--input",
            "capsules/echo-test.generic/examples/input.json",
            "--run-dir",
            str(capsule_run_dir),
            "--emit-conductor-json",
        ],
    )
    assert capsule_result.exit_code == 0, capsule_result.output
    capsule_payload = assert_single_json_stdout(capsule_result.stdout)
    assert capsule_payload["status"] == "success"
    assert load_json(capsule_run_dir / "conductor_output.json") == capsule_payload
    assert load_json(capsule_run_dir / "session_manifest.json")["session_id"] == (
        capsule_payload["session_id"]
    )

    workflow_run_dir = tmp_path / "callable_workflow"
    validate_result = runner.invoke(
        app,
        [
            "workflow",
            "validate",
            "examples/workflows/callable_nested_function_demo.accflow.json",
            "--json",
        ],
    )
    assert validate_result.exit_code == 0, validate_result.output
    validate_payload = assert_single_json_stdout(validate_result.stdout)
    assert validate_payload["status"] == "valid"
    assert validate_payload["topological_levels"] == [
        ["producer"],
        ["subflow"],
        ["final_merge"],
    ]

    workflow_result = runner.invoke(
        app,
        [
            "workflow",
            "run",
            "examples/workflows/callable_nested_function_demo.accflow.json",
            "--run-dir",
            str(workflow_run_dir),
            "--emit-json",
        ],
    )
    assert workflow_result.exit_code == 0, workflow_result.output
    workflow_payload = assert_single_json_stdout(workflow_result.stdout)
    assert workflow_payload["status"] == "success"

    parent_invocation = load_json(workflow_run_dir / "function_invocation_manifest.json")
    parent_scope = load_json(workflow_run_dir / "scope_frame_manifest.json")
    workflow_call = load_json(workflow_run_dir / "nodes/subflow/workflow_call_manifest.json")
    child_run_dir = workflow_run_dir / "nodes/subflow/nested_workflow"
    child_invocation = load_json(child_run_dir / "function_invocation_manifest.json")
    final_merge_session = load_json(
        workflow_run_dir / "nodes/final_merge/session_instance_manifest.json"
    )
    final_inbox = load_json(
        workflow_run_dir / "nodes/final_merge/inbox/summary/subflow_summary/inbox_manifest.json"
    )

    assert parent_invocation["root_scope_frame_id"] == parent_scope["frame_id"]
    assert workflow_call["parent_invocation_id"] == parent_invocation["invocation_id"]
    assert child_invocation["parent_invocation_id"] == parent_invocation["invocation_id"]
    assert final_merge_session["scope_frame_id"] == parent_scope["frame_id"]
    assert final_inbox["source_node_id"] == "subflow"
    assert final_inbox["source_port_id"] == "summary"

    inspect_result = runner.invoke(
        app,
        ["workflow", "inspect", str(workflow_run_dir), "--json"],
    )
    assert inspect_result.exit_code == 0, inspect_result.output
    inspect_payload = assert_single_json_stdout(inspect_result.stdout)
    assert inspect_payload["function_invocation"]["invocation_id"] == (
        parent_invocation["invocation_id"]
    )
    assert inspect_payload["workflow_calls"][0]["node_id"] == "subflow"
    assert any(
        item["source_node_id"] == "subflow" and item["target_node_id"] == "final_merge"
        for item in inspect_payload["lineage"]["inboxes"]
    )

    target_path = Path("examples/workflows/demo_level_parallel.graph.json")
    before = target_path.read_text(encoding="utf-8")
    graphops_result = runner.invoke(
        app,
        ["graphops", "apply-patch", "examples/graphops/add-review-node.patch.json", "--dry-run"],
    )
    assert graphops_result.exit_code == 0, graphops_result.output
    graphops_payload = assert_single_json_stdout(graphops_result.stdout)
    assert graphops_payload["status"] == "dry_run"
    assert target_path.read_text(encoding="utf-8") == before

    rejected_apply = runner.invoke(
        app,
        ["graphops", "apply-patch", "examples/graphops/add-review-node.patch.json"],
    )
    assert rejected_apply.exit_code != 0
    assert "requires --apply --human-approved" in rejected_apply.stderr
