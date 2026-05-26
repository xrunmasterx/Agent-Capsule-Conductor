from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app
from acc.utils import load_json


def test_accflow_validate_accepts_json_flag() -> None:
    result = CliRunner().invoke(
        app,
        [
            "workflow",
            "validate",
            "examples/workflows/stateless_template_demo.accflow.json",
            "--json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["status"] == "valid"
    assert payload["format"] == "accflow"
    assert payload["workflow_id"] == "stateless_template_demo"


def test_accflow_stateless_run_uses_ephemeral_workspace(tmp_path: Path) -> None:
    run_dir = tmp_path / "stateless"

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

    environment_manifest = load_json(run_dir / "environments/root_env/environment_manifest.json")
    workspace_root = Path(environment_manifest["workspace_root"])
    assert environment_manifest["ephemeral"] is True
    assert workspace_root == run_dir / "environments/root_env/workspace"
    assert workspace_root != Path.cwd().resolve()
    assert (run_dir / "workflow_run_manifest.json").exists()
    assert (run_dir / "nodes/producer/outbox/main/artifact_bundle.json").exists()
    assert (run_dir / "nodes/consumer/inbox/main/producer_main/inbox_manifest.json").exists()

    consumer_output = load_json(run_dir / "nodes/consumer/output.json")
    assert consumer_output["read_from_inbox"] is True


def test_accflow_bind_accepts_json_flag_and_bound_run_uses_workspace(tmp_path: Path) -> None:
    binding_path = tmp_path / "binding.local.json"
    run_dir = tmp_path / "bound"

    bind_result = CliRunner().invoke(
        app,
        [
            "workflow",
            "bind",
            "examples/workflows/environment_stateful_demo.accflow.json",
            "--workspace",
            ".",
            "--out",
            str(binding_path),
            "--json",
        ],
    )
    assert bind_result.exit_code == 0, bind_result.output
    binding = json.loads(bind_result.stdout)
    assert Path(binding["workspace_root"]) == Path.cwd().resolve()

    run_result = CliRunner().invoke(
        app,
        [
            "workflow",
            "run",
            "examples/workflows/environment_stateful_demo.accflow.json",
            "--binding",
            str(binding_path),
            "--run-dir",
            str(run_dir),
            "--emit-json",
        ],
    )

    assert run_result.exit_code == 0, run_result.output
    payload = json.loads(run_result.stdout)
    assert payload["status"] == "success"
    environment_manifest = load_json(run_dir / "environments/root_env/environment_manifest.json")
    assert Path(environment_manifest["workspace_root"]) == Path.cwd().resolve()
    assert environment_manifest["ephemeral"] is False
    assert (run_dir / "environments/root_env/.acc/behavior_pack_snapshot.json").exists()


def test_accflow_nested_workflow_runs_and_materializes_parent_inbox(tmp_path: Path) -> None:
    run_dir = tmp_path / "nested"

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
    payload = json.loads(result.stdout)
    assert payload["status"] == "success"
    assert (run_dir / "nodes/subflow/nested_workflow/workflow_run_manifest.json").exists()
    assert (
        run_dir / "nodes/final_merge/inbox/summary/subflow_summary/inbox_manifest.json"
    ).exists()
