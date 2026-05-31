from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from acc.app import WorkflowAppService
from acc.cli import app
from acc.legacy_graph_importer import legacy_graph_to_accflow_payload
from acc.store import write_json
from acc.utils import load_json

runner = CliRunner()


def test_workflow_import_graph_cli_writes_accflow_and_validates(tmp_path: Path) -> None:
    graph_path = tmp_path / "demo.graph.json"
    graph_path.write_text(
        Path("examples/workflows/demo_two_node.graph.json").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    output_path = tmp_path / "demo.accflow.json"

    result = runner.invoke(
        app,
        ["workflow", "import-graph", str(graph_path), "-o", str(output_path)],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["status"] == "imported"
    assert payload["output_path"] == str(output_path.resolve())
    assert payload["validation"]["status"] == "valid"
    assert payload["validation"]["format"] == "accflow"
    assert output_path.exists()
    saved = load_json(output_path)
    assert saved["id"] == "demo_two_node"
    assert saved["metadata"]["canonical_format"] == "accflow"


def test_workflow_import_graph_default_output_path(tmp_path: Path) -> None:
    graph_path = tmp_path / "demo.graph.json"
    graph_path.write_text(
        Path("examples/workflows/demo_two_node.graph.json").read_text(encoding="utf-8"),
        encoding="utf-8",
    )

    result = runner.invoke(app, ["workflow", "import-graph", str(graph_path)])

    assert result.exit_code == 0, result.output
    assert (tmp_path / "demo.accflow.json").exists()


def test_workflow_validate_legacy_graph_includes_import_hint(tmp_path: Path) -> None:
    graph_path = tmp_path / "demo.graph.json"
    graph_path.write_text(
        Path("examples/workflows/demo_two_node.graph.json").read_text(encoding="utf-8"),
        encoding="utf-8",
    )

    result = runner.invoke(app, ["workflow", "validate", str(graph_path)])

    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["format"] == "legacy_graph"
    assert "import-graph" in payload["import_hint"]


def test_import_graph_run_matches_direct_legacy_graph_run(tmp_path: Path) -> None:
    graph_path = Path("examples/workflows/demo_two_node.graph.json")
    accflow_path = tmp_path / "demo_two_node.accflow.json"
    write_json(accflow_path, legacy_graph_to_accflow_payload(graph_path))

    service = WorkflowAppService()
    graph_result = service.run_sync(graph_path, tmp_path / "graph_run")
    accflow_result = service.run_sync(accflow_path, tmp_path / "accflow_run")

    assert graph_result["status"] == "success"
    assert accflow_result["status"] == "success"
    assert {
        node["node_id"]: node["summary"] for node in graph_result["nodes"]
    } == {
        node["node_id"]: node["summary"] for node in accflow_result["nodes"]
    }
