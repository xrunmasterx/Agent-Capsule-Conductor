from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from acc.app import WorkflowAppService
from acc.cli import app
from acc.migration.graph_importer import legacy_graph_to_accflow_payload
from acc.store import write_json
from acc.utils import AccError, load_json

runner = CliRunner()
LEGACY_GRAPH_FIXTURE = Path("tests/fixtures/legacy/demo_two_node.graph.json")


def test_workflow_import_graph_cli_writes_accflow_and_validates(tmp_path: Path) -> None:
    graph_path = tmp_path / "demo.graph.json"
    graph_path.write_text(
        LEGACY_GRAPH_FIXTURE.read_text(encoding="utf-8"),
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
        LEGACY_GRAPH_FIXTURE.read_text(encoding="utf-8"),
        encoding="utf-8",
    )

    result = runner.invoke(app, ["workflow", "import-graph", str(graph_path)])

    assert result.exit_code == 0, result.output
    assert (tmp_path / "demo.accflow.json").exists()


def test_migrate_graph_cli_alias_writes_accflow(tmp_path: Path) -> None:
    graph_path = tmp_path / "demo.graph.json"
    graph_path.write_text(
        LEGACY_GRAPH_FIXTURE.read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    output_path = tmp_path / "migrated.accflow.json"

    result = runner.invoke(app, ["migrate", "graph", str(graph_path), "-o", str(output_path)])

    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["status"] == "imported"
    assert payload["output_path"] == str(output_path.resolve())
    assert output_path.exists()


def test_workflow_validate_legacy_graph_rejects_with_migration_hint(tmp_path: Path) -> None:
    graph_path = tmp_path / "demo.graph.json"
    graph_path.write_text(
        LEGACY_GRAPH_FIXTURE.read_text(encoding="utf-8"),
        encoding="utf-8",
    )

    result = runner.invoke(app, ["workflow", "validate", str(graph_path)])

    assert result.exit_code == 1
    assert ".graph.json is not runnable" in result.output
    assert "acc migrate graph" in result.output


def test_import_graph_output_path_must_be_accflow(tmp_path: Path) -> None:
    graph_path = tmp_path / "demo.graph.json"
    graph_path.write_text(
        LEGACY_GRAPH_FIXTURE.read_text(encoding="utf-8"),
        encoding="utf-8",
    )

    result = runner.invoke(
        app,
        ["migrate", "graph", str(graph_path), "-o", str(tmp_path / "bad.json")],
    )

    assert result.exit_code == 1
    assert "must end with .accflow.json" in result.output


def test_import_graph_output_path_must_stay_near_source(tmp_path: Path) -> None:
    graph_dir = tmp_path / "graphs"
    out_dir = tmp_path / "outside"
    graph_dir.mkdir()
    out_dir.mkdir()
    graph_path = graph_dir / "demo.graph.json"
    graph_path.write_text(
        LEGACY_GRAPH_FIXTURE.read_text(encoding="utf-8"),
        encoding="utf-8",
    )

    result = runner.invoke(
        app,
        ["migrate", "graph", str(graph_path), "-o", str(out_dir / "demo.accflow.json")],
    )

    assert result.exit_code == 1
    assert "inside the source graph directory" in result.output


def test_import_graph_output_runs_after_migration(tmp_path: Path) -> None:
    graph_path = LEGACY_GRAPH_FIXTURE
    accflow_path = tmp_path / "demo_two_node.accflow.json"
    write_json(accflow_path, legacy_graph_to_accflow_payload(graph_path))

    service = WorkflowAppService()
    accflow_result = service.run_sync(accflow_path, tmp_path / "accflow_run")

    assert accflow_result["status"] == "success"


def test_direct_legacy_graph_run_is_rejected() -> None:
    graph_path = LEGACY_GRAPH_FIXTURE

    with pytest.raises(AccError, match="not runnable"):
        WorkflowAppService().run_sync(graph_path, Path("runs") / "rejected_graph_run")
