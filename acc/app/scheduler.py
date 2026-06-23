"""File-backed wakeup queue and recovery (REQ-A4)."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

from acc.app.run_lifecycle import resume_waiting_run
from acc.app.runtime.continuation import continue_persisted_run
from acc.models import AccError, CallableRef, RecoveryLevel, WakeupReason, WakeupRequest
from acc.session import utc_now_iso
from acc.store import load_json, write_json

DEFAULT_STALE_AFTER_SECONDS = 600
L1_RETRYABLE_ERRORS = {"timeout", "adapter_error"}


def use_ready_queue() -> bool:
    return os.getenv("ACC_USE_READY_QUEUE", "").strip().lower() in {"1", "true", "yes"}


def _queue_path(run_dir: Path) -> Path:
    return run_dir / "wakeup_queue.jsonl"


def _state_path(run_dir: Path) -> Path:
    return run_dir / "wakeup_state.json"


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(payload, sort_keys=True) + "\n")


def wakeup_request_payload(request: WakeupRequest) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "request_id": request.request_id,
        "run_id": request.run_id,
        "reason": request.reason,
        "priority": request.priority,
        "created_at": request.created_at,
        "target_node_id": request.target_node_id,
        "payload": request.payload,
        "coalesce_key": request.coalesce_key,
    }
    if request.target_callable_ref is not None:
        payload["target_callable_ref"] = {
            "kind": request.target_callable_ref.kind,
            "id": request.target_callable_ref.id,
            "version": request.target_callable_ref.version,
        }
    return payload


def parse_wakeup_request(raw: dict[str, Any]) -> WakeupRequest:
    ref_raw = raw.get("target_callable_ref")
    target_ref = None
    if isinstance(ref_raw, dict):
        target_ref = CallableRef(
            kind=str(ref_raw["kind"]),
            id=str(ref_raw["id"]),
            version=ref_raw.get("version"),
        )
    return WakeupRequest(
        request_id=str(raw["request_id"]),
        run_id=str(raw["run_id"]),
        reason=raw["reason"],
        priority=int(raw.get("priority", 0)),
        created_at=str(raw["created_at"]),
        target_node_id=raw.get("target_node_id"),
        target_callable_ref=target_ref,
        coalesce_key=raw.get("coalesce_key"),
        payload=raw.get("payload") if isinstance(raw.get("payload"), dict) else {},
    )


def load_wakeup_state(run_dir: Path) -> dict[str, Any]:
    path = _state_path(run_dir)
    if path.exists():
        payload = load_json(path)
        if isinstance(payload, dict):
            return payload
    return reconcile_wakeup_state(run_dir)


def reconcile_wakeup_state(run_dir: Path) -> dict[str, Any]:
    queue_path = _queue_path(run_dir)
    pending: dict[str, dict[str, Any]] = {}
    consumed_ids: set[str] = set()
    queue_records: list[dict[str, Any]] = []
    if queue_path.exists():
        for line in queue_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            raw = json.loads(line)
            queue_records.append(raw)
            request_id = str(raw.get("request_id"))
            if raw.get("status") == "consumed":
                consumed_ids.add(request_id)
    for raw in queue_records:
        request_id = str(raw.get("request_id"))
        if request_id in consumed_ids:
            continue
        if raw.get("status") == "consumed":
            continue
        coalesce_key = raw.get("coalesce_key")
        if coalesce_key:
            pending[str(coalesce_key)] = raw
        else:
            pending[request_id] = raw
    state = {"pending": list(pending.values()), "updated_at": utc_now_iso()}
    write_json(_state_path(run_dir), state)
    return state


def enqueue_wakeup(run_dir: Path, request: WakeupRequest) -> str:
    queue_path = _queue_path(run_dir)
    state = load_wakeup_state(run_dir)
    pending = state.get("pending")
    if isinstance(pending, list) and request.coalesce_key:
        for item in pending:
            if (
                item.get("coalesce_key") == request.coalesce_key
                and item.get("status") != "consumed"
            ):
                item["created_at"] = request.created_at
                item["payload"] = {**(item.get("payload") or {}), **request.payload}
                write_json(_state_path(run_dir), {"pending": pending, "updated_at": utc_now_iso()})
                return str(item["request_id"])
    payload = wakeup_request_payload(request)
    payload["status"] = "pending"
    _append_jsonl(queue_path, payload)
    reconcile_wakeup_state(run_dir)
    return request.request_id


def claim_next_ready(run_dir: Path) -> WakeupRequest | None:
    state = reconcile_wakeup_state(run_dir)
    pending = state.get("pending")
    if not isinstance(pending, list) or not pending:
        return None
    pending_sorted = sorted(
        pending, key=lambda item: (int(item.get("priority", 0)), item.get("created_at", ""))
    )
    raw = pending_sorted[0]
    request = parse_wakeup_request(raw)
    raw["status"] = "consumed"
    raw["consumed_at"] = utc_now_iso()
    _append_jsonl(_queue_path(run_dir), raw)
    reconcile_wakeup_state(run_dir)
    return request


def claim_next_human_wakeup_for_resume(run_dir: Path) -> dict[str, Any] | None:
    request = _claim_next_ready_by_reason(run_dir, "human")
    if request is None:
        return None
    interaction_id = request.payload.get("interaction_id")
    if not isinstance(interaction_id, str) or not interaction_id:
        raise AccError("Human wakeup requires payload.interaction_id")
    resume = resume_waiting_run(run_dir, reason="human", interaction_id=interaction_id)
    dispatch = None
    if (run_dir / "behavior_snapshot" / "workflow_function_template.json").exists():
        dispatch = asyncio.run(
            continue_persisted_run(
                run_dir,
                reason="human_wakeup",
                interaction_id=interaction_id,
                target_node_id=request.target_node_id,
            )
        )
    payload: dict[str, Any] = {
        "request_id": request.request_id,
        "reason": request.reason,
        "resume": resume.as_payload(),
    }
    if dispatch is not None:
        payload["dispatch"] = dispatch
    return payload


def _claim_next_ready_by_reason(run_dir: Path, reason: WakeupReason) -> WakeupRequest | None:
    state = reconcile_wakeup_state(run_dir)
    pending = state.get("pending")
    if not isinstance(pending, list) or not pending:
        return None
    matching = [
        item
        for item in pending
        if item.get("reason") == reason and item.get("status") != "consumed"
    ]
    if not matching:
        return None
    raw = sorted(
        matching,
        key=lambda item: (int(item.get("priority", 0)), item.get("created_at", "")),
    )[0]
    request = parse_wakeup_request(raw)
    raw["status"] = "consumed"
    raw["consumed_at"] = utc_now_iso()
    _append_jsonl(_queue_path(run_dir), raw)
    reconcile_wakeup_state(run_dir)
    return request


def new_wakeup_request(
    *,
    run_id: str,
    reason: WakeupReason,
    target_node_id: str | None = None,
    target_callable_ref: CallableRef | None = None,
    coalesce_key: str | None = None,
    priority: int = 0,
    payload: dict[str, Any] | None = None,
) -> WakeupRequest:
    return WakeupRequest(
        request_id=uuid4().hex,
        run_id=run_id,
        reason=reason,
        priority=priority,
        created_at=utc_now_iso(),
        target_node_id=target_node_id,
        target_callable_ref=target_callable_ref,
        coalesce_key=coalesce_key,
        payload=payload or {},
    )


def scan_session_health(
    manifest: dict[str, Any],
    *,
    now_iso: str,
    stale_after_seconds: int = DEFAULT_STALE_AFTER_SECONDS,
) -> str:
    status = str(manifest.get("status") or "unknown")
    if status in {"failed", "timeout", "adapter_error"}:
        return "failed"
    if status not in {"running", "created"}:
        return "healthy"
    last_event_at = manifest.get("last_event_at") or manifest.get("started_at")
    if not isinstance(last_event_at, str):
        return "unknown"
    try:
        from datetime import datetime

        last = datetime.fromisoformat(last_event_at.replace("Z", "+00:00"))
        now = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
        age = (now - last).total_seconds()
    except ValueError:
        return "unknown"
    threshold = int(manifest.get("stale_after_seconds") or stale_after_seconds)
    return "stale" if age > threshold else "healthy"


def apply_recovery_level(
    run_dir: Path,
    *,
    error_class: str,
    attempt: int,
    node_id: str,
) -> RecoveryLevel:
    manifest_path = run_dir / "workflow_run_manifest.json"
    recovery_state = {"node_id": node_id, "attempt": attempt, "error_class": error_class}
    if error_class in L1_RETRYABLE_ERRORS and attempt < 2:
        recovery_state["recovery_level"] = "L1"
        level: RecoveryLevel = "L1"
    elif attempt < 3:
        recovery_state["recovery_level"] = "L2"
        write_json(run_dir / "recovery_plan.json", recovery_state)
        level = "L2"
    else:
        recovery_state["recovery_level"] = "L3"
        write_json(run_dir / "recovery_plan.json", recovery_state)
        level = "L3"
    if manifest_path.exists():
        manifest = load_json(manifest_path)
        if isinstance(manifest, dict):
            manifest["recovery_state"] = recovery_state
            manifest["recovery_level"] = level
            write_json(manifest_path, manifest)
    return level


def pause_run_for_human_escalation(run_dir: Path) -> None:
    state_path = run_dir / "run_summary.json"
    if state_path.exists():
        summary = load_json(state_path)
        if isinstance(summary, dict):
            summary["status"] = "waiting_interaction"
            write_json(state_path, summary)


def require_ready_queue_enabled() -> None:
    if not use_ready_queue():
        raise AccError("Ready queue is disabled; set ACC_USE_READY_QUEUE=1")
