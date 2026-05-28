from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app
from acc.utils import load_json


def test_agent_and_tool_nodes_write_session_instance_manifests(tmp_path: Path) -> None:
    run_dir = tmp_path / "session_instances"

    result = CliRunner().invoke(
        app,
        [
            "workflow",
            "run",
            "examples/workflows/stateless_template_demo.accflow.json",
            "--run-dir",
            str(run_dir),
            "--emit-json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    invocation = load_json(run_dir / "function_invocation_manifest.json")
    scope = load_json(run_dir / "scope_frame_manifest.json")

    for node_id, callable_kind in [
        ("producer", "tool_class"),
        ("consumer", "agent_class"),
    ]:
        session = load_json(run_dir / f"nodes/{node_id}/session_instance_manifest.json")
        node_run = load_json(run_dir / f"nodes/{node_id}/node_run_manifest.json")
        assert session["node_id"] == node_id
        assert session["callable_kind"] == callable_kind
        assert session["invocation_id"] == invocation["invocation_id"]
        assert session["scope_frame_id"] == scope["frame_id"]
        assert session["status"] == "success"
        assert node_run["session_id"] == session["session_id"]
        assert node_run["session_instance_manifest"].endswith(
            "session_instance_manifest.json"
        )

    assert payload["status"] == "success"


def test_workflow_node_writes_workflow_call_manifest(tmp_path: Path) -> None:
    run_dir = tmp_path / "workflow_call"

    result = CliRunner().invoke(
        app,
        [
            "workflow",
            "run",
            "examples/workflows/nested_environment_demo.accflow.json",
            "--run-dir",
            str(run_dir),
            "--emit-json",
        ],
    )

    assert result.exit_code == 0, result.output
    parent_invocation = load_json(run_dir / "function_invocation_manifest.json")
    parent_scope = load_json(run_dir / "scope_frame_manifest.json")
    call = load_json(run_dir / "nodes/subflow/workflow_call_manifest.json")

    assert call["node_id"] == "subflow"
    assert call["parent_invocation_id"] == parent_invocation["invocation_id"]
    assert call["parent_scope_frame_id"] == parent_scope["frame_id"]
    assert call["child_invocation_manifest"].endswith("function_invocation_manifest.json")
    assert call["child_scope_frame_manifest"].endswith("scope_frame_manifest.json")
    assert call["status"] == "success"
