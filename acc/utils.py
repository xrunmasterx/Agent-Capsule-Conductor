from __future__ import annotations

import json
import os
import re
import shlex
import sys
from pathlib import Path
from typing import Any

from acc.models import AccError


def dump_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True)


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise AccError(f"JSON file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise AccError(f"Invalid JSON in {path}: {exc}") from exc


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    """Read a JSONL file; return empty list if file does not exist."""
    if not path.exists():
        return []
    result: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            result.append(payload)
    return result


def update_runtime_json(path: Path, updates: dict[str, Any]) -> None:
    """Merge updates into a JSON file, creating it if absent."""
    from acc.store import write_json as _write_json

    payload: dict[str, Any] = {}
    if path.exists():
        try:
            loaded = load_json(path)
            if isinstance(loaded, dict):
                payload = loaded
        except AccError:
            payload = {}
    payload.update(updates)
    _write_json(path, payload)


def validate_agent_session_id(session_id: str) -> None:
    """Validate agent session id format: agent_session_<alphanum>."""
    if not re.fullmatch(r"agent_session_[A-Za-z0-9_-]+", session_id):
        raise AccError("Invalid agent session id")


def validate_authoring_session_id(session_id: str) -> None:
    """Validate authoring session id format: authoring_<alphanum>."""
    if not re.fullmatch(r"authoring_[A-Za-z0-9_-]+", session_id):
        raise AccError("Invalid authoring session id")


def log_stderr(message: str) -> None:
    print(message, file=sys.stderr)


def repo_root() -> Path:
    return Path.cwd()


_UNSUPPORTED_LIFECYCLE_SHELL_SNIPPETS = ("&&", "||", "|", ";", ">", "<", "$(", "`")


def _strip_wrapping_quotes(token: str) -> str:
    if len(token) >= 2 and token[0] == token[-1] and token[0] in {'"', "'"}:
        return token[1:-1]
    return token


def split_lifecycle_command(command: str) -> list[str]:
    stripped = command.strip()
    if not stripped:
        raise AccError("Lifecycle command must not be blank")
    for snippet in _UNSUPPORTED_LIFECYCLE_SHELL_SNIPPETS:
        if snippet in stripped:
            raise AccError(
                f"Lifecycle command uses unsupported shell syntax {snippet!r}: {command}"
            )
    try:
        parts = shlex.split(stripped, posix=os.name != "nt")
    except ValueError as exc:
        raise AccError(f"Invalid lifecycle command quoting: {command}") from exc
    if os.name == "nt":
        parts = [_strip_wrapping_quotes(part) for part in parts]
    if not parts or any(not part for part in parts):
        raise AccError(f"Lifecycle command could not be parsed safely: {command}")
    if parts[0].lower() in {"python", "python.exe", "python3", "python3.exe", "py", "py.exe"}:
        parts[0] = sys.executable
    return parts
