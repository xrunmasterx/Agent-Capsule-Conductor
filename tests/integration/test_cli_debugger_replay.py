from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app

DEMO_GRAPH = Path("examples/workflows/debugger_replay_demo.graph.json")
FORK_OVERRIDE = Path("examples/workflows/fork_override.json")


def test_cli_debugger_replay_commands(tmp_path: Path) -> None:
    runner = CliRunner()
    run_dir = tmp_path / "debugger_demo"
    rerun_node_dir = tmp_path / "rerun_node"
    rerun_from_dir = tmp_path / "rerun_from"
    fork_dir = tmp_path / "forked"

    run_result = runner.invoke(
        app,
        [
            "workflow",
            "run",
            str(DEMO_GRAPH),
            "--run-dir",
            str(run_dir),
            "--emit-json",
        ],
    )
    assert run_result.exit_code == 0, run_result.output
    assert json.loads(run_result.stdout)["status"] == "success"

    replay_result = runner.invoke(app, ["events", "replay", str(run_dir), "--json"])
    assert replay_result.exit_code == 0, replay_result.output
    assert json.loads(replay_result.stdout)["nodes"][1]["node_id"] == "demo_node_b"

    rerun_node_result = runner.invoke(
        app,
        [
            "workflow",
            "rerun-node",
            str(run_dir),
            "demo_node_a",
            "--out",
            str(rerun_node_dir),
        ],
    )
    assert rerun_node_result.exit_code == 0, rerun_node_result.output
    assert (rerun_node_dir / "replay_manifest.json").exists()

    rerun_from_result = runner.invoke(
        app,
        [
            "workflow",
            "rerun-from",
            str(run_dir),
            "demo_node_a",
            "--out",
            str(rerun_from_dir),
        ],
    )
    assert rerun_from_result.exit_code == 0, rerun_from_result.output
    assert (rerun_from_dir / "node_runs" / "demo_node_b" / "output.json").exists()

    fork_result = runner.invoke(
        app,
        [
            "workflow",
            "fork",
            str(run_dir),
            "--from-node",
            "demo_node_a",
            "--input",
            str(FORK_OVERRIDE),
            "--out",
            str(fork_dir),
        ],
    )
    assert fork_result.exit_code == 0, fork_result.output
    assert (fork_dir / "fork_manifest.json").exists()

    diff_result = runner.invoke(app, ["run", "diff", str(run_dir), str(fork_dir), "--json"])
    assert diff_result.exit_code == 0, diff_result.output
    diff_payload = json.loads(diff_result.stdout)
    assert "demo_node_a" in diff_payload["changed_nodes"]
