from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from acc.schemas import WorkspaceSpec
from acc.utils import AccError


@dataclass(frozen=True)
class WorkspaceResult:
    path: Path
    mode: str
    command: list[str] | None = None


class WorkspaceManager:
    def prepare(
        self,
        spec: WorkspaceSpec,
        input_payload: dict[str, Any],
        run_dir: Path,
    ) -> WorkspaceResult:
        if spec.mode == "existing_dir":
            workspace = self._existing_dir(spec, input_payload)
            return WorkspaceResult(path=workspace, mode=spec.mode)

        repo_path = self._repo_path_from_input(spec, input_payload)
        workspace_path = (run_dir / "workspace").resolve()
        command = build_worktree_command(spec.mode, repo_path, workspace_path, spec.base_ref)
        subprocess.run(command, check=True)
        return WorkspaceResult(path=workspace_path, mode=spec.mode, command=command)

    def _existing_dir(self, spec: WorkspaceSpec, input_payload: dict[str, Any]) -> Path:
        if spec.repo_path_input:
            workspace = self._repo_path_from_input(spec, input_payload)
        else:
            workspace = Path.cwd().resolve()
        ensure_allowed_path(workspace, spec.allowed_paths)
        if not workspace.exists() or not workspace.is_dir():
            raise AccError(f"Workspace directory not found: {workspace}")
        return workspace

    def _repo_path_from_input(self, spec: WorkspaceSpec, input_payload: dict[str, Any]) -> Path:
        if not spec.repo_path_input:
            raise AccError(f"{spec.mode} requires repo_path_input")
        raw_path = input_payload.get(spec.repo_path_input)
        if not isinstance(raw_path, str) or not raw_path:
            raise AccError(f"Input must include workspace path field: {spec.repo_path_input}")
        repo_path = Path(raw_path).expanduser().resolve()
        ensure_allowed_path(repo_path, spec.allowed_paths)
        if not repo_path.exists() or not repo_path.is_dir():
            raise AccError(f"Repository directory not found: {repo_path}")
        return repo_path


def ensure_allowed_path(path: Path, allowed_paths: list[str]) -> None:
    if not allowed_paths:
        return
    resolved_allowed = [Path(value).expanduser().resolve() for value in allowed_paths]
    if not any(path == allowed or path.is_relative_to(allowed) for allowed in resolved_allowed):
        allowed_display = ", ".join(str(value) for value in resolved_allowed)
        raise AccError(f"Workspace path {path} is outside allowed paths: {allowed_display}")


def build_worktree_command(
    mode: str,
    repo_path: Path,
    workspace_path: Path,
    base_ref: str | None,
) -> list[str]:
    ref = base_ref or "HEAD"
    if mode == "git_worktree_readonly":
        return [
            "git",
            "-C",
            str(repo_path),
            "worktree",
            "add",
            "--detach",
            str(workspace_path),
            ref,
        ]
    if mode == "git_worktree_write":
        branch_name = f"acc-{workspace_path.parent.name}"
        return [
            "git",
            "-C",
            str(repo_path),
            "worktree",
            "add",
            "-b",
            branch_name,
            str(workspace_path),
            ref,
        ]
    raise AccError(f"Unsupported workspace mode: {mode}")
