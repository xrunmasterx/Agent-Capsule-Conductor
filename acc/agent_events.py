from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from acc.session import utc_now_iso

TRANSCRIPT_PROJECTION_SCHEMA_VERSION = "acc.transcript_projection.v1"
MAX_PROJECTION_SUMMARY_LENGTH = 240

AGENT_EVENT_TYPES = frozenset(
    {
        "agent_turn_started",
        "agent_status",
        "agent_message",
        "agent_message_delta",
        "agent_tool_use",
        "agent_tool_result",
        "agent_approval_requested",
        "agent_usage",
        "agent_output_draft",
        "agent_output_published",
        "agent_turn_completed",
        "agent_turn_failed",
        "agent_turn_cancelled",
    }
)


def project_agent_event(
    event_type: str,
    payload: dict[str, Any],
    *,
    source: str = "computed",
) -> dict[str, Any]:
    projection = _base_projection(source=source)
    summary = _summary_from_payload(event_type, payload)
    if summary:
        projection["summary"] = summary
    projection.update(_projection_policy(event_type, payload))
    for key in ("item_id", "message_id", "tool_call_id", "parent_event_id"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            projection[key] = value
    return projection


def ensure_agent_event_projection(
    event: dict[str, Any],
    *,
    fallback_event_seq: int | None = None,
) -> dict[str, Any]:
    projected = dict(event)
    payload = projected.get("payload") if isinstance(projected.get("payload"), dict) else {}
    projection = projected.get("projection")
    if not _supported_projection(projection):
        event_type = str(projected.get("type") or projected.get("event") or "agent_event")
        projected["projection"] = project_agent_event(
            event_type,
            payload,
            source="computed_legacy",
        )
    if "event_seq" not in projected and fallback_event_seq is not None:
        projected["event_seq"] = fallback_event_seq
    return projected


def append_agent_event(
    event_log_path: Path,
    event_type: str,
    *,
    session_id: str,
    turn_id: str,
    run_id: str | None = None,
    node_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if event_type not in AGENT_EVENT_TYPES:
        raise ValueError(f"Unknown agent event type: {event_type}")
    timestamp = utc_now_iso()
    event_seq = next_agent_event_seq(event_log_path)
    event_payload = payload or {}
    event = {
        "event_id": f"agent_event_{timestamp}_{event_type}_{event_seq}",
        "event_seq": event_seq,
        "timestamp": timestamp,
        "type": event_type,
        "run_id": run_id,
        "node_id": node_id,
        "session_id": session_id,
        "turn_id": turn_id,
        "payload": event_payload,
        "projection": project_agent_event(event_type, event_payload),
    }
    event_log_path.parent.mkdir(parents=True, exist_ok=True)
    with event_log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
    return event


def append_provider_event(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")


def next_agent_event_seq(event_log_path: Path) -> int:
    if not event_log_path.exists():
        return 1
    max_seq = 0
    line_count = 0
    with event_log_path.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if not line.strip():
                continue
            line_count += 1
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(event, dict):
                continue
            seq = event.get("event_seq")
            if isinstance(seq, int):
                max_seq = max(max_seq, seq)
    return max(max_seq, line_count) + 1


def _base_projection(*, source: str) -> dict[str, Any]:
    return {
        "schema_version": TRANSCRIPT_PROJECTION_SCHEMA_VERSION,
        "visibility": "technical",
        "category": "status",
        "severity": "info",
        "display_kind": "status_pill",
        "source": source,
    }


def _projection_policy(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    if event_type == "agent_turn_started":
        return {"visibility": "hidden", "category": "status", "display_kind": "status_pill"}
    if event_type == "agent_status":
        category = "provider" if _looks_like_provider_status(payload) else "status"
        visibility = "hidden" if category == "provider" else "technical"
        return {"visibility": visibility, "category": category, "display_kind": "status_pill"}
    if event_type in {"agent_message", "agent_message_delta"}:
        return {
            "visibility": "primary",
            "category": "assistant_text",
            "display_kind": "assistant_text",
        }
    if event_type == "agent_tool_use":
        return {"visibility": "folded", "category": "tool", "display_kind": "tool_call"}
    if event_type == "agent_tool_result":
        return {"visibility": "folded", "category": "tool", "display_kind": "tool_result"}
    if event_type == "agent_approval_requested":
        return {
            "visibility": "primary",
            "category": "approval",
            "display_kind": "approval_request",
            "requires_action": True,
        }
    if event_type == "agent_usage":
        return {"visibility": "technical", "category": "usage", "display_kind": "usage"}
    if event_type == "agent_output_draft":
        visibility = "folded" if payload.get("proposal_ready") is True else "technical"
        return {"visibility": visibility, "category": "proposal", "display_kind": "artifact_link"}
    if event_type == "agent_output_published":
        return {"visibility": "folded", "category": "artifact", "display_kind": "artifact_link"}
    if event_type == "agent_turn_completed":
        return {"visibility": "hidden", "category": "status", "display_kind": "status_pill"}
    if event_type == "agent_turn_failed":
        return {
            "visibility": "primary",
            "category": "error",
            "severity": "error",
            "display_kind": "error_message",
        }
    if event_type == "agent_turn_cancelled":
        visibility = "primary" if payload.get("reason") or payload.get("error") else "hidden"
        return {
            "visibility": visibility,
            "category": "error" if visibility == "primary" else "status",
            "severity": "warning" if visibility == "primary" else "info",
            "display_kind": "error_message" if visibility == "primary" else "status_pill",
        }
    return {"visibility": "technical", "category": "status", "display_kind": "status_pill"}


def _summary_from_payload(event_type: str, payload: dict[str, Any]) -> str:
    if event_type in {"agent_message", "agent_message_delta"}:
        value = _string_value(payload.get("content")) or _string_value(payload.get("delta"))
    elif event_type == "agent_tool_use":
        value = _string_value(payload.get("tool")) or _string_value(payload.get("name"))
    elif event_type == "agent_tool_result":
        value = _string_value(payload.get("summary")) or _string_value(payload.get("status"))
    elif event_type in {"agent_turn_failed", "agent_turn_cancelled"}:
        value = (
            _string_value(payload.get("user_summary"))
            or _string_value(payload.get("error"))
            or _string_value(payload.get("reason"))
        )
    elif event_type in {"agent_output_draft", "agent_output_published"}:
        value = _string_value(payload.get("summary"))
    else:
        value = _string_value(payload.get("summary")) or _string_value(payload.get("status"))
    return _sanitize_summary(value)


def _sanitize_summary(value: str) -> str:
    text = " ".join(value.replace("\r", "\n").split())
    if not text:
        return ""
    if _looks_like_json_frame(text):
        return ""
    return text[:MAX_PROJECTION_SUMMARY_LENGTH]


def _looks_like_provider_status(payload: dict[str, Any]) -> bool:
    method = _string_value(payload.get("method"))
    item_type = _string_value(payload.get("item_type"))
    status = _string_value(payload.get("status"))
    return (
        method.startswith("item/")
        or method.startswith("turn/")
        or method.startswith("response.")
        or item_type in {"reasoning", "provider_status"}
        or status in {"reasoning_started", "reasoning_completed"}
    )


def _looks_like_json_frame(value: str) -> bool:
    if not (value.startswith("{") and value.endswith("}")):
        return False
    try:
        payload = json.loads(value)
    except json.JSONDecodeError:
        return False
    if not isinstance(payload, dict):
        return False
    method = _string_value(payload.get("method"))
    return method.startswith("item/") or method.startswith("turn/") or payload.get("jsonrpc") == "2.0"


def _supported_projection(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and value.get("schema_version") == TRANSCRIPT_PROJECTION_SCHEMA_VERSION
        and isinstance(value.get("visibility"), str)
        and isinstance(value.get("category"), str)
    )


def _string_value(value: Any) -> str:
    return value if isinstance(value, str) else ""
