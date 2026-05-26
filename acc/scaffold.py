from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

from acc.registry import CapsuleRegistry, validate_capsule_files
from acc.utils import AccError, load_json

CAPSULE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_.-]+$")
FIELD_TYPES = {"string", "number", "integer", "boolean", "object", "array"}


def scaffold_capsule(
    *,
    blueprint_path: Path | None = None,
    blueprint_payload: dict[str, Any] | None = None,
    capsule_id: str | None = None,
    runtime: str = "generic_cli",
    template: str = "simple",
    capsules_dir: Path | str = "capsules",
    force: bool = False,
) -> dict[str, Any]:
    if blueprint_path is not None and blueprint_payload is not None:
        raise AccError("Provide either blueprint_path or blueprint_payload, not both")
    if blueprint_payload is not None:
        blueprint = blueprint_payload
    elif blueprint_path is not None:
        blueprint = load_json(blueprint_path)
    else:
        blueprint = simple_blueprint(capsule_id, runtime, template)
    if not isinstance(blueprint, dict):
        raise AccError("Capsule blueprint must be a JSON object")
    validate_blueprint(blueprint)

    destination_root = Path(capsules_dir)
    destination = destination_root / blueprint["id"]
    validate_destination(destination_root, destination, blueprint["id"])
    if destination.exists():
        if not force:
            raise AccError(f"Capsule already exists: {destination}")
        shutil.rmtree(destination)

    write_capsule_files(destination, blueprint)
    registry = CapsuleRegistry(destination_root)
    capsule = registry.get(blueprint["id"])
    file_errors = validate_capsule_files(capsule)
    if file_errors:
        raise AccError("; ".join(file_errors))
    return {
        "status": "scaffolded",
        "capsule_id": capsule.spec.id,
        "capsule_dir": str(destination.resolve()),
        "files": [
            "capsule.yaml",
            "prompt_template.md",
            "input_schema.json",
            "output_schema.json",
            "artifact_manifest.yaml",
            "examples/input.json",
        ],
    }


def simple_blueprint(capsule_id: str | None, runtime: str, template: str) -> dict[str, Any]:
    if template != "simple":
        raise AccError(f"Unsupported scaffold template: {template}")
    if not capsule_id:
        raise AccError("--id is required when --blueprint is not provided")
    return {
        "id": capsule_id,
        "name": capsule_id,
        "runtime": runtime,
        "workspace_mode": "existing_dir",
        "description": "Scaffolded capsule.",
        "input_fields": [{"name": "topic", "type": "string", "required": True}],
        "output_fields": [
            {"name": "summary", "type": "string", "required": True},
            {"name": "recommendation", "type": "string", "required": True},
        ],
        "artifacts": [
            {"name": "report", "path": "report.md", "type": "markdown", "required": True}
        ],
        "prompt": "Write a concise note about {{ topic }}.",
    }


def validate_blueprint(blueprint: dict[str, Any]) -> None:
    schema_path = Path("schemas/capsule_blueprint_schema.json")
    Draft202012Validator(load_json(schema_path)).validate(blueprint)
    capsule_id = blueprint["id"]
    if not CAPSULE_ID_PATTERN.fullmatch(capsule_id) or Path(capsule_id).name != capsule_id:
        raise AccError(f"Invalid capsule id: {capsule_id}")
    if ".." in Path(capsule_id).parts:
        raise AccError(f"Invalid capsule id: {capsule_id}")
    for artifact in blueprint.get("artifacts", []):
        validate_relative_path(artifact["path"], "artifact path")


def validate_destination(root: Path, destination: Path, capsule_id: str) -> None:
    root_resolved = root.resolve()
    destination_resolved = destination.resolve()
    if not destination_resolved.is_relative_to(root_resolved):
        raise AccError(f"Capsule id escapes capsules directory: {capsule_id}")


