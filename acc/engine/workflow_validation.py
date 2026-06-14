"""Structured workflow validation and dry-run planning (REQ-B4)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from acc.engine import (
    callable_topological_levels,
    validate_callable_control_edges,
    validate_callable_data_edges,
    validate_callable_data_edges_follow_control_dependencies,
    validate_callable_ref,
    validate_callable_workflow_function,
    validate_node_invocation_spec,
    validate_workflow_call_input_boundary,
    validate_workflow_call_output_boundary,
)
from acc.engine.control_flow import (
    control_edge_forwards_main,
    control_main_source_nodes_for_target,
    data_edge_node_pairs,
)
from acc.engine.schema_ports import (
    effective_output_ports,
    has_projected_output_ports,
    schema_declares_output_port,
)
from acc.models import (
    CallableRef,
    NodeInvocationSpec,
    WorkflowFunctionTemplate,
    WorkflowInputBinding,
)

ValidationSeverity = Literal["error", "warning"]
PortTypeCheckMode = Literal["strict", "warn", "off"]


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    message: str
    node_id: str | None = None
    port: str | None = None
    severity: ValidationSeverity = "error"
    metadata: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "severity": self.severity,
        }
        if self.node_id is not None:
            payload["node_id"] = self.node_id
        if self.port is not None:
            payload["port"] = self.port
        if self.metadata:
            payload["metadata"] = self.metadata
        return payload


def port_type_check_mode(template: WorkflowFunctionTemplate) -> PortTypeCheckMode:
    policies = template.policies if isinstance(template.policies, dict) else {}
    raw = policies.get("port_type_check", "warn")
    if raw in {"strict", "warn", "off"}:
        return raw
    return "warn"


def augment_known_callable_refs(
    template: WorkflowFunctionTemplate,
    known_callable_refs: set[tuple[str, str]],
) -> set[tuple[str, str]]:
    augmented = set(known_callable_refs)
    for node in template.node_invocations.values():
        if not _callable_ref_is_known(node, node.callable_ref, known_callable_refs):
            continue
        augmented.add((node.callable_ref.kind, node.callable_ref.id))
    return augmented


def collect_callable_validation_issues(
    template: WorkflowFunctionTemplate,
    *,
    known_callable_refs: set[tuple[str, str]] | None = None,
    known_workflow_ids: set[str] | None = None,
) -> list[ValidationIssue]:
    """Collect structured validation issues without raising (B4-001..003)."""
    issues: list[ValidationIssue] = []
    node_ids = set(template.node_invocations)
    augmented_refs: set[tuple[str, str]] | None = None
    if known_callable_refs is not None:
        augmented_refs = augment_known_callable_refs(template, known_callable_refs)

    try:
        validate_callable_control_edges(template, node_ids)
    except Exception as exc:
        issues.append(ValidationIssue(code="control_edge_invalid", message=str(exc)))

    try:
        validate_callable_data_edges(template, node_ids)
    except Exception as exc:
        issues.append(ValidationIssue(code="data_edge_invalid", message=str(exc)))

    try:
        levels = callable_topological_levels(template)
        validate_callable_data_edges_follow_control_dependencies(template, levels=levels)
    except Exception as exc:
        issues.append(ValidationIssue(code="data_edge_order_invalid", message=str(exc)))

    for node in template.node_invocations.values():
        try:
            validate_node_invocation_spec(
                template,
                node,
                known_callable_refs=augmented_refs,
                parent_stateful=False,
            )
        except Exception as exc:
            issues.extend(_issues_from_callable_ref(node, exc))
        if node.callable_ref.kind == "workflow_function":
            try:
                validate_workflow_call_input_boundary(template, node)
                validate_workflow_call_output_boundary(node)
            except Exception as exc:
                issues.append(
                    ValidationIssue(
                        code="workflow_call_binding_invalid",
                        message=str(exc),
                        node_id=node.id,
                    )
                )

    issues.extend(_collect_port_binding_issues(template))
    issues.extend(_collect_output_schema_port_issues(template))
    issues.extend(_collect_workflow_boundary_issues(template))
    issues.extend(_collect_port_type_issues(template, port_type_check_mode(template)))
    issues.extend(_collect_artifact_binding_issues(template))
    if known_callable_refs is not None:
        issues.extend(_collect_unknown_callable_refs(template, known_callable_refs))
    if known_workflow_ids is not None:
        issues.extend(_collect_unknown_workflow_refs(template, known_workflow_ids))
    return issues


def _issues_from_callable_ref(node: NodeInvocationSpec, exc: Exception) -> list[ValidationIssue]:
    message = str(exc)
    if "Unknown callable reference" in message:
        return [
            ValidationIssue(
                code="unknown_callable_ref",
                message=message,
                node_id=node.id,
            )
        ]
    return [ValidationIssue(code="node_invocation_invalid", message=message, node_id=node.id)]


def _callable_ref_is_known(
    node: NodeInvocationSpec,
    ref: CallableRef,
    known_callable_refs: set[tuple[str, str]],
) -> bool:
    _ = node
    return (ref.kind, ref.id) in known_callable_refs


def _collect_unknown_callable_refs(
    template: WorkflowFunctionTemplate,
    known_callable_refs: set[tuple[str, str]],
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for node in template.node_invocations.values():
        ref = node.callable_ref
        if _callable_ref_is_known(node, ref, known_callable_refs):
            continue
        try:
            validate_callable_ref(ref, known_callable_refs=known_callable_refs)
        except Exception as exc:
            issues.append(
                ValidationIssue(
                    code="unknown_callable_ref",
                    message=str(exc),
                    node_id=node.id,
                )
            )
    return issues


def _collect_unknown_workflow_refs(
    template: WorkflowFunctionTemplate,
    known_workflow_ids: set[str],
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for node in template.node_invocations.values():
        if node.callable_ref.kind != "workflow_function":
            continue
        if node.callable_ref.id not in known_workflow_ids:
            issues.append(
                ValidationIssue(
                    code="missing_workflow_file",
                    message=f"Workflow function not found: {node.callable_ref.id!r}",
                    node_id=node.id,
                )
            )
    return issues


def _has_declared_output_port_contract(node: NodeInvocationSpec) -> bool:
    return bool(
        node.workflow_call_output_bindings
        or node.output_ports
        or has_projected_output_ports(node.output_schema)
    )


def _incoming_data_ports(template: WorkflowFunctionTemplate) -> dict[str, set[str]]:
    incoming: dict[str, set[str]] = {node_id: set() for node_id in template.node_invocations}
    for edge in template.data_edges:
        incoming[edge.target.node].add(edge.target.port)
    for node_id in template.node_invocations:
        if control_main_source_nodes_for_target(template, node_id):
            incoming[node_id].add("main")
    for binding in template.workflow_input_bindings:
        if binding.target.node in incoming:
            incoming[binding.target.node].add(binding.target.port)
    for node in template.node_invocations.values():
        for binding in node.input_bindings:
            if binding.source is not None or binding.static_value is not None:
                incoming[node.id].add(binding.target_port)
        for binding in node.workflow_call_input_bindings:
            if binding.source is not None or binding.static_value is not None:
                incoming[node.id].add(binding.workflow_input)
        static_input = node.overrides.static_input
        if isinstance(static_input, dict):
            for key in static_input:
                if isinstance(key, str):
                    incoming[node.id].add(key)
    return incoming


def _collect_port_binding_issues(
    template: WorkflowFunctionTemplate,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    incoming = _incoming_data_ports(template)
    connected_targets: set[tuple[str, str]] = {
        (edge.target.node, edge.target.port) for edge in template.data_edges
    }
    issues.extend(_collect_control_data_semantic_warnings(template))

    for edge in template.data_edges:
        if edge.source.node in template.node_invocations:
            source_node = template.node_invocations[edge.source.node]
            source_ports = effective_output_ports(source_node)
            has_source_contract = _has_declared_output_port_contract(source_node)
            if has_source_contract and edge.source.port not in source_ports:
                issues.append(
                    ValidationIssue(
                        code="dangling_data_edge_source",
                        message=(
                            f"Data edge references unknown output port "
                            f"{edge.source.node}.{edge.source.port}"
                        ),
                        node_id=edge.source.node,
                        port=edge.source.port,
                        metadata=_data_edge_issue_metadata(
                            edge,
                            expected_schema_path=_expected_output_schema_path(edge.source.port)
                            if has_projected_output_ports(source_node.output_schema)
                            else None,
                        ),
                    )
                )
        if edge.target.node not in template.node_invocations:
            issues.append(
                ValidationIssue(
                    code="dangling_data_edge_target",
                    message=(
                        f"Data edge targets missing node {edge.target.node!r} "
                        f"port {edge.target.port!r}"
                    ),
                    node_id=edge.target.node,
                    port=edge.target.port,
                    metadata=_data_edge_issue_metadata(edge),
                )
            )
            continue
        node = template.node_invocations[edge.target.node]
        if node.input_ports and edge.target.port not in node.input_ports:
            issues.append(
                ValidationIssue(
                    code="dangling_data_edge_target",
                    message=(
                        f"Data edge targets unknown input port "
                        f"{edge.target.node}.{edge.target.port}"
                    ),
                    node_id=edge.target.node,
                    port=edge.target.port,
                    metadata=_data_edge_issue_metadata(edge),
                )
            )

    for node_id, node in template.node_invocations.items():
        for port_id, port in node.input_ports.items():
            if not port.required:
                continue
            if port_id in incoming[node_id]:
                continue
            issues.append(
                ValidationIssue(
                    code="unbound_input_port",
                    message=f"Required input port {node_id}.{port_id} has no binding or data edge",
                    node_id=node_id,
                    port=port_id,
                    metadata={
                        "input_port": {"node": node_id, "port": port_id},
                        "available_sources": _available_sources_for_required_input(
                            template,
                            node_id,
                            port_id,
                        ),
                    },
                )
            )
        if node.callable_ref.kind == "workflow_function":
            for binding in node.workflow_call_input_bindings:
                if binding.required and binding.source is None and binding.static_value is None:
                    issues.append(
                        ValidationIssue(
                            code="unbound_workflow_call_input",
                            message=(
                                f"Workflow call input {binding.workflow_input!r} on node "
                                f"{node_id!r} requires a source or static_value"
                            ),
                            node_id=node_id,
                            port=binding.workflow_input,
                        )
                    )
                if binding.source is not None:
                    key = (node_id, binding.workflow_input)
                    source_keys = {(e.source.node, e.source.port) for e in template.data_edges}
                    target_keys = {(e.target.node, e.target.port) for e in template.data_edges}
                    if (
                        key not in target_keys
                        and (
                            binding.source.node,
                            binding.source.port,
                        )
                        not in source_keys
                    ):
                        issues.append(
                            ValidationIssue(
                                code="unbound_workflow_call_input",
                                message=(
                                    "Workflow call input must be bound through parent "
                                    f"data edge: {binding.source.node}.{binding.source.port} "
                                    f"-> {node_id}.{binding.workflow_input}"
                                ),
                                node_id=node_id,
                                port=binding.workflow_input,
                            )
                        )

    for binding in template.workflow_input_bindings:
        issues.extend(_validate_workflow_input_binding(template, binding, connected_targets))

    return issues


def _validate_workflow_input_binding(
    template: WorkflowFunctionTemplate,
    binding: WorkflowInputBinding,
    connected_targets: set[tuple[str, str]],
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    if binding.source_port not in template.exposed_inputs:
        issues.append(
            ValidationIssue(
                code="unbound_workflow_input",
                message=(
                    "Workflow input binding references missing exposed port "
                    f"{binding.source_port!r}"
                ),
                port=binding.source_port,
            )
        )
    target_node = template.node_invocations.get(binding.target.node)
    if target_node is None:
        issues.append(
            ValidationIssue(
                code="unbound_workflow_input",
                message=(
                    "Workflow input binding references missing target node "
                    f"{binding.target.node!r}"
                ),
                port=binding.target.port,
                node_id=binding.target.node,
            )
        )
    elif target_node.input_ports and binding.target.port not in target_node.input_ports:
        issues.append(
            ValidationIssue(
                code="unbound_workflow_input",
                message=(
                    "Workflow input binding references unknown target input port "
                    f"{binding.target.node}.{binding.target.port}"
                ),
                port=binding.target.port,
                node_id=binding.target.node,
            )
        )
    return issues


def _data_edge_issue_metadata(edge: Any, *, expected_schema_path: str | None = None) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "edge_id": (
            f"{edge.source.node}.{edge.source.port}->"
            f"{edge.target.node}.{edge.target.port}"
        ),
        "source": {"node": edge.source.node, "port": edge.source.port},
        "target": {"node": edge.target.node, "port": edge.target.port},
    }
    if expected_schema_path:
        metadata["expected_schema_path"] = expected_schema_path
    return metadata


def _expected_output_schema_path(port_id: str) -> str:
    return f"/properties/outputs/properties/{_json_pointer_token(port_id)}"


def _json_pointer_token(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


def _available_sources_for_required_input(
    template: WorkflowFunctionTemplate,
    node_id: str,
    port_id: str,
) -> list[dict[str, str]]:
    sources: list[dict[str, str]] = []
    for edge in template.data_edges:
        if edge.target.node == node_id and edge.target.port == port_id:
            sources.append(
                {
                    "kind": "data_edge",
                    "node": edge.source.node,
                    "port": edge.source.port,
                }
            )
    for edge in template.control_edges:
        if edge.target != node_id or port_id != "main":
            continue
        if control_edge_forwards_main(template, edge):
            sources.append({"kind": "control_main_default", "node": edge.source, "port": "main"})
    for binding in template.workflow_input_bindings:
        if binding.target.node == node_id and binding.target.port == port_id:
            sources.append({"kind": "workflow_input", "port": binding.source_port})
    return sources


def _collect_control_data_semantic_warnings(
    template: WorkflowFunctionTemplate,
) -> list[ValidationIssue]:
    pairs = data_edge_node_pairs(template)
    issues: list[ValidationIssue] = []
    for edge in template.control_edges:
        if (edge.source, edge.target) not in pairs:
            continue
        issues.append(
            ValidationIssue(
                code="control_main_suppressed_by_data_edge",
                message=(
                    "Control edge will only order execution because the same source/target "
                    "pair has an explicit data edge"
                ),
                node_id=edge.source,
                severity="warning",
                metadata={
                    "source": edge.source,
                    "target": edge.target,
                    "suppressed_port": "main",
                },
            )
        )
    return issues


def _collect_workflow_boundary_issues(
    template: WorkflowFunctionTemplate,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for port_id, port in template.exposed_inputs.items():
        if not port.required:
            continue
        bound = any(binding.source_port == port_id for binding in template.workflow_input_bindings)
        if not bound:
            issues.append(
                ValidationIssue(
                    code="unbound_workflow_input",
                    message=(
                        f"Required workflow exposed input {port_id!r} has no workflow_input_binding"
                    ),
                    port=port_id,
                )
            )
    output_bindings_by_target: dict[str, list[tuple[str, str]]] = {}
    source_nodes_by_target: dict[str, set[str]] = {}
    for binding in template.workflow_output_bindings:
        output_bindings_by_target.setdefault(binding.target_port, []).append(
            (binding.source.node, binding.source.port)
        )
        if binding.target_port not in template.exposed_outputs:
            issues.append(
                ValidationIssue(
                    code="unbound_workflow_output",
                    message=(
                        "Workflow output binding references missing exposed port "
                        f"{binding.target_port!r}"
                    ),
                    port=binding.target_port,
                    node_id=binding.source.node,
                )
            )
        source_node = template.node_invocations.get(binding.source.node)
        if source_node is None:
            issues.append(
                ValidationIssue(
                    code="unbound_workflow_output",
                    message=(
                        "Workflow output binding references missing source node "
                        f"{binding.source.node!r}"
                    ),
                    port=binding.source.port,
                    node_id=binding.source.node,
                )
            )
            continue
        source_ports = effective_output_ports(source_node)
        has_source_contract = _has_declared_output_port_contract(source_node)
        if has_source_contract and binding.source.port not in source_ports:
            issues.append(
                ValidationIssue(
                    code="unbound_workflow_output",
                    message=(
                        "Workflow output binding references unknown source output port "
                        f"{binding.source.node}.{binding.source.port}"
                    ),
                    port=binding.source.port,
                    node_id=binding.source.node,
                )
            )
        source_nodes = source_nodes_by_target.setdefault(binding.target_port, set())
        if binding.source.node in source_nodes:
            issues.append(
                ValidationIssue(
                    code="duplicate_workflow_output_source",
                    message=(
                        "Workflow output port cannot aggregate multiple ports from the same "
                        f"source node: {binding.source.node} -> {binding.target_port}"
                    ),
                    port=binding.target_port,
                    node_id=binding.source.node,
                )
            )
        source_nodes.add(binding.source.node)
    return issues


def _collect_output_schema_port_issues(
    template: WorkflowFunctionTemplate,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for node in template.node_invocations.values():
        if node.callable_ref.kind != "agent_class":
            continue
        non_main_ports = [
            port_id
            for port_id in node.output_ports
            if port_id not in {"main", "default"}
        ]
        if not non_main_ports:
            if node.output_schema is None:
                issues.append(
                    ValidationIssue(
                        code="node_output_schema_missing_compat",
                        message=(
                            f"Agent node {node.id!r} has no instance output_schema; "
                            "runtime will fall back to the callable template schema if available"
                        ),
                        node_id=node.id,
                        severity="warning",
                    )
                )
            continue
        if node.output_schema is None:
            for port_id in non_main_ports:
                issues.append(
                    ValidationIssue(
                        code="output_port_schema_missing",
                        message=(
                            f"Agent node {node.id!r} output port {port_id!r} "
                            "is not declared by an instance output_schema"
                        ),
                        node_id=node.id,
                        port=port_id,
                    )
                )
            continue
        for port_id in non_main_ports:
            if schema_declares_output_port(node.output_schema, port_id):
                continue
            issues.append(
                ValidationIssue(
                    code="output_port_schema_missing",
                    message=(
                        f"Agent node {node.id!r} output port {port_id!r} must be declared in "
                        "output_schema.properties.outputs.properties or legacy top-level "
                        "output_schema.properties"
                    ),
                    node_id=node.id,
                    port=port_id,
                    severity=(
                        "warning"
                        if has_projected_output_ports(node.output_schema)
                        else "error"
                    ),
                )
            )
    return issues


def _port_type_compatible(source_type: str, target_type: str) -> bool:
    return source_type == target_type


def _collect_port_type_issues(
    template: WorkflowFunctionTemplate,
    mode: PortTypeCheckMode,
) -> list[ValidationIssue]:
    if mode == "off":
        return []
    severity: ValidationSeverity = "error" if mode == "strict" else "warning"
    issues: list[ValidationIssue] = []
    for edge in template.data_edges:
        source_node = template.node_invocations.get(edge.source.node)
        target_node = template.node_invocations.get(edge.target.node)
        if source_node is None or target_node is None:
            continue
        source_port = _resolve_output_port_type(source_node, edge.source.port)
        target_port = _resolve_input_port_type(target_node, edge.target.port)
        if _port_type_compatible(source_port, target_port):
            continue
        issues.append(
            ValidationIssue(
                code="port_type_mismatch",
                message=(
                    f"Port type mismatch on data edge "
                    f"{edge.source.node}.{edge.source.port} ({source_port}) -> "
                    f"{edge.target.node}.{edge.target.port} ({target_port})"
                ),
                node_id=edge.target.node,
                port=edge.target.port,
                severity=severity,
            )
        )
    return issues


def _resolve_output_port_type(node: NodeInvocationSpec, port_id: str) -> str:
    output_ports = effective_output_ports(node)
    if port_id in output_ports:
        return output_ports[port_id].type
    return "artifact"


def _resolve_input_port_type(node: NodeInvocationSpec, port_id: str) -> str:
    if port_id in node.input_ports:
        return node.input_ports[port_id].type
    return "artifact"


def _collect_artifact_binding_issues(
    template: WorkflowFunctionTemplate,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for node in template.node_invocations.values():
        static_input = node.overrides.static_input
        if not isinstance(static_input, dict):
            continue
        for key, value in static_input.items():
            if isinstance(value, str) and value.startswith(("/", "\\")):
                issues.append(
                    ValidationIssue(
                        code="invalid_artifact_ref",
                        message=(f"Node {node.id} static input {key!r} must not use absolute path"),
                        node_id=node.id,
                        port=str(key),
                    )
                )
    return issues


def build_materialization_plan(template: WorkflowFunctionTemplate) -> list[dict[str, Any]]:
    plan: list[dict[str, Any]] = []
    for edge in template.data_edges:
        plan.append(
            {
                "edge": (
                    f"{edge.source.node}.{edge.source.port}->{edge.target.node}.{edge.target.port}"
                ),
                "source": {"node": edge.source.node, "port": edge.source.port},
                "target": {"node": edge.target.node, "port": edge.target.port},
                "mode": edge.materialization,
            }
        )
    return plan


def build_workflow_dry_run_report(
    template: WorkflowFunctionTemplate,
    *,
    known_callable_refs: set[tuple[str, str]] | None = None,
    known_workflow_ids: set[str] | None = None,
) -> dict[str, Any]:
    """Execution plan preview without spawning agents (REQ-B4-004)."""
    issues = collect_callable_validation_issues(
        template,
        known_callable_refs=known_callable_refs,
        known_workflow_ids=known_workflow_ids,
    )
    errors = [issue for issue in issues if issue.severity == "error"]
    if errors:
        return {
            "status": "invalid",
            "workflow_id": template.id,
            "errors": [issue.as_dict() for issue in errors],
            "warnings": [issue.as_dict() for issue in issues if issue.severity == "warning"],
        }
    levels = callable_topological_levels(template)
    node_order = [node_id for level in levels for node_id in level]
    return {
        "status": "dry_run",
        "workflow_id": template.id,
        "version": template.version,
        "levels": levels,
        "node_order": node_order,
        "estimated_node_count": len(template.node_invocations),
        "materialization_plan": build_materialization_plan(template),
        "warnings": [issue.as_dict() for issue in issues if issue.severity == "warning"],
    }


def validate_callable_workflow_function_report(
    template: WorkflowFunctionTemplate,
    *,
    known_callable_refs: set[tuple[str, str]] | None = None,
    known_workflow_ids: set[str] | None = None,
    call_depth: int = 0,
) -> dict[str, Any]:
    """Run structural validation; return structured result instead of only raising."""
    issues = collect_callable_validation_issues(
        template,
        known_callable_refs=known_callable_refs,
        known_workflow_ids=known_workflow_ids,
    )
    errors = [issue for issue in issues if issue.severity == "error"]
    if errors:
        return {
            "status": "invalid",
            "workflow_id": template.id,
            "errors": [issue.as_dict() for issue in errors],
            "warnings": [issue.as_dict() for issue in issues if issue.severity == "warning"],
        }
    refs_for_engine = known_callable_refs
    if known_callable_refs is not None:
        refs_for_engine = augment_known_callable_refs(template, known_callable_refs)
    try:
        validate_callable_workflow_function(
            template,
            known_callable_refs=refs_for_engine,
            call_depth=call_depth,
        )
    except Exception as exc:
        return {
            "status": "invalid",
            "workflow_id": template.id,
            "errors": [{"code": "validation_failed", "message": str(exc), "severity": "error"}],
            "warnings": [issue.as_dict() for issue in issues if issue.severity == "warning"],
        }
    levels = callable_topological_levels(template)
    return {
        "status": "valid",
        "workflow_id": template.id,
        "version": template.version,
        "node_count": len(template.node_invocations),
        "control_edge_count": len(template.control_edges),
        "data_edge_count": len(template.data_edges),
        "topological_levels": levels,
        "policy": template.policies,
        "format": "accflow",
        "warnings": [issue.as_dict() for issue in issues if issue.severity == "warning"],
    }
