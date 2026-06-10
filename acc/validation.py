"""Validation helpers for ACC domain objects and JSON schemas.

Contains both Core v2 domain validation (``validate_core_v2_*``) and JSON
Schema validation utilities.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError

from acc.artifact_manifest import load_artifact_manifest_v2
from acc.models import (
    CORE_CALLABLE_KINDS,
    CORE_V2_SCHEMA_VERSION,
    EXECUTABLE_METADATA_KEYS,
    AccError,
    ArtifactContract,
    CallableRef,
    ExecutionPlan,
    NodeInvocationSpec,
    PermissionProfile,
    WorkflowFunctionTemplate,
)
from acc.utils import load_json


def validate_payload(payload: Any, schema_path: Path) -> None:
    schema = load_json(schema_path)
    try:
        Draft202012Validator(schema).validate(payload)
    except JsonSchemaValidationError as exc:
        path = ".".join(str(part) for part in exc.path)
        location = f" at {path}" if path else ""
        raise AccError(f"JSON Schema validation failed{location}: {exc.message}") from exc


def validate_json_file(json_path: Path, schema_path: Path) -> dict[str, Any]:
    payload = load_json(json_path)
    validate_payload(payload, schema_path)
    if not isinstance(payload, dict):
        raise AccError(f"Validated JSON output must be an object: {json_path}")
    return payload


def validate_artifacts(artifact_dir: Path, manifest_path: Path) -> list[str]:
    try:
        manifest = load_artifact_manifest(manifest_path)
    except AccError as exc:
        if "escapes artifact directory" in str(exc):
            return [str(exc)]
        raise
    errors: list[str] = []
    for artifact in manifest["required"]:
        relative_path = artifact["path"]
        path_error = validate_relative_artifact_path(relative_path)
        if path_error is not None:
            errors.append(path_error)
            continue
        if not (artifact_dir / relative_path).exists():
            errors.append(f"Missing required artifact: {relative_path}")

    for artifact in manifest["optional"]:
        path_error = validate_relative_artifact_path(artifact["path"])
        if path_error is not None:
            errors.append(path_error)
    return errors


def load_artifact_manifest(manifest_path: Path) -> dict[str, list[dict[str, Any]]]:
    manifest = load_artifact_manifest_v2(manifest_path)
    return {
        "required": [entry.model_dump(by_alias=True) for entry in manifest.required],
        "optional": [entry.model_dump(by_alias=True) for entry in manifest.optional],
    }


def validate_relative_artifact_path(relative_path: str) -> str | None:
    path = Path(relative_path)
    if path.is_absolute() or ".." in path.parts:
        return f"Artifact path escapes artifact directory: {relative_path}"
    return None


# -- Core v2 domain validation ------------------------------------------------


def validate_core_v2_workflow_function_template(template: WorkflowFunctionTemplate) -> None:
    if not template.id:
        raise AccError("WorkflowFunctionTemplate.id is required")
    if not template.version:
        raise AccError("WorkflowFunctionTemplate.version is required")
    _reject_executable_metadata(template.metadata, "workflow metadata")
    _reject_executable_metadata(template.policies, "workflow policies")
    node_ids = set(template.node_invocations)
    for node_id, node in template.node_invocations.items():
        if node.id != node_id:
            raise AccError(f"node key {node_id!r} does not match node id {node.id!r}")
        validate_core_v2_node_invocation_spec(node, node_ids=node_ids)
    for edge in template.control_edges:
        if edge.context != "none":
            raise AccError("Core v2 control edges must not carry data context")
        if edge.source not in node_ids or edge.target not in node_ids:
            raise AccError("Control edge references a missing node")
    for edge in template.data_edges:
        if edge.source.node not in node_ids or edge.target.node not in node_ids:
            raise AccError("Data edge references a missing node")
    for binding in template.workflow_output_bindings:
        if binding.source.node not in node_ids:
            raise AccError("Workflow output binding references a missing node")


def validate_core_v2_execution_plan(plan: ExecutionPlan) -> None:
    if plan.schema_version != CORE_V2_SCHEMA_VERSION:
        raise AccError(f"Unsupported ExecutionPlan schema_version: {plan.schema_version}")
    seen: set[str] = set()
    for node in plan.nodes:
        if node.node_id in seen:
            raise AccError(f"ExecutionPlan contains duplicate node id: {node.node_id}")
        seen.add(node.node_id)
        if node.invocation.id != node.node_id:
            raise AccError("ExecutionNode id must match its NodeInvocationSpec id")
        validate_core_v2_node_invocation_spec(node.invocation)
    unknown_level_nodes = {
        node_id for level in plan.levels for node_id in level if node_id not in seen
    }
    if unknown_level_nodes:
        raise AccError("ExecutionPlan level references a missing node")


def validate_core_v2_node_invocation_spec(
    node: NodeInvocationSpec,
    *,
    node_ids: set[str] | None = None,
) -> None:
    if not node.id:
        raise AccError("NodeInvocationSpec.id is required")
    validate_core_v2_callable_ref(node.callable_ref)
    _reject_executable_metadata(node.metadata, f"node {node.id} metadata")
    _validate_permission_profile(
        node.runtime_policy.permission_profile,
        f"node {node.id} runtime permission profile",
    )
    if node.invocation_policy.permission_profile is not None:
        _validate_permission_profile(
            node.invocation_policy.permission_profile,
            f"node {node.id} invocation permission profile",
        )
    if node.overrides.permission_profile is not None:
        _validate_permission_profile(
            node.overrides.permission_profile,
            f"node {node.id} override permission profile",
        )
    _validate_artifact_contract(node.artifact_contract, f"node {node.id} artifact contract")
    for binding in node.input_bindings:
        source = getattr(binding, "source", None)
        if node_ids is not None and source is not None and source.node not in node_ids:
            raise AccError("Input binding references a missing source node")
    for binding in node.workflow_call_input_bindings:
        if (
            node_ids is not None
            and binding.source is not None
            and binding.source.node not in node_ids
        ):
            raise AccError("Workflow call input binding references a missing source node")


def validate_core_v2_callable_ref(ref: CallableRef) -> None:
    if ref.kind not in CORE_CALLABLE_KINDS:
        raise AccError(f"Unsupported Core v2 callable kind: {ref.kind}")
    if not ref.id:
        raise AccError("CallableRef.id is required")


# -- Private domain validation helpers ----------------------------------------


def _reject_executable_metadata(payload: dict[str, object], label: str) -> None:
    for key, value in payload.items():
        if key in EXECUTABLE_METADATA_KEYS or key.startswith("legacy_"):
            raise AccError(f"{label} contains executable metadata key: {key}")
        if isinstance(value, dict):
            _reject_executable_metadata(value, f"{label}.{key}")


def _validate_artifact_contract(contract: ArtifactContract, label: str) -> None:
    for raw_path in (*contract.required_paths, *contract.optional_paths):
        path = Path(raw_path)
        if path.is_absolute() or ".." in path.parts:
            raise AccError(f"{label} contains unsafe artifact path: {raw_path}")


def _validate_permission_profile(profile: PermissionProfile, label: str) -> None:
    if profile.workspace_access not in {"read_only", "writes_run_only", "writes_workspace"}:
        raise AccError(f"{label} has invalid workspace_access")
    if profile.env_policy not in {"acc_whitelist", "explicit_allowlist"}:
        raise AccError(f"{label} has invalid env_policy")
    if profile.timeout_seconds <= 0:
        raise AccError(f"{label} timeout_seconds must be positive")
    if "ALL" in profile.allowed_env or "*" in profile.allowed_env:
        raise AccError(f"{label} must not allow the full host environment")
