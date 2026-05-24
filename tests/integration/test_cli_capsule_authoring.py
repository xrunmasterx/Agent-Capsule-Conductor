import json
import shutil
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app


def test_acc_capsule_test_echo_succeeds(tmp_path: Path) -> None:
    run_dir = tmp_path / "capsule_test"
    result = CliRunner().invoke(
        app,
        [
            "capsule",
            "test",
            "echo-test.generic",
            "--input",
            "capsules/echo-test.generic/examples/input.json",
            "--run-dir",
            str(run_dir),
            "--emit-conductor-json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["status"] == "success"
    assert (run_dir / "node_summary.json").exists()


def test_acc_capsule_doctor_echo_succeeds() -> None:
    result = CliRunner().invoke(app, ["capsule", "doctor", "echo-test.generic"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["status"] == "valid"


def test_acc_capsule_clone_creates_valid_capsule(tmp_path: Path, monkeypatch) -> None:
    capsules_dir = tmp_path / "capsules"
    capsules_dir.mkdir()
    shutil.copytree(Path("capsules/echo-test.generic"), capsules_dir / "echo-test.generic")
    monkeypatch.chdir(tmp_path)
    runner = CliRunner()

    clone_result = runner.invoke(
        app,
        ["capsule", "clone", "echo-test.generic", "echo-test-copy.generic"],
    )
    validate_result = runner.invoke(app, ["validate", "echo-test-copy.generic"])

    assert clone_result.exit_code == 0
    assert validate_result.exit_code == 0
    assert (capsules_dir / "echo-test-copy.generic" / "capsule.yaml").exists()


def test_acc_capsule_doctor_reports_broken_capsule(tmp_path: Path, monkeypatch) -> None:
    capsules_dir = tmp_path / "capsules"
    capsules_dir.mkdir()
    broken_dir = capsules_dir / "broken.generic"
    shutil.copytree(Path("capsules/echo-test.generic"), broken_dir)
    (broken_dir / "prompt_template.md").unlink()
    monkeypatch.chdir(tmp_path)

    result = CliRunner().invoke(app, ["capsule", "doctor", "echo-test.generic"])

    assert result.exit_code != 0
    payload = json.loads(result.stdout)
    assert payload["status"] == "invalid"
    assert "Missing prompt template" in payload["errors"][0]
