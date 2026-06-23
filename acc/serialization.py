"""Serialization helpers for ACC domain models.

Converts frozen dataclass instances to/from plain dictionaries suitable for
JSON persistence.  All type references are imported from ``acc.models``.
"""

from __future__ import annotations

from dataclasses import fields, is_dataclass
from pathlib import Path
from typing import Any

from acc.models import (
    CORE_V2_SCHEMA_VERSION,
    AccError,
    ArtifactContract,
    CallableOverride,
    CallableRef,
    ControlEdge,
    DataEdge,
    DataEndpoint,
    ExecutionPlan,  # noqa: F811 – kept for clarity
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
)

# -- Public serialization API -------------------------------------------------


def workflow_function_template_to_dict(template: WorkflowFunctionTemplate) -> dict[str, Any]:
    return {
        "schema_version": CORE_V2_SCHEMA_VERSION,
        "id": template.id,
        "version": template.version,
        "nodes": [
            node_invocation_to_wire_dict(node)
            for node in template.node_invocations.values()
        ],
        "control_edges": [
            {
                "from": edge.source,
                "to": edge.target,
                **({"condition": edge.condition} if edge.condition else {}),
                "context": edge.context,
            }
            for edge in template.control_edges
        ],
        "data_edges": _to_jsonable(template.data_edges),
        "exposed_inputs": _to_jsonable(template.exposed_inputs),
        "exposed_outputs": _to_jsonable(template.exposed_outputs),
        "workflow_input_bindings": _to_jsonable(template.workflow_input_bindings),
        "workflow_output_bindings": _to_jsonable(template.workflow_output_bindings),
        "policies": _to_jsonable(template.policies),
        "metadata": _to_jsonable(template.metadata),
    }


def node_invocation_to_wire_dict(node: NodeInvocationSpec) -> dict[str, Any]:
    payload = _to_jsonable(node)
    payload["ports"] = {
        "inputs": payload.pop("input_ports", {}),
        "outputs": payload.pop("output_ports", {}),
    }
    if payload.get("output_schema") is None:
        payload.pop("output_schema", None)
    return payload


def workflow_function_template_from_dict(payload: dict[str, Any]) -> WorkflowFunctionTemplate:
    schema_version = payload.get("schema_version")
    if schema_version != CORE_V2_SCHEMA_VERSION:
        raise AccError(f"Unsupported schema_version: {schema_version}")
    nodes_payload = payload.get("nodes")
    if not isinstance(nodes_payload, list):
        raise AccError("WorkflowFunctionTemplate nodes must be an array")
    node_items = {
        str(item.get("id") or ""): item
        for item in nodes_payload
        if isinstance(item, dict)
    }
    return WorkflowFunctionTemplate(
        id=_required_string(payload, "id"),
        version=_required_string(payload, "version"),
        node_invocations={
            node_id: _node_invocation_from_dict(node_payload)
            for node_id, node_payload in node_items.items()
            if isinstance(node_id, str) and isinstance(node_payload, dict)
        },
        control_edges=[
            _control_edge_from_dict(edge)
            for edge in _required_list(payload.get("control_edges"), "control_edges")
        ],
        data_edges=[
            _data_edge_from_dict(edge)
            for edge in _required_list(payload.get("data_edges"), "data_edges")
        ],
        exposed_inputs=_port_map_from_dict(payload.get("exposed_inputs")),
        exposed_outputs=_port_map_from_dict(payload.get("exposed_outputs")),
        workflow_input_bindings=[
            _workflow_input_binding_from_dict(binding)
            for binding in _required_list(
                payload.get("workflow_input_bindings"),
                "workflow_input_bindings",
            )
        ],
        workflow_output_bindings=[
            _workflow_output_binding_from_dict(binding)
            for binding in _required_list(
                payload.get("workflow_output_bindings"),
                "workflow_output_bindings",
            )
        ],
        policies=_dict_or_empty(payload.get("policies"), "policies"),
        metadata=_dict_or_empty(payload.get("metadata"), "metadata"),
        source_path=Path(str(payload["source_path"])) if payload.get("source_path") else None,
    )


