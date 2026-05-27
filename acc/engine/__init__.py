from __future__ import annotations

import re
from collections import deque
from typing import Any

from acc.domain import (
    AccError,
    ControlEdge,
    DataEdge,
    DataEndpoint,
    NodeSpec,
    PermissionProfile,
    PortContract,
    WorkflowInputBinding,
    WorkflowOutputBinding,
    WorkflowTemplate,
)

IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
PATH_KEYS = {"workspace", "workspace_root", "workspace_path", "local_path"}
NODE_STATUSES_OK = {"success", "skipped"}
DEFAULT_PERMISSION_PROFILE = PermissionProfile()


def is_clean_workflow_payload(payload: dict[str, Any]) -> bool:
    nodes = payload.get("nodes")
    if not isinstance(nodes, list):
        return False
    return any(isinstance(node, dict) and "capsule_id" not in node for node in nodes)


def parse_clean_workflow_template(
    payload: dict[str, Any],
    *,
    source_path: Any | None = None,
) -> WorkflowTemplate:
    workflow_id = require_string(payload, "id", "WorkflowTemplate")
    version = require_string(payload, "version", workflow_id)
    nodes_payload = payload.get("nodes")
    if not isinstance(nodes_payload, list) or not nodes_payload:
        raise AccError("WorkflowTemplate nodes must be a non-empty array")

    nodes: dict[str, NodeSpec] = {}
    for node_payload in nodes_payload:
        if not isinstance(node_payload, dict):
            raise AccError("WorkflowTemplate node must be an object")
        node = parse_node_spec(node_payload)
        if node.id in nodes:
            raise AccError(f"WorkflowTemplate contains duplicate node id: {node.id}")
        nodes[node.id] = node

    control_edges = [
        parse_control_edge(edge, index)
        for index, edge in enumerate(payload.get("control_edges") or [])
    ]
    data_edges = [
        parse_data_edge(edge, index) for index, edge in enumerate(payload.get("data_edges") or [])
    ]
    exposed_inputs = parse_port_value(payload.get("exposed_inputs"), "input")
    exposed_outputs = parse_port_value(payload.get("exposed_outputs"), "output")
    workflow_input_bindings = [
        parse_workflow_input_binding(binding, index)
        for index, binding in enumerate(payload.get("workflow_input_bindings") or [])
    ]
    workflow_output_bindings = [
        parse_workflow_output_binding(binding, index)
        for index, binding in enumerate(payload.get("workflow_output_bindings") or [])
    ]
    policies = payload.get("policies") or payload.get("policy") or {}
    if not isinstance(policies, dict):
        raise AccError("WorkflowTemplate policies must be an object")
    metadata = payload.get("metadata") or {}
    if not isinstance(metadata, dict):
        raise AccError("WorkflowTemplate metadata must be an object")
    return WorkflowTemplate(
        id=workflow_id,
        version=version,
        nodes=nodes,
        control_edges=control_edges,
        data_edges=data_edges,
        exposed_inputs=exposed_inputs,
        exposed_outputs=exposed_outputs,
        workflow_input_bindings=workflow_input_bindings,
        workflow_output_bindings=workflow_output_bindings,
        policies=policies,
        metadata=metadata,
        source_path=source_path,
    )


def parse_node_spec(payload: dict[str, Any]) -> NodeSpec:
    node_id = require_string(payload, "id", "node")
    kind = payload.get("kind") or payload.get("type")
    if not isinstance(kind, str) or not kind:
        raise AccError(f"node {node_id} requires string field kind")
    if kind not in {"agent", "tool", "workflow"}:
        raise AccError(f"Unsupported node kind for {node_id}: {kind}")

    input_ports, output_ports = parse_ports(payload)
    runtime = payload.get("runtime") if isinstance(payload.get("runtime"), str) else None
    tool = payload.get("tool") if isinstance(payload.get("tool"), str) else None
    runner = payload.get("runner") if isinstance(payload.get("runner"), str) else None
    if kind == "tool" and tool is None and runner is not None:
        tool = "fake_producer" if runner == "fake" else runner
    if kind == "agent" and runtime is None and runner is not None:
        runtime = "generic_fake_agent" if runner == "fake" else runner

    return NodeSpec(
        id=node_id,
        kind=kind,  # type: ignore[arg-type]
        runtime=runtime,
        tool=tool,
        workflow_ref=payload.get("workflow_ref")
        if isinstance(payload.get("workflow_ref"), str)
        else None,
        prompt=payload.get("prompt") if isinstance(payload.get("prompt"), str) else None,
        permission_profile=parse_permission_profile(payload.get("permission_profile")),
        input_ports=input_ports,
        output_ports=output_ports,
        raw=dict(payload),
    )


