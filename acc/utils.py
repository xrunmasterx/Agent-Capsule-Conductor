from __future__ import annotations

import json
import os
import re
import shlex
import sys
from pathlib import Path
from typing import Any, Iterable

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


def iter_paths_no_symlink_targets(
    path: Path,
    *,
    exclude_relative_parts: Iterable[str] = (),
) -> list[Path]:
    """Return paths below path without traversing symlink or junction targets."""
    root = Path(path)
    excluded = _normalized_exclude_parts(exclude_relative_parts)
    if _path_is_missing(root):
        return []
    result = [root]
    if _is_file_symlink_or_junction(root):
        return result

    stack = [root]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as entries:
                children = sorted(entries, key=lambda entry: entry.name)
        except OSError:
            continue
        for entry in children:
            child = Path(entry.path)
            if _is_excluded_relative_path(root, child, excluded):
                continue
            result.append(child)
            try:
                is_dir = entry.is_dir(follow_symlinks=False)
                is_symlink = entry.is_symlink()
            except OSError:
                continue
            if is_dir and not is_symlink and not _is_junction(child):
                stack.append(child)
    return result


def safe_path_size_bytes(
    path: Path,
    *,
    exclude_relative_parts: Iterable[str] = (),
) -> int:
    """Best-effort size calculation for live runtime directories."""
    root = Path(path)
    if _path_is_missing(root):
        return 0
    if _is_file_symlink_or_junction(root):
        try:
            return root.lstat().st_size
        except OSError:
            return 0
    total = 0
    for child in iter_paths_no_symlink_targets(
        root,
        exclude_relative_parts=exclude_relative_parts,
    ):
        try:
            if child.is_dir() and not child.is_symlink():
                continue
            total += child.lstat().st_size
        except OSError:
            continue
    return total


def _normalized_exclude_parts(exclude_relative_parts: Iterable[str]) -> tuple[str, ...]:
    return tuple(
        part.replace("\\", "/").strip("/")
        for part in exclude_relative_parts
        if part.replace("\\", "/").strip("/")
    )


def _is_excluded_relative_path(root: Path, path: Path, excluded: tuple[str, ...]) -> bool:
    if not excluded:
        return False
    try:
        relative = path.relative_to(root).as_posix()
    except ValueError:
        return False
    return any(relative == part or relative.startswith(f"{part}/") for part in excluded)


def _path_is_missing(path: Path) -> bool:
    try:
        return not path.exists() and not path.is_symlink()
    except OSError:
        return True


def _is_file_symlink_or_junction(path: Path) -> bool:
    try:
        return path.is_file() or path.is_symlink() or _is_junction(path)
    except OSError:
        return False


def _is_junction(path: Path) -> bool:
    is_junction = getattr(path, "is_junction", None)
    if is_junction is None:
        return False
    try:
        return bool(is_junction())
    except OSError:
        return False


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
