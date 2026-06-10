from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app
from acc.models import CORE_V2_SCHEMA_VERSION


def _write_tool_callable(root: Path) -> None:
    tools_dir = root / "callables" / "tools"
    tools_dir.mkdir(parents=True)
    (tools_dir / "fake_tool.yaml").write_text(
        "\n".join(
            [
                "id: fake_tool",
                "version: 0.1.0",
                "runner: fake_runner",
                "output_ports:",
                "  main:",
                "    type: artifact",
            ]
        ),
        encoding="utf-8",
    )


def _workflow_with_main_data_edge(workflow_path: Path) -> None:
    workflow_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": workflow_path.name.removesuffix(".accflow.json"),
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "source",
                        "callable_ref": {"kind": "tool_class", "id": "fake_tool"},
                    },
                    {
                        "id": "target",
                        "callable_ref": {"kind": "tool_class", "id": "fake_tool"},
                    },
                ],
                "control_edges": [],
                "data_edges": [
                    {
                        "source": {"node": "source", "port": "main"},
                        "target": {"node": "target", "port": "main"},
                        "materialization": "copy",
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )


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
    assert (run_dir / "run_plan.json").exists()
    assert (run_dir / "plan_steps.jsonl").exists()
    assert (run_dir / "dispatches.jsonl").exists()
    assert (run_dir / "decisions.jsonl").exists()
    assert (run_dir / "result_store" / "produce" / "main.json").exists()
    assert not (run_dir / "workflow_graph.json").exists()
    assert not (run_dir / "node_runs").exists()


def test_workflow_normalize_json_preview_does_not_write(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    _write_tool_callable(tmp_path)
    workflow_path = tmp_path / "preview.accflow.json"
    _workflow_with_main_data_edge(workflow_path)
    before = workflow_path.read_text(encoding="utf-8")

    result = CliRunner().invoke(app, ["workflow", "normalize", str(workflow_path), "--json"])

    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["status"] == "preview"
    assert payload["normalization"]["removed_main_data_edges"] == 1
    assert workflow_path.read_text(encoding="utf-8") == before


def test_workflow_normalize_write_json_updates_file_and_validates(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    _write_tool_callable(tmp_path)
    workflow_path = tmp_path / "write.accflow.json"
    _workflow_with_main_data_edge(workflow_path)

    result = CliRunner().invoke(
        app,
        ["workflow", "normalize", str(workflow_path), "--write", "--json"],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    saved = json.loads(workflow_path.read_text(encoding="utf-8"))
    assert payload["status"] == "written"
    assert payload["validation"]["status"] == "valid"
    assert saved["data_edges"] == []
    assert saved["control_edges"] == [{"context": "none", "from": "source", "to": "target"}]
