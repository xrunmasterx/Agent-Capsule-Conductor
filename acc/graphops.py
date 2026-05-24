from __future__ import annotations

from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError

from acc.utils import AccError, load_json

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

    for index, operation in enumerate(patch["operations"], start=1):
        op = operation["op"]
        if op in FORBIDDEN_OPERATIONS:
            raise AccError(f"Forbidden GraphOps operation at operations[{index}]: {op}")
        validate_operation_policy(operation, index)
        validate_operation_paths(operation, index)


def validate_operation_policy(operation: dict[str, Any], index: int) -> None:
    if contains_value(operation, "danger-full-access"):
        raise AccError(
            f"Forbidden GraphOps permission value at operations[{index}]: danger-full-access"
        )
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


def dry_run_patch(patch: dict[str, Any]) -> dict[str, Any]:
    validate_patch(patch)
    target_path = Path(patch["target_path"])
    return {
        "status": "dry_run",
        "patch_id": patch["patch_id"],
        "target_type": patch["target_type"],
        "target_path": patch["target_path"],
        "target_exists": target_path.exists(),
        "operations": [preview_operation(operation) for operation in patch["operations"]],
        "mutated": False,
    }


def apply_patch_request(
    patch_path: Path,
    *,
    dry_run: bool,
    apply: bool,
    human_approved: bool,
) -> dict[str, Any]:
    patch = validate_patch_file(patch_path)
    if dry_run:
        return dry_run_patch(patch)
    if not (apply and human_approved):
        raise AccError("Real GraphOps apply requires --apply --human-approved")
    raise AccError("Real GraphOps apply is not implemented in the MVP")


def preview_operation(operation: dict[str, Any]) -> dict[str, Any]:
    op = operation["op"]
    if op == "add_node":
        return {
            "op": op,
            "description": (
                f"Would add node {operation.get('node_id')} "
                f"using capsule {operation.get('capsule_id')}"
            ),
        }
    if op == "connect_nodes":
        return {
            "op": op,
            "description": f"Would connect {operation.get('from')} to {operation.get('to')}",
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
