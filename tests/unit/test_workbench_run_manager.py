from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from acc.run_index import load_run_summary_by_id
from acc.server.run_manager import WorkbenchRunJob, WorkbenchRunManager


class _SuccessfulService:
    async def run(
        self,
        graph_path: Path,
        run_dir: Path,
        *,
        workspace: Path | None,
        binding_path: Path | None,
        input_payload: dict[str, Any] | None,
        should_cancel: Any,
    ) -> dict[str, Any]:
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "run_summary.json").write_text(
            json.dumps(
                {
                    "run_id": run_dir.name,
                    "workflow_id": "stock-flow",
                    "status": "running",
                    "run_dir": str(run_dir.resolve()),
                    "node_count": 0,
                    "failed_nodes": [],
                    "nodes": [],
                }
            ),
            encoding="utf-8",
        )
        return {"status": "success"}


class _FailingService:
    async def run(
        self,
        graph_path: Path,
        run_dir: Path,
        *,
        workspace: Path | None,
        binding_path: Path | None,
        input_payload: dict[str, Any] | None,
        should_cancel: Any,
    ) -> dict[str, Any]:
        raise RuntimeError("boom")


def _job(
    tmp_path: Path,
    *,
    run_id: str,
    task_id: str,
    service: Any,
) -> WorkbenchRunJob:
    graph_path = tmp_path / f"{run_id}.accflow.json"
    graph_path.write_text("{}", encoding="utf-8")
    return WorkbenchRunJob(
        graph_path=graph_path,
        run_dir=tmp_path / "runs" / run_id,
        workflow_id="stock-flow",
        task_id=task_id,
        workspace=None,
        binding_path=None,
        input_payload=None,
        service_factory=lambda: service,
    )


async def _wait_for_terminal(run_dir: Path) -> dict[str, Any]:
    for _ in range(100):
        summary_path = run_dir / "run_summary.json"
        if summary_path.exists():
            payload = json.loads(summary_path.read_text(encoding="utf-8"))
            if payload.get("status") in {"success", "failed", "cancelled", "crashed"}:
                return payload
        await asyncio.sleep(0.01)
    raise AssertionError("run did not reach terminal state")


def test_workbench_run_manager_rewrites_terminal_success_summary(tmp_path: Path) -> None:
    async def scenario() -> dict[str, Any]:
        manager = WorkbenchRunManager(tmp_path, max_active_runs=1)
        job = _job(
            tmp_path,
            run_id="run-success",
            task_id="task-stock",
            service=_SuccessfulService(),
        )
        submit_result = await manager.submit(job)
        assert submit_result["status"] == "running"
        return await _wait_for_terminal(job.run_dir)

    payload = asyncio.run(scenario())

    assert payload["status"] == "success"
    assert payload["task_id"] == "task-stock"
    summary = load_run_summary_by_id("run-success", tmp_path / "runs")
    assert summary.status == "success"


def test_workbench_run_manager_writes_failed_summary_on_background_exception(
    tmp_path: Path,
) -> None:
    async def scenario() -> dict[str, Any]:
        manager = WorkbenchRunManager(tmp_path, max_active_runs=1)
        job = _job(
            tmp_path,
            run_id="run-failed",
            task_id="task-stock",
            service=_FailingService(),
        )
        submit_result = await manager.submit(job)
        assert submit_result["status"] == "running"
        return await _wait_for_terminal(job.run_dir)

    payload = asyncio.run(scenario())

    assert payload["status"] == "failed"
    assert payload["task_id"] == "task-stock"
    assert payload["failed_nodes"] == ["stock-flow"]
    assert payload["nodes"][0]["summary"] == "boom"
