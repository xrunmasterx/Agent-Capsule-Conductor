from __future__ import annotations

import re
from collections import deque
from pathlib import Path
from typing import Any

import yaml
from jinja2 import Environment, TemplateSyntaxError, meta
from jsonschema import Draft202012Validator

from acc.registry import CapsuleRegistry
from acc.utils import AccError, load_json

NODE_REF_PATTERN = re.compile(r"nodes\.([a-zA-Z0-9_-]+)\.")
SUPPORTED_CAPSULE_KINDS = {
    None,
    "atomic",
    "agent_session",
    "agent_workflow",
    "acc_workflow",
    "external_workflow",
}
DEFAULT_POLICY = {"failure_mode": "fail_fast", "max_concurrency": 1}


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
    schema = load_json(workflow_schema_path(graph))
    Draft202012Validator(schema).validate(graph)
    normalized = normalize_workflow_graph(graph)
    validate_graph_semantics(normalized, registry or CapsuleRegistry())
    levels = topological_levels(normalized)
    return {
        "status": "valid",
        "workflow_id": normalized["id"],
        "node_count": len(normalized["nodes"]),
        "edge_count": len(normalized["control_edges"]),
        "control_edge_count": len(normalized["control_edges"]),
        "data_edge_count": len(normalized["data_edges"]),
        "topological_order": topological_order(normalized),
        "topological_levels": levels,
        "policy": normalized["policy"],
    }


def workflow_schema_path(graph: dict[str, Any]) -> Path:
    if is_v3_graph(graph):
        return Path("schemas/workflow_graph_v3_schema.json")
    return Path("schemas/workflow_graph_schema.json")


def is_v3_graph(graph: dict[str, Any]) -> bool:
    return any(key in graph for key in ("control_edges", "data_edges", "policy"))


