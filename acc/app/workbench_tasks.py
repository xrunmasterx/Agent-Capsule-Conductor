from __future__ import annotations

import copy
import re
from pathlib import Path
from typing import Any

from acc.session import utc_now_iso
from acc.store import load_json, write_json
from acc.utils import AccError

WORKBENCH_TASKS_ROOT = Path(".acc") / "tasks"
TASK_SCHEMA_VERSION = "acc.workbench.task.v1"
CANVAS_SNAPSHOT_SCHEMA_VERSION = "acc.workbench.canvas_snapshot.v2"
TASK_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")

RUNTIME_ONLY_KEYS = frozenset(
    {
        "status",
        "runId",
        "sessionId",
        "runtime",
        "run",
        "output",
        "output_path",
        "event_log",
        "stdout_log",
        "stderr_log",
        "logs",
        "messages",
        "provider_session_id",
        "threadId",
        "current_output_ref",
        "published_output_ref",
    }
)


class WorkbenchTaskService:
    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root.resolve()
        self.root = self.project_root / WORKBENCH_TASKS_ROOT

    def list_tasks(self, *, include_deleted: bool = False) -> dict[str, Any]:
        tasks = []
        if self.root.exists():
            for task_path in sorted(self.root.glob("*/task.json")):
                try:
                    task = self._task_payload(task_path.parent.name)
                except AccError:
                    continue
                if task.get("deleted_at") and not include_deleted:
                    continue
                tasks.append(task)
        return {"tasks": tasks}

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        task_id = validate_task_id(str(payload.get("task_id") or ""))
        task_dir = self._task_dir(task_id)
        if (task_dir / "task.json").exists():
            raise AccError(f"Workbench task already exists: {task_id}")
        now = utc_now_iso()
        title = str(payload.get("title") or "Untitled task")
        task = {
            "schema_version": TASK_SCHEMA_VERSION,
            "task_id": task_id,
            "title": title,
            "canvas_ref": f"task_canvas:{task_id}",
            "saved_workflow_ref": payload.get("saved_workflow_ref"),
            "active_run_id": payload.get("active_run_id"),
            "latest_run_id": payload.get("latest_run_id"),
            "created_at": now,
            "updated_at": now,
            "deleted_at": None,
            "retention": retention_payload(payload.get("retention")),
        }
        write_json(task_dir / "task.json", task)
        write_json(task_dir / "retention.json", task["retention"])
        write_json(task_dir / "refs.json", refs_payload(task))
        return task

    def get(self, task_id: str, *, include_deleted: bool = False) -> dict[str, Any]:
        task = self._task_payload(validate_task_id(task_id))
        if task.get("deleted_at") and not include_deleted:
            raise AccError(f"Workbench task is deleted: {task_id}")
        return task

    def update(self, task_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        safe_task_id = validate_task_id(task_id)
        task = self._task_payload(safe_task_id)
        if task.get("deleted_at"):
            raise AccError(f"Workbench task is deleted: {safe_task_id}")
        updated = dict(task)
        for key in ("title", "saved_workflow_ref", "active_run_id", "latest_run_id"):
            if key in payload:
                updated[key] = payload.get(key)
        if "retention" in payload:
            updated["retention"] = retention_payload(payload.get("retention"))
            write_json(self._task_dir(safe_task_id) / "retention.json", updated["retention"])
        updated["updated_at"] = utc_now_iso()
        write_json(self._task_dir(safe_task_id) / "task.json", updated)
        write_json(self._task_dir(safe_task_id) / "refs.json", refs_payload(updated))
        return updated

    def tombstone(self, task_id: str) -> dict[str, Any]:
        safe_task_id = validate_task_id(task_id)
        task = self._task_payload(safe_task_id)
        if task.get("deleted_at"):
            return task
        now = utc_now_iso()
        tombstoned = {**task, "deleted_at": now, "updated_at": now}
        write_json(self._task_dir(safe_task_id) / "task.json", tombstoned)
        return tombstoned

    def put_canvas(
        self,
        task_id: str,
        payload: dict[str, Any],
        *,
        base_canvas_hash: str | None = None,
    ) -> dict[str, Any]:
        safe_task_id = validate_task_id(task_id)
        canvas_hash = str(payload.get("canvas_hash") or "")
        canvas_snapshot = payload.get("canvas_snapshot")
        if not canvas_hash:
            raise AccError("canvas_hash is required")
        if not isinstance(canvas_snapshot, dict):
            raise AccError("canvas_snapshot must be an object")
        task = self._ensure_task_for_canvas(safe_task_id, canvas_snapshot)
        existing = self._optional_canvas_payload(safe_task_id)
        if base_canvas_hash and existing and existing.get("canvas_hash") != base_canvas_hash:
            raise AccError("Canvas snapshot base hash is stale")
        selection = payload.get("selection") if isinstance(payload.get("selection"), dict) else {}
        temporary_resources = (
            payload.get("temporary_resources")
            if isinstance(payload.get("temporary_resources"), dict)
            else {}
        )
        snapshot = {
            "schema_version": CANVAS_SNAPSHOT_SCHEMA_VERSION,
            "task_id": safe_task_id,
            "canvas_hash": canvas_hash,
            "canvas_snapshot": strip_canvas_runtime_state(canvas_snapshot),
            "selection": strip_transient_selection(selection),
            "temporary_resources": temporary_resources,
            "published_at": utc_now_iso(),
        }
        task_dir = self._task_dir(safe_task_id)
        write_json(task_dir / "canvas_snapshot.json", snapshot)
        write_json(task_dir / "ui_projection.json", ui_projection_payload(task, snapshot))
        self.update(
            safe_task_id,
            {
                "title": title_from_canvas(canvas_snapshot, fallback=str(task.get("title") or "")),
            },
        )
        return snapshot

    def get_canvas(self, task_id: str) -> dict[str, Any]:
        safe_task_id = validate_task_id(task_id)
        snapshot = self._optional_canvas_payload(safe_task_id)
        if snapshot is None:
            raise AccError(f"Workbench canvas snapshot not found: {safe_task_id}")
        return snapshot

    def _ensure_task_for_canvas(
        self,
        task_id: str,
        canvas_snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        try:
            return self.get(task_id, include_deleted=True)
        except AccError:
            return self.create(
                {
                    "task_id": task_id,
                    "title": title_from_canvas(canvas_snapshot, fallback="Untitled task"),
                }
            )

    def _task_payload(self, task_id: str) -> dict[str, Any]:
        path = self._task_dir(validate_task_id(task_id)) / "task.json"
        if not path.exists():
            raise AccError(f"Workbench task not found: {task_id}")
        payload = load_json(path)
        if not isinstance(payload, dict):
            raise AccError(f"Workbench task is invalid: {task_id}")
        return payload

    def _optional_canvas_payload(self, task_id: str) -> dict[str, Any] | None:
        path = self._task_dir(validate_task_id(task_id)) / "canvas_snapshot.json"
        if not path.exists():
            return None
        payload = load_json(path)
        if not isinstance(payload, dict):
            raise AccError(f"Workbench canvas snapshot is invalid: {task_id}")
        return payload

    def _task_dir(self, task_id: str) -> Path:
        task_dir = (self.root / validate_task_id(task_id)).resolve()
        if task_dir.parent != self.root.resolve():
            raise AccError(f"Invalid task_id: {task_id}")
        return task_dir


def validate_task_id(task_id: str) -> str:
    if not isinstance(task_id, str) or not TASK_ID_RE.fullmatch(task_id):
        raise AccError("task_id must match ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
    if task_id in {".", ".."} or task_id.startswith("_"):
        raise AccError(f"Invalid task_id: {task_id}")
    return task_id


def retention_payload(value: Any) -> dict[str, Any]:
    payload = value if isinstance(value, dict) else {}
    return {
        "pinned": bool(payload.get("pinned", False)),
        "retention_class": str(payload.get("retention_class") or "normal"),
    }


def refs_payload(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": "acc.workbench.task.refs.v1",
        "task_id": task.get("task_id"),
        "canvas_ref": task.get("canvas_ref"),
        "saved_workflow_ref": task.get("saved_workflow_ref"),
        "active_run_id": task.get("active_run_id"),
        "latest_run_id": task.get("latest_run_id"),
        "updated_at": task.get("updated_at"),
    }


def ui_projection_payload(task: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": "acc.workbench.task.ui_projection.v1",
        "task_id": task.get("task_id"),
        "title": task.get("title"),
        "canvas_hash": snapshot.get("canvas_hash"),
        "published_at": snapshot.get("published_at"),
    }


def strip_canvas_runtime_state(value: Any) -> Any:
    if isinstance(value, list):
        return [strip_canvas_runtime_state(item) for item in value]
    if not isinstance(value, dict):
        return copy.deepcopy(value)
    stripped: dict[str, Any] = {}
    for key, item in value.items():
        if key in RUNTIME_ONLY_KEYS:
            continue
        if key == "ui" and isinstance(item, dict):
            stripped[key] = {
                child_key: strip_canvas_runtime_state(child_value)
                for child_key, child_value in item.items()
                if child_key != "internal_nodes"
            }
            continue
        stripped[key] = strip_canvas_runtime_state(item)
    return stripped


def strip_transient_selection(selection: dict[str, Any]) -> dict[str, Any]:
    return {
        key: strip_canvas_runtime_state(value)
        for key, value in selection.items()
        if key not in {"execution_overlay", "runtime", "run", "logs"}
    }


def title_from_canvas(canvas: dict[str, Any], *, fallback: str) -> str:
    title = canvas.get("name") or canvas.get("title")
    if isinstance(title, str) and title.strip():
        return title.strip()
    return fallback or "Untitled task"
