from __future__ import annotations

import asyncio
import json
import os
import shutil
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from acc.domain import AccError, EnvironmentFrame, NodeSpec, PermissionProfile
from acc.engine import validate_permission_profile

DEFAULT_ACC_ENV_KEYS = {
    "ACC_RUN_DIR",
    "ACC_NODE_ID",
    "ACC_INBOX_DIR",
    "ACC_OUTBOX_DIR",
    "ACC_ARTIFACT_DIR",
    "ACC_WORKSPACE_DIR",
    "ACC_EVENTS_JSONL",
}

NodeExecutor = Callable[[NodeSpec, Path, Path, Path, EnvironmentFrame], Awaitable[dict[str, Any]]]
AttemptPreparer = Callable[[Path], None]


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
        if key in {"*", "ALL"}:
            raise AccError("full host environment inheritance is rejected")
        if key in base:
            result[key] = base[key]
    return result


def node_writes_workspace(node: NodeSpec) -> bool:
    profile = node.permission_profile
    if profile is not None and profile.workspace_access == "writes_workspace":
        return True
    permissions = node.raw.get("permissions")
    if isinstance(permissions, dict) and permissions.get("write_workspace") is True:
        return True
    return bool(node.raw.get("write_workspace", False))


def validate_workspace_access(node: NodeSpec, *, has_workspace_lock: bool) -> None:
    profile = node.permission_profile
    if profile is None:
        raise AccError(f"Node {node.id} requires permission_profile")
    validate_permission_profile(profile)
    if profile.workspace_access == "writes_workspace" and not has_workspace_lock:
        raise AccError("writes_workspace requires workspace write lock")


async def execute_clean_node_with_policy(
    node: NodeSpec,
    workflow_path: Path,
    run_dir: Path,
    node_dir: Path,
    frame: EnvironmentFrame,
    write_lock: asyncio.Lock,
    *,
    node_executor: NodeExecutor | None = None,
    prepare_attempt: AttemptPreparer | None = None,
) -> tuple[dict[str, Any], int]:
    retry = node.raw.get("retry") if isinstance(node.raw.get("retry"), dict) else {}
    max_attempts = max(1, int(retry.get("max_attempts", 1)))
    timeout_seconds = node.raw.get("timeout_seconds")
    if timeout_seconds is None and node.permission_profile is not None:
        timeout_seconds = node.permission_profile.timeout_seconds
    last_error: Exception | None = None
    executor = node_executor or execute_clean_node
    attempt_preparer = prepare_attempt or prepare_runtime_attempt_dir
    for attempt in range(1, max_attempts + 1):
        try:
            attempt_preparer(node_dir)
            coroutine = executor(node, workflow_path, run_dir, node_dir, frame)
            if node_writes_workspace(node):
                validate_workspace_access(node, has_workspace_lock=True)
                async with write_lock:
                    result = await await_with_optional_timeout(coroutine, timeout_seconds)
            else:
                result = await await_with_optional_timeout(coroutine, timeout_seconds)
            return result, attempt
        except Exception as exc:  # noqa: BLE001 - retry policy needs original failure text.
            last_error = exc
    raise AccError(str(last_error) if last_error is not None else "Node execution failed")


async def await_with_optional_timeout(coroutine, timeout_seconds: Any) -> dict[str, Any]:
    if timeout_seconds is None:
        return await coroutine
    try:
        return await asyncio.wait_for(coroutine, timeout=float(timeout_seconds))
    except TimeoutError as exc:
        raise AccError("Node execution timed out") from exc


async def execute_clean_node(
    node: NodeSpec,
    workflow_path: Path,
    run_dir: Path,
    node_dir: Path,
    frame: EnvironmentFrame,
) -> dict[str, Any]:
    if node.kind == "tool":
        return execute_tool_node(node, node_dir, frame)
    if node.kind == "agent":
        return execute_agent_node(node, node_dir, frame)
    if node.kind == "workflow":
        raise AccError(
            f"Workflow node {node.id} must be executed by the application service"
        )
    raise AccError(f"Unsupported node kind: {node.kind}")


def prepare_runtime_attempt_dir(node_dir: Path) -> None:
    output_path = node_dir / "output.json"
    if output_path.exists():
        output_path.unlink()
    for child_name in ("artifacts", "outbox"):
        child = node_dir / child_name
        if child.exists():
            shutil.rmtree(child)
        child.mkdir(parents=True, exist_ok=True)


def execute_tool_node(node: NodeSpec, node_dir: Path, frame: EnvironmentFrame) -> dict[str, Any]:
    if node.tool in {"fake_producer", "fake"}:
        inbox_files = sorted(path for path in (node_dir / "inbox").rglob("*") if path.is_file())
        output = {
            "status": "success",
            "summary": f"Produced artifact from {node.id}",
            "producer_node_id": node.id,
            "read_from_inbox": bool(inbox_files),
            "inbox_file_count": len(inbox_files),
        }
        write_json(node_dir / "artifacts" / "payload.json", output)
    elif node.tool == "merge":
        inbox_files = sorted(path for path in (node_dir / "inbox").rglob("*") if path.is_file())
        output = {
            "status": "success",
            "summary": f"Merged {len(inbox_files)} inbox file(s)",
            "merged_file_count": len(inbox_files),
            "read_from_inbox": bool(inbox_files),
        }
        write_json(node_dir / "artifacts" / "merged.json", output)
    elif node.tool == "wait":
        output = {"status": "success", "summary": "Wait completed"}
    elif node.tool == "fail":
        raise AccError(f"Tool node {node.id} failed by configuration")
    else:
        raise AccError(f"Unsupported tool node {node.id}: {node.tool}")
    output["cwd"] = str(frame.workspace_root)
    write_json(node_dir / "output.json", output)
    return output


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def execute_agent_node(node: NodeSpec, node_dir: Path, frame: EnvironmentFrame) -> dict[str, Any]:
    if node.runtime != "generic_fake_agent":
        raise AccError(f"Unsupported clean agent runtime for {node.id}: {node.runtime}")
    inbox_files = sorted(path for path in (node_dir / "inbox").rglob("*") if path.is_file())
    output = {
        "status": "success",
        "summary": f"Fake agent {node.id} ran in {frame.workspace_root}",
        "cwd": str(frame.workspace_root),
        "prompt": node.prompt or "",
        "read_from_inbox": bool(inbox_files),
        "inbox_file_count": len(inbox_files),
    }
    write_json(node_dir / "artifacts" / "cwd_report.json", output)
    write_json(node_dir / "output.json", output)
    return output