def normalize_workflow_graph(graph: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(graph)
    policy = {**DEFAULT_POLICY, **dict(graph.get("policy") or {})}
    normalized["policy"] = policy
    if is_v3_graph(graph):
        normalized["control_edges"] = list(graph.get("control_edges", []))
        normalized["data_edges"] = list(graph.get("data_edges", []))
        normalized["edges"] = list(graph.get("control_edges", []))
        normalized["format_version"] = "v3"
        return normalized

    control_edges = list(graph.get("edges", []))
    normalized["control_edges"] = control_edges
    normalized["data_edges"] = legacy_data_edges(graph, control_edges)
    normalized["format_version"] = "legacy"
    return normalized


def legacy_data_edges(
    graph: dict[str, Any],
    control_edges: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    data_edges: list[dict[str, Any]] = []
    for edge in control_edges:
        for input_name, expression in dict(edge.get("mapping") or {}).items():
            source_node = first_node_reference(expression)
            if source_node is None:
                continue
            data_edges.append(
                {
                    "id": f"legacy_data_{edge['id']}_{input_name}",
                    "from": {"node": source_node, "path": str(expression)},
                    "to": {"node": edge["to"], "input": input_name},
                    "required": True,
                }
            )
    for node in graph.get("nodes", []):
        for input_name, expression in dict(node.get("input_mapping") or {}).items():
            source_node = first_node_reference(expression)
            if source_node is None:
                continue
            data_edges.append(
                {
                    "id": f"legacy_mapping_{node['id']}_{input_name}",
                    "from": {"node": source_node, "path": str(expression)},
                    "to": {"node": node["id"], "input": input_name},
                    "required": True,
                }
            )
    return data_edges


def first_node_reference(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    match = NODE_REF_PATTERN.search(value)
    return match.group(1) if match else None


def validate_graph_semantics(graph: dict[str, Any], registry: CapsuleRegistry) -> None:
    normalized = normalize_workflow_graph(graph)
    nodes = normalized["nodes"]
    control_edges = normalized["control_edges"]
    data_edges = normalized["data_edges"]
    node_ids = [node["id"] for node in nodes]
    control_edge_ids = [edge["id"] for edge in control_edges]
    data_edge_ids = [edge["id"] for edge in data_edges]
    if len(set(node_ids)) != len(node_ids):
        raise AccError("Workflow graph contains duplicate node ids")
    all_edge_ids = [*control_edge_ids, *data_edge_ids]
    if len(set(all_edge_ids)) != len(all_edge_ids):
        raise AccError("Workflow graph contains duplicate edge ids")

    node_set = set(node_ids)
    validate_control_edges(control_edges, node_set)
    ordered = topological_order(normalized)
    ancestor_masks, node_bits = graph_ancestor_masks(normalized, ordered)
    capsule_by_node: dict[str, Any] = {}

    for node in nodes:
        capsule = registry.get(node["capsule_id"])
        validate_capsule_kind(capsule)
        capsule_by_node[node["id"]] = capsule
        if "input" in node and not isinstance(node["input"], dict):
            raise AccError(f"Node {node['id']} input must be an object")
        if "input_mapping" in node and not isinstance(node["input_mapping"], dict):
            raise AccError(f"Node {node['id']} input_mapping must be an object")
        validate_static_input_payload(
            node.get("input", {}),
            context=f"node {node['id']} input",
        )
        validate_mapping_payload(
            node.get("input_mapping", {}),
            node_set,
            context=f"node {node['id']} input_mapping",
            allowed_node_bits=ancestor_masks[node["id"]],
            node_bits=node_bits,
        )

    validate_data_edges(data_edges, node_set, ancestor_masks, node_bits, capsule_by_node)

    mapped_inputs = inputs_from_data_edges(data_edges)
    for node in nodes:
        capsule = capsule_by_node[node["id"]]
        data_edge_inputs = mapped_inputs.get(node["id"], set())
        validate_required_input(node, capsule.input_schema_path, data_edge_inputs)
        validate_target_input_names(node, capsule.input_schema_path, data_edge_inputs)

    if normalized["format_version"] == "legacy":
        for edge in control_edges:
            validate_mapping_payload(
                edge.get("mapping", {}),
                node_set,
                context=f"edge {edge['id']} mapping",
                allowed_node_bits=ancestor_masks[edge["to"]],
                node_bits=node_bits,
            )


def validate_capsule_kind(capsule: Any) -> None:
    kind = capsule.raw.get("kind")
    if kind not in SUPPORTED_CAPSULE_KINDS:
        raise AccError(f"Unsupported capsule kind for {capsule.spec.id}: {kind}")


def validate_control_edges(edges: list[dict[str, Any]], node_set: set[str]) -> None:
    for edge in edges:
        if edge["from"] not in node_set:
            raise AccError(f"Edge {edge['id']} points from missing node {edge['from']!r}")
        if edge["to"] not in node_set:
            raise AccError(f"Edge {edge['id']} points to missing node {edge['to']!r}")
        if edge["from"] == edge["to"]:
            raise AccError(f"Edge {edge['id']} cannot connect node {edge['from']!r} to itself")


def validate_data_edges(
    data_edges: list[dict[str, Any]],
    node_set: set[str],
    ancestor_masks: dict[str, int],
    node_bits: dict[str, int],
    capsule_by_node: dict[str, Any],
) -> None:
    for edge in data_edges:
        source = edge["from"]["node"]
        target = edge["to"]["node"]
        if source not in node_set:
            raise AccError(f"Data edge {edge['id']} points from missing node {source!r}")
        if target not in node_set:
            raise AccError(f"Data edge {edge['id']} points to missing node {target!r}")
        if ancestor_masks[target] & node_bits[source] == 0:
            raise AccError(f"Data edge {edge['id']} source {source!r} is not upstream")
        source_ref = edge["from"]
        if not any(key in source_ref for key in ("output", "artifact", "path")):
            raise AccError(f"Data edge {edge['id']} must reference output, artifact, or path")
        if "artifact" in source_ref:
            validate_artifact_reference(edge, capsule_by_node[source])


def validate_artifact_reference(edge: dict[str, Any], capsule: Any) -> None:
    artifact_name = str(edge["from"]["artifact"])
    manifest = yaml.safe_load(capsule.artifact_manifest_path.read_text(encoding="utf-8")) or {}
    candidates: set[str] = set()
    for section in ("required", "optional"):
        for item in manifest.get(section, []) or []:
            if isinstance(item, dict):
                if "name" in item:
                    candidates.add(str(item["name"]))
                if "path" in item:
                    candidates.add(str(Path(item["path"]).name))
                    candidates.add(str(item["path"]))
            elif isinstance(item, str):
                candidates.add(item)
                candidates.add(Path(item).name)
    if artifact_name not in candidates:
        raise AccError(
            f"Data edge {edge['id']} references missing artifact {artifact_name!r} "
            f"from capsule {capsule.spec.id}"
        )


def inputs_from_data_edges(data_edges: list[dict[str, Any]]) -> dict[str, set[str]]:
    mapped: dict[str, set[str]] = {}
    for edge in data_edges:
        mapped.setdefault(edge["to"]["node"], set()).add(edge["to"]["input"])
    return mapped


def topological_order(graph: dict[str, Any]) -> list[str]:
    _normalized, node_ids, outgoing, _incoming, incoming_count = control_graph_structures(graph)

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


def topological_levels(graph: dict[str, Any]) -> list[list[str]]:
    _normalized, node_ids, outgoing, _incoming, incoming_count = control_graph_structures(graph)
    ready = [node_id for node_id in node_ids if incoming_count[node_id] == 0]
    levels: list[list[str]] = []
    processed = 0
    while ready:
        level = ready
        levels.append(level)
        processed += len(level)
        next_level: list[str] = []
        for node_id in level:
            for target in outgoing[node_id]:
                incoming_count[target] -= 1
                if incoming_count[target] == 0:
                    next_level.append(target)
        ready = next_level
    if processed != len(node_ids):
        raise AccError("Workflow graph contains a cycle")
    return levels


def graph_ancestor_masks(
    graph: dict[str, Any],
    ordered: list[str],
) -> tuple[dict[str, int], dict[str, int]]:
    _normalized, _node_ids, _outgoing, incoming, _incoming_count = control_graph_structures(graph)
    node_bits = {node_id: 1 << index for index, node_id in enumerate(ordered)}
    ancestors: dict[str, int] = {node_id: 0 for node_id in ordered}
    for node_id in ordered:
        mask = 0
        for source in incoming[node_id]:
            mask |= ancestors[source] | node_bits[source]
        ancestors[node_id] = mask
    return ancestors, node_bits


def control_graph_structures(
    graph: dict[str, Any],
) -> tuple[dict[str, Any], list[str], dict[str, list[str]], dict[str, list[str]], dict[str, int]]:
    normalized = normalize_workflow_graph(graph)
    node_ids = [node["id"] for node in normalized["nodes"]]
    outgoing: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    incoming: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    incoming_count: dict[str, int] = {node_id: 0 for node_id in node_ids}
    for edge in normalized["control_edges"]:
        source = edge["from"]
        target = edge["to"]
        outgoing[source].append(target)
        incoming[target].append(source)
        incoming_count[target] += 1
    return normalized, node_ids, outgoing, incoming, incoming_count


def validate_required_input(
    node: dict[str, Any],
    input_schema_path: Path,
    data_edge_inputs: set[str] | None = None,
) -> None:
    schema = load_json(input_schema_path)
    required = schema.get("required", []) if isinstance(schema, dict) else []
    if not isinstance(required, list):
        return
    input_keys = set((node.get("input") or {}).keys())
    mapping_keys = set((node.get("input_mapping") or {}).keys())
    data_keys = data_edge_inputs or set()
    missing = [
        str(field)
        for field in required
        if isinstance(field, str)
        and field not in input_keys
        and field not in mapping_keys
        and field not in data_keys
    ]
    if missing:
        raise AccError(f"Node {node['id']} missing required input: {', '.join(sorted(missing))}")


def validate_target_input_names(
    node: dict[str, Any],
    input_schema_path: Path,
    data_edge_inputs: set[str],
) -> None:
    schema = load_json(input_schema_path)
    if not isinstance(schema, dict) or schema.get("additionalProperties", True):
        return
    allowed = set((schema.get("properties") or {}).keys())
    configured = set((node.get("input") or {}).keys())
    configured.update((node.get("input_mapping") or {}).keys())
    configured.update(data_edge_inputs)
    invalid = sorted(configured - allowed)
    if invalid:
        raise AccError(f"Node {node['id']} has unknown input field(s): {', '.join(invalid)}")


def validate_mapping_payload(
    value: Any,
    node_ids: set[str],
    *,
    context: str,
    allowed_node_bits: int,
    node_bits: dict[str, int],
) -> None:
    if isinstance(value, str):
        validate_mapping_expression(
            value,
            node_ids,
            context=context,
            allowed_node_bits=allowed_node_bits,
            node_bits=node_bits,
        )
        return
    if isinstance(value, list):
        for item in value:
            validate_mapping_payload(
                item,
                node_ids,
                context=context,
                allowed_node_bits=allowed_node_bits,
                node_bits=node_bits,
            )
        return
    if isinstance(value, dict):
        for item in value.values():
            validate_mapping_payload(
                item,
                node_ids,
                context=context,
                allowed_node_bits=allowed_node_bits,
                node_bits=node_bits,
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
    allowed_node_bits: int,
    node_bits: dict[str, int],
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
        if allowed_node_bits & node_bits[node_id] == 0:
            raise AccError(
                f"Invalid mapping expression in {context}: node {node_id!r} is not upstream"
            )
