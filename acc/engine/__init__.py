from __future__ import annotations

import re
from collections import deque
from pathlib import Path
from typing import Any

from acc.domain import (
    CORE_V2_SCHEMA_VERSION,
    AccError,
    ArtifactContract,
    CallableOverride,
    CallableRef,
    ControlEdge,
    DataEdge,
    DataEndpoint,
    ExecutionNode,
    ExecutionPlan,
    InvocationPolicy,
    NodeControlPolicy,
    NodeInputBinding,
    NodeInvocationSpec,
    NodeOutputBinding,
    PermissionProfile,
    PortContract,
    PromptPolicy,
    RetryPolicy,
    RuntimePolicy,
    TimeoutPolicy,
    WorkflowCallInputBinding,
    WorkflowCallOutputBinding,
    WorkflowFunctionTemplate,
    WorkflowInputBinding,
    WorkflowOutputBinding,
    validate_core_v2_workflow_function_template,
)

IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
PATH_KEYS = {"workspace", "workspace_root", "workspace_path", "local_path"}
NODE_STATUSES_OK = {"success", "skipped"}
DEFAULT_PERMISSION_PROFILE = PermissionProfile()
ENVIRONMENT_POLICIES = {
    "inherit_parent",
    "new_ephemeral",
    "binding_required",
    "forbidden",
}
CORE_V2_TEMPLATE_FIELDS = {
    "schema_version",
    "id",
    "version",
    "name",
    "description",
    "nodes",
    "control_edges",
    "data_edges",
    "exposed_inputs",
    "exposed_outputs",
    "workflow_input_bindings",
    "workflow_output_bindings",
    "policies",
    "metadata",
    "source_path",
}
CORE_V2_NODE_FIELDS = {
    "id",
    "callable_ref",
    "overrides",
    "ports",
    "input_bindings",
    "output_bindings",
    "workflow_call_input_bindings",
    "workflow_call_output_bindings",
    "environment_policy",
    "invocation_policy",
    "runtime_policy",
    "prompt_policy",
    "control",
    "artifact_contract",
    "output_schema",
    "metadata",
}


def parse_workflow_function_template(
    payload: dict[str, Any],
    *,
    source_path: Any | None = None,
) -> WorkflowFunctionTemplate:
    if payload.get("schema_version") != CORE_V2_SCHEMA_VERSION:
        raise AccError(f"Unsupported schema_version: {payload.get('schema_version')}")
    reject_core_v2_unknown_fields(payload, CORE_V2_TEMPLATE_FIELDS, "workflow")

    workflow_id = require_string(payload, "id", "WorkflowFunctionTemplate")
    version = require_string(payload, "version", workflow_id)
    nodes_payload = payload.get("nodes")
    if not isinstance(nodes_payload, list):
        raise AccError("WorkflowFunctionTemplate nodes must be an array")

    node_invocations: dict[str, NodeInvocationSpec] = {}
    for node_payload in nodes_payload:
        if not isinstance(node_payload, dict):
            raise AccError("WorkflowFunctionTemplate node must be an object")
        node = parse_core_v2_node_invocation(node_payload)
        if node.id in node_invocations:
            raise AccError(f"WorkflowFunctionTemplate contains duplicate node id: {node.id}")
        node_invocations[node.id] = node

    template = WorkflowFunctionTemplate(
        id=workflow_id,
        version=version,
        node_invocations=node_invocations,
        control_edges=[
            parse_core_v2_control_edge(edge, index)
            for index, edge in enumerate(payload.get("control_edges") or [])
        ],
        data_edges=[
            parse_core_v2_data_edge(edge, index)
            for index, edge in enumerate(payload.get("data_edges") or [])
        ],
        exposed_inputs=parse_port_value(payload.get("exposed_inputs"), "input"),
        exposed_outputs=parse_port_value(payload.get("exposed_outputs"), "output"),
        workflow_input_bindings=[
            parse_core_v2_workflow_input_binding(binding, index)
            for index, binding in enumerate(payload.get("workflow_input_bindings") or [])
        ],
        workflow_output_bindings=[
            parse_core_v2_workflow_output_binding(binding, index)
            for index, binding in enumerate(payload.get("workflow_output_bindings") or [])
        ],
        policies=parse_optional_mapping(
            payload.get("policies") or payload.get("policy"),
            "WorkflowFunctionTemplate policies",
        ),
        metadata=parse_core_v2_metadata(
            payload.get("metadata"),
            "WorkflowFunctionTemplate metadata",
        ),
        source_path=source_path,
    )
    return template


