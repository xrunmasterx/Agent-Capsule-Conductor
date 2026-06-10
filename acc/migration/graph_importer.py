from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from acc.models import CORE_V2_SCHEMA_VERSION, AccError
from acc.hermetic_callables import HERMETIC_AGENT_CLASS_IDS, HERMETIC_TOOL_CLASS_IDS


def accflow_path_from_legacy_graph_path(path: Path) -> Path:
    if path.name.endswith(".graph.json"):
        return path.with_name(path.name.replace(".graph.json", ".accflow.json"))
    if path.name.endswith(".accflow.json"):
        return path
    return path.with_suffix(".accflow.json")


def legacy_graph_to_accflow_payload(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise AccError(f"Workflow graph not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise AccError(f"Invalid JSON in {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise AccError(f"Workflow graph must be a JSON object: {path}")
    return legacy_graph_dict_to_accflow_payload(payload, source_path=path)


def legacy_graph_dict_to_accflow_payload(
    graph: dict[str, Any],
    *,
    source_path: Path | None = None,
) -> dict[str, Any]:
    if graph.get("schema_version") == CORE_V2_SCHEMA_VERSION:
        return json.loads(json.dumps(graph))
    workflow_id = _required_string(graph, "id", "workflow graph")
    nodes = graph.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        raise AccError("Workflow graph nodes must be a non-empty array")
    payload = {
        "schema_version": CORE_V2_SCHEMA_VERSION,
        "id": workflow_id,
        "version": str(graph.get("version") or "0.1.0"),
        "nodes": [_node_to_core_v2(node) for node in nodes if isinstance(node, dict)],
        "control_edges": [
            _edge_to_core_v2(edge)
            for edge in graph.get("control_edges") or graph.get("edges") or []
        ],
        "data_edges": [_data_edge_to_core_v2(edge) for edge in graph.get("data_edges") or []],
        "exposed_inputs": _ports_to_mapping(graph.get("exposed_inputs"), "input"),
        "exposed_outputs": _ports_to_mapping(graph.get("exposed_outputs"), "output"),
        "workflow_input_bindings": graph.get("workflow_input_bindings") or [],
        "workflow_output_bindings": graph.get("workflow_output_bindings") or [],
        "metadata": {
            "imported_from": str(source_path) if source_path is not None else None,
            "canonical_format": "accflow",
        },
    }
    _ensure_referenced_ports(payload)
    return payload


def _node_to_core_v2(node: dict[str, Any]) -> dict[str, Any]:
    node_id = _required_string(node, "id", "workflow node")
    callable_ref = node.get("callable_ref")
    if isinstance(callable_ref, dict):
        ref = dict(callable_ref)
    else:
        kind = str(node.get("kind") or "").lower()
        tool_id = node.get("tool")
        runtime_id = (
            node.get("runtime")
            or node.get("capsule_id")
            or node.get("capsuleId")
            or node.get("legacy_capsule_id")
        )
        if kind == "tool" or isinstance(tool_id, str):
            ref = {
                "kind": "tool_class",
                "id": _known_tool_id(str(tool_id or runtime_id or node_id)),
            }
        elif kind == "workflow" and isinstance(node.get("workflow_ref"), str):
            ref = {
                "kind": "workflow_function",
                "id": Path(str(node["workflow_ref"])).name,
            }
        else:
            ref = {"kind": "agent_class", "id": _known_agent_id(str(runtime_id or ""))}
    payload = {
        "id": node_id,
        "callable_ref": ref,
        "ports": {
            "inputs": _ports_to_mapping(node.get("input_ports"), "input"),
            "outputs": _ports_to_mapping(node.get("output_ports"), "output"),
        },
    }
    static_input = node.get("input")
    if isinstance(static_input, dict) and static_input:
        payload["input_bindings"] = [
            {"target_port": key, "static_value": value}
            for key, value in sorted(static_input.items())
        ]
        for key in static_input:
            if isinstance(key, str):
                payload["ports"]["inputs"].setdefault(key, {"type": "json"})
    return payload


def _ensure_referenced_ports(payload: dict[str, Any]) -> None:
    nodes = {
        node.get("id"): node
        for node in payload.get("nodes", [])
        if isinstance(node, dict) and isinstance(node.get("id"), str)
    }

    def ensure_port(node_id: str, direction: str, port: str) -> None:
        node = nodes.get(node_id)
        if node is None or not port:
            return
        ports = node.setdefault("ports", {})
        key = "inputs" if direction == "input" else "outputs"
        port_map = ports.setdefault(key, {})
        port_map.setdefault(port, {"type": "json"})

    for node in nodes.values():
        for binding in node.get("input_bindings") or []:
            if isinstance(binding, dict):
                ensure_port(str(node["id"]), "input", str(binding.get("target_port") or "main"))
                source = binding.get("source")
                if isinstance(source, dict):
                    ensure_port(
                        str(source.get("node")),
                        "output",
                        str(source.get("port") or "main"),
                    )
    for binding in payload.get("workflow_input_bindings") or []:
        if isinstance(binding, dict) and isinstance(binding.get("target"), dict):
            target = binding["target"]
            ensure_port(str(target.get("node")), "input", str(target.get("port") or "main"))
    for binding in payload.get("workflow_output_bindings") or []:
        if isinstance(binding, dict) and isinstance(binding.get("source"), dict):
            source = binding["source"]
            ensure_port(str(source.get("node")), "output", str(source.get("port") or "main"))
    for edge in payload.get("data_edges") or []:
        if not isinstance(edge, dict):
            continue
        source = edge.get("source")
        target = edge.get("target")
        if isinstance(source, dict):
            ensure_port(str(source.get("node")), "output", str(source.get("port") or "main"))
        if isinstance(target, dict):
            ensure_port(str(target.get("node")), "input", str(target.get("port") or "main"))


def _edge_to_core_v2(edge: Any) -> dict[str, Any]:
    if not isinstance(edge, dict):
        raise AccError("Control edge must be an object")
    source = edge.get("from", edge.get("source"))
    target = edge.get("to", edge.get("target"))
    if not isinstance(source, str) or not isinstance(target, str):
        raise AccError("Control edge requires from/to node ids")
    return {"from": source, "to": target}


def _data_edge_to_core_v2(edge: Any) -> dict[str, Any]:
    if not isinstance(edge, dict):
        raise AccError("Data edge must be an object")
    source = edge.get("source") or edge.get("from")
    target = edge.get("target") or edge.get("to")
    if isinstance(source, str):
        source = {"node": source, "port": "main"}
    if isinstance(target, str):
        target = {"node": target, "port": "main"}
    if not isinstance(source, dict) or not isinstance(target, dict):
        raise AccError("Data edge requires source/target endpoints")
    return {
        "source": source,
        "target": target,
        "materialization": edge.get("materialization") or "copy",
    }


def _known_agent_id(value: str) -> str:
    if value in HERMETIC_AGENT_CLASS_IDS:
        return value
    return "generic_fake_agent"


def _known_tool_id(value: str) -> str:
    if value in HERMETIC_TOOL_CLASS_IDS:
        return value
    return "fake"


def _ports_to_mapping(value: Any, direction: str) -> dict[str, dict[str, Any]]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return {
            str(key): spec if isinstance(spec, dict) else {"type": "json"}
            for key, spec in value.items()
        }
    if isinstance(value, list):
        result: dict[str, dict[str, Any]] = {}
        for item in value:
            if isinstance(item, str):
                result[item] = {"type": "json"}
            elif isinstance(item, dict) and isinstance(item.get("id"), str):
                result[str(item["id"])] = {
                    "type": str(item.get("type") or "json"),
                    "required": bool(item.get("required", False)),
                }
        return result
    raise AccError(f"{direction} ports must be an object or array")


def _required_string(payload: dict[str, Any], key: str, context: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise AccError(f"{context} requires string field {key}")
    return value
