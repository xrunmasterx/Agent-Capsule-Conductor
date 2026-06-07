from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from acc.app.authoring import strip_runtime_state
from acc.session import utc_now_iso
from acc.store import load_json, write_json
from acc.utils import AccError

WORKBENCH_CANVAS_SNAPSHOT_ROOT = Path("runs") / "_workbench_canvas_snapshots"
TASK_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


class WorkbenchCanvasSnapshotService:
    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root.resolve()
        self.root = self.project_root / WORKBENCH_CANVAS_SNAPSHOT_ROOT

    def publish(self, payload: dict[str, Any]) -> dict[str, Any]:
        task_id = validate_task_id(str(payload.get("task_id") or ""))
        canvas_hash = str(payload.get("canvas_hash") or "")
        canvas_snapshot = payload.get("canvas_snapshot")
        if not canvas_hash:
            raise AccError("canvas_hash is required")
        if not isinstance(canvas_snapshot, dict):
            raise AccError("canvas_snapshot must be an object")
        selection = payload.get("selection") if isinstance(payload.get("selection"), dict) else {}
        temporary_resources = (
            payload.get("temporary_resources")
            if isinstance(payload.get("temporary_resources"), dict)
            else {}
        )
        snapshot = {
            "schema_version": "acc.workbench.canvas_snapshot.v1",
            "task_id": task_id,
            "canvas_hash": canvas_hash,
            "canvas_snapshot": strip_runtime_state(canvas_snapshot),
            "selection": selection,
            "temporary_resources": temporary_resources,
            "published_at": utc_now_iso(),
        }
        snapshot_dir = self._task_dir(task_id)
        snapshot_dir.mkdir(parents=True, exist_ok=True)
        write_json(snapshot_dir / "snapshot.json", snapshot)
        return snapshot

    def get(self, task_id: str) -> dict[str, Any]:
        safe_task_id = validate_task_id(task_id)
        path = self._task_dir(safe_task_id) / "snapshot.json"
        if not path.exists():
            raise AccError(f"Workbench canvas snapshot not found: {safe_task_id}")
        payload = load_json(path)
        if not isinstance(payload, dict):
            raise AccError(f"Workbench canvas snapshot is invalid: {safe_task_id}")
        return payload

    def _task_dir(self, task_id: str) -> Path:
        return (self.root / task_id).resolve()


def validate_task_id(task_id: str) -> str:
    if not task_id or not TASK_ID_RE.fullmatch(task_id):
        raise AccError("task_id must match ^[A-Za-z0-9_.-]+$")
    return task_id
