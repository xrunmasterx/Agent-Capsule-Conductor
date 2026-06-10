from __future__ import annotations

import os

from acc.domain import AccError

HERMETIC_RUN_MODE = "hermetic"
PRODUCTION_RUN_MODE = "production"
DEFAULT_PRODUCTION_CODEX_TIMEOUT_SECONDS = 900
DEFAULT_PRODUCTION_CODEX_APP_SERVER_TIMEOUT_SECONDS = 600
TRUTHY_ENV_VALUES = {"1", "true", "yes"}
FALSY_ENV_VALUES = {"0", "false", "no"}


def acc_run_mode() -> str:
    value = os.getenv("ACC_RUN_MODE", PRODUCTION_RUN_MODE).strip().lower()
    if value in {HERMETIC_RUN_MODE, "test", "ci"}:
        return HERMETIC_RUN_MODE
    return PRODUCTION_RUN_MODE


def env_flag_value(name: str) -> bool | None:
    raw_value = os.getenv(name)
    if raw_value is None:
        return None
    value = raw_value.strip().lower()
    if value in TRUTHY_ENV_VALUES:
        return True
    if value in FALSY_ENV_VALUES:
        return False
    return False


def env_flag_enabled(name: str) -> bool:
    return env_flag_value(name) is True


def external_agent_execution_enabled() -> bool:
    if env_flag_enabled("ACC_DISABLE_EXTERNAL_AGENT_EXECUTION"):
        return False
    explicit = env_flag_value("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION")
    if explicit is not None:
        return explicit
    return acc_run_mode() == PRODUCTION_RUN_MODE


def use_submit_validate() -> bool:
    return env_flag_enabled("ACC_ENABLE_SUBMIT_VALIDATE")


def use_supervisor() -> bool:
    return env_flag_enabled("ACC_ENABLE_SUPERVISOR")


def production_codex_timeout_seconds() -> int:
    raw_value = os.getenv("ACC_CODEX_TIMEOUT_SECONDS")
    if raw_value:
        try:
            value = int(raw_value)
        except ValueError as exc:
            raise AccError("ACC_CODEX_TIMEOUT_SECONDS must be an integer") from exc
        if value <= 0:
            raise AccError("ACC_CODEX_TIMEOUT_SECONDS must be positive")
        return value
    return DEFAULT_PRODUCTION_CODEX_TIMEOUT_SECONDS


def production_codex_app_server_timeout_seconds() -> int:
    raw_value = os.getenv("ACC_CODEX_APP_SERVER_TIMEOUT_SECONDS")
    if raw_value:
        try:
            value = int(raw_value)
        except ValueError as exc:
            raise AccError("ACC_CODEX_APP_SERVER_TIMEOUT_SECONDS must be an integer") from exc
        if value <= 0:
            raise AccError("ACC_CODEX_APP_SERVER_TIMEOUT_SECONDS must be positive")
        return value
    return DEFAULT_PRODUCTION_CODEX_APP_SERVER_TIMEOUT_SECONDS