def validate_workflow_function_template(template: WorkflowFunctionTemplate) -> None:
    validate_core_v2_workflow_function_template(template)
    callable_topological_levels(template)


def compile_execution_plan(
    template: WorkflowFunctionTemplate,
    workflow_input: dict[str, Any] | None = None,
) -> ExecutionPlan:
    _ = workflow_input
    validate_workflow_function_template(template)
    levels = tuple(tuple(level) for level in callable_topological_levels(template))
    incoming: dict[str, list[str]] = {node_id: [] for node_id in template.node_invocations}
    for edge in template.control_edges:
        incoming[edge.target].append(edge.source)
    return ExecutionPlan(
        workflow_function_id=template.id,
        schema_version=CORE_V2_SCHEMA_VERSION,
        nodes=tuple(
            ExecutionNode(
                node_id=node_id,
                invocation=node,
                depends_on=tuple(incoming[node_id]),
            )
            for node_id, node in template.node_invocations.items()
        ),
        levels=levels,
    )


def parse_core_v2_node_invocation(payload: dict[str, Any]) -> NodeInvocationSpec:
    reject_core_v2_unknown_fields(
        payload,
        CORE_V2_NODE_FIELDS,
        f"node {payload.get('id') or '<unknown>'}",
    )
    node_id = require_string(payload, "id", "node")
    callable_ref_payload = require_mapping(
        payload.get("callable_ref"),
        f"node {node_id}.callable_ref",
    )
    input_ports, output_ports = parse_ports(payload)
    return NodeInvocationSpec(
        id=node_id,
        callable_ref=parse_core_v2_callable_ref(callable_ref_payload, node_id),
        overrides=parse_core_v2_callable_override(payload.get("overrides")),
        input_bindings=[
            parse_core_v2_node_input_binding(binding, index)
            for index, binding in enumerate(payload.get("input_bindings") or [])
        ],
        output_bindings=[
            parse_core_v2_node_output_binding(binding, index)
            for index, binding in enumerate(payload.get("output_bindings") or [])
        ],
        workflow_call_input_bindings=parse_workflow_call_input_bindings(
            payload.get("workflow_call_input_bindings")
        ),
        workflow_call_output_bindings=parse_workflow_call_output_bindings(
            payload.get("workflow_call_output_bindings")
        ),
        environment_policy=parse_environment_policy(payload.get("environment_policy")),
        invocation_policy=parse_core_v2_invocation_policy(payload.get("invocation_policy")),
        runtime_policy=parse_core_v2_runtime_policy(payload.get("runtime_policy")),
        prompt_policy=parse_core_v2_prompt_policy(payload.get("prompt_policy")),
        control=parse_core_v2_node_control_policy(payload.get("control")),
        artifact_contract=parse_core_v2_artifact_contract(payload.get("artifact_contract")),
        output_schema=parse_optional_output_schema(payload.get("output_schema"), node_id),
        input_ports=input_ports,
        output_ports=output_ports,
        metadata=parse_optional_mapping(payload.get("metadata"), f"node {node_id} metadata"),
    )


def parse_core_v2_callable_override(value: Any) -> CallableOverride:
    if value is None:
        return CallableOverride()
    payload = require_mapping(value, "overrides")
    timeout_seconds = payload.get("timeout_seconds")
    return CallableOverride(
        prompt=payload.get("prompt") if isinstance(payload.get("prompt"), str) else None,
        permission_profile=(
            parse_permission_profile(payload.get("permission_profile"))
            if payload.get("permission_profile") is not None
            else None
        ),
        timeout_seconds=timeout_seconds if isinstance(timeout_seconds, int) else None,
        retry=parse_optional_mapping(payload.get("retry"), "overrides.retry"),
        static_input=parse_optional_mapping(payload.get("static_input"), "overrides.static_input"),
        behavior_overlay=parse_optional_mapping(
            payload.get("behavior_overlay"),
            "overrides.behavior_overlay",
        ),
    )