def write_capsule_files(destination: Path, blueprint: dict[str, Any]) -> None:
    examples_dir = destination / "examples"
    examples_dir.mkdir(parents=True, exist_ok=True)
    (destination / "capsule.yaml").write_text(
        yaml.safe_dump(capsule_yaml(blueprint), sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    (destination / "prompt_template.md").write_text(blueprint["prompt"] + "\n", encoding="utf-8")
    write_json(destination / "input_schema.json", json_schema(blueprint["input_fields"]))
    write_json(destination / "output_schema.json", output_schema(blueprint["output_fields"]))
    (destination / "artifact_manifest.yaml").write_text(
        yaml.safe_dump(artifact_manifest(blueprint), sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    write_json(examples_dir / "input.json", example_input(blueprint["input_fields"]))


def capsule_yaml(blueprint: dict[str, Any]) -> dict[str, Any]:
    runtime = blueprint["runtime"]
    permissions = {
        "sandbox": "read-only",
        "network": False,
        "write_files": runtime == "generic_cli",
        "timeout_seconds": 30,
        "allow_dangerous": False,
        **blueprint.get("permissions", {}),
    }
    payload: dict[str, Any] = {
        "id": blueprint["id"],
        "version": "0.1.0",
        "name": blueprint["name"],
        "description": blueprint.get("description", ""),
        "runtime": runtime_spec(runtime, blueprint),
        "workspace": {"mode": blueprint["workspace_mode"]},
        "permissions": permissions,
        "prompt": {"template": "prompt_template.md"},
        "schema": {"input": "input_schema.json", "output": "output_schema.json"},
        "artifacts": {"manifest": "artifact_manifest.yaml"},
    }
    return payload


def runtime_spec(runtime: str, blueprint: dict[str, Any]) -> dict[str, Any]:
    if runtime == "generic_cli":
        return {
            "type": "generic_cli",
            "command": "python",
            "args_base": ["-m", "acc.scaffold_runtime"],
            "env": {
                "ACC_SCAFFOLD_ARTIFACTS": json.dumps(
                    artifact_manifest(blueprint)["required"],
                    ensure_ascii=False,
                    sort_keys=True,
                )
            },
        }
    return {"type": runtime}


def json_schema(fields: list[dict[str, Any]]) -> dict[str, Any]:
    required = [field["name"] for field in fields if field.get("required")]
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": required,
        "properties": {field["name"]: field_schema(field) for field in fields},
        "additionalProperties": False,
    }


def output_schema(fields: list[dict[str, Any]]) -> dict[str, Any]:
    schema = json_schema(fields)
    schema["required"] = ["status", *schema["required"]]
    schema["properties"] = {
        "status": {"type": "string", "enum": ["success"]},
        **schema["properties"],
    }
    return schema


def field_schema(field: dict[str, Any]) -> dict[str, Any]:
    field_type = field["type"]
    if field_type not in FIELD_TYPES:
        raise AccError(f"Invalid field type: {field_type}")
    payload = {"type": field_type}
    if field.get("description"):
        payload["description"] = field["description"]
    return payload


def artifact_manifest(blueprint: dict[str, Any]) -> dict[str, Any]:
    required = []
    optional = []
    for artifact in blueprint.get("artifacts", []):
        entry = {
            "path": artifact["path"],
            "name": artifact["name"],
            "type": artifact["type"],
            "viewer": artifact["type"],
            "display": "primary" if artifact.get("required") else "optional",
        }
        if artifact.get("required"):
            required.append(entry)
        else:
            optional.append(entry)
    return {"version": "2.0", "required": required, "optional": optional}


def example_input(fields: list[dict[str, Any]]) -> dict[str, Any]:
    return {field["name"]: example_value(field) for field in fields}


def example_value(field: dict[str, Any]) -> Any:
    field_type = field["type"]
    if field_type == "number":
        return 1.0
    if field_type == "integer":
        return 1
    if field_type == "boolean":
        return True
    if field_type == "object":
        return {}
    if field_type == "array":
        return []
    return f"example {field['name']}"


def write_json(path: Path, payload: Any) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def validate_relative_path(value: str, label: str) -> None:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        raise AccError(f"Invalid {label}: {value}")
