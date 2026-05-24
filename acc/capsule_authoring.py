from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

from acc.artifact_manifest import load_artifact_manifest_v2
from acc.registry import CapsuleRegistry, validate_capsule_files
from acc.utils import AccError, load_json


def doctor_capsule(capsule_id: str, registry: CapsuleRegistry | None = None) -> dict[str, Any]:
    registry = registry or CapsuleRegistry()
    errors: list[str] = []
    warnings: list[str] = []
    try:
        capsule = registry.get(capsule_id)
    except AccError as exc:
        return {
            "status": "invalid",
            "capsule_id": capsule_id,
            "errors": [str(exc)],
            "warnings": [],
        }

    errors.extend(validate_capsule_files(capsule))
    if not errors:
        for label, schema_path in [
            ("input schema", capsule.input_schema_path),
            ("output schema", capsule.output_schema_path),
        ]:
            try:
                schema = load_json(schema_path)
                Draft202012Validator.check_schema(schema)
            except Exception as exc:  # noqa: BLE001 - return actionable doctor diagnostics.
                errors.append(f"Invalid {label}: {schema_path}: {exc}")

        try:
            load_artifact_manifest_v2(capsule.artifact_manifest_path)
        except AccError as exc:
            errors.append(str(exc))

    if capsule.spec.permissions.allow_dangerous:
        warnings.append("Capsule allows dangerous permissions")
    if capsule.spec.permissions.network:
        warnings.append("Capsule may use network access")
    if schema_depth(capsule.output_schema_path) > 20:
        warnings.append("Output schema is deeply nested")

    return {
        "status": "valid" if not errors else "invalid",
        "capsule_id": capsule.spec.id,
        "capsule_dir": str(capsule.capsule_dir.resolve()),
        "runtime": capsule.spec.runtime.type,
        "errors": errors,
        "warnings": warnings,
    }


def clone_capsule(
    source_id: str,
    new_id: str,
    registry: CapsuleRegistry | None = None,
) -> dict[str, Any]:
    if Path(new_id).name != new_id or ".." in Path(new_id).parts:
        raise AccError(f"Invalid capsule id for clone destination: {new_id}")

    registry = registry or CapsuleRegistry()
    source = registry.get(source_id)
    destination = source.capsule_dir.parent / new_id
    if destination.exists():
        raise AccError(f"Capsule destination already exists: {destination}")

    shutil.copytree(source.capsule_dir, destination)
    yaml_path = destination / "capsule.yaml"
    raw = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise AccError(f"Capsule YAML must be an object: {yaml_path}")
    raw["id"] = new_id
    raw["name"] = f"{source.spec.name} Copy"
    yaml_path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")

    cloned = CapsuleRegistry(source.capsule_dir.parent).get(new_id)
    return {
        "status": "cloned",
        "source_id": source_id,
        "capsule_id": cloned.spec.id,
        "capsule_dir": str(destination.resolve()),
    }


def schema_depth(schema_path: Path) -> int:
    try:
        payload = load_json(schema_path)
    except AccError:
        return 0
    return max_depth(payload)


def max_depth(value: Any) -> int:
    if isinstance(value, dict):
        if not value:
            return 1
        return 1 + max(max_depth(item) for item in value.values())
    if isinstance(value, list):
        if not value:
            return 1
        return 1 + max(max_depth(item) for item in value)
    return 1
