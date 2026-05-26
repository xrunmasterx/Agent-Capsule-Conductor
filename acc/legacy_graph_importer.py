from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from acc.domain import ControlEdge, DataEdge, DataEndpoint, NodeSpec, WorkflowTemplate
from acc.engine import DEFAULT_PERMISSION_PROFILE
from acc.store import load_json
from acc.utils import AccError

NODE_REF_PATTERN = re.compile(r"nodes\.([a-zA-Z0-9_-]+)\.")
DEFAULT_LEGACY_POLICY = {"failure_mode": "fail_fast", "max_concurrency": 1}


def load_legacy_graph_template(path: Path) -> tuple[WorkflowTemplate, dict[str, Any]]:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise AccError(f"Workflow graph must be a JSON object: {path}")
    return import_legacy_graph_template(payload, source_path=path), payload


def legacy_graph_to_accflow_payload(path: Path) -> dict[str, Any]:
    template, _raw = load_legacy_graph_template(path)
    return workflow_template_to_accflow_payload(template)


def workflow_template_to_accflow_payload(template: WorkflowTemplate) -> dict[str, Any]:
    return {
        "id": template.id,
        "version": template.version,
        "nodes": [node_to_payload(node) for node in template.nodes.values()],
        "control_edges": [
            {"from": edge.source, "to": edge.target, "condition": edge.condition}
            for edge in template.control_edges
        ],
        "data_edges": [
            {
                "from": {"node": edge.source.node, "port": edge.source.port},
                "to": {"node": edge.target.node, "port": edge.target.port},
                "materialization": edge.materialization,
            }
            for edge in template.data_edges
        ],
        "policies": template.policies,
        "metadata": template.metadata,
    }


def node_to_payload(node: NodeSpec) -> dict[str, Any]:
    payload = {
        "id": node.id,
        "kind": node.kind,
        "runtime": node.runtime,
        "tool": node.tool,
        "workflow_ref": node.workflow_ref,
        "permission_profile": {
            "workspace_access": node.permission_profile.workspace_access,
            "network": node.permission_profile.network,
            "shell": node.permission_profile.shell,
            "dangerous": node.permission_profile.dangerous,
            "env_policy": node.permission_profile.env_policy,
            "allowed_env": list(node.permission_profile.allowed_env),
            "timeout_seconds": node.permission_profile.timeout_seconds,
        }
        if node.permission_profile is not None
        else None,
        **node.raw,
    }
    return {key: value for key, value in payload.items() if value is not None}


def import_legacy_graph_template(
    payload: dict[str, Any],
    *,
    source_path: Path | None = None,
) -> WorkflowTemplate:
    nodes = {node.id: node for node in import_legacy_nodes(payload)}
    legacy_control_edges = legacy_control_edge_payloads(payload)
    control_edges = [
        ControlEdge(
            source=str(edge["from"]),
            target=str(edge["to"]),
            condition=edge.get("condition") if isinstance(edge.get("condition"), str) else None,
        )
        for edge in legacy_control_edges
    ]
    data_edges, value_edges_by_target = split_legacy_data_edges(
        legacy_data_edge_payloads(payload, legacy_control_edges)
    )
    nodes = {
        node_id: attach_legacy_value_edges(node, value_edges_by_target.get(node_id, []))
        for node_id, node in nodes.items()
    }
    policy = {**DEFAULT_LEGACY_POLICY, **dict(payload.get("policy") or {})}
    metadata = dict(payload.get("metadata") or {})
    metadata.update(
        {
            "canonical_format": "accflow",
            "imported_from": "legacy_graph_json",
            "legacy_format_version": "legacy_graph_json",
            "legacy_workflow_input": dict(payload.get("input", {}) or {}),
        }
    )
    return WorkflowTemplate(
        id=require_string(payload, "id", "workflow graph"),
        version=str(payload.get("version") or "0.1.0"),
        nodes=nodes,
        control_edges=control_edges,
        data_edges=data_edges,
        policies=policy,
        metadata=metadata,
        source_path=source_path,
    )


def legacy_control_edge_payloads(
    payload: dict[str, Any],
) -> list[dict[str, Any]]:
    control_edges = payload.get("control_edges")
    if isinstance(control_edges, list) and control_edges:
        return normalize_control_edges(control_edges)
    legacy_edges = payload.get("edges")
    if isinstance(legacy_edges, list) and legacy_edges:
        return normalize_control_edges(legacy_edges)
    return []


