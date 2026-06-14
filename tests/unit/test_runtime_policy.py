from __future__ import annotations

import pytest

from acc.models import AccError, PermissionProfile
from acc.runtime import validate_permission_profile, validate_workspace_access
from acc.runtime.policy import (
    DEFAULT_PRODUCTION_CODEX_APP_SERVER_TIMEOUT_SECONDS,
    DEFAULT_PRODUCTION_CODEX_TIMEOUT_SECONDS,
    HERMETIC_RUN_MODE,
    PRODUCTION_RUN_MODE,
    acc_run_mode,
    external_agent_execution_enabled,
    production_codex_app_server_timeout_seconds,
    production_codex_timeout_seconds,
    use_submit_validate,
    use_supervisor,
)


def test_acc_run_mode_defaults_to_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ACC_RUN_MODE", raising=False)

    assert acc_run_mode() == PRODUCTION_RUN_MODE


@pytest.mark.parametrize("value", ["hermetic", "test", "ci", " HERMETIC "])
def test_acc_run_mode_uses_hermetic_only_when_explicit(
    monkeypatch: pytest.MonkeyPatch,
    value: str,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", value)

    assert acc_run_mode() == HERMETIC_RUN_MODE


@pytest.mark.parametrize("value", ["production", "real", "anything-else"])
def test_acc_run_mode_treats_non_hermetic_values_as_production(
    monkeypatch: pytest.MonkeyPatch,
    value: str,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", value)

    assert acc_run_mode() == PRODUCTION_RUN_MODE


@pytest.mark.parametrize("value", ["1", "true", "yes", " TRUE "])
def test_external_agent_gate_accepts_truthy_values(
    monkeypatch: pytest.MonkeyPatch,
    value: str,
) -> None:
    monkeypatch.setenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", value)

    assert external_agent_execution_enabled() is True


def test_runtime_feature_flags_default_to_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", raising=False)
    monkeypatch.delenv("ACC_DISABLE_EXTERNAL_AGENT_EXECUTION", raising=False)
    monkeypatch.delenv("ACC_ENABLE_SUBMIT_VALIDATE", raising=False)
    monkeypatch.delenv("ACC_ENABLE_SUPERVISOR", raising=False)
    monkeypatch.setenv("ACC_RUN_MODE", "hermetic")

    assert external_agent_execution_enabled() is False
    assert use_submit_validate() is False
    assert use_supervisor() is False


def test_writes_run_only_permission_profile_is_supported_without_workspace_lock() -> None:
    profile = PermissionProfile(workspace_access="writes_run_only")

    validate_permission_profile(profile)
    validate_workspace_access(profile, has_workspace_lock=False)


def test_writes_workspace_still_requires_workspace_lock() -> None:
    profile = PermissionProfile(workspace_access="writes_workspace")

    with pytest.raises(AccError, match="writes_workspace requires workspace write lock"):
        validate_workspace_access(profile, has_workspace_lock=False)


def test_external_agent_execution_defaults_to_enabled_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ACC_RUN_MODE", raising=False)
    monkeypatch.delenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", raising=False)
    monkeypatch.delenv("ACC_DISABLE_EXTERNAL_AGENT_EXECUTION", raising=False)

    assert acc_run_mode() == PRODUCTION_RUN_MODE
    assert external_agent_execution_enabled() is True


def test_external_agent_execution_disable_flag_wins(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    monkeypatch.setenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", "1")
    monkeypatch.setenv("ACC_DISABLE_EXTERNAL_AGENT_EXECUTION", "1")

    assert external_agent_execution_enabled() is False


def test_runtime_feature_flags_share_truthy_parser(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ACC_ENABLE_SUBMIT_VALIDATE", "yes")
    monkeypatch.setenv("ACC_ENABLE_SUPERVISOR", "1")

    assert use_submit_validate() is True
    assert use_supervisor() is True


def test_production_codex_timeout_uses_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ACC_CODEX_TIMEOUT_SECONDS", raising=False)

    assert production_codex_timeout_seconds() == DEFAULT_PRODUCTION_CODEX_TIMEOUT_SECONDS


def test_production_codex_timeout_accepts_positive_integer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ACC_CODEX_TIMEOUT_SECONDS", "42")

    assert production_codex_timeout_seconds() == 42


@pytest.mark.parametrize(
    ("value", "message"),
    [("abc", "must be an integer"), ("0", "must be positive"), ("-1", "must be positive")],
)
def test_production_codex_timeout_rejects_invalid_values(
    monkeypatch: pytest.MonkeyPatch,
    value: str,
    message: str,
) -> None:
    monkeypatch.setenv("ACC_CODEX_TIMEOUT_SECONDS", value)

    with pytest.raises(AccError, match=message):
        production_codex_timeout_seconds()


def test_production_codex_app_server_timeout_uses_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ACC_CODEX_APP_SERVER_TIMEOUT_SECONDS", raising=False)

    assert (
        production_codex_app_server_timeout_seconds()
        == DEFAULT_PRODUCTION_CODEX_APP_SERVER_TIMEOUT_SECONDS
    )


def test_production_codex_app_server_timeout_accepts_positive_integer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ACC_CODEX_APP_SERVER_TIMEOUT_SECONDS", "600")

    assert production_codex_app_server_timeout_seconds() == 600


@pytest.mark.parametrize(
    ("value", "message"),
    [("abc", "must be an integer"), ("0", "must be positive"), ("-1", "must be positive")],
)
def test_production_codex_app_server_timeout_rejects_invalid_values(
    monkeypatch: pytest.MonkeyPatch,
    value: str,
    message: str,
) -> None:
    monkeypatch.setenv("ACC_CODEX_APP_SERVER_TIMEOUT_SECONDS", value)

    with pytest.raises(AccError, match=message):
        production_codex_app_server_timeout_seconds()
