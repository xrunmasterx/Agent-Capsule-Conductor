from __future__ import annotations

from pathlib import Path
from typing import Any

from acc.utils import AccError, load_json


async def run_batch(
    spec_path: Path,
    run_dir: Path,
    max_concurrency: int,
    service: Any | None = None,
) -> dict[str, Any]:
    payload = load_json(spec_path)
    if not isinstance(payload, dict) or not isinstance(payload.get("tasks"), list):
        raise AccError("Batch spec must contain a tasks list")
    if max_concurrency <= 0:
        raise AccError("--max-concurrency must be positive")

    _ = run_dir, service
    raise AccError(
        "Legacy batch-run specs are no longer executable. "
        "Use a canonical Core v2 workflow with explicit callable refs and bindings."
    )
