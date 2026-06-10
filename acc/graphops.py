from __future__ import annotations

from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError

from acc.models import CORE_V2_SCHEMA_VERSION
from acc.engine import parse_workflow_function_template, validate_workflow_function_template
from acc.utils import AccError, load_json

FORBIDDEN_OPERATIONS = {
    "enable_danger_full_access",
    "remove_human_gate",
    "disable_tests",
    "write_secret_files",
    "change_git_remote",
    "remove_schema_validation",
    "add_artifact_requirement",
}
GRAPHOPS_PATCH_SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent / "schemas" / "graphops_patch_schema.json"
)
GRAPHOPS_GOVERNANCE_MODE = "proposal_dry_run_only"
GRAPHOPS_APPLY_STATUS = "not_implemented"


def graphops_governance_payload() -> dict[str, Any]:
    return {
        "governance_mode": GRAPHOPS_GOVERNANCE_MODE,
        "dry_run_only": True,
        "apply_status": GRAPHOPS_APPLY_STATUS,
        "apply_requires_human_approval": True,
    }


def validate_patch_file(patch_path: Path) -> dict[str, Any]:
    patch = load_json(patch_path)
    if not isinstance(patch, dict):
        raise AccError("GraphOps patch must be a JSON object")
    validate_patch(patch)
    return patch


def validate_patch(patch: dict[str, Any]) -> None:
    schema = load_json(GRAPHOPS_PATCH_SCHEMA_PATH)
    try:
        Draft202012Validator(schema).validate(patch)
    except JsonSchemaValidationError as exc:
        path = ".".join(str(part) for part in exc.path)
        location = f" at {path}" if path else ""
        raise AccError(f"GraphOps patch schema validation failed{location}: {exc.message}") from exc

    target_path = patch["target_path"]
    path_error = validate_relative_path(target_path)
    if path_error is not None:
        raise AccError(path_error)
    if patch["target_type"] == "schema":
        raise AccError("GraphOps schema mutations are disabled by default")
    if Path(target_path).name == "output_schema.json":
        raise AccError("GraphOps output schema mutations are disabled by default")
    if patch["target_type"] == "workflow" and not target_path.endswith(".accflow.json"):
        raise AccError("GraphOps workflow target must be a canonical .accflow.json file")

    for index, operation in enumerate(patch["operations"], start=1):
        op = operation["op"]
        if op in FORBIDDEN_OPERATIONS:
            raise AccError(f"Forbidden GraphOps operation at operations[{index}]: {op}")
        validate_operation_policy(operation, index)
        validate_operation_paths(operation, index)


def validate_operation_policy(operation: dict[str, Any], index: int) -> None:
    if contains_legacy_workflow_field(operation):
        raise AccError(
            f"GraphOps workflow operation contains legacy field at operations[{index}]"
        )
    if operation.get("op") == "connect_nodes":
        raise AccError("GraphOps connect_nodes is legacy shorthand; use add_control_edge")
    if operation.get("op") == "update_node_input":
        raise AccError("GraphOps update_node_input is legacy shorthand; use input_bindings")
    if operation.get("op") == "replace_schema":
        raise AccError("GraphOps schema mutations are disabled by default")
    if contains_value(operation, "danger-full-access"):
        raise AccError(
            f"Forbidden GraphOps permission value at operations[{index}]: danger-full-access"
        )
    if contains_policy_value(operation, "network", True):
        raise AccError(f"Forbidden GraphOps network enable at operations[{index}]")
    if contains_policy_value(operation, "write_files", True):
        raise AccError(f"Forbidden GraphOps write_files enable at operations[{index}]")
    if operation.get("op") == "remove_node" and operation.get("node_id") == "human_gate":
        raise AccError("Forbidden GraphOps operation: removing human_gate")


def validate_operation_paths(operation: dict[str, Any], index: int) -> None:
    for key, value in operation.items():
        if isinstance(value, str) and key.endswith("path"):
            path_error = validate_relative_path(value)
            if path_error is not None:
                raise AccError(f"{path_error} at operations[{index}].{key}")


