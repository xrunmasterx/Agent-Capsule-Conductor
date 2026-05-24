import json
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app


def test_batch_run_three_fake_agent_tasks(tmp_path: Path) -> None:
    run_dir = tmp_path / "batch"
    result = CliRunner().invoke(
        app,
        [
            "batch-run",
            "--spec",
            "capsules/fake-agent.generic/examples/batch.json",
            "--run-dir",
            str(run_dir),
            "--max-concurrency",
            "2",
            "--emit-conductor-json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["status"] == "success"
    assert (run_dir / "bundle.json").exists()
    assert (run_dir / "tasks" / "task_001").is_dir()
    assert (run_dir / "tasks" / "task_002").is_dir()
    assert (run_dir / "tasks" / "task_003").is_dir()