def parse_core_v2_node_control_policy(value: Any) -> NodeControlPolicy:
    if value is None:
        return NodeControlPolicy()
    payload = require_mapping(value, "control")
    reject_status = str(payload.get("approval_reject_status") or "failed")
    if reject_status not in {"failed", "skipped"}:
        raise AccError(f"Unsupported approval_reject_status: {reject_status}")
    approval_prompt = payload.get("approval_prompt")
    return NodeControlPolicy(
        require_human_approval=bool(payload.get("require_human_approval", False)),
        approval_prompt=approval_prompt if isinstance(approval_prompt, str) else None,
        approval_reject_status=reject_status,  # type: ignore[arg-type]
        forward_main_output_on_control=(
            bool(payload["forward_main_output_on_control"])
            if isinstance(payload.get("forward_main_output_on_control"), bool)
            else None
        ),
    )


def parse_core_v2_callable_ref(payload: dict[str, Any], node_id: str) -> CallableRef:
    kind = str(payload.get("kind") or "")
    if kind not in {"agent_class", "tool_class", "workflow_function"}:
        raise AccError(f"Unsupported callable kind for node {node_id}: {kind}")
    version = payload.get("version")
    ref_id = require_callable_ref_id(payload, "id", f"node {node_id}.callable_ref", kind)
    return CallableRef(
        kind=kind,  # type: ignore[arg-type]
        id=ref_id,
        version=version if isinstance(version, str) else None,
    )


def parse_core_v2_runtime_policy(value: Any) -> RuntimePolicy:
    if value is None:
        return RuntimePolicy()
    payload = require_mapping(value, "runtime_policy")
    retry_payload = payload.get("retry") if isinstance(payload.get("retry"), dict) else {}
    timeout_payload = payload.get("timeout") if isinstance(payload.get("timeout"), dict) else {}
    timeout_seconds = timeout_payload.get("seconds") if isinstance(timeout_payload, dict) else None
    return RuntimePolicy(
        retry=RetryPolicy(
            max_attempts=int(retry_payload.get("max_attempts", 1)),
            backoff_seconds=float(retry_payload.get("backoff_seconds", 0.0)),
        ),
        timeout=TimeoutPolicy(
            seconds=timeout_seconds if isinstance(timeout_seconds, int) else None
        ),
        permission_profile=parse_permission_profile(payload.get("permission_profile")),
    )


def parse_core_v2_invocation_policy(value: Any) -> InvocationPolicy:
    if value is None:
        return InvocationPolicy()
    payload = require_mapping(value, "invocation_policy")
    timeout_seconds = payload.get("timeout_seconds")
    return InvocationPolicy(
        retry=payload.get("retry") if isinstance(payload.get("retry"), dict) else {},
        timeout_seconds=timeout_seconds if isinstance(timeout_seconds, int) else None,
        permission_profile=(
            parse_permission_profile(payload.get("permission_profile"))
            if payload.get("permission_profile") is not None
            else None
        ),
    )


def parse_core_v2_prompt_policy(value: Any) -> PromptPolicy:
    if value is None:
        return PromptPolicy()
    payload = require_mapping(value, "prompt_policy")
    system_prompt = payload.get("system_prompt")
    user_prompt = payload.get("user_prompt")
    return PromptPolicy(
        system_prompt=system_prompt if isinstance(system_prompt, str) else None,
        user_prompt=user_prompt if isinstance(user_prompt, str) else None,
        appendix_policy=str(payload.get("appendix_policy") or "task_only"),
    )


def parse_core_v2_artifact_contract(value: Any) -> ArtifactContract:
    if value is None:
        return ArtifactContract()
    payload = require_mapping(value, "artifact_contract")
    return ArtifactContract(
        required_paths=tuple(str(item) for item in payload.get("required_paths") or ()),
        optional_paths=tuple(str(item) for item in payload.get("optional_paths") or ()),
    )


def parse_optional_output_schema(value: Any, node_id: str) -> dict[str, Any] | None:
    if value is None:
        return None
    return dict(require_mapping(value, f"node {node_id}.output_schema"))


