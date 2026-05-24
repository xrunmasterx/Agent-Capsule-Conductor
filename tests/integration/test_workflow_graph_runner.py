from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app
from acc.utils import load_json
from acc.workflow_runner import run_workflow_graph_sync


def test_runs_demo_two_node_graph_successfully(tmp_path: Path) -> None:
    run_dir = tmp_path / "demo_graph"

    result = run_workflow_graph_sync(Path("examples/workflows/demo_two_node.graph.json"), run_dir)

    assert result["status"] == "success"
    assert (run_dir / "workflow_run.json").exists()
    assert (run_dir / "nodes" / "echo" / "output.json").exists()
    assert (run_dir / "nodes" / "fake" / "output.json").exists()
    assert (run_dir / "nodes" / "fake" / "artifacts" / "report.md").exists()


def test_template_mapping_passes_previous_output_to_next_node(tmp_path: Path) -> None:
    run_dir = tmp_path / "demo_graph"

    run_workflow_graph_sync(Path("examples/workflows/demo_two_node.graph.json"), run_dir)

    fake_input = load_json(run_dir / "nodes" / "fake" / "input.json")
    assert fake_input["topic"] == "Echoed message: hello from editable workbench"


def test_cli_emit_json_stdout_contract(tmp_path: Path) -> None:
    run_dir = tmp_path / "demo_graph"

    result = CliRunner().invoke(
        app,
        [
            "workflow",
            "run",
            "examples/workflows/demo_two_node.graph.json",
            "--run-dir",
            str(run_dir),
            "--emit-json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["status"] == "success"
    assert result.stdout.strip().startswith("{")
    assert result.stdout.strip().endswith("}")


def test_failed_node_marks_workflow_failed(tmp_path: Path) -> None:
    graph = load_json(Path("examples/workflows/demo_two_node.graph.json"))
    graph["nodes"][1]["input"] = {"missing": "field"}
    graph_path = tmp_path / "bad.graph.json"
    graph_path.write_text(json.dumps(graph), encoding="utf-8")
    run_dir = tmp_path / "bad_graph"

    result = run_workflow_graph_sync(graph_path, run_dir)

    assert result["status"] == "failed"
    assert (run_dir / "workflow_run.json").exists()
    assert result["nodes"][1]["status"] != "success"
