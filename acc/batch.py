from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from acc.artifact_store import ArtifactStore
from acc.runner import CapsuleRunner
from acc.utils import AccError, load_json


async def run_batch(
    spec_path: Path,
    run_dir: Path,
    max_concurrency: int,
    runner: CapsuleRunner | None = None,
) -> dict[str, Any]:
    payload = load_json(spec_path)
    if not isinstance(payload, dict) or not isinstance(payload.get("tasks"), list):
        raise AccError("Batch spec must contain a tasks list")
    if max_concurrency <= 0:
        raise AccError("--max-concurrency must be positive")

    runner = runner or CapsuleRunner()
    store = ArtifactStore(run_dir)
    store.prepare()
    tasks_dir = store.run_dir / "tasks"
    tasks_dir.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(max_concurrency)
    spec_base = spec_path.parent

    async def run_task(index: int, task: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(task, dict):
            raise AccError("Batch task must be an object")
        capsule_id = task.get("capsule_id")
        input_value = task.get("input")
        if not isinstance(capsule_id, str) or not isinstance(input_value, str):
            raise AccError("Batch task requires capsule_id and input")
        input_path = Path(input_value)
        if not input_path.is_absolute():
            input_path = spec_base / input_path
        async with semaphore:
            task_output = await runner.run(
                capsule_id,
                load_json(input_path),
                tasks_dir / f"task_{index:03d}",
            )
        return {
            "index": index,
            "capsule_id": capsule_id,
            "status": task_output["status"],
            "run_dir": str((tasks_dir / f"task_{index:03d}").resolve()),
            "output": task_output,
        }

    task_results = await asyncio.gather(
        *(run_task(index, task) for index, task in enumerate(payload["tasks"], start=1))
    )
    status = "success" if all(task["status"] == "success" for task in task_results) else "failed"
    bundle = {
        "status": status,
        "summary": f"Batch completed with {len(task_results)} task(s)",
        "tasks": task_results,
    }
    bundle_path = store.run_dir / "bundle.json"
    bundle_path.write_text(json.dumps(bundle, indent=2, sort_keys=True), encoding="utf-8")
    conductor_output = {
        "status": status,
        "summary": bundle["summary"],
        "output_path": str(bundle_path.resolve()),
        "artifact_dir": str(store.artifacts_dir.resolve()),
        "event_log": str(store.events_log_path.resolve()),
    }
    store.write_conductor_output(conductor_output)
    return conductor_output

