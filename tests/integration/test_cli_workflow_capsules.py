import json
from pathlib import Path

from typer.testing import CliRunner

from acc.app import WorkflowAppService
from acc.cli import app
from acc.utils import load_json


def run_workflow(graph_path: Path, run_dir: Path) -> dict:
    return WorkflowAppService().run_sync(graph_path, run_dir)


def test_cli_validates_goal2_workflow_capsules() -> None:
    runner = CliRunner()

    for capsule_id in [
        "codex-workflow-capsule.example",
        "acc-subworkflow-capsule.example",
        "external-workflow-capsule.example",
    ]:
        result = runner.invoke(app, ["validate", capsule_id])
        assert result.exit_code == 0, result.output


def test_cli_runs_agent_and_external_workflow_capsules(tmp_path: Path) -> None:
    runner = CliRunner()

    agent_run = runner.invoke(
        app,
        [
            "run",
            "codex-workflow-capsule.example",
            "--input-json",
            json.dumps({"topic": "cli workflow capsule"}),
            "--run-dir",
            str(tmp_path / "agent_workflow"),
            "--emit-conductor-json",
        ],
    )
    assert agent_run.exit_code == 0, agent_run.output
    assert json.loads(agent_run.stdout)["status"] == "success"

    external_run = runner.invoke(
        app,
        [
            "run",
            "external-workflow-capsule.example",
            "--input-json",
            json.dumps({"workflow_input": "cli external workflow"}),
            "--run-dir",
            str(tmp_path / "external_workflow"),
            "--emit-conductor-json",
        ],
    )
    assert external_run.exit_code == 0, external_run.output
    assert json.loads(external_run.stdout)["status"] == "success"


def test_cli_runs_nested_acc_workflow_capsule_and_writes_snapshot(tmp_path: Path) -> None:
    run_dir = tmp_path / "acc_subworkflow"
    result = CliRunner().invoke(
        app,
        [
            "run",
            "acc-subworkflow-capsule.example",
            "--input",
            "examples/capsules/acc-subworkflow-capsule.example/input.json",
            "--run-dir",
            str(run_dir),
            "--emit-conductor-json",
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["status"] == "success"
    assert (run_dir / "template_snapshot" / "workflow.graph.json").exists()
    assert (run_dir / "lifecycle_logs" / "collect" / "stage.json").exists()
    assert (run_dir / "artifacts" / "nested_workflow" / "workflow_summary.json").exists()


def test_parent_workflow_consumes_child_workflow_capsule_output(tmp_path: Path) -> None:
    run_dir = tmp_path / "nested_demo"

    result = run_workflow(
        Path("examples/workflows/workflow_capsule_nested_demo.graph.json"),
        run_dir,
    )

    assert result["status"] == "success"
    final_input = load_json(run_dir / "node_runs" / "final_review" / "input.json")
    assert final_input["topic"] == "Nested workflow nested_workflow_capsule_demo success"
