from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app


def test_acc_run_legacy_ref_is_rejected_as_runtime_input(tmp_path: Path) -> None:
    result = CliRunner().invoke(
        app,
        [
            "run",
            "fake-agent.generic",
            "--input-json",
            "{}",
            "--run-dir",
            str(tmp_path / "run"),
            "--emit-conductor-json",
        ],
    )

    assert result.exit_code == 1
    assert result.stdout == ""
    assert "no longer executes legacy runtime assets" in result.stderr
