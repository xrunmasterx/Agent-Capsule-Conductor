from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app
from acc.domain import CORE_V2_SCHEMA_VERSION


def test_core_v2_workflow_cli_emit_json_contract(tmp_path: Path) -> None:
    workflow_path = tmp_path / "cli_v2.accflow.json"
    workflow_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "cli_v2",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "produce",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "ports": {"outputs": {"main": {}}},
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    run_dir = tmp_path / "run"

    result = CliRunner().invoke(
        app,
        [
            "workflow",
            "run",
            str(workflow_path),
            "--run-dir",
            str(run_dir),
            "--emit-json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["status"] == "success"
    assert payload["workflow_id"] == "cli_v2"
    assert result.stderr == ""
    assert result.stdout.strip().startswith("{")
    assert result.stdout.strip().endswith("}")
    assert (run_dir / "run_record.json").exists()
    assert (run_dir / "result_store" / "produce" / "main.json").exists()
    assert not (run_dir / "workflow_graph.json").exists()
    assert not (run_dir / "node_runs").exists()
