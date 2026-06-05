"""Filesystem helpers for the Runtime Control Ledger.

These helpers are source-of-truth file primitives only. Goal 01 does not wire
them into Core v2 execution; later goals decide where runtime coordination calls
the writers.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Generic, TypeVar
from uuid import uuid4

from acc.control_ledger_codec import (
    parse_control_event_record,
    parse_decision_record,
    parse_dispatch_transition,
    parse_plan_step_transition,
    parse_run_plan,
)
from acc.domain import (
    AccError,
    ControlEventRecord,
    DecisionRecord,
    DispatchEnvelope,
    DispatchTransitionRecord,
    PlanStep,
    PlanStepTransitionRecord,
    RunPlan,
    control_ledger_to_dict,
)
from acc.session import utc_now_iso
from acc.store import load_json, write_json

RUN_PLAN_FILE = "run_plan.json"
PLAN_STEPS_FILE = "plan_steps.jsonl"
DISPATCHES_FILE = "dispatches.jsonl"
DECISIONS_FILE = "decisions.jsonl"
EVENTS_FILE = "events.jsonl"

T = TypeVar("T")


@dataclass(frozen=True)
class ControlLedgerLoadResult(Generic[T]):
    value: T
    warnings: tuple[str, ...] = ()


def load_run_plan(run_dir: Path) -> ControlLedgerLoadResult[RunPlan | None]:
    path = run_dir / RUN_PLAN_FILE
    if not path.exists():
        return ControlLedgerLoadResult(None, (_missing_warning(path),))
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise AccError(f"{RUN_PLAN_FILE} must contain a JSON object")
    return ControlLedgerLoadResult(parse_run_plan(payload))


def write_run_plan(run_dir: Path, run_plan: RunPlan) -> None:
    write_json(run_dir / RUN_PLAN_FILE, control_ledger_to_dict(run_plan))


def load_plan_steps(run_dir: Path) -> ControlLedgerLoadResult[tuple[PlanStep, ...]]:
    path = run_dir / PLAN_STEPS_FILE
    if not path.exists():
        return ControlLedgerLoadResult((), (_missing_warning(path),))
    transitions = _read_jsonl(path, parse_plan_step_transition)
    return ControlLedgerLoadResult(_latest_plan_steps(transitions))


def load_plan_step_transitions(
    run_dir: Path,
) -> ControlLedgerLoadResult[tuple[PlanStepTransitionRecord, ...]]:
    path = run_dir / PLAN_STEPS_FILE
    if not path.exists():
        return ControlLedgerLoadResult((), (_missing_warning(path),))
    return ControlLedgerLoadResult(_read_jsonl(path, parse_plan_step_transition))


def next_plan_step_transition_sequence(run_dir: Path) -> int:
    transitions = load_plan_step_transitions(run_dir)
    if transitions.warnings:
        return 1
    if not transitions.value:
        return 1
    return max(transition.sequence for transition in transitions.value) + 1


def append_plan_step_transition(
    run_dir: Path,
    transition: PlanStepTransitionRecord,
) -> None:
    _append_jsonl(run_dir / PLAN_STEPS_FILE, control_ledger_to_dict(transition))


def load_dispatches(run_dir: Path) -> ControlLedgerLoadResult[tuple[DispatchEnvelope, ...]]:
    path = run_dir / DISPATCHES_FILE
    if not path.exists():
        return ControlLedgerLoadResult((), (_missing_warning(path),))
    transitions = _read_jsonl(path, parse_dispatch_transition)
    return ControlLedgerLoadResult(_latest_dispatches(transitions))


def load_dispatch_transitions(
    run_dir: Path,
) -> ControlLedgerLoadResult[tuple[DispatchTransitionRecord, ...]]:
    path = run_dir / DISPATCHES_FILE
    if not path.exists():
        return ControlLedgerLoadResult((), (_missing_warning(path),))
    return ControlLedgerLoadResult(_read_jsonl(path, parse_dispatch_transition))


def next_dispatch_transition_sequence(run_dir: Path) -> int:
    transitions = load_dispatch_transitions(run_dir)
    if transitions.warnings:
        return 1
    if not transitions.value:
        return 1
    return max(transition.sequence for transition in transitions.value) + 1


def append_dispatch_transition(
    run_dir: Path,
    transition: DispatchTransitionRecord,
) -> None:
    _append_jsonl(run_dir / DISPATCHES_FILE, control_ledger_to_dict(transition))


def load_decisions(run_dir: Path) -> ControlLedgerLoadResult[tuple[DecisionRecord, ...]]:
    path = run_dir / DECISIONS_FILE
    if not path.exists():
        return ControlLedgerLoadResult((), (_missing_warning(path),))
    return ControlLedgerLoadResult(tuple(_read_jsonl(path, parse_decision_record)))


def append_decision_record(run_dir: Path, decision: DecisionRecord) -> None:
    _append_jsonl(run_dir / DECISIONS_FILE, control_ledger_to_dict(decision))


def append_control_event(
    run_dir: Path,
    *,
    event_type: str,
    run_id: str,
    payload: dict[str, object] | None = None,
    event_id: str | None = None,
    timestamp: str | None = None,
    scope_frame_id: str | None = None,
    node_id: str | None = None,
    session_id: str | None = None,
    plan_step_id: str | None = None,
    dispatch_id: str | None = None,
    decision_id: str | None = None,
) -> ControlEventRecord:
    event = ControlEventRecord(
        event_id=event_id or f"event_{uuid4().hex}",
        type=event_type,
        timestamp=timestamp or utc_now_iso(),
        run_id=run_id,
        scope_frame_id=scope_frame_id,
        node_id=node_id,
        session_id=session_id,
        plan_step_id=plan_step_id,
        dispatch_id=dispatch_id,
        decision_id=decision_id,
        payload=dict(payload or {}),
    )
    parse_control_event_record(control_ledger_to_dict(event))
    _append_jsonl(run_dir / EVENTS_FILE, control_ledger_to_dict(event))
    return event


def _latest_plan_steps(
    transitions: tuple[PlanStepTransitionRecord, ...],
) -> tuple[PlanStep, ...]:
    _validate_sequence_order(transitions, PLAN_STEPS_FILE)
    latest: dict[str, PlanStep] = {}
    order: list[str] = []
    for transition in transitions:
        current = latest.get(transition.plan_step_id)
        if current is None:
            if transition.previous_status is not None:
                raise AccError(
                    f"{PLAN_STEPS_FILE} first transition for {transition.plan_step_id!r} "
                    "must have previous_status null"
                )
            order.append(transition.plan_step_id)
        elif transition.previous_status != current.status:
            raise AccError(
                f"{PLAN_STEPS_FILE} transition for {transition.plan_step_id!r} "
                "does not match latest status"
            )
        latest[transition.plan_step_id] = transition.snapshot
    return tuple(latest[plan_step_id] for plan_step_id in order)


def _latest_dispatches(
    transitions: tuple[DispatchTransitionRecord, ...],
) -> tuple[DispatchEnvelope, ...]:
    _validate_sequence_order(transitions, DISPATCHES_FILE)
    latest: dict[str, DispatchEnvelope] = {}
    order: list[str] = []
    for transition in transitions:
        current = latest.get(transition.dispatch_id)
        if current is None:
            if transition.previous_status is not None:
                raise AccError(
                    f"{DISPATCHES_FILE} first transition for {transition.dispatch_id!r} "
                    "must have previous_status null"
                )
            order.append(transition.dispatch_id)
        elif transition.previous_status != current.status:
            raise AccError(
                f"{DISPATCHES_FILE} transition for {transition.dispatch_id!r} "
                "does not match latest status"
            )
        latest[transition.dispatch_id] = transition.snapshot
    return tuple(latest[dispatch_id] for dispatch_id in order)


def _validate_sequence_order(
    transitions: tuple[PlanStepTransitionRecord | DispatchTransitionRecord, ...],
    filename: str,
) -> None:
    seen: set[int] = set()
    previous_sequence: int | None = None
    for transition in transitions:
        if transition.sequence in seen:
            raise AccError(f"{filename} contains duplicate sequence: {transition.sequence}")
        if previous_sequence is not None and transition.sequence <= previous_sequence:
            raise AccError(f"{filename} sequence must be monotonically increasing")
        seen.add(transition.sequence)
        previous_sequence = transition.sequence


def _read_jsonl(path: Path, parser: Callable[[dict[str, object]], T]) -> tuple[T, ...]:
    records: list[T] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:
                raise AccError(f"Invalid JSONL in {path} line {line_number}: {exc}") from exc
            if not isinstance(payload, dict):
                raise AccError(f"{path.name} line {line_number} must be a JSON object")
            records.append(parser(payload))
    return tuple(records)


def _append_jsonl(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")


def _missing_warning(path: Path) -> str:
    return f"Missing control ledger file: {path.name}"