def validate_relative_path(value: str) -> str | None:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        return f"GraphOps path escapes repository: {value}"
    return None


def contains_value(value: Any, needle: str) -> bool:
    if isinstance(value, str):
        return value == needle
    if isinstance(value, dict):
        return any(contains_value(child, needle) for child in value.values())
    if isinstance(value, list):
        return any(contains_value(child, needle) for child in value)
    return False


def contains_policy_value(value: Any, key: str, expected: Any) -> bool:
    if isinstance(value, dict):
        if value.get(key) == expected:
            return True
        return any(contains_policy_value(child, key, expected) for child in value.values())
    if isinstance(value, list):
        return any(contains_policy_value(child, key, expected) for child in value)
    return False


def contains_legacy_workflow_field(value: Any) -> bool:
    allowed_node_fields = {
        "id",
        "callable_ref",
        "ports",
        "input_bindings",
        "output_bindings",
        "workflow_call_input_bindings",
        "workflow_call_output_bindings",
        "environment_policy",
        "invocation_policy",
        "runtime_policy",
        "prompt_policy",
        "artifact_contract",
        "metadata",
    }
    legacy_fields = {
        "input_mapping",
        "legacy_value_edges",
        "binding_mode",
        "upstream_context",
        "runtime",
        "kind",
        "tool",
        "workflow_ref",
    }
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "node" and isinstance(child, dict):
                return any(node_key not in allowed_node_fields for node_key in child)
            if key in legacy_fields:
                return True
            if key == "callable_ref":
                continue
            if contains_legacy_workflow_field(child):
                return True
        return False
    if isinstance(value, list):
        return any(contains_legacy_workflow_field(child) for child in value)
    return False


def dry_run_patch(patch: dict[str, Any], *, semantic: bool = False) -> dict[str, Any]:
    validate_patch(patch)
    target_path = Path(patch["target_path"])
    result = {
        "status": "dry_run",
        "patch_id": patch["patch_id"],
        "target_type": patch["target_type"],
        "target_path": patch["target_path"],
        "target_exists": target_path.exists(),
        "operations": [preview_operation(operation) for operation in patch["operations"]],
        "mutated": False,
        **graphops_governance_payload(),
    }
    if semantic:
        result["semantic_diff"] = semantic_diff_for_patch(patch)
    return result


def dry_run_supervisor_proposal(
    proposal: dict[str, Any],
    *,
    target_path: str,
    semantic: bool = False,
) -> dict[str, Any]:
    from acc.app.supervisor import proposal_to_graphops_patch
    from acc.engine.supervisor import parse_dynamic_invocation_proposal

    parsed = parse_dynamic_invocation_proposal(proposal)
    patch = proposal_to_graphops_patch(parsed, target_path=target_path)
    return dry_run_patch(patch, semantic=semantic)


def apply_patch_request(
    patch_path: Path,
    *,
    dry_run: bool,
    apply: bool,
    human_approved: bool,
    semantic: bool = False,
) -> dict[str, Any]:
    patch = validate_patch_file(patch_path)
    if dry_run:
        return dry_run_patch(patch, semantic=semantic)
    if not (apply and human_approved):
        raise AccError(
            "GraphOps apply is unavailable in Option A: use --dry-run. "
            "Real apply requires --apply --human-approved and is not implemented."
        )
    raise AccError("Real GraphOps apply is not implemented in Option A; use --dry-run.")


def preview_operation(operation: dict[str, Any]) -> dict[str, Any]:
    op = operation["op"]
    if op == "add_node":
        node = operation.get("node") or {}
        node_id = operation.get("node_id") or node.get("id")
        callable_ref = node.get("callable_ref") if isinstance(node, dict) else None
        callable_label = (
            f"{callable_ref.get('kind')}:{callable_ref.get('id')}"
            if isinstance(callable_ref, dict)
            else "<missing callable_ref>"
        )
        return {
            "op": op,
            "description": f"Would add node {node_id} using {callable_label}",
        }
    if op == "add_control_edge":
        edge = operation.get("edge") or {}
        return {
            "op": op,
            "description": f"Would add control edge {edge.get('from')} to {edge.get('to')}",
        }
    if op == "add_data_edge":
        edge = operation.get("edge") or {}
        source = edge.get("source") or edge.get("from") or {}
        target = edge.get("target") or edge.get("to") or {}
        return {
            "op": op,
            "description": (
                f"Would add data edge {source.get('node')} "
                f"to {target.get('node')}"
            ),
        }
    return {
        "op": op,
        "description": f"Would perform {op}",
    }


