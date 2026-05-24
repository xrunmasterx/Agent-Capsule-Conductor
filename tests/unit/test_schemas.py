from pathlib import Path

import pytest
from pydantic import ValidationError

from acc.schemas import CapsuleSpec
from acc.utils import load_json


def valid_capsule_data() -> dict:
    return {
        "id": "example.generic",
        "version": "0.1.0",
        "name": "Example",
        "description": "Example capsule",
        "runtime": {"type": "generic_cli", "command": "python"},
        "workspace": {"mode": "existing_dir"},
        "permissions": {
            "sandbox": "read-only",
            "network": False,
            "write_files": False,
            "timeout_seconds": 30,
            "allow_dangerous": False,
        },
        "prompt": {"template": "prompt_template.md"},
        "schema": {"input": "input_schema.json", "output": "output_schema.json"},
        "artifacts": {"manifest": "artifact_manifest.yaml"},
    }


def test_valid_capsule_spec_loads() -> None:
    spec = CapsuleSpec.model_validate(valid_capsule_data())

    assert spec.id == "example.generic"
    assert spec.runtime.type == "generic_cli"


def test_missing_id_fails() -> None:
    data = valid_capsule_data()
    del data["id"]

    with pytest.raises(ValidationError):
        CapsuleSpec.model_validate(data)


def test_unknown_runtime_type_fails() -> None:
    data = valid_capsule_data()
    data["runtime"]["type"] = "custom_loop"

    with pytest.raises(ValidationError):
        CapsuleSpec.model_validate(data)


def test_invalid_workspace_mode_fails() -> None:
    data = valid_capsule_data()
    data["workspace"]["mode"] = "docker"

    with pytest.raises(ValidationError):
        CapsuleSpec.model_validate(data)


def test_missing_timeout_fails() -> None:
    data = valid_capsule_data()
    del data["permissions"]["timeout_seconds"]

    with pytest.raises(ValidationError):
        CapsuleSpec.model_validate(data)


def test_danger_full_access_requires_explicit_allow() -> None:
    data = valid_capsule_data()
    data["permissions"]["sandbox"] = "danger-full-access"

    with pytest.raises(ValidationError):
        CapsuleSpec.model_validate(data)


def test_repository_json_schemas_parse() -> None:
    for schema_path in [
        "schemas/capsule_template_schema.json",
        "schemas/session_manifest_schema.json",
        "schemas/graphops_patch_schema.json",
    ]:
        assert isinstance(load_json(Path(schema_path)), dict)
