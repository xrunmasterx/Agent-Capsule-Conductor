from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

DirectoryPickerStatus = Literal["selected", "cancelled", "unsupported", "failed"]

_PICKER_LOCK = threading.Lock()
_PICKER_TIMEOUT_SECONDS = 300

_HELPER_SCRIPT = r"""
from __future__ import annotations

import json
import sys


def main() -> int:
    payload = json.loads(sys.stdin.read() or "{}")
    initial_dir = payload.get("initial_dir") or None
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        options = {"title": "选择 Workbench 工作目录", "mustexist": True}
        if initial_dir:
            options["initialdir"] = initial_dir
        selected = filedialog.askdirectory(parent=root, **options)
        root.destroy()
    except Exception as exc:  # pragma: no cover - executed in helper process.
        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False))
        return 1

    if selected:
        print(json.dumps({"status": "selected", "path": selected}, ensure_ascii=False))
    else:
        print(json.dumps({"status": "cancelled"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
"""


@dataclass(frozen=True)
class LocalDirectorySelection:
    status: DirectoryPickerStatus
    path: str | None = None
    error: str | None = None


def select_local_directory(
    initial_dir: str | None = None,
    *,
    timeout_seconds: int = _PICKER_TIMEOUT_SECONDS,
) -> LocalDirectorySelection:
    supported, reason = native_directory_picker_supported()
    if not supported:
        return LocalDirectorySelection(status="unsupported", error=reason)
    if not _PICKER_LOCK.acquire(blocking=False):
        return LocalDirectorySelection(status="failed", error="picker_busy")

    try:
        payload = {"initial_dir": normalized_initial_dir(initial_dir)}
        try:
            completed = subprocess.run(
                [sys.executable, "-c", _HELPER_SCRIPT],
                input=json.dumps(payload),
                capture_output=True,
                check=False,
                encoding="utf-8",
                timeout=timeout_seconds,
            )
        except subprocess.TimeoutExpired:
            return LocalDirectorySelection(status="failed", error="directory_picker_timeout")

        selection = parse_helper_output(completed.stdout)
        if selection is not None:
            return selection
        if completed.returncode != 0:
            error = (completed.stderr or "").strip() or "directory_picker_failed"
            return LocalDirectorySelection(status="failed", error=error)
        return LocalDirectorySelection(status="failed", error="directory_picker_invalid_output")
    finally:
        _PICKER_LOCK.release()


def native_directory_picker_supported() -> tuple[bool, str | None]:
    flag = (os.environ.get("ACC_ENABLE_NATIVE_DIRECTORY_PICKER") or "").strip().lower()
    if flag in {"0", "false", "no", "off"}:
        return False, "native directory picker disabled"
    if flag in {"1", "true", "yes", "on"}:
        return True, None
    if os.environ.get("CI"):
        return False, "native directory picker is unavailable in CI"
    if sys.platform.startswith("linux") and not (
        os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")
    ):
        return False, "native directory picker requires a graphical session"
    return True, None


def normalized_initial_dir(initial_dir: str | None) -> str | None:
    if not initial_dir:
        return None
    try:
        candidate = Path(initial_dir).expanduser().resolve()
    except OSError:
        return None
    if not candidate.exists() or not candidate.is_dir():
        return None
    return str(candidate)


def parse_helper_output(stdout: str) -> LocalDirectorySelection | None:
    if not stdout.strip():
        return None
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    status = payload.get("status")
    if status not in {"selected", "cancelled", "unsupported", "failed"}:
        return None
    path = payload.get("path") if isinstance(payload.get("path"), str) else None
    error = payload.get("error") if isinstance(payload.get("error"), str) else None
    return LocalDirectorySelection(status=status, path=path, error=error)