def parse_core_v2_node_input_binding(payload: Any, index: int) -> NodeInputBinding:
    value = require_mapping(payload, f"input_bindings[{index}]")
    source = parse_core_v2_optional_data_endpoint(
        value.get("source"),
        f"input_bindings[{index}].source",
    )
    return NodeInputBinding(
        source=source,
        target_port=str(value.get("target_port") or value.get("target") or "main"),
        static_value=value.get("static_value"),
        materialization=parse_materialization(value.get("materialization")),
        required=bool(value.get("required", True)),
    )


def parse_core_v2_node_output_binding(payload: Any, index: int) -> NodeOutputBinding:
    value = require_mapping(payload, f"output_bindings[{index}]")
    return NodeOutputBinding(
        source_port=str(value.get("source_port") or "main"),
        target=parse_core_v2_optional_data_endpoint(
            value.get("target"),
            f"output_bindings[{index}].target",
        ),
        materialization=parse_materialization(value.get("materialization")),
        required=bool(value.get("required", True)),
    )


def parse_core_v2_workflow_input_binding(payload: Any, index: int) -> WorkflowInputBinding:
    value = require_mapping(payload, f"workflow_input_bindings[{index}]")
    return WorkflowInputBinding(
        source_port=require_string(value, "source_port", f"workflow_input_bindings[{index}]"),
        target=parse_core_v2_data_endpoint(
            require_mapping(value.get("target"), f"workflow_input_bindings[{index}].target"),
            f"workflow_input_bindings[{index}].target",
        ),
        materialization=parse_materialization(value.get("materialization")),
        required=bool(value.get("required", True)),
    )


def parse_core_v2_workflow_output_binding(payload: Any, index: int) -> WorkflowOutputBinding:
    value = require_mapping(payload, f"workflow_output_bindings[{index}]")
    return WorkflowOutputBinding(
        source=parse_core_v2_data_endpoint(
            require_mapping(value.get("source"), f"workflow_output_bindings[{index}].source"),
            f"workflow_output_bindings[{index}].source",
        ),
        target_port=require_string(value, "target_port", f"workflow_output_bindings[{index}]"),
        materialization=parse_materialization(value.get("materialization")),
        required=bool(value.get("required", True)),
    )


def parse_core_v2_control_edge(payload: Any, index: int) -> ControlEdge:
    value = require_mapping(payload, f"control_edges[{index}]")
    if value.get("context") not in {None, "none"}:
        raise AccError("Core v2 control edges must not carry data context")
    source = value.get("from", value.get("source"))
    target = value.get("to", value.get("target"))
    if not isinstance(source, str) or not isinstance(target, str):
        raise AccError(f"control_edges[{index}] requires from/to node ids")
    return ControlEdge(
        source=source,
        target=target,
        condition=value.get("condition") if isinstance(value.get("condition"), str) else None,
        context="none",
    )


def parse_core_v2_data_edge(payload: Any, index: int) -> DataEdge:
    value = require_mapping(payload, f"data_edges[{index}]")
    return DataEdge(
        source=parse_core_v2_data_endpoint(
            require_mapping(value.get("source"), f"data_edges[{index}].source"),
            f"data_edges[{index}].source",
        ),
        target=parse_core_v2_data_endpoint(
            require_mapping(value.get("target"), f"data_edges[{index}].target"),
            f"data_edges[{index}].target",
        ),
        materialization=parse_materialization(value.get("materialization")),
    )


def parse_core_v2_optional_data_endpoint(value: Any, context: str) -> DataEndpoint | None:
    if value is None:
        return None
    return parse_core_v2_data_endpoint(require_mapping(value, context), context)


def parse_core_v2_data_endpoint(payload: dict[str, Any], context: str) -> DataEndpoint:
    return DataEndpoint(
        node=require_string(payload, "node", context),
        port=str(payload.get("port") or payload.get("output") or payload.get("input") or "main"),
    )


def parse_ports(payload: dict[str, Any]) -> tuple[dict[str, PortContract], dict[str, PortContract]]:
    ports = payload.get("ports") or {}
    if not isinstance(ports, dict):
        raise AccError("ports must be an object")
    return (
        parse_port_value(ports.get("inputs"), "input"),
        parse_port_value(ports.get("outputs"), "output"),
    )


