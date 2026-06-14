from __future__ import annotations

from pathlib import Path
from typing import Any

from acc.app.workbench_tasks import WorkbenchTaskService, validate_task_id

WORKBENCH_CANVAS_SNAPSHOT_ROOT = Path("runs") / "_workbench_canvas_snapshots"


class WorkbenchCanvasSnapshotService:
    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root.resolve()
        self.root = self.project_root / WORKBENCH_CANVAS_SNAPSHOT_ROOT
        self.task_service = WorkbenchTaskService(project_root)

    def publish(self, payload: dict[str, Any]) -> dict[str, Any]:
        task_id = validate_task_id(str(payload.get("task_id") or ""))
        return self.task_service.put_canvas(task_id, payload)

    def get(self, task_id: str) -> dict[str, Any]:
        return self.task_service.get_canvas(task_id)

    def _task_dir(self, task_id: str) -> Path:
        return (self.root / task_id).resolve()
