from __future__ import annotations

import json
import os
import re
import threading
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
from typing import Any
from uuid import uuid4

from acc.models import AccError
from acc.session import utc_now_iso

RUN_MARKER_FILENAME = ".acc-run-marker.json"
STORAGE_VERSION = "storage.v1"
_RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
_JSONL_LOCKS: dict[Path, threading.Lock] = {}
_JSONL_LOCKS_GUARD = threading.Lock()


@dataclass(frozen=True)
class RunHandle:
    run_id: str
    run_dir: Path
    marker_path: Path


def generate_run_id() -> str:
    return f"run_{uuid4().hex}"


def validate_run_id(run_id: str) -> str:
    if not isinstance(run_id, str) or not run_id:
        raise AccError("run_id is required")
    if run_id in {".", ".."} or run_id.startswith("_"):
        raise AccError(f"Invalid run_id: {run_id}")
    if not _RUN_ID_PATTERN.fullmatch(run_id):
        raise AccError(f"Invalid run_id: {run_id}")
    windows_path = PureWindowsPath(run_id)
    if windows_path.drive or windows_path.root or Path(run_id).name != run_id:
        raise AccError(f"Invalid run_id: {run_id}")
    return run_id


def parse_legacy_run_dir(run_dir_value: str) -> str:
    if not isinstance(run_dir_value, str) or not run_dir_value:
        raise AccError("run_dir is required")
    raw = run_dir_value.strip()
    windows_path = PureWindowsPath(raw)
    if windows_path.drive or windows_path.root or Path(raw).is_absolute():
        raise AccError("Legacy run_dir must be exactly runs/<run_id>")
    normalized = raw.replace("\\", "/")
    parts = [part for part in normalized.split("/") if part]
    if len(parts) != 2 or parts[0] != "runs":
        raise AccError("Legacy run_dir must be exactly runs/<run_id>")
    if normalized != f"runs/{parts[1]}":
        raise AccError("Legacy run_dir must be exactly runs/<run_id>")
    return validate_run_id(parts[1])


def resolve_run_dir(project_root: Path, run_id: str) -> Path:
    safe_run_id = validate_run_id(run_id)
    runs_root = (project_root / "runs").resolve()
    run_dir = (runs_root / safe_run_id).resolve()
    if run_dir.parent != runs_root:
        raise AccError(f"Invalid run_id: {run_id}")
    return run_dir


def claim_run(
    project_root: Path,
    *,
    run_id: str | None = None,
    workflow_id: str | None = None,
    task_id: str | None = None,
) -> RunHandle:
    selected_run_id = validate_run_id(run_id or generate_run_id())
    run_dir = resolve_run_dir(project_root, selected_run_id)
    try:
        run_dir.mkdir(parents=True, exist_ok=False)
    except FileExistsError as exc:
        raise AccError(f"Run already exists: {selected_run_id}") from exc
    handle = RunHandle(
        run_id=selected_run_id,
        run_dir=run_dir,
        marker_path=run_dir / RUN_MARKER_FILENAME,
    )
    try:
        write_run_marker(handle, project_root, workflow_id=workflow_id, task_id=task_id)
        _rebuild_storage_index(project_root)
    except Exception:
        with suppress(OSError):
            run_dir.rmdir()
        raise
    return handle


def write_run_marker(
    handle: RunHandle,
    project_root: Path,
    *,
    workflow_id: str | None = None,
    task_id: str | None = None,
) -> None:
    marker = {
        "schema_version": 1,
        "run_id": handle.run_id,
        "created_at": utc_now_iso(),
        "project_root_fingerprint": _project_root_fingerprint(project_root),
        "storage_version": STORAGE_VERSION,
        "created_by": "acc",
    }
    if workflow_id:
        marker["workflow_id"] = workflow_id
    if task_id:
        marker["task_id"] = task_id
    write_json_atomic(handle.marker_path, marker)


def assert_acc_run_dir(run_dir: Path, *, project_root: Path | None = None) -> None:
    resolved = run_dir.resolve()
    if project_root is not None:
        expected = resolve_run_dir(project_root, resolved.name)
        if resolved != expected:
            raise AccError(f"Run directory is outside canonical runs root: {run_dir}")
    validate_run_id(resolved.name)
    marker_path = resolved / RUN_MARKER_FILENAME
    if not marker_path.exists():
        raise AccError(f"Run directory is not claimed by ACC storage: {run_dir}")
    payload = json.loads(marker_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("run_id") != resolved.name:
        raise AccError(f"Run marker does not match run directory: {run_dir}")
    if payload.get("created_by") != "acc":
        raise AccError(f"Run marker is not owned by ACC: {run_dir}")


def prepare_runtime_run_dir(run_dir: Path, *, project_root: Path | None = None) -> None:
    if not run_dir.exists():
        run_dir.mkdir(parents=True, exist_ok=False)
        if project_root is not None and _is_canonical_run_dir(project_root, run_dir):
            handle = RunHandle(
                run_id=run_dir.name,
                run_dir=run_dir,
                marker_path=run_dir / RUN_MARKER_FILENAME,
            )
            write_run_marker(handle, project_root)
        return
    if project_root is not None and _is_canonical_run_dir(project_root, run_dir):
        assert_acc_run_dir(run_dir, project_root=project_root)
        return
    if any(run_dir.iterdir()):
        raise AccError(f"Run directory already exists and is not empty: {run_dir}")


def write_json_atomic(path: Path, payload: Any) -> None:
    text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)
    write_text_atomic(path, text)


def write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    temp_path.replace(path)
    _fsync_dir(path.parent)


def append_jsonl_locked(path: Path, event: dict[str, Any]) -> dict[str, Any]:
    lock = _jsonl_lock_for(path)
    with lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        next_sequence = _next_jsonl_sequence(path)
        payload = dict(event)
        payload.setdefault("sequence", next_sequence)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
    return payload


def _next_jsonl_sequence(path: Path) -> int:
    max_sequence = 0
    if not path.exists():
        return 1
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if not line.strip():
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            sequence = payload.get("sequence") if isinstance(payload, dict) else None
            if isinstance(sequence, int) and sequence > max_sequence:
                max_sequence = sequence
    return max_sequence + 1


def _jsonl_lock_for(path: Path) -> threading.Lock:
    resolved = path.resolve()
    with _JSONL_LOCKS_GUARD:
        lock = _JSONL_LOCKS.get(resolved)
        if lock is None:
            lock = threading.Lock()
            _JSONL_LOCKS[resolved] = lock
        return lock


def _is_canonical_run_dir(project_root: Path, run_dir: Path) -> bool:
    runs_root = (project_root / "runs").resolve()
    resolved = run_dir.resolve()
    return resolved.parent == runs_root


def _project_root_fingerprint(project_root: Path) -> str:
    import hashlib

    return hashlib.sha256(str(project_root.resolve()).encode("utf-8")).hexdigest()


def _fsync_dir(path: Path) -> None:
    if os.name == "nt":
        return
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _rebuild_storage_index(project_root: Path) -> None:
    try:
        from acc.storage_index import rebuild_storage_index

        rebuild_storage_index(project_root)
    except Exception:
        return
