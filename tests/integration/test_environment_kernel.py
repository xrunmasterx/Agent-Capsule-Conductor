from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from acc.app import WorkflowAppService
from acc.cli import app
from acc.utils import AccError, load_json
from acc.workflow_graph import validate_workflow_graph


def run_workflow(
    graph_path: Path,
    run_dir: Path,
    *,
    binding_path: Path | None = None,
) -> dict:
    return WorkflowAppService().run_sync(graph_path, run_dir, binding_path=binding_path)


def test_stateless_workflow_creates_environment_and_ports(tmp_path: Path) -> None:
    run_dir = tmp_path / "stateless"

    result = run_workflow(
        Path("examples/workflows/stateless_template_demo.graph.json"),
        run_dir,
    )

    assert result["status"] == "success"
    environment_manifest = load_json(
        run_dir / "environments" / "root_env" / "environment_manifest.json"
    )
    workspace_root = Path(environment_manifest["workspace_root"])
    assert environment_manifest["state_mode"] == "stateless"
    assert workspace_root == run_dir / "environments" / "root_env" / "workspace"
    assert workspace_root.exists()
    assert (
        run_dir
        / "environments"
        / "root_env"
        / ".acc"
        / "inbox"
        / "review"
        / "from_plan"
        / "plan_main"
        / "inbox_manifest.json"
    ).exists()
    assert (
        run_dir
        / "environments"
        / "root_env"
        / ".acc"
        / "outbox"
        / "plan"
        / "main"
        / "outbox_manifest.json"
    ).exists()


def test_bound_workflow_uses_binding_without_mutating_template(tmp_path: Path) -> None:
    graph_path = Path("examples/workflows/environment_stateful_demo.graph.json")
    before = graph_path.read_text(encoding="utf-8")
    binding_path = tmp_path / "binding.local.json"
    run_dir = tmp_path / "bound"

    bind_result = CliRunner().invoke(
        app,
        [
            "workflow",
            "bind",
            str(graph_path),
            "--workspace",
            ".",
            "--out",
            str(binding_path),
        ],
    )
    assert bind_result.exit_code == 0, bind_result.output
    result = run_workflow(graph_path, run_dir, binding_path=binding_path)

    assert result["status"] == "success"
    assert graph_path.read_text(encoding="utf-8") == before
    binding = load_json(binding_path)
    assert Path(binding["workspace_root"]).resolve() == Path(".").resolve()
    workspace_manifest = load_json(run_dir / "node_runs" / "agent_a" / "workspace_manifest.json")
    assert Path(workspace_manifest["path"]).resolve() == Path(".").resolve()
    assert (
        run_dir
        / "environments"
        / "root_env"
        / ".acc"
        / "snapshots"
        / "behavior_pack"
        / "agent_a"
        / "behavior_pack_manifest.json"
    ).exists()


def test_ports_inspect_reports_source_lineage(tmp_path: Path) -> None:
    run_dir = tmp_path / "bound"
    binding_path = tmp_path / "binding.local.json"
    CliRunner().invoke(
        app,
        [
            "workflow",
            "bind",
            "examples/workflows/environment_stateful_demo.graph.json",
            "--workspace",
            ".",
            "--out",
            str(binding_path),
        ],
    )
    run_workflow(
        Path("examples/workflows/environment_stateful_demo.graph.json"),
        run_dir,
        binding_path=binding_path,
    )

    inspect_result = CliRunner().invoke(app, ["ports", "inspect", str(run_dir), "--json"])

    assert inspect_result.exit_code == 0, inspect_result.output
    payload = json.loads(inspect_result.stdout)
    assert payload["outboxes"]
    assert payload["inboxes"]
    inbox = next(item for item in payload["inboxes"] if item["node_id"] == "agent_b")
    assert inbox["source_node_id"] == "agent_a"
    assert inbox["source_session_id"].startswith("session_")


def test_stateful_inside_stateful_is_rejected(tmp_path: Path) -> None:
    graph = load_json(Path("examples/workflows/nested_environment_demo.graph.json"))
    graph["workspace_policy"]["default_state_mode"] = "stateful"
    graph["nodes"][0]["workspace_mode"] = "stateful_binding_required"
    path = tmp_path / "bad.graph.json"
    path.write_text(json.dumps(graph), encoding="utf-8")

    with pytest.raises(AccError, match="Stateful workflow cannot contain another stateful"):
        validate_workflow_graph(path)
