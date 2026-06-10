"""Read-only projections over run-scoped control ledger files."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from acc.serialization import control_ledger_to_dict
from acc.store.control_ledger import (
    load_decisions,
    load_dispatches,
    load_plan_steps,
    load_run_plan,
)


def load_run_plan_projection(run_dir: Path) -> dict[str, Any]:
    result = load_run_plan(run_dir)
    warnings = list(result.warnings)
    if result.value is not None and result.value.source != "fixed":
        warnings.append(
            f"RunPlan source {result.value.source!r} is outside fixed-only P0 projection"
        )
    return {
        "run_id": run_dir.name,
        "plan": control_ledger_to_dict(result.value) if result.value is not None else None,
        "events_ref": str((run_dir / "events.jsonl").resolve()),
        "warnings": warnings,
    }


def load_plan_steps_projection(run_dir: Path) -> dict[str, Any]:
    result = load_plan_steps(run_dir)
    return {
        "run_id": run_dir.name,
        "steps": [control_ledger_to_dict(step) for step in result.value],
        "events_ref": str((run_dir / "events.jsonl").resolve()),
        "warnings": list(result.warnings),
    }


def load_dispatches_projection(run_dir: Path) -> dict[str, Any]:
    result = load_dispatches(run_dir)
    return {
        "run_id": run_dir.name,
        "dispatches": [control_ledger_to_dict(dispatch) for dispatch in result.value],
        "events_ref": str((run_dir / "events.jsonl").resolve()),
        "warnings": list(result.warnings),
    }


def load_decisions_projection(run_dir: Path) -> dict[str, Any]:
    result = load_decisions(run_dir)
    return {
        "run_id": run_dir.name,
        "decisions": [control_ledger_to_dict(decision) for decision in result.value],
        "events_ref": str((run_dir / "events.jsonl").resolve()),
        "warnings": list(result.warnings),
    }


def load_control_ledger_projection(run_dir: Path) -> dict[str, Any]:
    plan = load_run_plan_projection(run_dir)
    steps = load_plan_steps_projection(run_dir)
    dispatches = load_dispatches_projection(run_dir)
    decisions = load_decisions_projection(run_dir)
    warnings = [
        *plan["warnings"],
        *steps["warnings"],
        *dispatches["warnings"],
        *decisions["warnings"],
    ]
    return {
        "run_id": run_dir.name,
        "plan": plan["plan"],
        "steps": steps["steps"],
        "dispatches": dispatches["dispatches"],
        "decisions": decisions["decisions"],
        "events_ref": str((run_dir / "events.jsonl").resolve()),
        "warnings": warnings,
    }