def semantic_diff_for_patch(patch: dict[str, Any]) -> dict[str, Any]:
    diff = {
        "status": "valid",
        "added_nodes": [],
        "removed_nodes": [],
        "changed_nodes": [],
        "added_edges": [],
        "removed_edges": [],
        "policy_warnings": [],
        "semantic_errors": [],
    }
    try:
        result = materialize_patch(patch)
        if patch["target_type"] == "workflow":
            validate_workflow_function_template(parse_workflow_function_template(result))
    except AccError as exc:
        diff["status"] = "invalid"
        diff["semantic_errors"].append(str(exc))
    for operation in patch["operations"]:
        op = operation["op"]
        if op == "add_node":
            node_id = operation.get("node_id") or (operation.get("node") or {}).get("id")
            diff["added_nodes"].append(node_id)
        elif op == "remove_node":
            diff["removed_nodes"].append(operation.get("node_id"))
        elif op in {"add_control_edge", "add_data_edge"}:
            edge = operation.get("edge") or operation
            diff["added_edges"].append(edge.get("id") or f"{edge.get('from')}->{edge.get('to')}")
        elif op.startswith("update_"):
            diff["changed_nodes"].append(operation.get("node_id"))
    return diff


def materialize_patch(patch: dict[str, Any]) -> dict[str, Any]:
    target_path = Path(patch["target_path"])
    if not target_path.exists():
        raise AccError(f"GraphOps target does not exist: {target_path}")
    if target_path.suffix == ".json":
        target = load_json(target_path)
    else:
        raise AccError("GraphOps workflow targets must be JSON Core v2 templates")
    if not isinstance(target, dict):
        raise AccError(f"GraphOps target must be an object: {target_path}")
    if patch["target_type"] != "workflow":
        return target
    graph = json_clone(target)
    if graph.get("schema_version") != CORE_V2_SCHEMA_VERSION:
        raise AccError("GraphOps workflow target must use schema_version acc.core.v2")
    for operation in patch["operations"]:
        apply_operation_to_graph(graph, operation)
    validate_workflow_function_template(parse_workflow_function_template(graph))
    return graph


def apply_operation_to_graph(graph: dict[str, Any], operation: dict[str, Any]) -> None:
    op = operation["op"]
    if op == "add_node":
        node = operation.get("node")
        if not isinstance(node, dict) or not isinstance(node.get("callable_ref"), dict):
            raise AccError("GraphOps add_node requires a Core v2 node with callable_ref")
        graph.setdefault("nodes", []).append(node)
        return
    if op == "remove_node":
        node_id = operation.get("node_id")
        graph["nodes"] = [node for node in graph.get("nodes", []) if node.get("id") != node_id]
        graph["control_edges"] = [
            edge
            for edge in graph.get("control_edges", [])
            if edge.get("from") != node_id and edge.get("to") != node_id
        ]
        graph["data_edges"] = [
            edge
            for edge in graph.get("data_edges", [])
            if edge.get("from", {}).get("node") != node_id
            and edge.get("to", {}).get("node") != node_id
        ]
        return
    if op == "add_control_edge":
        graph.setdefault("control_edges", []).append(operation["edge"])
        return
    if op == "add_data_edge":
        graph.setdefault("data_edges", []).append(operation["edge"])
        return
    if op == "update_node_input":
        raise AccError("GraphOps update_node_input is legacy shorthand; use input_bindings")


def json_clone(value: dict[str, Any]) -> dict[str, Any]:
    import json

    return json.loads(json.dumps(value))
