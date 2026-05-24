from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


class AccError(Exception):
    """Base exception for user-facing ACC failures."""


def dump_json(data: Any) -> str:
    return json.dumps(data, indent=2, sort_keys=True)


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

