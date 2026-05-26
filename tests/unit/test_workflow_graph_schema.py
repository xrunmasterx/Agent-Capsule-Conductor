from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError

from acc.registry import CapsuleRegistry
from acc.utils import AccError, load_json
from acc.workflow_graph import topological_levels, topological_order, validate_workflow_graph


def write_graph(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def valid_graph() -> dict:
    return load_json(Path("examples/workflows/demo_two_node.graph.json"))


def test_valid_graph_loads() -> None:
    result = validate_workflow_graph(Path("examples/workflows/demo_two_node.graph.json"))

    assert result["status"] == "valid"
    assert result["topological_order"] == ["echo", "fake"]


def test_missing_graph_id_fails(tmp_path: Path) -> None:
    graph = valid_graph()
    graph.pop("id")
    path = tmp_path / "graph.json"
    write_graph(path, graph)

    with pytest.raises(JsonSchemaValidationError, match="'id' is a required property"):
        validate_workflow_graph(path)


def test_duplicate_node_id_fails(tmp_path: Path) -> None:
    graph = valid_graph()
    graph["nodes"][1]["id"] = "echo"
    path = tmp_path / "graph.json"
    write_graph(path, graph)

    with pytest.raises(AccError, match="duplicate node ids"):
        validate_workflow_graph(path)


def test_duplicate_edge_id_fails(tmp_path: Path) -> None:
    graph = valid_graph()
    graph["edges"].append({"id": "edge_echo_fake", "from": "fake", "to": "echo"})
    path = tmp_path / "graph.json"
    write_graph(path, graph)

    with pytest.raises(AccError, match="duplicate edge ids"):
        validate_workflow_graph(path)


def test_edge_source_missing_fails(tmp_path: Path) -> None:
    graph = valid_graph()
    graph["edges"][0]["from"] = "missing"
    path = tmp_path / "graph.json"
    write_graph(path, graph)

    with pytest.raises(AccError, match="missing node 'missing'"):
        validate_workflow_graph(path)


def test_edge_target_missing_fails(tmp_path: Path) -> None:
    graph = valid_graph()
    graph["edges"][0]["to"] = "missing"
    path = tmp_path / "graph.json"
    write_graph(path, graph)

    with pytest.raises(AccError, match="missing node 'missing'"):
        validate_workflow_graph(path)


def test_missing_capsule_id_fails(tmp_path: Path) -> None:
    graph = valid_graph()
    graph["nodes"][0]["capsule_id"] = "missing.generic"
    path = tmp_path / "graph.json"
    write_graph(path, graph)

    with pytest.raises(AccError, match="Capsule not found"):
        validate_workflow_graph(path, CapsuleRegistry())


def test_cycle_detection_works(tmp_path: Path) -> None:
    graph = valid_graph()
    graph["edges"].append({"id": "edge_fake_echo", "from": "fake", "to": "echo"})
    path = tmp_path / "graph.json"
    write_graph(path, graph)

    with pytest.raises(AccError, match="cycle"):
        validate_workflow_graph(path)


def test_self_edge_fails(tmp_path: Path) -> None:
    graph = valid_graph()
    graph["edges"][0] = {"id": "edge_echo_echo", "from": "echo", "to": "echo"}
    path = tmp_path / "graph.json"
    write_graph(path, graph)

    with pytest.raises(AccError, match="cannot connect node 'echo' to itself"):
        validate_workflow_graph(path)


def test_missing_required_input_fails(tmp_path: Path) -> None:
    graph = valid_graph()
    graph["nodes"][1]["input"] = {}
    graph["nodes"][1].pop("input_mapping", None)
    path = tmp_path / "graph.json"
    write_graph(path, graph)

    with pytest.raises(AccError, match="missing required input: topic"):
        validate_workflow_graph(path)


def test_invalid_mapping_expression_unknown_root_fails(tmp_path: Path) -> None:
    graph = valid_graph()
    graph["nodes"][1]["input"] = {}
    graph["nodes"][1]["input_mapping"] = {"topic": "{{ unknown.value }}"}
    path = tmp_path / "graph.json"
    write_graph(path, graph)

    with pytest.raises(AccError, match="unknown root unknown"):
        validate_workflow_graph(path)


def test_mapping_expression_must_reference_upstream_node(tmp_path: Path) -> None:
    graph = valid_graph()
    graph["nodes"][0]["input"] = {}
    graph["nodes"][0]["input_mapping"] = {"message": "{{ nodes.fake.output.summary }}"}
    path = tmp_path / "graph.json"
    write_graph(path, graph)

    with pytest.raises(AccError, match="node 'fake' is not upstream"):
        validate_workflow_graph(path)


def test_static_input_rejects_template_expressions(tmp_path: Path) -> None:
    graph = valid_graph()
    graph["nodes"][1]["input"] = {"topic": "{{ nodes.echo.output.summary }}"}
    graph["nodes"][1].pop("input_mapping", None)
    path = tmp_path / "graph.json"
    write_graph(path, graph)

    with pytest.raises(AccError, match="use input_mapping for template expressions"):
        validate_workflow_graph(path)


def test_position_is_optional(tmp_path: Path) -> None:
    graph = valid_graph()
    for node in graph["nodes"]:
        node.pop("position", None)
    path = tmp_path / "graph.json"
    write_graph(path, graph)

    assert topological_order(graph) == ["echo", "fake"]
    assert validate_workflow_graph(path)["status"] == "valid"


def test_node_input_must_be_object(tmp_path: Path) -> None:
    graph = valid_graph()
    graph["nodes"][0]["input"] = "bad"
    path = tmp_path / "graph.json"
    write_graph(path, graph)

    with pytest.raises(JsonSchemaValidationError, match="'bad' is not of type 'object'"):
        validate_workflow_graph(path)


def test_topological_levels_preserve_parallel_layers() -> None:
    graph = load_json(Path("examples/workflows/demo_parallel.graph.json"))

    levels = topological_levels(graph)

    assert levels == [["plan"], ["branch_a", "branch_b"], ["merge"]]


def test_legacy_edges_still_define_dependencies_when_policy_is_present() -> None:
    graph = load_json(Path("examples/workflows/demo_parallel.graph.json"))
    graph["policy"] = {"failure_mode": "fail_fast", "max_concurrency": 4}

    levels = topological_levels(graph)

    assert levels == [["plan"], ["branch_a", "branch_b"], ["merge"]]


def test_validate_large_linear_graph(tmp_path: Path) -> None:
    nodes = [
        {
            "id": "node_0",
            "capsule_id": "echo-test.generic",
            "input": {"message": "seed"},
        }
    ]
    edges = []
    for index in range(1, 150):
        previous = f"node_{index - 1}"
        current = f"node_{index}"
        nodes.append(
            {
                "id": current,
                "capsule_id": "echo-test.generic",
                "input_mapping": {"message": f"{{{{ nodes.{previous}.output.summary }}}}"},
            }
        )
        edges.append({"id": f"edge_{previous}_{current}", "from": previous, "to": current})

    path = tmp_path / "large.graph.json"
    write_graph(
        path,
        {
            "id": "large_linear",
            "version": "1.0",
            "name": "Large Linear",
            "nodes": nodes,
            "edges": edges,
        },
    )

    result = validate_workflow_graph(path)

    assert result["status"] == "valid"
    assert result["node_count"] == 150
    assert len(result["topological_levels"]) == 150
