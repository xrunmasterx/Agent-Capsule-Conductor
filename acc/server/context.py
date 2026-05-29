from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Request

from acc.server.run_manager import WorkbenchRunManager

SECRET_EXACT_NAMES = {
    ".env",
    ".env.local",
    ".envrc",
    "credentials",
    "credentials.json",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
    "known_hosts",
}
SECRET_SUBSTRINGS = {
    "api_key",
    "apikey",
    "credential",
    "password",
    "private_key",
    "secret",
    "token",
}
MAX_ARTIFACT_READ_BYTES = 1_000_000


def get_project_root(request: Request) -> Path:
    root = getattr(request.app.state, "project_root", None)
    if root is None:
        return Path.cwd().resolve()
    return Path(root).resolve()


def get_workbench_run_manager(request: Request) -> WorkbenchRunManager:
    manager = getattr(request.app.state, "workbench_run_manager", None)
    project_root = get_project_root(request)
    if isinstance(manager, WorkbenchRunManager) and manager.project_root == project_root:
        return manager
    manager = WorkbenchRunManager(project_root)
    request.app.state.workbench_run_manager = manager
    return manager


def project_path(request: Request, *parts: str) -> Path:
    return get_project_root(request).joinpath(*parts)


def configured_project_dir(project_root: Path, env_name: str, default_value: str) -> Path:
    return resolve_inside_project(project_root, os.environ.get(env_name, default_value))


def resolve_inside_project(project_root: Path, value: str | Path) -> Path:
    raw_path = Path(value)
    candidate = raw_path if raw_path.is_absolute() else project_root / raw_path
    resolved = candidate.resolve()
    if not is_relative_to(resolved, project_root):
        raise HTTPException(status_code=400, detail="Path is outside project root")
    return resolved


def is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def relative_project_path(project_root: Path, path: Path) -> str:
    root = project_root.resolve()
    candidate = path if path.is_absolute() else root / path
    try:
        relative = candidate.resolve().relative_to(root)
    except ValueError:
        try:
            relative = candidate.relative_to(root)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Path is outside project root") from exc
    return str(relative).replace("\\", "/")


def reject_secret_like_path(path: Path) -> None:
    lower_parts = [part.lower() for part in path.parts]
    name = path.name.lower()
    if name in SECRET_EXACT_NAMES:
        raise HTTPException(status_code=403, detail="Secret-like files are not exposed")
    if any(part in SECRET_EXACT_NAMES for part in lower_parts):
        raise HTTPException(status_code=403, detail="Secret-like files are not exposed")
    if any(marker in name for marker in SECRET_SUBSTRINGS):
        raise HTTPException(status_code=403, detail="Secret-like files are not exposed")


def read_safe_text_file(project_root: Path, path_value: str) -> dict[str, Any]:
    path = resolve_inside_project(project_root, path_value)
    reject_secret_like_path(path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Artifact not found")
    size = path.stat().st_size
    if size > MAX_ARTIFACT_READ_BYTES:
        raise HTTPException(status_code=413, detail="Artifact is too large to read")
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=415, detail="Artifact is not UTF-8 text") from exc
    return {
        "path": relative_project_path(project_root, path),
        "name": path.name,
        "type": infer_artifact_type(path),
        "content": content,
        "size_bytes": size,
    }


def infer_artifact_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".md":
        return "markdown"
    if suffix == ".json":
        return "json"
    if suffix in {".log", ".jsonl"}:
        return "log"
    if suffix in {".patch", ".diff"}:
        return "patch"
    return "text"
