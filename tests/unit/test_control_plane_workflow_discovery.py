from __future__ import annotations

import json
from pathlib import Path

from acc.control_plane import discover_workflow_files, workflow_file_id, workflow_metadata
from acc.registry import CapsuleRegistry
from acc.utils import repo_root


def test_discover_workflow_files_prefers_accflow_over_legacy_graph(tmp_path: Path) -> None:
    workflows_dir = tmp_path / "workflows"
    workflows_dir.mkdir()
    graph_path = workflows_dir / "demo_dual.graph.json"
    accflow_path = workflows_dir / "demo_dual.accflow.json"
    graph_path.write_text(
        json.dumps({"id": "demo_dual", "name": "Legacy", "nodes": [], "edges": []}),
        encoding="utf-8",
    )
    accflow_path.write_text(
        json.dumps(
            {
                "id": "demo_dual",
                "version": "1.0.0",
                "name": "Canonical",
                "nodes": [
                    {
                        "id": "echo",
                        "kind": "agent",
                        "runtime": "echo-test.generic",
                        "ports": {"inputs": [], "outputs": []},
                    }
                ],
                "control_edges": [],
                "data_edges": [],
                "policy": {"failure_mode": "fail_fast", "max_concurrency": 1},
                "workspace_policy": {"save_mode": "stateless_template"},
            }
        ),
        encoding="utf-8",
    )

    discovered = discover_workflow_files(tmp_path, workflows_dir)
    discovered_names = {path.name for path in discovered}

    assert "demo_dual.accflow.json" in discovered_names
    assert "demo_dual.graph.json" not in discovered_names


def test_discover_workflow_files_includes_accflow_only_workflow(tmp_path: Path) -> None:
    workflows_dir = tmp_path / "workflows"
    workflows_dir.mkdir()
    accflow_path = workflows_dir / "accflow_only.accflow.json"
    accflow_path.write_text(
        json.dumps(
            {
                "id": "accflow_only",
                "version": "1.0.0",
                "name": "Accflow Only",
                "nodes": [
                    {
                        "id": "echo",
                        "kind": "agent",
                        "runtime": "echo-test.generic",
                        "ports": {"inputs": [], "outputs": []},
                    }
                ],
                "control_edges": [],
                "data_edges": [],
                "policy": {"failure_mode": "fail_fast", "max_concurrency": 1},
                "workspace_policy": {"save_mode": "stateless_template"},
            }
        ),
        encoding="utf-8",
    )

    discovered = discover_workflow_files(tmp_path, workflows_dir)

    assert discovered == [accflow_path.resolve()]


def test_workflow_metadata_marks_accflow_type() -> None:
    project_root = repo_root()
    accflow_path = project_root / "examples/workflows/stateless_template_demo.accflow.json"
    registry = CapsuleRegistry()

    metadata = workflow_metadata(accflow_path, project_root, registry)

    assert metadata["workflow_id"] == "stateless_template_demo"
    assert metadata["type"] == "accflow"
    assert workflow_file_id(accflow_path) == "stateless_template_demo"


def test_discover_includes_repo_accflow_examples() -> None:
    project_root = repo_root()
    discovered = discover_workflow_files(project_root)
    accflow_names = {path.name for path in discovered if path.name.endswith(".accflow.json")}

    assert "stateless_template_demo.accflow.json" in accflow_names