def parse_port_value(value: Any, direction: str) -> dict[str, PortContract]:
    if value is None:
        return {}
    if isinstance(value, list):
        return {
            str(port_id): build_port_contract(str(port_id), direction, {})
            for port_id in value
        }
    if isinstance(value, dict):
        return {
            str(port_id): build_port_contract(
                str(port_id),
                direction,
                spec if isinstance(spec, dict) else {},
            )
            for port_id, spec in value.items()
        }
    raise AccError(f"ports.{direction}s must be an object or array")


def build_port_contract(port_id: str, direction: str, payload: dict[str, Any]) -> PortContract:
    return PortContract(
        id=port_id,
        direction=direction,  # type: ignore[arg-type]
        type=str(payload.get("type") or "artifact"),
        required=bool(payload.get("required", False)),
        cardinality=str(payload.get("cardinality") or "one"),
    )


def parse_permission_profile(value: Any) -> PermissionProfile:
    if value is None:
        return PermissionProfile()
    payload = require_mapping(value, "permission_profile")
    allowed_env = payload.get("allowed_env")
    return PermissionProfile(
        workspace_access=str(payload.get("workspace_access") or "read_only"),  # type: ignore[arg-type]
        network=bool(payload.get("network", False)),
        shell=bool(payload.get("shell", False)),
        dangerous=bool(payload.get("dangerous", False)),
        env_policy=str(payload.get("env_policy") or "acc_whitelist"),  # type: ignore[arg-type]
        allowed_env=(
            tuple(str(item) for item in allowed_env)
            if isinstance(allowed_env, list)
            else ()
        ),
        timeout_seconds=int(payload.get("timeout_seconds", 60)),
    )


def parse_environment_policy(value: Any) -> str:
    if value is None:
        return "inherit_parent"
    policy = str(value)
    if policy not in ENVIRONMENT_POLICIES:
        raise AccError(f"Unsupported environment_policy: {policy}")
    return policy


def parse_workflow_call_input_bindings(value: Any) -> list[WorkflowCallInputBinding]:
    return [
        parse_workflow_call_input_binding(binding, index)
        for index, binding in enumerate(value or [])
    ]


def parse_workflow_call_input_binding(value: Any, index: int) -> WorkflowCallInputBinding:
    payload = require_mapping(value, f"workflow_call_input_bindings[{index}]")
    return WorkflowCallInputBinding(
        source=parse_core_v2_optional_data_endpoint(
            payload.get("source"),
            f"workflow_call_input_bindings[{index}].source",
        ),
        workflow_input=str(payload.get("workflow_input") or payload.get("target_port") or "main"),
        static_value=payload.get("static_value"),
        materialization=parse_materialization(payload.get("materialization")),
        required=bool(payload.get("required", True)),
    )


def parse_workflow_call_output_bindings(value: Any) -> list[WorkflowCallOutputBinding]:
    return [
        parse_workflow_call_output_binding(binding, index)
        for index, binding in enumerate(value or [])
    ]


def parse_workflow_call_output_binding(value: Any, index: int) -> WorkflowCallOutputBinding:
    payload = require_mapping(value, f"workflow_call_output_bindings[{index}]")
    return WorkflowCallOutputBinding(
        workflow_output=str(payload.get("workflow_output") or payload.get("source_port") or "main"),
        parent_port=str(payload.get("parent_port") or payload.get("target_port") or "main"),
        materialization=parse_materialization(payload.get("materialization")),
        required=bool(payload.get("required", True)),
    )


def parse_materialization(value: Any) -> str:
    if value is None:
        return "copy"
    materialization = str(value)
    if materialization not in {"copy", "reference"}:
        raise AccError(f"Unsupported materialization: {materialization}")
    return materialization


def is_clean_workflow_payload(payload: dict[str, Any]) -> bool:
    return payload.get("schema_version") == CORE_V2_SCHEMA_VERSION


def reject_core_v2_unknown_fields(
    payload: dict[str, Any],
    allowed: set[str],
    context: str,
) -> None:
    unknown = sorted(field for field in payload if field not in allowed)
    if unknown:
        raise AccError(f"Core v2 {context} contains unsupported field(s): {', '.join(unknown)}")


