import json
import shutil
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app
from acc.utils import load_json


def test_run_emit_conductor_json_stdout_contract(tmp_path: Path) -> None:
    run_dir = tmp_path / "echo_run"
    result = CliRunner().invoke(
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

    assert result.exit_code == 0
    stdout_payload = json.loads(result.stdout)
    assert result.stdout.strip().startswith("{")
    assert result.stdout.strip().endswith("}")
    assert stdout_payload["status"] == "success"
    assert stdout_payload["session_id"].startswith("session_")
    assert Path(stdout_payload["output_path"]).exists()
    assert Path(stdout_payload["artifact_dir"]).exists()
    assert Path(stdout_payload["event_log"]).exists()
    assert Path(stdout_payload["session_manifest"]).exists()
    assert (run_dir / "session_manifest.json").exists()
    assert load_json(run_dir / "conductor_output.json") == stdout_payload
    manifest = load_json(run_dir / "session_manifest.json")
    assert manifest["session_id"] == stdout_payload["session_id"]


def test_run_accepts_explicit_capsules_dir(tmp_path: Path) -> None:
    capsules_dir = tmp_path / "capsules"
    shutil.copytree(Path("capsules/echo-test.generic"), capsules_dir / "echo-test.generic")
    run_dir = tmp_path / "external_registry_run"

    result = CliRunner().invoke(
        app,
        [
            "run",
            "echo-test.generic",
            "--capsules-dir",
            str(capsules_dir),
            "--input",
            str(capsules_dir / "echo-test.generic" / "examples" / "input.json"),
            "--run-dir",
            str(run_dir),
            "--emit-conductor-json",
        ],
    )

    assert result.exit_code == 0, result.output
    stdout_payload = json.loads(result.stdout)
    assert stdout_payload["status"] == "success"
    assert load_json(run_dir / "conductor_output.json") == stdout_payload
