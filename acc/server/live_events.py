from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from contextlib import suppress
from pathlib import Path
from typing import Any

from acc.agent_events import ensure_agent_event_projection
from acc.app.run_events import (
    RunEventProjectionService,
    read_jsonl_since_offset,
    read_jsonl_tail_with_offset,
)
from acc.run_status import is_terminal_run_status
from acc.session import utc_now_iso

MAX_QUEUE_EVENTS = 256
STREAM_HEARTBEAT_INTERVAL_SECONDS = 15.0
STREAM_AGENT_EVENT_BATCH_LIMIT = 200
STREAM_INITIAL_FRAME_BUDGET = 1000
STREAM_INITIAL_BYTE_BUDGET = 1024 * 1024
STREAM_NODE_LOG_TAIL_BYTES = 16 * 1024
STREAM_NODE_LOG_LIVE_BYTES = 64 * 1024
STREAM_AGENT_EVENT_TAIL_LIMIT = 200


class LiveEventProjectionService:
    """Transport-neutral projection for run live-event replay and cursor semantics."""

    def __init__(
        self,
        run_dir: Path,
        *,
        history: str = "none",
        tail_bytes: int = STREAM_NODE_LOG_TAIL_BYTES,
        tail_events: int = STREAM_AGENT_EVENT_TAIL_LIMIT,
        heartbeat_seconds: float = STREAM_HEARTBEAT_INTERVAL_SECONDS,
    ) -> None:
        self.run_dir = run_dir.resolve()
        self.run_id = self.run_dir.name
        self.history = history if history in {"none", "tail", "full"} else "none"
        self.tail_bytes = min(max(0, tail_bytes), STREAM_NODE_LOG_TAIL_BYTES)
        self.tail_events = min(max(0, tail_events), STREAM_AGENT_EVENT_TAIL_LIMIT)
        self.events = RunEventProjectionService(self.run_dir)
        self.heartbeat_seconds = heartbeat_seconds
        self.offsets: dict[tuple[str, str], int] = {}
        self.agent_event_offsets: dict[str, int] = {}
        self.agent_event_sequences: dict[str, int] = {}
        self.sequence = 0
        self.initial_frames = 0
        self.initial_bytes = 0
        self.budget_exhausted = False

    async def stream_sse(self, request: Any, *, after_seq: int = 0):
        after_seq = max(0, after_seq)
        last_emit_monotonic = time.monotonic()
        summary = self.terminal_summary()
        if self.history == "none":
            self.sequence = max(self.sequence, after_seq)
        if self.history == "none" and summary is not None:
            yield self.summary_frame(summary)
            return

        for frame in self.initial_history_frames(after_seq=after_seq):
            yield frame
            last_emit_monotonic = time.monotonic()

        if summary is not None:
            yield self.summary_frame(summary)
            return

        while not await request.is_disconnected():
            for frame in self.live_frames(after_seq=after_seq):
                yield frame
                last_emit_monotonic = time.monotonic()
            summary = self.terminal_summary()
            if summary is not None:
                yield self.summary_frame(summary)
                break
            if time.monotonic() - last_emit_monotonic >= self.heartbeat_seconds:
                yield ": heartbeat\n\n"
                last_emit_monotonic = time.monotonic()
            await asyncio.sleep(0.5)

    def initial_history_frames(self, *, after_seq: int = 0) -> list[str]:
        if self.history == "none":
            self.sequence = max(self.sequence, after_seq)
        frames: list[str] = []
        for node_identity in self.events.iter_node_identities():
            for stream_name in ("stdout", "stderr"):
                key = (node_identity.node_run_dir, stream_name)
                size = self.log_path_size(node_identity, stream_name)
                if self.history == "none":
                    self.offsets[key] = size
                    continue
                replay_offset = 0 if self.history == "full" else max(0, size - self.tail_bytes)
                replay_limit = (
                    STREAM_NODE_LOG_TAIL_BYTES if self.history == "full" else self.tail_bytes
                )
                if replay_limit <= 0:
                    self.offsets[key] = size
                    continue
                while True:
                    payload = self.events.read_node_log_delta_from_identity(
                        node_identity,
                        stream_name,
                        offset=replay_offset,
                        limit=max(1, replay_limit),
                    )
                    self.offsets[key] = int(payload["next_offset"])
                    if payload["text"]:
                        payload["timestamp"] = utc_now_iso()
                        frame = self.initial_frame("node_log_delta", payload)
                        if frame is not None:
                            frames.append(frame)
                        if not self.budget_exhausted:
                            live_event = live_event_from_node_log(payload, self.next_seq())
                            if after_seq > 0 and live_event["seq"] > after_seq:
                                frames.append(sse_event("live_event", live_event))
                    if self.history != "full" or payload.get("eof") or self.budget_exhausted:
                        break
                    replay_offset = int(payload["next_offset"])

            agent_event_log = self.events.resolve_agent_turn_event_log(node_identity.node_dir)
            if agent_event_log is None:
                continue
            agent_event_key = str(agent_event_log)
            if self.history == "none":
                self.agent_event_offsets[agent_event_key] = agent_event_log.stat().st_size
                self.agent_event_sequences[agent_event_key] = 0
                continue
            if self.history == "tail":
                events, _next_offset = read_jsonl_tail_with_offset(
                    agent_event_log,
                    limit=self.tail_events,
                )
            else:
                events, _next_offset = read_jsonl_since_offset(
                    agent_event_log,
                    0,
                    limit=self.tail_events,
                )
            for event_index, agent_event in enumerate(events, start=1):
                payload = self.events.project_agent_event(
                    agent_event,
                    node_identity,
                    fallback_event_seq=event_index,
                )
                frame = self.initial_frame("agent_event", payload)
                if frame is not None:
                    frames.append(frame)
                if not self.budget_exhausted:
                    live_event = live_event_from_agent_event(
                        payload,
                        self.next_seq(),
                        source="run_node",
                    )
                    if after_seq > 0 and live_event["seq"] > after_seq:
                        frames.append(sse_event("live_event", live_event))
            self.agent_event_offsets[agent_event_key] = agent_event_log.stat().st_size
            self.agent_event_sequences[agent_event_key] = len(events)
        return replay_events_after_seq_frames(frames, after_seq)

    def live_frames(self, *, after_seq: int = 0) -> list[str]:
        frames: list[str] = []
        for node_identity in self.events.iter_node_identities():
            for stream_name in ("stdout", "stderr"):
                key = (node_identity.node_run_dir, stream_name)
                payload = self.events.read_node_log_delta_from_identity(
                    node_identity,
                    stream_name,
                    offset=self.offsets.get(key, 0),
                    limit=STREAM_NODE_LOG_LIVE_BYTES,
                )
                self.offsets[key] = int(payload["next_offset"])
                if payload["text"]:
                    payload["timestamp"] = utc_now_iso()
                    frames.append(sse_event("node_log_delta", payload))
                    live_event = live_event_from_node_log(payload, self.next_seq())
                    if live_event["seq"] > after_seq:
                        frames.append(sse_event("live_event", live_event))

            agent_event_log = self.events.resolve_agent_turn_event_log(node_identity.node_dir)
            if agent_event_log is None:
                continue
            agent_event_key = str(agent_event_log)
            events, next_offset = read_jsonl_since_offset(
                agent_event_log,
                self.agent_event_offsets.get(agent_event_key, 0),
                limit=STREAM_AGENT_EVENT_BATCH_LIMIT,
            )
            next_event_sequence = self.agent_event_sequences.get(agent_event_key, 0)
            for event_index, agent_event in enumerate(events, start=next_event_sequence + 1):
                payload = self.events.project_agent_event(
                    agent_event,
                    node_identity,
                    fallback_event_seq=event_index,
                )
                frames.append(sse_event("agent_event", payload))
                live_event = live_event_from_agent_event(
                    payload,
                    self.next_seq(),
                    source="run_node",
                )
                if live_event["seq"] > after_seq:
                    frames.append(sse_event("live_event", live_event))
            self.agent_event_offsets[agent_event_key] = next_offset
            self.agent_event_sequences[agent_event_key] = next_event_sequence + len(events)
        return frames

    def live_events_after_seq(self, after_seq: int) -> list[dict[str, Any]]:
        live_events: list[dict[str, Any]] = []
        for frame in self.initial_history_frames(after_seq=after_seq):
            event = parse_sse_frame(frame)
            if event is not None and event.get("seq", 0) > after_seq:
                live_events.append(event)
        for frame in self.live_frames(after_seq=after_seq):
            event = parse_sse_frame(frame)
            if event is not None and event.get("seq", 0) > after_seq:
                live_events.append(event)
        return replay_events_after_seq(live_events, after_seq)

    def summary_frame(self, summary: dict[str, Any]) -> str:
        return sse_event(
            "summary",
            {"type": "summary", "run_id": self.run_id, "summary": summary},
        )

    def next_seq(self) -> int:
        self.sequence += 1
        return self.sequence

    def terminal_summary(self) -> dict[str, Any] | None:
        summary_path = self.run_dir / "run_summary.json"
        if not summary_path.exists():
            return None
        try:
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return None
        if isinstance(summary, dict) and is_terminal_run_status(summary.get("status")):
            return summary
        return None

    def log_path_size(self, node_identity: Any, stream_name: str) -> int:
        log_path = self.events.resolve_effective_log(node_identity.node_dir, stream_name)
        return log_path.stat().st_size if log_path.exists() and log_path.is_file() else 0

    def initial_frame(self, event_name: str, payload: dict[str, Any]) -> str | None:
        if self.budget_exhausted:
            return None
        frame = sse_event(event_name, payload)
        frame_bytes = len(frame.encode("utf-8", errors="replace"))
        if (
            self.initial_frames + 1 > STREAM_INITIAL_FRAME_BUDGET
            or self.initial_bytes + frame_bytes > STREAM_INITIAL_BYTE_BUDGET
        ):
            self.budget_exhausted = True
            diagnostic = {
                "type": "stream_budget_exhausted",
                "run_id": self.run_id,
                "history": self.history,
                "frames": self.initial_frames,
                "bytes": self.initial_bytes,
                "frame_budget": STREAM_INITIAL_FRAME_BUDGET,
                "byte_budget": STREAM_INITIAL_BYTE_BUDGET,
            }
            return sse_event("stream_budget_exhausted", diagnostic)
        self.initial_frames += 1
        self.initial_bytes += frame_bytes
        return frame


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


