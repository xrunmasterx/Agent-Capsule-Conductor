"""Shared control/data edge semantics for Core v2 workflows."""

from __future__ import annotations

from acc.models import ControlEdge, WorkflowFunctionTemplate


def data_edge_node_pairs(template: WorkflowFunctionTemplate) -> set[tuple[str, str]]:
    """Return source/target node pairs that already have an explicit data edge."""

    return {
        (edge.source.node, edge.target.node)
        for edge in template.data_edges
    }


def source_node_forwards_main_by_default(
    template: WorkflowFunctionTemplate,
    source_node_id: str,
) -> bool:
    source_node = template.node_invocations.get(source_node_id)
    if source_node is None:
        return False
    if source_node.control.forward_main_output_on_control is False:
        return False
    if source_node.callable_ref.kind != "workflow_function":
        return True
    return any(
        binding.parent_port == "main" and binding.required
        for binding in source_node.workflow_call_output_bindings
    )


def control_edge_forwards_main(
    template: WorkflowFunctionTemplate,
    edge: ControlEdge,
) -> bool:
    if (edge.source, edge.target) in data_edge_node_pairs(template):
        return False
    return source_node_forwards_main_by_default(template, edge.source)


def control_main_source_nodes_for_target(
    template: WorkflowFunctionTemplate,
    target_node_id: str,
) -> list[str]:
    return [
        edge.source
        for edge in template.control_edges
        if edge.target == target_node_id and control_edge_forwards_main(template, edge)
    ]
