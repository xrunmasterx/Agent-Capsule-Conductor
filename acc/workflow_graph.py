from __future__ import annotations

import re
from collections import deque
from pathlib import Path
from typing import Any

from jinja2 import Environment, TemplateSyntaxError, meta
from jsonschema import Draft202012Validator

from acc.registry import CapsuleRegistry
from acc.utils import AccError, load_json

NODE_REF_PATTERN = re.compile(r"nodes\.([a-zA-Z0-9_-]+)\.")


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
        if edge["from"] == edge["to"]:
            raise AccError(f"Edge {edge['id']} cannot connect node {edge['from']!r} to itself")
    ordered = topological_order(graph)
    ancestors = graph_ancestors(graph, ordered)
    for node in nodes:
        capsule = registry.get(node["capsule_id"])
        if "input" in node and not isinstance(node["input"], dict):
            raise AccError(f"Node {node['id']} input must be an object")
        if "input_mapping" in node and not isinstance(node["input_mapping"], dict):
            raise AccError(f"Node {node['id']} input_mapping must be an object")
        validate_required_input(node, capsule.input_schema_path)
        validate_static_input_payload(
            node.get("input", {}),
            context=f"node {node['id']} input",
        )
        validate_mapping_payload(
            node.get("input_mapping", {}),
            node_set,
            context=f"node {node['id']} input_mapping",
            allowed_node_refs=ancestors[node["id"]],
        )
    for edge in edges:
        validate_mapping_payload(
            edge.get("mapping", {}),
            node_set,
            context=f"edge {edge['id']} mapping",
            allowed_node_refs=ancestors[edge["to"]],
        )


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


def graph_ancestors(graph: dict[str, Any], ordered: list[str]) -> dict[str, set[str]]:
    ancestors: dict[str, set[str]] = {node_id: set() for node_id in ordered}
    for node_id in ordered:
        for edge in graph.get("edges", []):
            if edge["to"] == node_id:
                ancestors[node_id].add(edge["from"])
                ancestors[node_id].update(ancestors[edge["from"]])
    return ancestors


def validate_required_input(node: dict[str, Any], input_schema_path: Path) -> None:
    schema = load_json(input_schema_path)
    required = schema.get("required", []) if isinstance(schema, dict) else []
    if not isinstance(required, list):
        return
    input_keys = set((node.get("input") or {}).keys())
    mapping_keys = set((node.get("input_mapping") or {}).keys())
    missing = [
        str(field)
        for field in required
        if isinstance(field, str) and field not in input_keys and field not in mapping_keys
    ]
    if missing:
        raise AccError(
            f"Node {node['id']} missing required input: {', '.join(sorted(missing))}"
        )


def validate_mapping_payload(
    value: Any,
    node_ids: set[str],
    *,
    context: str,
    allowed_node_refs: set[str],
) -> None:
    if isinstance(value, str):
        validate_mapping_expression(
            value,
            node_ids,
            context=context,
            allowed_node_refs=allowed_node_refs,
        )
        return
    if isinstance(value, list):
        for item in value:
            validate_mapping_payload(
                item,
                node_ids,
                context=context,
                allowed_node_refs=allowed_node_refs,
            )
        return
    if isinstance(value, dict):
        for item in value.values():
            validate_mapping_payload(
                item,
                node_ids,
                context=context,
                allowed_node_refs=allowed_node_refs,
            )


def validate_static_input_payload(value: Any, *, context: str) -> None:
    if isinstance(value, str):
        if "{{" in value or "{%" in value:
            raise AccError(
                f"Invalid static input in {context}: use input_mapping for template expressions"
            )
        return
    if isinstance(value, list):
        for item in value:
            validate_static_input_payload(item, context=context)
        return
    if isinstance(value, dict):
        for item in value.values():
            validate_static_input_payload(item, context=context)


def validate_mapping_expression(
    value: str,
    node_ids: set[str],
    *,
    context: str,
    allowed_node_refs: set[str],
) -> None:
    if "{{" not in value and "{%" not in value:
        return
    environment = Environment(autoescape=False)
    try:
        parsed = environment.parse(value)
    except TemplateSyntaxError as exc:
        raise AccError(f"Invalid mapping expression in {context}: {exc}") from exc
    unknown_roots = meta.find_undeclared_variables(parsed) - {"nodes", "workflow"}
    if unknown_roots:
        raise AccError(
            f"Invalid mapping expression in {context}: unknown root "
            f"{', '.join(sorted(unknown_roots))}"
        )
    for node_id in NODE_REF_PATTERN.findall(value):
        if node_id not in node_ids:
            raise AccError(
                f"Invalid mapping expression in {context}: missing node {node_id!r}"
            )
        if node_id not in allowed_node_refs:
            raise AccError(
                f"Invalid mapping expression in {context}: node {node_id!r} is not upstream"
            )