def parse_permission_profile(value: Any) -> PermissionProfile:
    if value is None:
        return DEFAULT_PERMISSION_PROFILE
    if not isinstance(value, dict):
        raise AccError("permission_profile must be an object")
    workspace_access = str(value.get("workspace_access") or "read_only")
    if workspace_access not in {"read_only", "writes_run_only", "writes_workspace"}:
        raise AccError(f"Unsupported workspace_access: {workspace_access}")
    env_policy = str(value.get("env_policy") or "acc_whitelist")
    if env_policy not in {"acc_whitelist", "explicit_allowlist"}:
        raise AccError(f"Unsupported env_policy: {env_policy}")
    allowed_env = value.get("allowed_env") or []
    if not isinstance(allowed_env, list) or not all(isinstance(item, str) for item in allowed_env):
        raise AccError("permission_profile.allowed_env must be a string array")
    timeout_seconds = value.get("timeout_seconds", 60)
    if not isinstance(timeout_seconds, int) or timeout_seconds <= 0:
        raise AccError("permission_profile.timeout_seconds must be a positive integer")
    return PermissionProfile(
        workspace_access=workspace_access,  # type: ignore[arg-type]
        network=bool(value.get("network", False)),
        shell=bool(value.get("shell", False)),
        dangerous=bool(value.get("dangerous", False)),
        env_policy=env_policy,  # type: ignore[arg-type]
        allowed_env=tuple(allowed_env),
        timeout_seconds=timeout_seconds,
    )


def parse_ports(payload: dict[str, Any]) -> tuple[dict[str, PortContract], dict[str, PortContract]]:
    ports = payload.get("ports")
    if isinstance(ports, dict):
        input_value = ports.get("inputs", ports.get("in"))
        output_value = ports.get("outputs", ports.get("out"))
        return (parse_port_value(input_value, "input"), parse_port_value(output_value, "output"))
    return (
        parse_port_value(payload.get("input_ports"), "input"),
        parse_port_value(payload.get("output_ports"), "output"),
    )


def parse_port_value(value: Any, direction: str) -> dict[str, PortContract]:
    if value is None:
        return {}
    if isinstance(value, dict):
        result: dict[str, PortContract] = {}
        for port_id, port_payload in value.items():
            if not isinstance(port_id, str):
                raise AccError("port id must be a string")
            if port_payload is None:
                port_payload = {}
            if not isinstance(port_payload, dict):
                raise AccError(f"port {port_id} must be an object")
            result[port_id] = build_port_contract(port_id, direction, port_payload)
        return result
    if isinstance(value, list):
        result = {}
        for item in value:
            if isinstance(item, str):
                result[item] = build_port_contract(item, direction, {})
            elif isinstance(item, dict):
                port_id = require_string(item, "id", f"{direction} port")
                result[port_id] = build_port_contract(port_id, direction, item)
            else:
                raise AccError(f"{direction} port must be a string or object")
        return result
    raise AccError(f"{direction} ports must be an object or array")


def build_port_contract(port_id: str, direction: str, payload: dict[str, Any]) -> PortContract:
    validate_identifier(port_id, "port id")
    declared_direction = payload.get("direction", direction)
    if declared_direction != direction:
        raise AccError(f"Port {port_id} direction must be {direction}")
    return PortContract(
        id=port_id,
        direction=direction,  # type: ignore[arg-type]
        type=str(payload.get("type") or "artifact"),
        required=bool(payload.get("required", False)),
        cardinality=str(payload.get("cardinality") or "one"),
    )