def execution_plan_to_dict(plan: ExecutionPlan) -> dict[str, Any]:
    return _to_jsonable(plan)


def control_ledger_to_dict(value: Any) -> Any:
    return _to_jsonable(value)


# -- Generic recursive serializer --------------------------------------------


def _to_jsonable(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if is_dataclass(value) and not isinstance(value, type):
        return {field.name: _to_jsonable(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, dict):
        return {str(key): _to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(item) for item in value]
    return value


# -- Internal from_dict helpers -----------------------------------------------


def _node_invocation_from_dict(payload: dict[str, Any]) -> NodeInvocationSpec:
    input_ports, output_ports = _node_ports_from_dict(payload)
    return NodeInvocationSpec(
        id=_required_string(payload, "id"),
        callable_ref=_callable_ref_from_dict(
            _required_dict(payload.get("callable_ref"), "callable_ref")
        ),
        overrides=_callable_override_from_dict(payload.get("overrides")),
        input_bindings=[
            _node_input_binding_from_dict(binding)
            for binding in _required_list(payload.get("input_bindings"), "input_bindings")
        ],
        output_bindings=[
            _node_output_binding_from_dict(binding)
            for binding in _required_list(payload.get("output_bindings"), "output_bindings")
        ],
        workflow_call_input_bindings=[
            _workflow_call_input_binding_from_dict(binding)
            for binding in _required_list(
                payload.get("workflow_call_input_bindings"),
                "workflow_call_input_bindings",
            )
        ],
        workflow_call_output_bindings=[
            _workflow_call_output_binding_from_dict(binding)
            for binding in _required_list(
                payload.get("workflow_call_output_bindings"),
                "workflow_call_output_bindings",
            )
        ],
        environment_policy=str(payload.get("environment_policy") or "inherit_parent"),  # type: ignore[arg-type]
        invocation_policy=_invocation_policy_from_dict(payload.get("invocation_policy")),
        runtime_policy=_runtime_policy_from_dict(payload.get("runtime_policy")),
        prompt_policy=_prompt_policy_from_dict(payload.get("prompt_policy")),
        control=_node_control_policy_from_dict(payload.get("control")),
        artifact_contract=_artifact_contract_from_dict(payload.get("artifact_contract")),
        output_schema=_optional_dict(payload.get("output_schema"), "output_schema"),
        input_ports=input_ports,
        output_ports=output_ports,
        metadata=_dict_or_empty(payload.get("metadata"), "metadata"),
    )


def _callable_ref_from_dict(payload: dict[str, Any]) -> CallableRef:
    version = payload.get("version")
    return CallableRef(
        kind=str(payload.get("kind") or ""),  # type: ignore[arg-type]
        id=_required_string(payload, "id"),
        version=version if isinstance(version, str) else None,
    )


def _callable_override_from_dict(value: Any) -> CallableOverride:
    payload = _dict_or_empty(value, "overrides")
    return CallableOverride(
        prompt=payload.get("prompt") if isinstance(payload.get("prompt"), str) else None,
        permission_profile=_permission_profile_from_dict(payload.get("permission_profile")),
        timeout_seconds=payload.get("timeout_seconds")
        if isinstance(payload.get("timeout_seconds"), int)
        else None,
        retry=_dict_or_empty(payload.get("retry"), "retry"),
        static_input=_dict_or_empty(payload.get("static_input"), "static_input"),
        behavior_overlay=_dict_or_empty(payload.get("behavior_overlay"), "behavior_overlay"),
    )


def _node_control_policy_from_dict(value: Any) -> NodeControlPolicy:
    payload = _dict_or_empty(value, "control")
    reject_status = payload.get("approval_reject_status") or "failed"
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


def _permission_profile_from_dict(value: Any) -> PermissionProfile | None:
    if value is None:
        return None
    payload = _required_dict(value, "permission_profile")
    return PermissionProfile(
        workspace_access=str(payload.get("workspace_access") or "read_only"),  # type: ignore[arg-type]
        network=bool(payload.get("network", False)),
        shell=bool(payload.get("shell", False)),
        dangerous=bool(payload.get("dangerous", False)),
        env_policy=str(payload.get("env_policy") or "acc_whitelist"),  # type: ignore[arg-type]
        allowed_env=tuple(str(item) for item in payload.get("allowed_env") or []),
        timeout_seconds=int(payload.get("timeout_seconds") or 60),
    )


def _runtime_policy_from_dict(value: Any) -> RuntimePolicy:
    payload = _dict_or_empty(value, "runtime_policy")
    retry = _dict_or_empty(payload.get("retry"), "runtime_policy.retry")
    timeout = _dict_or_empty(payload.get("timeout"), "runtime_policy.timeout")
    permission_profile = _permission_profile_from_dict(payload.get("permission_profile"))
    return RuntimePolicy(
        retry=RetryPolicy(
            max_attempts=int(retry.get("max_attempts") or 1),
            backoff_seconds=float(retry.get("backoff_seconds") or 0.0),
        ),
        timeout=TimeoutPolicy(
            seconds=timeout.get("seconds") if isinstance(timeout.get("seconds"), int) else None
        ),
        permission_profile=permission_profile or PermissionProfile(),
    )


def _prompt_policy_from_dict(value: Any) -> PromptPolicy:
    payload = _dict_or_empty(value, "prompt_policy")
    return PromptPolicy(
        system_prompt=payload.get("system_prompt")
        if isinstance(payload.get("system_prompt"), str)
        else None,
        user_prompt=payload.get("user_prompt")
        if isinstance(payload.get("user_prompt"), str)
        else None,
        appendix_policy=str(payload.get("appendix_policy") or "task_only"),
    )


def _artifact_contract_from_dict(value: Any) -> ArtifactContract:
    payload = _dict_or_empty(value, "artifact_contract")
    return ArtifactContract(
        required_paths=tuple(str(item) for item in payload.get("required_paths") or []),
        optional_paths=tuple(str(item) for item in payload.get("optional_paths") or []),
    )


def _invocation_policy_from_dict(value: Any) -> InvocationPolicy:
    payload = _dict_or_empty(value, "invocation_policy")
    return InvocationPolicy(
        retry=_dict_or_empty(payload.get("retry"), "invocation_policy.retry"),
        timeout_seconds=payload.get("timeout_seconds")
        if isinstance(payload.get("timeout_seconds"), int)
        else None,
        permission_profile=_permission_profile_from_dict(payload.get("permission_profile")),
    )


def _node_input_binding_from_dict(payload: dict[str, Any]) -> NodeInputBinding:
    source_payload = payload.get("source")
    return NodeInputBinding(
        source=_data_endpoint_from_dict(source_payload)
        if isinstance(source_payload, dict)
        else None,
        target_port=str(payload.get("target_port") or "main"),
        static_value=payload.get("static_value"),
        materialization=str(payload.get("materialization") or "copy"),  # type: ignore[arg-type]
        required=bool(payload.get("required", True)),
    )


def _node_output_binding_from_dict(payload: dict[str, Any]) -> NodeOutputBinding:
    target_payload = payload.get("target")
    return NodeOutputBinding(
        source_port=str(payload.get("source_port") or "main"),
        target=_data_endpoint_from_dict(target_payload)
        if isinstance(target_payload, dict)
        else None,
        materialization=str(payload.get("materialization") or "copy"),  # type: ignore[arg-type]
        required=bool(payload.get("required", True)),
    )


def _workflow_input_binding_from_dict(payload: dict[str, Any]) -> WorkflowInputBinding:
    return WorkflowInputBinding(
        source_port=_required_string(payload, "source_port"),
        target=_data_endpoint_from_dict(_required_dict(payload.get("target"), "target")),
        materialization=str(payload.get("materialization") or "copy"),  # type: ignore[arg-type]
        required=bool(payload.get("required", True)),
    )


def _workflow_output_binding_from_dict(payload: dict[str, Any]) -> WorkflowOutputBinding:
    return WorkflowOutputBinding(
        source=_data_endpoint_from_dict(_required_dict(payload.get("source"), "source")),
        target_port=_required_string(payload, "target_port"),
        materialization=str(payload.get("materialization") or "copy"),  # type: ignore[arg-type]
        required=bool(payload.get("required", True)),
    )


def _workflow_call_input_binding_from_dict(payload: dict[str, Any]) -> WorkflowCallInputBinding:
    source_payload = payload.get("source")
    return WorkflowCallInputBinding(
        source=_data_endpoint_from_dict(source_payload)
        if isinstance(source_payload, dict)
        else None,
        workflow_input=str(payload.get("workflow_input") or "main"),
        static_value=payload.get("static_value"),
        materialization=str(payload.get("materialization") or "copy"),  # type: ignore[arg-type]
        required=bool(payload.get("required", True)),
    )


def _workflow_call_output_binding_from_dict(payload: dict[str, Any]) -> WorkflowCallOutputBinding:
    return WorkflowCallOutputBinding(
        workflow_output=_required_string(payload, "workflow_output"),
        parent_port=_required_string(payload, "parent_port"),
        materialization=str(payload.get("materialization") or "copy"),  # type: ignore[arg-type]
        required=bool(payload.get("required", True)),
    )


def _control_edge_from_dict(payload: dict[str, Any]) -> ControlEdge:
    return ControlEdge(
        source=_required_string(payload, "from"),
        target=_required_string(payload, "to"),
        condition=payload.get("condition") if isinstance(payload.get("condition"), str) else None,
        context=str(payload.get("context") or "none"),  # type: ignore[arg-type]
    )


def _data_edge_from_dict(payload: dict[str, Any]) -> DataEdge:
    return DataEdge(
        source=_data_endpoint_from_dict(_required_dict(payload.get("source"), "source")),
        target=_data_endpoint_from_dict(_required_dict(payload.get("target"), "target")),
        materialization=str(payload.get("materialization") or "copy"),  # type: ignore[arg-type]
    )


def _data_endpoint_from_dict(payload: dict[str, Any]) -> DataEndpoint:
    return DataEndpoint(
        node=_required_string(payload, "node"),
        port=_required_string(payload, "port"),
    )


def _port_map_from_dict(value: Any, direction: str = "input") -> dict[str, PortContract]:
    payload = _dict_or_empty(value, "ports")
    return {
        port_id: PortContract(
            id=str(port_payload.get("id") or port_id),
            direction=str(port_payload.get("direction") or direction),  # type: ignore[arg-type]
            type=str(port_payload.get("type") or "artifact"),
            required=bool(port_payload.get("required", False)),
            cardinality=str(port_payload.get("cardinality") or "one"),
        )
        for port_id, port_payload in payload.items()
        if isinstance(port_id, str) and isinstance(port_payload, dict)
    }


def _node_ports_from_dict(
    payload: dict[str, Any],
) -> tuple[dict[str, PortContract], dict[str, PortContract]]:
    ports = payload.get("ports")
    if ports is None:
        return {}, {}
    if not isinstance(ports, dict):
        raise AccError("Node ports must be an object")
    return (
        _port_map_from_dict(ports.get("inputs"), "input"),
        _port_map_from_dict(ports.get("outputs"), "output"),
    )


# -- Primitive extraction helpers ---------------------------------------------


def _required_string(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise AccError(f"{key} must be a non-empty string")
    return value


def _required_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AccError(f"{label} must be an object")
    return value


def _dict_or_empty(value: Any, label: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise AccError(f"{label} must be an object")
    return value


def _optional_dict(value: Any, label: str) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise AccError(f"{label} must be an object")
    return value


def _required_list(value: Any, label: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise AccError(f"{label} must be an array of objects")
    return value
