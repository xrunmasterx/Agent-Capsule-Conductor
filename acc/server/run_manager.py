from __future__ import annotations

import asyncio
import os
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from acc.run_index import NodeRunSummary, RunSummary, rebuild_run_index, write_json
from acc.session import utc_now_iso
from acc.utils import AccError

TERMINAL_RUN_STATUSES = {"success", "failed", "cancelled", "crashed"}
ACTIVE_RUN_STATUSES = {"queued", "running", "cancel_requested"}


@dataclass(frozen=True)
class WorkbenchRunJob:
    graph_path: Path
    run_dir: Path
    workflow_id: str
    task_id: str | None
    workspace: Path | None
    binding_path: Path | None
    input_payload: dict[str, Any] | None
    service_factory: Callable[[], Any]


class WorkbenchRunManager:
    """Small in-process runner for Workbench async graph runs.

    Durable facts are the files under runs/<run_id>. The manager only owns
    process-local execution handles and a bounded FIFO queue.
    """

    def __init__(self, project_root: Path, max_active_runs: int | None = None) -> None:
        self.project_root = project_root.resolve()
        self.runs_root = self.project_root / "runs"
        self.max_active_runs = max(1, max_active_runs or configured_max_active_runs())
        self._lock = asyncio.Lock()
        self._queued: deque[WorkbenchRunJob] = deque()
        self._active: dict[str, asyncio.Task[None]] = {}
        self._reconcile_interrupted_runs()

    async def submit(self, job: WorkbenchRunJob) -> dict[str, Any]:
        run_id = job.run_dir.name
        async with self._lock:
            self._write_summary(job, "queued")
            self._queued.append(job)
            self._start_queued_locked()
            status = "running" if run_id in self._active else "queued"
            return self._submit_payload(job, status)

    async def cancel(self, run_id: str) -> dict[str, Any]:
        async with self._lock:
            queued_job = self._pop_queued_locked(run_id)
            if queued_job is not None:
                self._write_cancel_marker(queued_job.run_dir)
                self._write_summary(queued_job, "cancelled", ended_at=utc_now_iso())
                return {"run_id": run_id, "status": "cancelled"}

            active_task = self._active.get(run_id)
            if active_task is not None:
                run_dir = self.runs_root / run_id
                self._write_cancel_marker(run_dir)
                summary = self._load_existing_summary(run_dir)
                if summary is not None:
                    self._write_summary_from_existing(summary, "cancel_requested")
                return {"run_id": run_id, "status": "cancel_requested"}

        raise AccError(f"Run is not queued or running: {run_id}")

    def _start_queued_locked(self) -> None:
        while len(self._active) < self.max_active_runs and self._queued:
            job = self._queued.popleft()
            if self._cancel_marker(job.run_dir).exists():
                self._write_summary(job, "cancelled", ended_at=utc_now_iso())
                continue
            self._write_summary(job, "running", started_at=utc_now_iso())
            task = asyncio.create_task(self._run_job(job))
            self._active[job.run_dir.name] = task

    async def _run_job(self, job: WorkbenchRunJob) -> None:
        run_id = job.run_dir.name
        try:
            service = job.service_factory()
            result = await service.run(
                job.graph_path,
                job.run_dir,
                workspace=job.workspace,
                binding_path=job.binding_path,
                input_payload=job.input_payload,
                should_cancel=lambda: self._cancel_marker(job.run_dir).exists(),
            )
            if (
                self._cancel_marker(job.run_dir).exists()
                and result.get("status") not in TERMINAL_RUN_STATUSES
            ):
                self._write_summary(job, "cancelled", ended_at=utc_now_iso())
        except Exception as exc:  # noqa: BLE001 - background tasks must persist failure facts
            status = "cancelled" if self._cancel_marker(job.run_dir).exists() else "failed"
            self._write_summary(job, status, ended_at=utc_now_iso(), error=str(exc))
        finally:
            async with self._lock:
                self._active.pop(run_id, None)
                self._start_queued_locked()

    def _pop_queued_locked(self, run_id: str) -> WorkbenchRunJob | None:
        remaining: deque[WorkbenchRunJob] = deque()
        found: WorkbenchRunJob | None = None
        while self._queued:
            job = self._queued.popleft()
            if job.run_dir.name == run_id and found is None:
                found = job
                continue
            remaining.append(job)
        self._queued = remaining
        return found

    def _write_summary(
        self,
        job: WorkbenchRunJob,
        status: str,
        *,
        started_at: str | None = None,
        ended_at: str | None = None,
        error: str | None = None,
    ) -> None:
        job.run_dir.mkdir(parents=True, exist_ok=True)
        summary = RunSummary(
            run_id=job.run_dir.name,
            workflow_id=job.workflow_id,
            status=status,
            started_at=started_at,
            ended_at=ended_at,
            run_dir=str(job.run_dir.resolve()),
            node_count=0,
            failed_nodes=[],
            nodes=[],
        )
        if error:
            summary.nodes.append(
                NodeRunSummary(
                    node_id=job.workflow_id,
                    capsule_id="workflow",
                    status=status,
                    summary=error,
                    run_dir=str(job.run_dir.resolve()),
                )
            )
            summary.node_count = 1
            summary.failed_nodes = [job.workflow_id]
        extra = {"task_id": job.task_id} if job.task_id else None
        self._write_summary_model(summary, extra=extra)

    def _write_summary_from_existing(self, summary: RunSummary, status: str) -> None:
        next_summary = summary.model_copy(update={"status": status})
        self._write_summary_model(next_summary)

    def _write_summary_model(
        self,
        summary: RunSummary,
        *,
        extra: dict[str, Any] | None = None,
    ) -> None:
        run_dir = Path(summary.run_dir)
        run_dir.mkdir(parents=True, exist_ok=True)
        payload = summary.model_dump()
        if extra:
            payload.update(extra)
        write_json(run_dir / "run_summary.json", payload)
        self._write_index()

    def _write_index(self) -> None:
        self.runs_root.mkdir(parents=True, exist_ok=True)
        write_json(self.runs_root / "index.json", rebuild_run_index(self.runs_root).model_dump())

    def _load_existing_summary(self, run_dir: Path) -> RunSummary | None:
        path = run_dir / "run_summary.json"
        if not path.exists():
            return None
        try:
            import json

            return RunSummary.model_validate(json.loads(path.read_text(encoding="utf-8")))
        except Exception:
            return None

    def _reconcile_interrupted_runs(self) -> None:
        if not self.runs_root.exists():
            return
        changed = False
        for run_dir in self.runs_root.iterdir():
            if not run_dir.is_dir():
                continue
            summary = self._load_existing_summary(run_dir)
            if summary is None or summary.status not in ACTIVE_RUN_STATUSES:
                continue
            self._write_summary_from_existing(summary, "crashed")
            changed = True
        if changed:
            self._write_index()

    def _write_cancel_marker(self, run_dir: Path) -> None:
        run_dir.mkdir(parents=True, exist_ok=True)
        self._cancel_marker(run_dir).write_text(utc_now_iso(), encoding="utf-8")

    def _cancel_marker(self, run_dir: Path) -> Path:
        return run_dir / "cancel_requested"

    def _submit_payload(self, job: WorkbenchRunJob, status: str) -> dict[str, Any]:
        return {
            "run_id": job.run_dir.name,
            "task_id": job.task_id,
            "status": status,
            "run_dir": str(job.run_dir.resolve()),
        }


def configured_max_active_runs() -> int:
    value = os.getenv("ACC_WORKBENCH_MAX_ACTIVE_RUNS", "").strip()
    if not value:
        return 3
    try:
        return max(1, int(value))
    except ValueError:
        return 3
