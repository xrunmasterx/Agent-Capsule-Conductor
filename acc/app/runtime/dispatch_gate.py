"""Deprecated compatibility shims for persisted run continuation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from acc.callable_registry import CallableRegistry


async def resume_approved_human_gate_dispatch(
    run_dir: Path,
    *,
    interaction_id: str,
    callable_registry: CallableRegistry | None = None,
) -> dict[str, Any]:
    from acc.app.runtime.continuation import continue_persisted_run

    return await continue_persisted_run(
        run_dir,
        reason="human",
        interaction_id=interaction_id,
        callable_registry=callable_registry,
    )


async def dispatch_ready_supervisor_plan_steps(
    run_dir: Path,
    *,
    callable_registry: CallableRegistry | None = None,
) -> dict[str, Any]:
    from acc.app.runtime.continuation import continue_persisted_run

    return await continue_persisted_run(
        run_dir,
        reason="supervisor",
        callable_registry=callable_registry,
    )


async def dispatch_ready_handoff_plan_steps(
    run_dir: Path,
    *,
    callable_registry: CallableRegistry | None = None,
) -> dict[str, Any]:
    from acc.app.runtime.continuation import continue_persisted_run

    return await continue_persisted_run(
        run_dir,
        reason="handoff",
        callable_registry=callable_registry,
    )
