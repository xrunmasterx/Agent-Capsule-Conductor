from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app

CONTROL_PLANE_DEMO = Path("examples/workflows/control_plane_demo.graph.json")
GRAPHOPS_PATCH = Path("examples/graphops/add-review-node.patch.json")


def test_capsules_control_plane_commands_emit_machine_readable_json() -> None:
    runner = CliRunner()

    list_result = runner.invoke(app, ["capsules", "list", "--json"])
    assert list_result.exit_code == 0, list_result.output
    list_payload = json.loads(list_result.stdout)
    assert any(item["id"] == "echo-test.generic" for item in list_payload["capsules"])

    show_result = runner.invoke(app, ["capsules", "show", "echo-test.generic", "--json"])
    assert show_result.exit_code == 0, show_result.output
    show_payload = json.loads(show_result.stdout)
    assert show_payload["capsule"]["id"] == "echo-test.generic"
    assert show_payload["capsule"]["runtime"] == "generic_cli"


def test_workflows_control_plane_commands_emit_machine_readable_json() -> None:
    runner = CliRunner()

    list_result = runner.invoke(app, ["workflows", "list", "--json"])
    assert list_result.exit_code == 0, list_result.output
    list_payload = json.loads(list_result.stdout)
    assert any(
        item["workflow_id"] == "control_plane_demo" for item in list_payload["workflows"]
    )

    show_result = runner.invoke(app, ["workflows", "show", str(CONTROL_PLANE_DEMO), "--json"])
    assert show_result.exit_code == 0, show_result.output
    show_payload = json.loads(show_result.stdout)
    assert show_payload["workflow_id"] == "control_plane_demo"
    assert show_payload["validation"]["status"] == "valid"


def test_runs_and_artifacts_control_plane_commands_emit_machine_readable_json(
    tmp_path: Path,
    monkeypatch,
) -> None:
    runner = CliRunner()
    monkeypatch.chdir(Path.cwd())
    run_dir = Path("runs") / f"test_control_plane_{tmp_path.name}"

    run_result = runner.invoke(
        app,
        [
            "workflow",
            "run",
            str(CONTROL_PLANE_DEMO),
            "--run-dir",
            str(run_dir),
            "--emit-json",
        ],
    )
    assert run_result.exit_code == 0, run_result.output
    assert json.loads(run_result.stdout)["status"] == "success"

    show_result = runner.invoke(app, ["runs", "show", str(run_dir), "--json"])
    assert show_result.exit_code == 0, show_result.output
    show_payload = json.loads(show_result.stdout)
    assert show_payload["run_id"] == run_dir.name
    assert show_payload["workflow_id"] == "control_plane_demo"

    artifact_result = runner.invoke(
        app,
        ["artifacts", "get", f"{run_dir.name}:control_echo:output.json", "--json"],
    )
    assert artifact_result.exit_code == 0, artifact_result.output
    artifact_payload = json.loads(artifact_result.stdout)
    assert artifact_payload["type"] == "json"
    output_payload = json.loads(artifact_payload["content"])
    assert output_payload["summary"] == "Echoed message: control plane demo"


def test_graphops_control_plane_commands_emit_machine_readable_json() -> None:
    runner = CliRunner()

    validate_result = runner.invoke(app, ["graphops", "validate", str(GRAPHOPS_PATCH), "--json"])
    assert validate_result.exit_code == 0, validate_result.output
    validate_payload = json.loads(validate_result.stdout)
    assert validate_payload["status"] == "valid"
    assert validate_payload["operations"] == 3

    dry_run_result = runner.invoke(app, ["graphops", "dry-run", str(GRAPHOPS_PATCH), "--json"])
    assert dry_run_result.exit_code == 0, dry_run_result.output
    dry_run_payload = json.loads(dry_run_result.stdout)
    assert dry_run_payload["status"] == "dry_run"
    assert dry_run_payload["mutated"] is False
    assert dry_run_payload["operations"]
