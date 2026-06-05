"""Structured workflow validation and dry-run planning (REQ-B4)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from acc.domain import (
    CallableRef,
    NodeInvocationSpec,
    WorkflowFunctionTemplate,
    WorkflowInputBinding,
)
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

ValidationSeverity = Literal["error", "warning"]
PortTypeCheckMode = Literal["strict", "warn", "off"]


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    message: str
    node_id: str | None = None
    port: str | None = None
    severity: ValidationSeverity = "error"

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


def _control_main_can_satisfy_input(source_node: NodeInvocationSpec) -> bool:
    if source_node.control.forward_main_output_on_control is False:
        return False
    if (
        source_node.callable_ref.kind == "workflow_function"
        and source_node.workflow_call_output_bindings
    ):
        return any(
            binding.parent_port == "main" and binding.required
            for binding in source_node.workflow_call_output_bindings
        )
    return True


def _incoming_data_ports(template: WorkflowFunctionTemplate) -> dict[str, set[str]]:
    incoming: dict[str, set[str]] = {node_id: set() for node_id in template.node_invocations}
    for edge in template.data_edges:
        incoming[edge.target.node].add(edge.target.port)
    for edge in template.control_edges:
        source_node = template.node_invocations.get(edge.source)
        if source_node is not None and _control_main_can_satisfy_input(source_node):
            incoming[edge.target].add("main")
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

    for edge in template.data_edges:
        if edge.source.node in template.node_invocations:
            source_node = template.node_invocations[edge.source.node]
            if source_node.output_ports and edge.source.port not in source_node.output_ports:
                issues.append(
                    ValidationIssue(
                        code="dangling_data_edge_source",
                        message=(
                            f"Data edge references unknown output port "
                            f"{edge.source.node}.{edge.source.port}"
                        ),
                        node_id=edge.source.node,
                        port=edge.source.port,
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
                )
            )

    control_main_sources_by_target: dict[str, list[str]] = {}
    for edge in template.control_edges:
        source_node = template.node_invocations.get(edge.source)
        if source_node is None or not _control_main_can_satisfy_input(source_node):
            continue
        control_main_sources_by_target.setdefault(edge.target, []).append(edge.source)
    for target_node, source_nodes in control_main_sources_by_target.items():
        target_spec = template.node_invocations.get(target_node)
        explicit_main = any(
            edge.target.node == target_node and edge.target.port == "main"
            for edge in template.data_edges
        )
        if target_spec is not None:
            explicit_main = explicit_main or any(
                binding.target_port == "main" for binding in target_spec.input_bindings
            )
            explicit_main = explicit_main or "main" in target_spec.overrides.static_input
        if len(source_nodes) > 1 and not explicit_main:
            issues.append(
                ValidationIssue(
                    code="ambiguous_control_main_input",
                    message=(
                        f"Multiple control predecessors can forward main into {target_node}: "
                        f"{', '.join(sorted(source_nodes))}"
                    ),
                    node_id=target_node,
                    port="main",
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
        if source_node.output_ports and binding.source.port not in source_node.output_ports:
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
            if _output_schema_declares_port(node.output_schema, port_id):
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
                )
            )
    return issues


def _output_schema_declares_port(schema: dict[str, Any], port_id: str) -> bool:
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return False
    outputs = properties.get("outputs")
    if isinstance(outputs, dict):
        output_properties = outputs.get("properties")
        if isinstance(output_properties, dict) and port_id in output_properties:
            return True
    return port_id in properties


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
    if port_id in node.output_ports:
        return node.output_ports[port_id].type
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
