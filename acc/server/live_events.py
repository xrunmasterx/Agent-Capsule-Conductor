from __future__ import annotations

import asyncio
import json
from collections import deque
from contextlib import suppress
from typing import Any

from acc.agent_events import ensure_agent_event_projection
from acc.session import utc_now_iso

MAX_QUEUE_EVENTS = 256


class WorkbenchLiveBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}
        self._next_seq: dict[str, int] = {}

    def next_seq(self, stream_key: str) -> int:
        seq = self._next_seq.get(stream_key, 0) + 1
        self._next_seq[stream_key] = seq
        return seq

    def ensure_min_seq(self, stream_key: str, seq: int) -> None:
        self._next_seq[stream_key] = max(self._next_seq.get(stream_key, 0), seq)

    def publish(self, stream_key: str, event: dict[str, Any]) -> None:
        subscribers = self._subscribers.get(stream_key)
        if not subscribers:
            return
        for queue in list(subscribers):
            if queue.full():
                drop_queue_head(queue)
                gap_event = {
                    "event_id": f"gap_{stream_key}_{self.next_seq(stream_key)}",
                    "seq": self._next_seq[stream_key],
                    "source": event.get("source") or "agent_turn",
                    "run_id": event.get("run_id"),
                    "node_id": event.get("node_id"),
                    "ui_node_id": event.get("ui_node_id"),
                    "parent_node_id": event.get("parent_node_id"),
                    "node_run_dir": event.get("node_run_dir"),
                    "session_id": event.get("session_id"),
                    "turn_id": event.get("turn_id"),
                    "type": "gap",
                    "stream": "agent",
                    "payload": {"reason": "live queue overflow"},
                    "timestamp": utc_now_iso(),
                }
                put_bounded(queue, gap_event)
                if queue.full():
                    continue
            put_bounded(queue, event)

    async def subscribe(self, stream_key: str, max_queue_events: int = MAX_QUEUE_EVENTS):
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=max_queue_events)
        self._subscribers.setdefault(stream_key, set()).add(queue)
        try:
            yield queue
        finally:
            subscribers = self._subscribers.get(stream_key)
            if subscribers is not None:
                subscribers.discard(queue)
                if not subscribers:
                    self._subscribers.pop(stream_key, None)


def sse_event(event_name: str, payload: dict[str, Any]) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def agent_turn_stream_key(session_id: str, turn_id: str) -> str:
    return f"agent_turn:{session_id}:{turn_id}"


def replay_events_after_seq(events: list[dict[str, Any]], after_seq: int) -> list[dict[str, Any]]:
    bounded: deque[dict[str, Any]] = deque(maxlen=500)
    for event in events:
        if int(event.get("seq") or 0) > after_seq:
            bounded.append(event)
    return list(bounded)


def put_bounded(queue: asyncio.Queue[dict[str, Any]], event: dict[str, Any]) -> None:
    while queue.full():
        drop_queue_head(queue)
    queue.put_nowait(event)


def drop_queue_head(queue: asyncio.Queue[dict[str, Any]]) -> None:
    with suppress(asyncio.QueueEmpty):
        queue.get_nowait()


def live_event_from_node_log(payload: dict[str, Any], seq: int) -> dict[str, Any]:
    event_id = (
        f"live_{payload.get('run_id')}_{payload.get('node_id')}_"
        f"{payload.get('stream')}_{seq}"
    )
    return {
        "event_id": event_id,
        "seq": seq,
        "source": "run_node",
        "run_id": payload.get("run_id"),
        "node_id": payload.get("node_id"),
        "ui_node_id": payload.get("ui_node_id"),
        "parent_node_id": payload.get("parent_node_id"),
        "node_run_dir": payload.get("node_run_dir"),
        "type": "node_log_delta",
        "stream": payload.get("stream"),
        "text": payload.get("text") or "",
        "payload": {
            "offset": payload.get("offset"),
            "next_offset": payload.get("next_offset"),
        },
        "timestamp": payload.get("timestamp") or utc_now_iso(),
    }


def live_event_from_agent_event(
    payload: dict[str, Any],
    seq: int,
    *,
    source: str,
) -> dict[str, Any]:
    projected_payload = ensure_agent_event_projection(payload)
    event_type = str(projected_payload.get("type") or projected_payload.get("event") or "agent_event")
    event_payload = (
        projected_payload.get("payload")
        if isinstance(projected_payload.get("payload"), dict)
        else {}
    )
    text = ""
    if event_type in {"agent_message", "agent_message_delta"}:
        content = event_payload.get("content")
        if not isinstance(content, str) and event_type == "agent_message_delta":
            content = event_payload.get("delta")
        text = content if isinstance(content, str) else ""
    event_id = (
        projected_payload.get("event_id")
        or f"live_{projected_payload.get('session_id')}_{projected_payload.get('turn_id')}_{seq}"
    )
    return {
        "event_id": str(event_id),
        "seq": seq,
        "event_seq": projected_payload.get("event_seq"),
        "source": source,
        "run_id": projected_payload.get("run_id"),
        "node_id": projected_payload.get("node_id"),
        "ui_node_id": projected_payload.get("ui_node_id"),
        "parent_node_id": projected_payload.get("parent_node_id"),
        "node_run_dir": projected_payload.get("node_run_dir"),
        "session_id": projected_payload.get("session_id") or projected_payload.get("agent_session_id"),
        "turn_id": projected_payload.get("turn_id") or projected_payload.get("agent_turn_id"),
        "type": event_type if event_type.startswith("agent_") else "agent_event",
        "stream": "agent",
        "text": text,
        "payload": event_payload,
        "projection": projected_payload.get("projection"),
        "timestamp": projected_payload.get("timestamp") or utc_now_iso(),
    }
