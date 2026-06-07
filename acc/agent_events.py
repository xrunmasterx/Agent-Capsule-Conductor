from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from acc.session import utc_now_iso

AGENT_EVENT_TYPES = frozenset(
    {
        "agent_turn_started",
        "agent_status",
        "agent_message",
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
    event = {
        "event_id": f"agent_event_{timestamp}_{event_type}",
        "timestamp": timestamp,
        "type": event_type,
        "run_id": run_id,
        "node_id": node_id,
        "session_id": session_id,
        "turn_id": turn_id,
        "payload": payload or {},
    }
    event_log_path.parent.mkdir(parents=True, exist_ok=True)
    with event_log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
    return event


def append_provider_event(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")
