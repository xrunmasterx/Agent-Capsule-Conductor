import json
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app


def test_session_inspect_reads_session_manifest(tmp_path: Path) -> None:
    run_dir = tmp_path / "echo_run"
    runner = CliRunner()
    run_result = runner.invoke(
        app,
        [
            "run",
            "echo-test.generic",
            "--input",
            "capsules/echo-test.generic/examples/input.json",
            "--run-dir",
            str(run_dir),
            "--emit-conductor-json",
        ],
    )
    assert run_result.exit_code == 0

    inspect_result = runner.invoke(app, ["session", "inspect", str(run_dir)])

    assert inspect_result.exit_code == 0
    payload = json.loads(inspect_result.stdout)
    manifest = payload["session_manifest"]
    assert manifest["capsule_id"] == "echo-test.generic"
    assert manifest["session_id"].startswith("session_")
    assert manifest["status"] == "success"
    assert payload["artifact_dir"]


def test_legacy_inspect_reads_session_manifest(tmp_path: Path) -> None:
    run_dir = tmp_path / "echo_run"
    runner = CliRunner()
    run_result = runner.invoke(
        app,
        [
            "run",
            "echo-test.generic",
            "--input",
            "capsules/echo-test.generic/examples/input.json",
            "--run-dir",
            str(run_dir),
            "--emit-conductor-json",
        ],
    )
    assert run_result.exit_code == 0

    inspect_result = runner.invoke(app, ["inspect", str(run_dir)])

    assert inspect_result.exit_code == 0
    payload = json.loads(inspect_result.stdout)
    assert payload["session_manifest"]["capsule_id"] == "echo-test.generic"
