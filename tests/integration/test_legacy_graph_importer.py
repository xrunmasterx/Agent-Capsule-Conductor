from __future__ import annotations

from pathlib import Path

import pytest

from acc.app import WorkflowAppService
from acc.engine import topological_levels
from acc.legacy_graph_importer import legacy_graph_to_accflow_payload, load_legacy_graph_template
from acc.store import write_json
from acc.utils import AccError


def test_legacy_graph_demo_imports_to_canonical_workflow_template() -> None:
    template, _raw = load_legacy_graph_template(Path("examples/workflows/demo_two_node.graph.json"))

    assert template.id == "demo_two_node"
    assert template.metadata["canonical_format"] == "accflow"
    assert template.metadata["imported_from"] == "legacy_graph_json"
    assert set(template.nodes) == {"echo", "fake"}
    assert template.nodes["echo"].raw["legacy_capsule_id"] == "echo-test.generic"


def test_legacy_graph_with_policy_still_imports_legacy_edges_as_control_edges(
    tmp_path: Path,
) -> None:
    graph_path = tmp_path / "legacy_with_policy.graph.json"
    write_json(
        graph_path,
        {
            "id": "legacy_with_policy",
            "version": "0.2.0",
            "policy": {"failure_mode": "fail_fast", "max_concurrency": 4},
            "nodes": [
                {"id": "plan", "capsule_id": "echo-test.generic", "input": {}},
                {"id": "branch_a", "capsule_id": "fake-agent.generic", "input": {}},
                {"id": "branch_b", "capsule_id": "fake-agent.generic", "input": {}},
                {"id": "merge", "capsule_id": "fake-agent.generic", "input": {}},
            ],
            "edges": [
                {"id": "edge_plan_a", "from": "plan", "to": "branch_a"},
                {"id": "edge_plan_b", "from": "plan", "to": "branch_b"},
                {"id": "edge_a_merge", "from": "branch_a", "to": "merge"},
                {"id": "edge_b_merge", "from": "branch_b", "to": "merge"},
            ],
        },
    )
    template, _raw = load_legacy_graph_template(graph_path)

    assert [(edge.source, edge.target) for edge in template.control_edges] == [
        ("plan", "branch_a"),
        ("plan", "branch_b"),
        ("branch_a", "merge"),
        ("branch_b", "merge"),
    ]
    assert topological_levels(template) == [["plan"], ["branch_a", "branch_b"], ["merge"]]


def test_workflow_app_service_validate_rejects_missing_legacy_capsule(tmp_path: Path) -> None:
    graph_path = tmp_path / "missing_capsule.graph.json"
    write_json(
        graph_path,
        {
            "id": "missing_capsule",
            "nodes": [{"id": "only", "capsule_id": "missing.generic", "input": {}}],
            "edges": [],
        },
    )

    with pytest.raises(AccError, match="Capsule not found: missing.generic"):
        WorkflowAppService().validate(graph_path)


def test_legacy_graph_and_imported_accflow_produce_equivalent_outputs_and_events(
    tmp_path: Path,
) -> None:
    graph_path = Path("examples/workflows/demo_two_node.graph.json")
    accflow_path = tmp_path / "demo_two_node_imported.accflow.json"
    write_json(accflow_path, legacy_graph_to_accflow_payload(graph_path))

    service = WorkflowAppService()
    graph_result = service.run_sync(graph_path, tmp_path / "graph_run")
    accflow_result = service.run_sync(accflow_path, tmp_path / "accflow_run")

    assert graph_result["status"] == "success"
    assert accflow_result["status"] == "success"
    assert node_summaries(graph_result) == node_summaries(accflow_result)
    assert event_types(tmp_path / "graph_run") == event_types(tmp_path / "accflow_run")


def node_summaries(payload: dict) -> dict[str, str]:
    return {node["node_id"]: node["summary"] for node in payload["nodes"]}


def event_types(run_dir: Path) -> list[str]:
    return [
        line.split('"type": "', 1)[1].split('"', 1)[0]
        for line in (run_dir / "workflow_events.jsonl").read_text(encoding="utf-8").splitlines()
        if '"type": "' in line
    ]
