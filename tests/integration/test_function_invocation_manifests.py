from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app
from acc.utils import load_json


def test_accflow_run_writes_function_invocation_and_scope_frame(tmp_path: Path) -> None:
    run_dir = tmp_path / "callable_main"

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
    assert payload["status"] == "success"

    invocation = load_json(run_dir / "function_invocation_manifest.json")
    scope = load_json(run_dir / "scope_frame_manifest.json")
    environment = load_json(run_dir / "environments/root_env/environment_manifest.json")

    assert invocation["workflow_function_id"] == "stateless_template_demo"
    assert invocation["status"] == "success"
    assert invocation["root_scope_frame_id"] == scope["frame_id"]
    assert invocation["parent_invocation_id"] is None
    assert scope["invocation_id"] == invocation["invocation_id"]
    assert scope["parent_frame_id"] is None
    assert scope["call_depth"] == 0
    assert scope["ephemeral"] is True
    assert environment["function_invocation_id"] == invocation["invocation_id"]
    assert environment["scope_frame_id"] == scope["frame_id"]
    assert payload["function_invocation_manifest"].endswith(
        "function_invocation_manifest.json"
    )
    assert payload["scope_frame_manifest"].endswith("scope_frame_manifest.json")


def test_nested_accflow_run_writes_child_invocation_and_parent_scope(
    tmp_path: Path,
) -> None:
    run_dir = tmp_path / "callable_nested"

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
    child_run_dir = run_dir / "nodes/subflow/nested_workflow"
    child_invocation = load_json(child_run_dir / "function_invocation_manifest.json")
    child_scope = load_json(child_run_dir / "scope_frame_manifest.json")

    assert child_invocation["parent_invocation_id"] == parent_invocation["invocation_id"]
    assert child_scope["parent_frame_id"] == parent_scope["frame_id"]
    assert child_scope["call_depth"] == parent_scope["call_depth"] + 1
    assert child_invocation["root_scope_frame_id"] == child_scope["frame_id"]
