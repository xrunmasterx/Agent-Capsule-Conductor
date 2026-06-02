import json
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app
from acc.run_index import NodeRunSummary, write_run_summary


def make_indexed_run(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "workbench_fake"
    run_dir.mkdir(parents=True)
    node = NodeRunSummary(
        node_id="workbench_fake",
        callable_id="fake-agent.generic",
        status="success",
        run_dir=str(run_dir),
        output_path=str(run_dir / "output.json"),
        artifact_dir=str(run_dir / "artifacts"),
    )
    write_run_summary(run_dir, node)


def test_acc_runs_list_exits_zero(tmp_path: Path, monkeypatch) -> None:
    make_indexed_run(tmp_path)
    monkeypatch.chdir(tmp_path)

    result = CliRunner().invoke(app, ["runs", "list"])

    assert result.exit_code == 0
    assert "workbench_fake" in result.stdout
    assert "success" in result.stdout


def test_acc_runs_list_json_returns_valid_json(tmp_path: Path, monkeypatch) -> None:
    make_indexed_run(tmp_path)
    monkeypatch.chdir(tmp_path)

    result = CliRunner().invoke(app, ["runs", "list", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["runs"][0]["run_id"] == "workbench_fake"


def test_acc_runs_show_exits_zero(tmp_path: Path, monkeypatch) -> None:
    make_indexed_run(tmp_path)
    monkeypatch.chdir(tmp_path)

    result = CliRunner().invoke(app, ["runs", "show", "workbench_fake"])

    assert result.exit_code == 0
    assert "artifact_dir" in result.stdout


def test_acc_runs_show_json_returns_valid_json(tmp_path: Path, monkeypatch) -> None:
    make_indexed_run(tmp_path)
    monkeypatch.chdir(tmp_path)

    result = CliRunner().invoke(app, ["runs", "show", "workbench_fake", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["status"] == "success"


def test_acc_runs_show_missing_returns_nonzero(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "runs").mkdir()
    monkeypatch.chdir(tmp_path)

    result = CliRunner().invoke(app, ["runs", "show", "missing"])

    assert result.exit_code != 0
    assert "Run not found" in result.stderr
