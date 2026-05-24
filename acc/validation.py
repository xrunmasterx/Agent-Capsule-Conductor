from __future__ import annotations

from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError

from acc.artifact_manifest import load_artifact_manifest_v2
from acc.utils import AccError, load_json


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