def replay_events_after_seq_frames(frames: list[str], after_seq: int) -> list[str]:
    if after_seq <= 0:
        return frames
    filtered: list[str] = []
    for frame in frames:
        event = parse_sse_frame(frame)
        if event is None:
            filtered.append(frame)
            continue
        if int(event.get("seq") or 0) > after_seq:
            filtered.append(frame)
    return filtered


def parse_sse_frame(frame: str) -> dict[str, Any] | None:
    if "event: live_event" not in frame:
        return None
    for line in frame.splitlines():
        if not line.startswith("data: "):
            continue
        try:
            payload = json.loads(line.removeprefix("data: "))
        except json.JSONDecodeError:
            return None
        return payload if isinstance(payload, dict) else None
    return None


def put_bounded(queue: asyncio.Queue[dict[str, Any]], event: dict[str, Any]) -> None:
    while queue.full():
        drop_queue_head(queue)
    queue.put_nowait(event)


def drop_queue_head(queue: asyncio.Queue[dict[str, Any]]) -> None:
    with suppress(asyncio.QueueEmpty):
        queue.get_nowait()


def live_event_from_node_log(payload: dict[str, Any], seq: int) -> dict[str, Any]:
    event_id = (
        f"live_{payload.get('run_id')}_{payload.get('node_id')}_{payload.get('stream')}_{seq}"
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
    event_type = str(
        projected_payload.get("type") or projected_payload.get("event") or "agent_event"
    )
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
        "session_id": projected_payload.get("session_id")
        or projected_payload.get("agent_session_id"),
        "turn_id": projected_payload.get("turn_id") or projected_payload.get("agent_turn_id"),
        "type": event_type if event_type.startswith("agent_") else "agent_event",
        "stream": "agent",
        "text": text,
        "payload": event_payload,
        "projection": projected_payload.get("projection"),
        "timestamp": projected_payload.get("timestamp") or utc_now_iso(),
    }