def parse_control_edge(payload: Any, index: int) -> ControlEdge:
    if not isinstance(payload, dict):
        raise AccError("control edge must be an object")
    source = require_string(payload, "from", f"control edge {index}")
    target = require_string(payload, "to", f"control edge {index}")
    condition = payload.get("condition")
    if condition is not None and not isinstance(condition, str):
        raise AccError(f"control edge {index} condition must be string or null")
    return ControlEdge(source=source, target=target, condition=condition)


def parse_data_edge(payload: Any, index: int) -> DataEdge:
    if not isinstance(payload, dict):
        raise AccError("data edge must be an object")
    source_payload = payload.get("from")
    target_payload = payload.get("to")
    if not isinstance(source_payload, dict) or not isinstance(target_payload, dict):
        raise AccError(f"data edge {index} endpoints must be objects")
    materialization = str(payload.get("materialization") or "copy")
    if materialization == "link":
        materialization = "symlink"
    if materialization not in {"copy", "reference", "symlink"}:
        raise AccError(f"Unsupported materialization mode: {materialization}")
    return DataEdge(
        source=DataEndpoint(
            node=require_string(source_payload, "node", f"data edge {index} source"),
            port=str(source_payload.get("port") or source_payload.get("output") or "main"),
        ),
        target=DataEndpoint(
            node=require_string(target_payload, "node", f"data edge {index} target"),
            port=str(target_payload.get("port") or target_payload.get("input") or "main"),
        ),
        materialization=materialization,  # type: ignore[arg-type]
    )


def parse_workflow_input_binding(payload: Any, index: int) -> WorkflowInputBinding:
    if not isinstance(payload, dict):
        raise AccError("workflow input binding must be an object")
    source_port = str(payload.get("source_port") or payload.get("from_port") or "")
    if not source_port:
        source = payload.get("from")
        if isinstance(source, dict):
            source_port = str(source.get("port") or "")
    if not source_port:
        raise AccError(f"workflow input binding {index} requires source_port")
    target_payload = payload.get("target") or payload.get("to")
    if not isinstance(target_payload, dict):
        raise AccError(f"workflow input binding {index} target must be an object")
    return WorkflowInputBinding(
        source_port=source_port,
        target=DataEndpoint(
            node=require_string(target_payload, "node", f"workflow input binding {index} target"),
            port=str(target_payload.get("port") or target_payload.get("input") or "main"),
        ),
        materialization=parse_materialization(payload.get("materialization")),
        required=bool(payload.get("required", True)),
    )


def parse_workflow_output_binding(payload: Any, index: int) -> WorkflowOutputBinding:
    if not isinstance(payload, dict):
        raise AccError("workflow output binding must be an object")
    target_port = str(payload.get("target_port") or payload.get("to_port") or "")
    if not target_port:
        target = payload.get("target") or payload.get("to")
        if isinstance(target, dict):
            target_port = str(target.get("port") or "")
    if not target_port:
        raise AccError(f"workflow output binding {index} requires target_port")
    source_payload = payload.get("source") or payload.get("from")
    if not isinstance(source_payload, dict):
        raise AccError(f"workflow output binding {index} source must be an object")
    return WorkflowOutputBinding(
        source=DataEndpoint(
            node=require_string(source_payload, "node", f"workflow output binding {index} source"),
            port=str(source_payload.get("port") or source_payload.get("output") or "main"),
        ),
        target_port=target_port,
        materialization=parse_materialization(payload.get("materialization")),
        required=bool(payload.get("required", True)),
    )


def parse_materialization(value: Any) -> str:
    materialization = str(value or "copy")
    if materialization == "link":
        materialization = "symlink"
    if materialization not in {"copy", "reference", "symlink"}:
        raise AccError(f"Unsupported materialization mode: {materialization}")
    return materialization


