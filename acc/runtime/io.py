"""Payload serialization and event I/O helpers.

Extracted from the God Module core_v2_runtime.py.
Pure synchronous helpers (no async, no heavy dependencies).
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from acc.models import (
    ArtifactBundle,
    EventRecord,
    FailureRecord,
    FunctionInvocation,
    RunRecord,
    ScopeFrame,
    SessionInstance,
)
from acc.session import utc_now_iso
from acc.storage import append_jsonl_locked


def function_invocation_payload(invocation: FunctionInvocation) -> dict[str, Any]:
    return asdict(invocation)


def scope_frame_payload(scope: ScopeFrame) -> dict[str, Any]:
    payload = asdict(scope)
    for key in (
        "workspace_root",
        "environment_root",
        "inbox_root",
        "outbox_root",
        "artifact_root",
        "behavior_snapshot_path",
        "binding_path",
    ):
        if payload[key] is not None:
            payload[key] = str(payload[key])
    return payload


def session_instance_payload(session: SessionInstance) -> dict[str, Any]:
    payload = asdict(session)
    payload["cwd"] = str(session.cwd)
    payload["input_path"] = str(session.input_path)
    payload["output_path"] = str(session.output_path)
    payload["artifact_dir"] = str(session.artifact_dir)
    payload["event_log_path"] = str(session.event_log_path)
    return payload


def artifact_bundle_payload(bundle: ArtifactBundle) -> dict[str, Any]:
    return asdict(bundle)


def run_record_payload(record: RunRecord) -> dict[str, Any]:
    payload = asdict(record)
    payload["event_log_path"] = str(record.event_log_path)
    payload["result_store_root"] = str(record.result_store_root)
    return payload


def event_record_payload(event: EventRecord) -> dict[str, Any]:
    return asdict(event)


def failure_record_payload(failure: FailureRecord) -> dict[str, Any]:
    payload = asdict(failure)
    payload["evidence_paths"] = [str(path) for path in failure.evidence_paths]
    return payload


def append_event(
    event_log_path: Path,
    run_id: str,
    event_type: str,
    *,
    node_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    timestamp = utc_now_iso()
    event = EventRecord(
        event_id=f"event_{timestamp}_{event_type}",
        run_id=run_id,
        type=event_type,
        timestamp=timestamp,
        node_id=node_id,
        payload=payload or {},
    )
    append_jsonl_locked(event_log_path, event_record_payload(event))


def append_runtime_error_to_stderr_log(path: Path, message: str) -> None:
    prefix = "\n" if path.exists() and path.stat().st_size > 0 else ""
    with path.open("a", encoding="utf-8") as file:
        file.write(f"{prefix}ACC runtime error: {message}\n")


def read_required_session_id(run_dir: Path, node_id: str) -> str:
    from acc.ledger_writer import ControlLedgerAuditError

    manifest_path = run_dir / "nodes" / node_id / "session_instance_manifest.json"
    if not manifest_path.exists():
        raise ControlLedgerAuditError(f"Session manifest missing for node {node_id}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    session_id = manifest.get("session_id") if isinstance(manifest, dict) else None
    if not isinstance(session_id, str) or not session_id:
        raise ControlLedgerAuditError(f"Session id missing for node {node_id}")
    return session_id


def read_required_artifact_bundle_id(run_dir: Path, node_id: str) -> str:
    from acc.ledger_writer import ControlLedgerAuditError

    bundle_path = run_dir / "nodes" / node_id / "artifact_bundle.json"
    if not bundle_path.exists():
        raise ControlLedgerAuditError(f"Artifact bundle missing for node {node_id}")
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    bundle_id = bundle.get("bundle_id") if isinstance(bundle, dict) else None
    if not isinstance(bundle_id, str) or not bundle_id:
        raise ControlLedgerAuditError(f"Artifact bundle id missing for node {node_id}")
    return bundle_id
