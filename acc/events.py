from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import uuid4

from acc.session import utc_now_iso

EVENT_PAYLOAD_MAX_BYTES = 4096
LOG_EXCERPT_MAX_CHARS = 2048
_HEAVY_PAYLOAD_KEYS = frozenset(
    {"stdout", "stderr", "text", "content", "transcript", "output", "body", "log"}
)


def sanitize_event_payload(
    payload: dict[str, Any] | None,
    *,
    log_ref: str | None = None,
) -> dict[str, Any]:
    """Keep timeline events small; large text belongs in log artifacts (REQ-A5-001)."""
    if not payload:
        return {}
    sanitized: dict[str, Any] = {}
    for key, value in payload.items():
        if key in _HEAVY_PAYLOAD_KEYS and isinstance(value, str):
            excerpt = _truncate_text(value, LOG_EXCERPT_MAX_CHARS)
            sanitized["summary"] = sanitized.get("summary") or excerpt[:240]
            sanitized["excerpt"] = excerpt
            if log_ref:
                sanitized["log_ref"] = log_ref
            continue
        if isinstance(value, str) and len(value.encode("utf-8")) > LOG_EXCERPT_MAX_CHARS:
            sanitized[key] = _truncate_text(value, LOG_EXCERPT_MAX_CHARS)
            sanitized.setdefault("summary", sanitized[key][:240])
            continue
        sanitized[key] = value
    if log_ref and "log_ref" not in sanitized:
        sanitized["log_ref"] = log_ref
    encoded = json.dumps(sanitized, ensure_ascii=False).encode("utf-8")
    if len(encoded) <= EVENT_PAYLOAD_MAX_BYTES:
        return sanitized
    compact = {
        "summary": str(sanitized.get("summary") or "")[:240],
        "excerpt": _truncate_text(json.dumps(sanitized, ensure_ascii=False), LOG_EXCERPT_MAX_CHARS),
    }
    if log_ref:
        compact["log_ref"] = log_ref
    return compact


def _truncate_text(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + "\n... [truncated]"


def cap_event_record(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("payload")
    if isinstance(payload, dict):
        capped = dict(event)
        capped["payload"] = sanitize_event_payload(payload, log_ref=payload.get("log_ref"))
        return capped
    return event


class JsonlEventEmitter:
    def __init__(
        self,
        event_log_path: Path,
        *,
        workflow_run_id: str | None = None,
        session_id: str | None = None,
        node_id: str | None = None,
    ) -> None:
        self.event_log_path = event_log_path
        self.workflow_run_id = workflow_run_id
        self.session_id = session_id
        self.node_id = node_id

    def emit(
        self,
        event_type: str,
        *,
        status: str | None = None,
        level: int | None = None,
        payload: dict[str, Any] | None = None,
        workflow_run_id: str | None = None,
        session_id: str | None = None,
        node_id: str | None = None,
    ) -> dict[str, Any]:
        event = {
            "event_id": f"event_{uuid4().hex}",
            "type": event_type,
            "timestamp": utc_now_iso(),
            "payload": payload or {},
        }
        resolved_workflow_run_id = workflow_run_id or self.workflow_run_id
        resolved_session_id = session_id or self.session_id
        resolved_node_id = node_id or self.node_id
        if resolved_workflow_run_id is not None:
            event["workflow_run_id"] = resolved_workflow_run_id
        if resolved_session_id is not None:
            event["session_id"] = resolved_session_id
        if resolved_node_id is not None:
            event["node_id"] = resolved_node_id
        if level is not None:
            event["level"] = level
        if status is not None:
            event["status"] = status

        event["payload"] = sanitize_event_payload(
            event.get("payload") if isinstance(event.get("payload"), dict) else {},
            log_ref=_default_log_ref(self.event_log_path),
        )
        self.event_log_path.parent.mkdir(parents=True, exist_ok=True)
        with self.event_log_path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
        return event


def _default_log_ref(event_log_path: Path) -> str | None:
    run_dir = event_log_path.parent
    stdout = run_dir / "stdout.log"
    if stdout.exists():
        return str(stdout.resolve())
    return None


class SessionEventEmitter(JsonlEventEmitter):
    pass


class WorkflowEventEmitter(JsonlEventEmitter):
    pass


def iter_jsonl_events(event_log_path: Path) -> Iterator[dict[str, Any]]:
    if not event_log_path.exists():
        return
    with event_log_path.open(encoding="utf-8") as file:
        for line in file:
            if not line.strip():
                continue
            payload = json.loads(line)
            if isinstance(payload, dict):
                yield payload


def read_jsonl_events(event_log_path: Path) -> list[dict[str, Any]]:
    return list(iter_jsonl_events(event_log_path))
