from __future__ import annotations

import os
from pathlib import Path

from fastapi import HTTPException, Request

from acc.server.run_manager import WorkbenchRunManager


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
    refresh_service = getattr(request.app.state, "storage_index_refresh_service", None)
    refresh_trigger = getattr(refresh_service, "trigger", None)
    manager = WorkbenchRunManager(
        project_root,
        storage_refresh_trigger=refresh_trigger if callable(refresh_trigger) else None,
    )
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