def validate_clean_workflow_template(
    template: WorkflowTemplate,
    *,
    raw_payload: dict[str, Any] | None = None,
    allow_dangerous: bool = False,
    hermetic: bool = True,
) -> None:
    validate_identifier(template.id, "workflow id")
    if raw_payload is not None:
        reject_absolute_workspace_paths(raw_payload)
    validate_workflow_policy(template.policies)
    node_ids = set(template.nodes)
    for node in template.nodes.values():
        validate_node_spec(node, allow_dangerous=allow_dangerous, hermetic=hermetic)
    for edge in template.control_edges:
        if edge.source not in node_ids:
            raise AccError(f"Control edge points from missing node {edge.source!r}")
        if edge.target not in node_ids:
            raise AccError(f"Control edge points to missing node {edge.target!r}")
        if edge.source == edge.target:
            raise AccError(f"Control edge cannot connect node {edge.source!r} to itself")
    for edge in template.data_edges:
        validate_data_endpoint(template, edge.source, direction="output")
        validate_data_endpoint(template, edge.target, direction="input")
    validate_workflow_boundary_contract(template)
    levels = topological_levels(template)
    validate_data_edges_follow_control_dependencies(template, levels=levels)


def validate_node_spec(
    node: NodeSpec,
    *,
    allow_dangerous: bool = False,
    hermetic: bool = True,
) -> None:
    validate_identifier(node.id, "node id")
    if node.kind == "agent" and not node.runtime:
        raise AccError(f"Agent node {node.id} requires runtime")
    if node.kind == "tool" and not node.tool:
        raise AccError(f"Tool node {node.id} requires tool")
    if node.kind == "workflow" and not node.workflow_ref:
        raise AccError(f"Workflow node {node.id} requires workflow_ref")
    validate_permission_profile(
        node.permission_profile or DEFAULT_PERMISSION_PROFILE,
        allow_dangerous=allow_dangerous,
        hermetic=hermetic,
    )


def validate_permission_profile(
    profile: PermissionProfile,
    *,
    allow_dangerous: bool = False,
    hermetic: bool = True,
) -> None:
    if profile.dangerous and not allow_dangerous:
        raise AccError("dangerous permission requires explicit allow_dangerous")
    if hermetic and profile.network:
        raise AccError("network access is rejected in hermetic mode")
    if profile.env_policy not in {"acc_whitelist", "explicit_allowlist"}:
        raise AccError(f"Unsupported env_policy: {profile.env_policy}")
    if "ALL" in profile.allowed_env or "*" in profile.allowed_env:
        raise AccError("full host environment inheritance is rejected")


def validate_workflow_policy(policies: dict[str, Any]) -> None:
    failure_mode = str(policies.get("failure_mode") or "fail_fast")
    if failure_mode not in {"fail_fast", "continue_on_error", "all_or_nothing", "manual_review"}:
        raise AccError(f"Unsupported failure_mode: {failure_mode}")
    raw_max_concurrency = policies.get("max_concurrency", 1)
    if not isinstance(raw_max_concurrency, int) or raw_max_concurrency < 1:
        raise AccError("policies.max_concurrency must be a positive integer")


def validate_data_endpoint(
    template: WorkflowTemplate,
    endpoint: DataEndpoint,
    *,
    direction: str,
) -> None:
    node = template.nodes.get(endpoint.node)
    if node is None:
        raise AccError(f"Data edge points to missing node {endpoint.node!r}")
    validate_identifier(endpoint.port, "port id")
    ports = node.output_ports if direction == "output" else node.input_ports
    if ports and endpoint.port not in ports:
        raise AccError(
            f"Data edge references missing {direction} port "
            f"{endpoint.node}.{endpoint.port}"
        )


