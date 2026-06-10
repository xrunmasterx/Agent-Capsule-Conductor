from __future__ import annotations

import json
import os
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
