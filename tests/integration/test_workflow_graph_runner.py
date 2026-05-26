from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from acc.app import WorkflowAppService
from acc.cli import app
from acc.utils import load_json


def run_workflow(graph_path: Path, run_dir: Path) -> dict:
    return WorkflowAppService().run_sync(graph_path, run_dir)


def test_runs_demo_two_node_graph_successfully(tmp_path: Path) -> None:
    run_dir = tmp_path / "demo_graph"

    result = run_workflow(Path("examples/workflows/demo_two_node.graph.json"), run_dir)

    assert result["status"] == "success"
    assert (run_dir / "workflow_run.json").exists()
    assert (run_dir / "nodes" / "echo" / "output.json").exists()
    assert (run_dir / "nodes" / "fake" / "output.json").exists()
    assert (run_dir / "nodes" / "fake" / "artifacts" / "report.md").exists()


def test_template_mapping_passes_previous_output_to_next_node(tmp_path: Path) -> None:
    run_dir = tmp_path / "demo_graph"

    run_workflow(Path("examples/workflows/demo_two_node.graph.json"), run_dir)

    fake_input = load_json(run_dir / "nodes" / "fake" / "input.json")
    assert fake_input["topic"] == "Echoed message: hello from editable workbench"
    assert set(fake_input) == {"notes", "topic"}


def test_graph_metadata_does_not_pollute_node_input_or_prompt(tmp_path: Path) -> None:
    graph = load_json(Path("examples/workflows/demo_two_node.graph.json"))
    graph["metadata"] = {
        "global_instruction": "DO NOT LEAK INTO NODE",
        "debug_context": {"unrelated": "outside graph state"},
    }
    graph["nodes"][1]["label"] = "Noisy UI label that should stay outside agent prompt"
    graph["nodes"][1]["notes"] = "Noisy node notes that should stay outside agent prompt"
    graph["edges"][0]["mapping"] = {"unused": "Noisy edge mapping"}
    graph_path = tmp_path / "isolated.graph.json"
    graph_path.write_text(json.dumps(graph), encoding="utf-8")
    run_dir = tmp_path / "isolated_graph"

    result = run_workflow(graph_path, run_dir)

    assert result["status"] == "success"
    fake_input_text = (run_dir / "nodes" / "fake" / "input.json").read_text(encoding="utf-8")
    fake_prompt_text = (run_dir / "nodes" / "fake" / "resolved_prompt.md").read_text(
        encoding="utf-8"
    )
    assert "DO NOT LEAK INTO NODE" not in fake_input_text
    assert "DO NOT LEAK INTO NODE" not in fake_prompt_text
    assert "Noisy UI label" not in fake_input_text
    assert "Noisy UI label" not in fake_prompt_text
    assert "Noisy node notes" not in fake_input_text
    assert "Noisy node notes" not in fake_prompt_text
    assert "Noisy edge mapping" not in fake_input_text
    assert "Noisy edge mapping" not in fake_prompt_text


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
    graph["nodes"][1]["input"] = {"topic": 123}
    graph["nodes"][1].pop("input_mapping", None)
    graph_path = tmp_path / "bad.graph.json"
    graph_path.write_text(json.dumps(graph), encoding="utf-8")
    run_dir = tmp_path / "bad_graph"

    result = run_workflow(graph_path, run_dir)

    assert result["status"] == "failed"
    assert (run_dir / "workflow_run.json").exists()
    assert result["nodes"][1]["status"] != "success"
