from __future__ import annotations

import asyncio
import json
import os
import shutil
from pathlib import Path
from typing import Any

from acc.models import AccError, PermissionProfile
from acc.runtime.payload import (
    RUNTIME_ONLY_KEYS,
    AgentPayload,
    RuntimePayload,
    split_payloads,
)
from acc.runtime.transfer_policy import TransferPolicy, materialize

__all__ = [
    "DEFAULT_ACC_ENV_KEYS",
    "AgentPayload",
    "RuntimePayload",
    "RUNTIME_ONLY_KEYS",
    "TransferPolicy",
    "await_with_optional_timeout",
    "build_allowed_env",
    "materialize",
    "prepare_runtime_attempt_dir",
    "split_payloads",
    "validate_permission_profile",
    "validate_workspace_access",
    "write_json",
    "read_json_object",
]

DEFAULT_ACC_ENV_KEYS = {
    "ACC_RUN_DIR",
    "ACC_NODE_ID",
    "ACC_INBOX_DIR",
    "ACC_OUTBOX_DIR",
    "ACC_ARTIFACT_DIR",
    "ACC_WORKSPACE_DIR",
    "ACC_EVENTS_JSONL",
}


def validate_permission_profile(profile: PermissionProfile) -> None:
    if profile.workspace_access not in {"read_only", "writes_workspace", "none"}:
        raise AccError(f"Unsupported workspace_access: {profile.workspace_access}")
    for key in profile.allowed_env:
        if key in {"*", "ALL"}:
            raise AccError("full host environment inheritance is rejected")


def build_allowed_env(
    profile: PermissionProfile,
    *,
    base_env: dict[str, str] | None = None,
    declared_env: dict[str, str] | None = None,
) -> dict[str, str]:
    validate_permission_profile(profile)
    base = base_env if base_env is not None else os.environ
    declared = declared_env or {}
    result = {key: value for key, value in declared.items() if key in DEFAULT_ACC_ENV_KEYS}
    for key in profile.allowed_env:
        if key in base:
            result[key] = base[key]
    return result


def validate_workspace_access(profile: PermissionProfile, *, has_workspace_lock: bool) -> None:
    validate_permission_profile(profile)
    if profile.workspace_access == "writes_workspace" and not has_workspace_lock:
        raise AccError("writes_workspace requires workspace write lock")


async def await_with_optional_timeout(coroutine: Any, timeout_seconds: Any) -> Any:
    if timeout_seconds is None:
        return await coroutine
    try:
        return await asyncio.wait_for(coroutine, timeout=float(timeout_seconds))
    except TimeoutError as exc:
        raise AccError("Execution timed out") from exc


def prepare_runtime_attempt_dir(node_dir: Path) -> None:
    for child_name in ("artifacts", "outbox"):
        child = node_dir / child_name
        if child.exists():
            shutil.rmtree(child)
        child.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def read_json_object(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload if isinstance(payload, dict) else {}
