import pytest
from pydantic import ValidationError

from acc.schemas import PermissionSpec, RuntimeSpec, WorkspaceSpec


def test_runtime_spec_loads() -> None:
    spec = RuntimeSpec.model_validate({"type": "generic_cli", "command": "python"})
    assert spec.type == "generic_cli"


def test_generic_cli_requires_command() -> None:
    with pytest.raises(ValidationError):
        RuntimeSpec.model_validate({"type": "generic_cli"})


def test_unknown_runtime_type_fails() -> None:
    with pytest.raises(ValidationError):
        RuntimeSpec.model_validate({"type": "custom_loop", "command": "python"})


def test_invalid_workspace_mode_fails() -> None:
    with pytest.raises(ValidationError):
        WorkspaceSpec.model_validate({"mode": "docker"})


def test_missing_timeout_fails() -> None:
    with pytest.raises(ValidationError):
        PermissionSpec.model_validate(
            {
                "sandbox": "read-only",
                "network": False,
                "write_files": False,
                "allow_dangerous": False,
            }
        )


def test_danger_full_access_requires_explicit_allow() -> None:
    with pytest.raises(ValidationError):
        PermissionSpec.model_validate(
            {
                "sandbox": "danger-full-access",
                "network": False,
                "write_files": False,
                "timeout_seconds": 30,
                "allow_dangerous": False,
            }
        )
