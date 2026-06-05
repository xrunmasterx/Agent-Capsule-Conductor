from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

from acc.callable_registry import CallableRegistry
from acc.callable_runner import DEFAULT_AGENT_OUTPUT_SCHEMA
from acc.domain import AccError, AgentClassTemplate, CallableRef, PortContract

MAIN_PORTS = {"main", "default"}


@dataclass
class WorkflowNormalizationSummary:
    removed_main_data_edges: int = 0
    added_control_edges: int = 0
    snapshotted_nodes: int = 0
    snapshotted_input_ports: int = 0
    snapshotted_output_ports: int = 0
    snapshotted_output_schemas: int = 0
    conflicts: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[dict[str, Any]] = field(default_factory=list)
    workflows: list[dict[str, Any]] = field(default_factory=list)

    def merge(self, other: WorkflowNormalizationSummary, *, workflow_id: str | None = None) -> None:
        self.removed_main_data_edges += other.removed_main_data_edges
        self.added_control_edges += other.added_control_edges
        self.snapshotted_nodes += other.snapshotted_nodes
        self.snapshotted_input_ports += other.snapshotted_input_ports
        self.snapshotted_output_ports += other.snapshotted_output_ports
        self.snapshotted_output_schemas += other.snapshotted_output_schemas
        self.conflicts.extend(other.conflicts)
        self.warnings.extend(other.warnings)
        workflow_payload = other.as_dict(include_workflows=False)
        workflow_payload["workflow_id"] = workflow_id
        self.workflows.append(workflow_payload)

    def as_dict(self, *, include_workflows: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "removed_main_data_edges": self.removed_main_data_edges,
            "added_control_edges": self.added_control_edges,
            "snapshotted_nodes": self.snapshotted_nodes,
            "snapshotted_input_ports": self.snapshotted_input_ports,
            "snapshotted_output_ports": self.snapshotted_output_ports,
            "snapshotted_output_schemas": self.snapshotted_output_schemas,
            "conflicts": list(self.conflicts),
            "warnings": list(self.warnings),
        }
        if include_workflows:
            payload["workflows"] = list(self.workflows)
        return payload


def normalize_workflow_payload_contracts(
    payload: dict[str, Any],
    *,
    callable_registry: CallableRegistry | None = None,
    force: bool = False,
    allow_conflicts: bool = False,
) -> tuple[dict[str, Any], WorkflowNormalizationSummary]:
    """Normalize Workbench/Core-v2 transport contracts before save or run."""

    normalized = copy.deepcopy(payload)
    summary = WorkflowNormalizationSummary()
    if callable_registry is not None:
        _snapshot_callable_instance_defaults(normalized, callable_registry, summary)
    _normalize_main_data_edges(normalized, summary, force=force)
    if summary.conflicts and not force and not allow_conflicts:
        raise AccError(
            "Workflow normalization has conflicts; rerun with explicit force after review: "
            f"{summary.conflicts}"
        )
    return normalized, summary


def aggregate_normalization_summaries(
    root_summary: WorkflowNormalizationSummary,
    child_summaries: dict[str, WorkflowNormalizationSummary],
    *,
    root_id: str | None,
) -> WorkflowNormalizationSummary:
    aggregate = WorkflowNormalizationSummary()
    aggregate.merge(root_summary, workflow_id=root_id)
    for child_name, summary in sorted(child_summaries.items()):
        aggregate.merge(summary, workflow_id=child_name)
    return aggregate


def _snapshot_callable_instance_defaults(
    payload: dict[str, Any],
    callable_registry: CallableRegistry,
    summary: WorkflowNormalizationSummary,
) -> None:
    nodes = payload.get("nodes")
    if not isinstance(nodes, list):
        return
    for node in nodes:
        if not isinstance(node, dict):
            continue
        ref = node.get("callable_ref")
        if not isinstance(ref, dict):
            continue
        kind = ref.get("kind")
        callable_id = ref.get("id")
        if kind not in {"agent_class", "tool_class"} or not isinstance(callable_id, str):
            continue
        if not callable_registry.has(str(kind), callable_id):
            continue
        asset = callable_registry.resolve(CallableRef(kind=str(kind), id=callable_id))  # type: ignore[arg-type]
        template = asset.template
        node_changed = False
        ports = node.get("ports")
        if not isinstance(ports, dict):
            ports = {}
            node["ports"] = ports
        inputs = ports.get("inputs")
        if (not isinstance(inputs, dict) or not inputs) and template.input_ports:
            ports["inputs"] = _port_contracts_to_wire(template.input_ports)
            summary.snapshotted_input_ports += 1
            node_changed = True
        outputs = ports.get("outputs")
        if (not isinstance(outputs, dict) or not outputs) and template.output_ports:
            ports["outputs"] = _port_contracts_to_wire(template.output_ports)
            summary.snapshotted_output_ports += 1
            node_changed = True
        if kind == "agent_class" and not isinstance(node.get("output_schema"), dict):
            schema = _agent_template_output_schema(template)
            node["output_schema"] = copy.deepcopy(schema)
            summary.snapshotted_output_schemas += 1
            node_changed = True
        if node_changed:
            summary.snapshotted_nodes += 1
            metadata = node.get("metadata")
            if not isinstance(metadata, dict):
                metadata = {}
                node["metadata"] = metadata
            metadata.setdefault(
                "template_snapshot",
                {
                    "class_id": callable_id,
                    "class_kind": kind,
                    "class_version": getattr(template, "version", None),
                    "snapshot_source": "callable_registry",
                },
            )