def validate_workflow_boundary_contract(template: WorkflowTemplate) -> None:
    for port_id, port in template.exposed_inputs.items():
        validate_identifier(port_id, "workflow input port id")
        if port.direction != "input":
            raise AccError(f"Workflow exposed input {port_id} must have input direction")
    for port_id, port in template.exposed_outputs.items():
        validate_identifier(port_id, "workflow output port id")
        if port.direction != "output":
            raise AccError(f"Workflow exposed output {port_id} must have output direction")

    seen_input_bindings: set[tuple[str, str, str]] = set()
    for binding in template.workflow_input_bindings:
        if binding.source_port not in template.exposed_inputs:
            raise AccError(
                f"Workflow input binding references missing exposed input "
                f"{binding.source_port!r}"
            )
        validate_data_endpoint(template, binding.target, direction="input")
        key = (binding.source_port, binding.target.node, binding.target.port)
        if key in seen_input_bindings:
            raise AccError(
                f"Duplicate workflow input binding "
                f"{binding.source_port} -> {binding.target.node}.{binding.target.port}"
            )
        seen_input_bindings.add(key)

    seen_output_ports: set[str] = set()
    for binding in template.workflow_output_bindings:
        if binding.target_port not in template.exposed_outputs:
            raise AccError(
                f"Workflow output binding references missing exposed output "
                f"{binding.target_port!r}"
            )
        validate_data_endpoint(template, binding.source, direction="output")
        if binding.target_port in seen_output_ports:
            raise AccError(f"Duplicate workflow output binding for {binding.target_port!r}")
        seen_output_ports.add(binding.target_port)


def topological_levels(template: WorkflowTemplate) -> list[list[str]]:
    outgoing: dict[str, list[str]] = {node_id: [] for node_id in template.nodes}
    incoming_count: dict[str, int] = {node_id: 0 for node_id in template.nodes}
    for edge in template.control_edges:
        outgoing[edge.source].append(edge.target)
        incoming_count[edge.target] += 1

    ready = deque(node_id for node_id, count in incoming_count.items() if count == 0)
    levels: list[list[str]] = []
    processed = 0
    while ready:
        level = list(ready)
        ready.clear()
        levels.append(level)
        processed += len(level)
        for node_id in level:
            for target in outgoing[node_id]:
                incoming_count[target] -= 1
                if incoming_count[target] == 0:
                    ready.append(target)
    if processed != len(template.nodes):
        raise AccError("WorkflowTemplate control graph contains a cycle")
    return levels


def validate_data_edges_follow_control_dependencies(
    template: WorkflowTemplate,
    *,
    levels: list[list[str]] | None = None,
) -> None:
    ancestors = control_ancestors(template, levels=levels)
    for edge in template.data_edges:
        if edge.source.node == edge.target.node:
            raise AccError(f"Data edge cannot connect node {edge.source.node!r} to itself")
        if edge.source.node not in ancestors[edge.target.node]:
            raise AccError(
                "Data edge source must be an upstream control dependency: "
                f"{edge.source.node}.{edge.source.port} -> "
                f"{edge.target.node}.{edge.target.port}"
            )


def control_ancestors(
    template: WorkflowTemplate,
    *,
    levels: list[list[str]] | None = None,
) -> dict[str, set[str]]:
    incoming: dict[str, list[str]] = {node_id: [] for node_id in template.nodes}
    for edge in template.control_edges:
        incoming[edge.target].append(edge.source)
    levels = levels or topological_levels(template)
    ancestors: dict[str, set[str]] = {node_id: set() for node_id in template.nodes}
    for level in levels:
        for node_id in level:
            for predecessor in incoming[node_id]:
                ancestors[node_id].add(predecessor)
                ancestors[node_id].update(ancestors[predecessor])
    return ancestors


def workflow_status_after_node_failure(failure_mode: str) -> str:
    if failure_mode == "continue_on_error":
        return "success"
    if failure_mode == "manual_review":
        return "manual_review"
    return "failed"


def reject_absolute_workspace_paths(payload: Any) -> None:
    if isinstance(payload, dict):
        for key, value in payload.items():
            if (
                key in PATH_KEYS
                and isinstance(value, str)
                and (re.match(r"^[A-Za-z]:[\\/]", value) or value.startswith(("/", "\\")))
            ):
                raise AccError(
                    "WorkflowTemplate must not contain local absolute workspace paths"
                )
            reject_absolute_workspace_paths(value)
    elif isinstance(payload, list):
        for item in payload:
            reject_absolute_workspace_paths(item)


def require_string(payload: dict[str, Any], key: str, context: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise AccError(f"{context} requires string field {key}")
    validate_identifier(value, key) if key in {"id", "node", "port"} else None
    return value


def validate_identifier(value: str, label: str) -> None:
    if not IDENTIFIER_RE.match(value):
        raise AccError(f"Invalid {label}: {value!r}")