def normalize_control_edges(value: Any) -> list[dict[str, Any]]:
    edges: list[dict[str, Any]] = []
    for index, edge in enumerate(value or []):
        if not isinstance(edge, dict):
            raise AccError("Workflow graph edge must be an object")
        normalized = dict(edge)
        normalized.setdefault(
            "id",
            f"control_{normalized.get('from')}_{normalized.get('to')}_{index}",
        )
        edges.append(normalized)
    return edges


def legacy_data_edge_payloads(
    payload: dict[str, Any],
    control_edges: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    data_edges = [
        dict(edge) for edge in payload.get("data_edges", []) if isinstance(edge, dict)
    ]
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
    for node in payload.get("nodes", []):
        if not isinstance(node, dict):
            continue
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


def import_legacy_nodes(graph: dict[str, Any]) -> list[NodeSpec]:
    result: list[NodeSpec] = []
    for node in graph.get("nodes", []):
        if not isinstance(node, dict):
            raise AccError("Workflow graph node must be an object")
        node_id = require_string(node, "id", "workflow graph node")
        capsule_id = require_string(node, "capsule_id", f"node {node_id}")
        raw = dict(node)
        raw["legacy_capsule_id"] = capsule_id
        raw["legacy_kind"] = node.get("kind") or "agent_session"
        raw.setdefault("input", {})
        raw.setdefault("input_mapping", {})
        result.append(
            NodeSpec(
                id=node_id,
                kind="agent",
                runtime="capsule",
                permission_profile=DEFAULT_PERMISSION_PROFILE,
                input_ports=parse_legacy_ports(node.get("input_ports"), "input"),
                output_ports=parse_legacy_ports(node.get("output_ports"), "output"),
                raw=raw,
            )
        )
    return result


def split_legacy_data_edges(
    edges: list[dict[str, Any]],
) -> tuple[list[DataEdge], dict[str, list[dict[str, Any]]]]:
    port_edges: list[DataEdge] = []
    value_edges_by_target: dict[str, list[dict[str, Any]]] = {}
    for edge in edges:
        source = edge.get("from") if isinstance(edge, dict) else None
        target = edge.get("to") if isinstance(edge, dict) else None
        if not isinstance(source, dict) or not isinstance(target, dict):
            raise AccError("Legacy data edge endpoints must be objects")
        if "port" in source or "port" in target:
            port_edges.append(
                DataEdge(
                    source=DataEndpoint(
                        node=require_string(source, "node", "data edge source"),
                        port=str(source.get("port") or "main"),
                    ),
                    target=DataEndpoint(
                        node=require_string(target, "node", "data edge target"),
                        port=str(target.get("port") or "main"),
                    ),
                    materialization=normalize_materialization(edge.get("materialization")),
                )
            )
            continue
        target_node = require_string(target, "node", "data edge target")
        value_edges_by_target.setdefault(target_node, []).append(dict(edge))
    return port_edges, value_edges_by_target


def attach_legacy_value_edges(node: NodeSpec, edges: list[dict[str, Any]]) -> NodeSpec:
    if not edges:
        return node
    raw = dict(node.raw)
    raw["legacy_value_edges"] = edges
    return NodeSpec(
        id=node.id,
        kind=node.kind,
        runtime=node.runtime,
        tool=node.tool,
        workflow_ref=node.workflow_ref,
        prompt=node.prompt,
        permission_profile=node.permission_profile,
        input_ports=node.input_ports,
        output_ports=node.output_ports,
        raw=raw,
    )


def parse_legacy_ports(value: Any, direction: str) -> dict[str, Any]:
    if not isinstance(value, list):
        return {}
    ports = {}
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            continue
        from acc.engine import build_port_contract

        ports[item["id"]] = build_port_contract(item["id"], direction, item)
    return ports


def normalize_materialization(value: Any) -> str:
    if value == "link":
        return "symlink"
    if value in {"copy", "reference", "symlink"}:
        return str(value)
    return "copy"


def require_string(payload: dict[str, Any], key: str, context: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise AccError(f"{context} requires string field {key}")
    return value
