from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from acc.callable_registry import CallableRegistry


@dataclass(frozen=True)
class ProjectContext:
    project_root: Path
    runs_root: Path
    callable_registry: CallableRegistry | None = None


@dataclass(frozen=True)
class ExecutionContext:
    project: ProjectContext
    run_dir: Path
    request_id: str | None = None

    def with_run_dir(self, run_dir: Path) -> ExecutionContext:
        return ExecutionContext(
            project=self.project,
            run_dir=run_dir.resolve(),
            request_id=self.request_id,
        )


def build_execution_context(
    *,
    workflow_path: Path | None = None,
    run_dir: Path,
    project_root: Path | None = None,
    callable_registry: CallableRegistry | None = None,
    request_id: str | None = None,
) -> ExecutionContext:
    resolved_project_root = resolve_project_root(
        workflow_path=workflow_path,
        run_dir=run_dir,
        project_root=project_root,
        callable_registry=callable_registry,
    )
    return ExecutionContext(
        project=ProjectContext(
            project_root=resolved_project_root,
            runs_root=(resolved_project_root / "runs").resolve(),
            callable_registry=callable_registry,
        ),
        run_dir=run_dir.resolve(),
        request_id=request_id,
    )


def resolve_project_root(
    *,
    workflow_path: Path | None = None,
    run_dir: Path | None = None,
    project_root: Path | None = None,
    callable_registry: CallableRegistry | None = None,
) -> Path:
    if project_root is not None:
        return project_root.resolve()
    if callable_registry is not None and callable_registry.project_root is not None:
        return callable_registry.project_root.resolve()
    if run_dir is not None:
        resolved_run_dir = run_dir.resolve()
        if resolved_run_dir.parent.name == "runs":
            return resolved_run_dir.parent.parent.resolve()
    if workflow_path is not None:
        return workflow_path.resolve().parent
    return Path.cwd().resolve()
