from __future__ import annotations

from collections import deque
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from acc.registry import CapsuleRegistry
from acc.utils import AccError, load_json


def load_workflow_graph(graph_path: Path) -> dict[str, Any]:
    payload = load_json(graph_path)
    if not isinstance(payload, dict):
        raise AccError(f"Workflow graph must be a JSON object: {graph_path}")
    return payload


def validate_workflow_graph(
    graph_path: Path,
    registry: CapsuleRegistry | None = None,
) -> dict[str, Any]:
    graph = load_workflow_graph(graph_path)
    schema = load_json(Path("schemas/workflow_graph_schema.json"))
    Draft202012Validator(schema).validate(graph)
    validate_graph_semantics(graph, registry or CapsuleRegistry())
    return {
        "status": "valid",
        "workflow_id": graph["id"],
        "node_count": len(graph["nodes"]),
        "edge_count": len(graph.get("edges", [])),
        "topological_order": topological_order(graph),
    }


def validate_graph_semantics(graph: dict[str, Any], registry: CapsuleRegistry) -> None:
    nodes = graph["nodes"]
    edges = graph.get("edges", [])
    node_ids = [node["id"] for node in nodes]
    edge_ids = [edge["id"] for edge in edges]
    if len(set(node_ids)) != len(node_ids):
        raise AccError("Workflow graph contains duplicate node ids")
    if len(set(edge_ids)) != len(edge_ids):
        raise AccError("Workflow graph contains duplicate edge ids")

    node_set = set(node_ids)
    for edge in edges:
        if edge["from"] not in node_set:
            raise AccError(f"Edge {edge['id']} points from missing node {edge['from']!r}")
        if edge["to"] not in node_set:
            raise AccError(f"Edge {edge['id']} points to missing node {edge['to']!r}")
    for node in nodes:
        registry.get(node["capsule_id"])
        if "input" in node and not isinstance(node["input"], dict):
            raise AccError(f"Node {node['id']} input must be an object")
    topological_order(graph)


def topological_order(graph: dict[str, Any]) -> list[str]:
    node_ids = [node["id"] for node in graph["nodes"]]
    outgoing: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    incoming_count: dict[str, int] = {node_id: 0 for node_id in node_ids}
    for edge in graph.get("edges", []):
        outgoing[edge["from"]].append(edge["to"])
        incoming_count[edge["to"]] += 1

    queue = deque(node_id for node_id in node_ids if incoming_count[node_id] == 0)
    ordered: list[str] = []
    while queue:
        node_id = queue.popleft()
        ordered.append(node_id)
        for target in outgoing[node_id]:
            incoming_count[target] -= 1
            if incoming_count[target] == 0:
                queue.append(target)
    if len(ordered) != len(node_ids):
        raise AccError("Workflow graph contains a cycle")
    return ordered
