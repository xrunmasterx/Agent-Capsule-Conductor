from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError

from acc.registry import CapsuleRegistry
from acc.utils import AccError, load_json
from acc.workflow_graph import topological_order, validate_workflow_graph


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
