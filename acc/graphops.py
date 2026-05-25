from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError

from acc.registry import CapsuleRegistry
from acc.utils import AccError, load_json
from acc.workflow_graph import normalize_workflow_graph, validate_graph_semantics

FORBIDDEN_OPERATIONS = {
    "enable_danger_full_access",
    "remove_human_gate",
    "disable_tests",
    "write_secret_files",
    "change_git_remote",
    "remove_schema_validation",
}


def validate_patch_file(patch_path: Path) -> dict[str, Any]:
    patch = load_json(patch_path)
    if not isinstance(patch, dict):
        raise AccError("GraphOps patch must be a JSON object")
    validate_patch(patch)
    return patch


def validate_patch(patch: dict[str, Any]) -> None:
    schema = load_json(Path("schemas/graphops_patch_schema.json"))
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

    for index, operation in enumerate(patch["operations"], start=1):
        op = operation["op"]
        if op in FORBIDDEN_OPERATIONS:
            raise AccError(f"Forbidden GraphOps operation at operations[{index}]: {op}")
        validate_operation_policy(operation, index)
        validate_operation_paths(operation, index)


def validate_operation_policy(operation: dict[str, Any], index: int) -> None:
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
    }
    if semantic:
        result["semantic_diff"] = semantic_diff_for_patch(patch)
    return result


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
        raise AccError("Real GraphOps apply requires --apply --human-approved")
    raise AccError("Real GraphOps apply is not implemented in the MVP")


def preview_operation(operation: dict[str, Any]) -> dict[str, Any]:
    op = operation["op"]
    if op == "add_node":
        node = operation.get("node") or {}
        node_id = operation.get("node_id") or node.get("id")
        capsule_id = operation.get("capsule_id") or node.get("capsule_id")
        return {
            "op": op,
            "description": (
                f"Would add node {node_id} "
                f"using capsule {capsule_id}"
            ),
        }
    if op == "connect_nodes":
        return {
            "op": op,
            "description": f"Would connect {operation.get('from')} to {operation.get('to')}",
        }
    if op == "add_control_edge":
        edge = operation.get("edge") or {}
        return {
            "op": op,
            "description": f"Would add control edge {edge.get('from')} to {edge.get('to')}",
        }
    if op == "add_data_edge":
        edge = operation.get("edge") or {}
        return {
            "op": op,
            "description": (
                f"Would add data edge {edge.get('from', {}).get('node')} "
                f"to {edge.get('to', {}).get('node')}"
            ),
        }
    if op == "update_capsule_prompt":
        return {
            "op": op,
            "description": f"Would update prompt for {operation.get('capsule_id')}",
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
            validate_graph_semantics(result, CapsuleRegistry())
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
        elif op in {"connect_nodes", "add_control_edge", "add_data_edge"}:
            edge = operation.get("edge") or operation
            diff["added_edges"].append(edge.get("id") or f"{edge.get('from')}->{edge.get('to')}")
        elif op.startswith("update_"):
            diff["changed_nodes"].append(operation.get("node_id") or operation.get("capsule_id"))
    return diff


def materialize_patch(patch: dict[str, Any]) -> dict[str, Any]:
    target_path = Path(patch["target_path"])
    if not target_path.exists():
        raise AccError(f"GraphOps target does not exist: {target_path}")
    if target_path.suffix == ".json":
        target = load_json(target_path)
    else:
        target = yaml.safe_load(target_path.read_text(encoding="utf-8"))
    if not isinstance(target, dict):
        raise AccError(f"GraphOps target must be an object: {target_path}")
    if patch["target_type"] != "workflow":
        return target
    graph = normalize_workflow_graph(target)
    for operation in patch["operations"]:
        apply_operation_to_graph(graph, operation)
    return graph


def apply_operation_to_graph(graph: dict[str, Any], operation: dict[str, Any]) -> None:
    op = operation["op"]
    if op == "add_node":
        node = operation.get("node") or {
            "id": operation.get("node_id"),
            "capsule_id": operation.get("capsule_id"),
            "input": operation.get("input", {}),
        }
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
    if op == "connect_nodes":
        edge_id = operation.get("edge_id") or f"edge_{operation.get('from')}_{operation.get('to')}"
        graph.setdefault("control_edges", []).append(
            {
                "id": edge_id,
                "from": operation.get("from"),
                "to": operation.get("to"),
            }
        )
        return
    if op == "add_control_edge":
        graph.setdefault("control_edges", []).append(operation["edge"])
        return
    if op == "add_data_edge":
        graph.setdefault("data_edges", []).append(operation["edge"])
        return
    if op == "update_node_input":
        for node in graph.get("nodes", []):
            if node.get("id") == operation.get("node_id"):
                node["input"] = operation.get("input", {})
                return