def _agent_template_output_schema(template: Any) -> dict[str, Any]:
    if isinstance(template, AgentClassTemplate):
        schema = template.artifact_contract.get("output_schema")
        if isinstance(schema, dict):
            return copy.deepcopy(schema)
    return copy.deepcopy(DEFAULT_AGENT_OUTPUT_SCHEMA)


def _port_contracts_to_wire(ports: dict[str, PortContract]) -> dict[str, dict[str, Any]]:
    return {
        port_id: {
            "id": port.id,
            "direction": port.direction,
            "type": port.type,
            "required": port.required,
            "cardinality": port.cardinality,
        }
        for port_id, port in ports.items()
    }


def _normalize_main_data_edges(
    payload: dict[str, Any],
    summary: WorkflowNormalizationSummary,
    *,
    force: bool,
) -> None:
    data_edges = payload.get("data_edges")
    if not isinstance(data_edges, list):
        return
    kept_data_edges: list[dict[str, Any]] = []
    removed_by_source: dict[str, set[str]] = {}
    for edge in data_edges:
        if not isinstance(edge, dict) or not _is_main_to_main_data_edge(edge):
            kept_data_edges.append(edge)
            continue
        source_node = _edge_node(edge.get("source") or edge.get("from"))
        target_node = _edge_node(edge.get("target") or edge.get("to"))
        if not source_node or not target_node:
            kept_data_edges.append(edge)
            continue
        removed_by_source.setdefault(source_node, set()).add(target_node)
        summary.removed_main_data_edges += 1
    payload["data_edges"] = kept_data_edges
    if not removed_by_source:
        return

    control_edges = payload.get("control_edges")
    if not isinstance(control_edges, list):
        control_edges = []
        payload["control_edges"] = control_edges
    control_pairs = {
        (str(edge.get("from")), str(edge.get("to")))
        for edge in control_edges
        if isinstance(edge, dict) and edge.get("from") and edge.get("to")
    }
    for source, targets in removed_by_source.items():
        for target in targets:
            if (source, target) in control_pairs:
                continue
            control_edges.append({"from": source, "to": target, "context": "none"})
            control_pairs.add((source, target))
            summary.added_control_edges += 1

    control_targets_by_source: dict[str, set[str]] = {}
    for source, target in control_pairs:
        control_targets_by_source.setdefault(source, set()).add(target)
    node_by_id = _node_by_id(payload)
    for source, data_targets in removed_by_source.items():
        node = node_by_id.get(source)
        if node is None:
            continue
        control = node.get("control")
        if isinstance(control, dict) and control.get("forward_main_output_on_control") is False:
            summary.conflicts.append(
                {
                    "code": "main_forwarding_disabled_conflict",
                    "source": source,
                    "targets": sorted(data_targets),
                    "message": (
                        "main->main data edge migration would require main forwarding, "
                        "but the source node explicitly disables it"
                    ),
                }
            )
        broad_targets = sorted(control_targets_by_source.get(source, set()) - data_targets)
        if broad_targets:
            summary.conflicts.append(
                {
                    "code": "main_forwarding_broadened_risk",
                    "source": source,
                    "targets_with_removed_main_data_edge": sorted(data_targets),
                    "other_control_targets": broad_targets,
                    "message": (
                        "source-level main forwarding would expose main output to control "
                        "targets that did not have an explicit main data edge"
                    ),
                }
            )
        if force or not _source_has_conflict(summary, source):
            _set_forward_main_output_on_control(node, True)


def _is_main_to_main_data_edge(edge: dict[str, Any]) -> bool:
    source = edge.get("source") or edge.get("from")
    target = edge.get("target") or edge.get("to")
    return _edge_port(source) in MAIN_PORTS and _edge_port(target) in MAIN_PORTS


def _edge_node(endpoint: Any) -> str | None:
    if isinstance(endpoint, dict):
        node = endpoint.get("node")
        return str(node) if node else None
    return None


def _edge_port(endpoint: Any) -> str:
    if not isinstance(endpoint, dict):
        return "main"
    port = endpoint.get("port") or endpoint.get("output") or endpoint.get("input") or "main"
    return str(port)


def _node_by_id(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    nodes = payload.get("nodes")
    if not isinstance(nodes, list):
        return {}
    return {
        str(node.get("id")): node
        for node in nodes
        if isinstance(node, dict) and node.get("id")
    }


def _source_has_conflict(summary: WorkflowNormalizationSummary, source: str) -> bool:
    return any(conflict.get("source") == source for conflict in summary.conflicts)


def _set_forward_main_output_on_control(node: dict[str, Any], value: bool) -> None:
    control = node.get("control")
    if not isinstance(control, dict):
        control = {}
        node["control"] = control
    control["forward_main_output_on_control"] = value