def parse_optional_mapping(value: Any, context: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise AccError(f"{context} must be an object")
    return dict(value)


def parse_core_v2_metadata(value: Any, context: str) -> dict[str, Any]:
    payload = parse_optional_mapping(value, context)
    return payload


def require_mapping(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AccError(f"{context} must be an object")
    return value


def validate_callable_workflow_function(
    template: WorkflowFunctionTemplate,
    *,
    known_callable_refs: set[tuple[str, str]] | None = None,
    call_depth: int = 0,
    parent_stateful: bool = False,
) -> None:
    _ = call_depth
    validate_workflow_function_template(template)
    for node in template.node_invocations.values():
        validate_node_invocation_spec(
            template,
            node,
            known_callable_refs=known_callable_refs,
            parent_stateful=parent_stateful,
        )


def validate_node_invocation_spec(
    template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
    *,
    known_callable_refs: set[tuple[str, str]] | None = None,
    parent_stateful: bool = False,
) -> None:
    _ = template, parent_stateful
    validate_callable_ref(node.callable_ref, known_callable_refs=known_callable_refs)
    for binding in node.input_bindings:
        if binding.source is None and binding.static_value is None and binding.required:
            continue
    validate_workflow_call_input_boundary(template, node)
    validate_workflow_call_output_boundary(node)


def validate_callable_ref(
    ref: CallableRef,
    *,
    known_callable_refs: set[tuple[str, str]] | None = None,
) -> None:
    if ref.kind not in {"agent_class", "tool_class", "workflow_function"}:
        raise AccError(f"Unsupported callable kind: {ref.kind}")
    if not ref.id:
        raise AccError("CallableRef.id is required")
    if (
        known_callable_refs is not None
        and (ref.kind, ref.id) not in known_callable_refs
        and ref.kind != "workflow_function"
    ):
        raise AccError(f"Unknown callable reference: {ref.kind}:{ref.id}")


def validate_workflow_call_input_boundary(
    template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
) -> None:
    _ = template
    if node.callable_ref.kind != "workflow_function":
        if node.workflow_call_input_bindings:
            raise AccError(f"Node {node.id} is not a workflow_function callable")
        return
    for binding in node.workflow_call_input_bindings:
        if not binding.workflow_input:
            raise AccError(f"Node {node.id} has empty workflow call input binding")


def validate_workflow_call_output_boundary(node: NodeInvocationSpec) -> None:
    if node.callable_ref.kind != "workflow_function":
        if node.workflow_call_output_bindings:
            raise AccError(f"Node {node.id} is not a workflow_function callable")
        return
    for binding in node.workflow_call_output_bindings:
        if not binding.workflow_output or not binding.parent_port:
            raise AccError(f"Node {node.id} has invalid workflow call output binding")


def validate_workflow_call_contract(
    template: WorkflowFunctionTemplate,
    child_template: WorkflowFunctionTemplate,
    node: NodeInvocationSpec,
) -> None:
    _ = template
    if node.callable_ref.kind != "workflow_function":
        raise AccError(f"Node {node.id} is not a workflow_function callable")
    child_inputs = set(child_template.exposed_inputs)
    child_outputs = set(child_template.exposed_outputs)
    for binding in node.workflow_call_input_bindings:
        if child_inputs and binding.workflow_input not in child_inputs:
            raise AccError(f"Unknown child workflow input: {binding.workflow_input}")
    for binding in node.workflow_call_output_bindings:
        if child_outputs and binding.workflow_output not in child_outputs:
            raise AccError(f"Unknown child workflow output: {binding.workflow_output}")


def validate_callable_control_edges(
    template: WorkflowFunctionTemplate,
    node_ids: set[str],
) -> None:
    for edge in template.control_edges:
        if edge.source not in node_ids or edge.target not in node_ids:
            raise AccError("Control edge references a missing node")
        if edge.context != "none":
            raise AccError("Core v2 control edges must not carry data context")


def validate_callable_data_edges(
    template: WorkflowFunctionTemplate,
    node_ids: set[str],
) -> None:
    for edge in template.data_edges:
        if edge.source.node not in node_ids or edge.target.node not in node_ids:
            raise AccError("Data edge references a missing node")


def callable_topological_levels(template: WorkflowFunctionTemplate) -> list[list[str]]:
    node_ids = set(template.node_invocations)
    incoming: dict[str, set[str]] = {node_id: set() for node_id in node_ids}
    outgoing: dict[str, set[str]] = {node_id: set() for node_id in node_ids}
    for edge in template.control_edges:
        if edge.source not in node_ids or edge.target not in node_ids:
            raise AccError("Control edge references a missing node")
        incoming[edge.target].add(edge.source)
        outgoing[edge.source].add(edge.target)
    ready = deque(sorted(node for node, deps in incoming.items() if not deps))
    levels: list[list[str]] = []
    processed: set[str] = set()
    while ready:
        level = list(ready)
        ready.clear()
        levels.append(level)
        for node in level:
            processed.add(node)
            for target in sorted(outgoing[node]):
                incoming[target].discard(node)
                if not incoming[target]:
                    ready.append(target)
    if processed != node_ids:
        raise AccError("WorkflowFunctionTemplate control graph contains a cycle")
    return levels


def validate_callable_data_edges_follow_control_dependencies(
    template: WorkflowFunctionTemplate,
    *,
    levels: list[list[str]] | None = None,
) -> None:
    if levels is None:
        levels = callable_topological_levels(template)
    order = {node_id: index for index, level in enumerate(levels) for node_id in level}
    ancestors = callable_control_ancestors(template)
    for edge in template.data_edges:
        if order[edge.source.node] >= order[edge.target.node]:
            raise AccError("Data edge source must run before target")
        if edge.source.node not in ancestors[edge.target.node]:
            raise AccError("Data edge must follow a control dependency")


def callable_control_ancestors(template: WorkflowFunctionTemplate) -> dict[str, set[str]]:
    parents: dict[str, set[str]] = {node_id: set() for node_id in template.node_invocations}
    for edge in template.control_edges:
        parents[edge.target].add(edge.source)
    ancestors: dict[str, set[str]] = {node_id: set() for node_id in template.node_invocations}
    for node_id in template.node_invocations:
        stack = list(parents[node_id])
        while stack:
            parent = stack.pop()
            if parent in ancestors[node_id]:
                continue
            ancestors[node_id].add(parent)
            stack.extend(parents[parent])
    return ancestors


def topological_levels(template: WorkflowFunctionTemplate) -> list[list[str]]:
    return callable_topological_levels(template)


def validate_nested_internal_node_boundaries(payload: dict[str, Any]) -> None:
    reject_absolute_workspace_paths(payload)


def workflow_status_after_node_failure(failure_mode: str) -> str:
    if failure_mode == "continue":
        return "partial"
    return "failed"


def reject_absolute_workspace_paths(payload: Any) -> None:
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key in PATH_KEYS and isinstance(value, str) and re.match(r"^[A-Za-z]:[\\/]", value):
                raise AccError(
                    "WorkflowFunctionTemplate must not contain local absolute workspace paths"
                )
            reject_absolute_workspace_paths(value)
    elif isinstance(payload, list):
        for item in payload:
            reject_absolute_workspace_paths(item)


def require_string(payload: dict[str, Any], key: str, context: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise AccError(f"{context} requires string field {key}")
    validate_identifier(value, f"{context}.{key}")
    return value


def require_callable_ref_id(
    payload: dict[str, Any],
    key: str,
    context: str,
    kind: str,
) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise AccError(f"{context} requires string field {key}")
    if kind == "workflow_function":
        validate_workflow_function_ref_id(value, f"{context}.{key}")
    else:
        validate_identifier(value, f"{context}.{key}")
    return value


def validate_workflow_function_ref_id(value: str, label: str) -> None:
    if IDENTIFIER_RE.match(value):
        return
    path = Path(value)
    if ".." in path.parts:
        raise AccError(f"{label} must not contain '..'")
    if not path.name.endswith(".accflow.json"):
        raise AccError(f"{label} must be an identifier or .accflow.json path")


def validate_identifier(value: str, label: str) -> None:
    if not IDENTIFIER_RE.match(value):
        raise AccError(f"{label} must match {IDENTIFIER_RE.pattern}")
