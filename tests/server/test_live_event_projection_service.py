from __future__ import annotations

import asyncio
import json
from pathlib import Path

from acc.server.live_events import LiveEventProjectionService, parse_sse_frame


class _DisconnectAfterFirstIdle:
    def __init__(self) -> None:
        self.calls = 0

    async def is_disconnected(self) -> bool:
        self.calls += 1
        return self.calls > 1


def _write_terminal_agent_run(
    project_root: Path,
    run_id: str = "live_projection_run",
    *,
    stdout_text: str = "hello live\n",
) -> Path:
    run_dir = project_root / "runs" / run_id
    node_dir = run_dir / "nodes" / "agent"
    session_dir = project_root / "runs" / "_agent_sessions" / run_id / "agent"
    turn_dir = session_dir / "turns" / "turn_1"
    node_dir.mkdir(parents=True, exist_ok=True)
    turn_dir.mkdir(parents=True, exist_ok=True)
    (node_dir / "stdout.log").write_text(stdout_text, encoding="utf-8")
    (node_dir / "runtime.json").write_text(
        json.dumps({"agent_session_ref": str(session_dir.resolve()), "turn_id": "turn_1"}),
        encoding="utf-8",
    )
    (turn_dir / "events.jsonl").write_text(
        json.dumps(
            {
                "event_id": "agent_evt_1",
                "type": "agent_message",
                "timestamp": "2026-06-22T00:00:00Z",
                "session_id": "session_1",
                "turn_id": "turn_1",
                "payload": {"content": "projected"},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": run_id,
                "status": "running",
                "run_dir": str(run_dir.resolve()),
                "node_count": 1,
                "nodes": [],
            }
        ),
        encoding="utf-8",
    )
    return run_dir


def test_live_event_projection_service_assigns_stable_history_seq(project_root) -> None:
    run_dir = _write_terminal_agent_run(project_root)
    service = LiveEventProjectionService(run_dir, history="tail")

    frames = service.initial_history_frames(after_seq=0)
    live_events = [parse_sse_frame(frame) for frame in frames]
    live_events = [event for event in live_events if event is not None]

    assert live_events == []
    assert service.sequence == 2
    assert any("event: node_log_delta" in frame for frame in frames)
    assert any("event: agent_event" in frame for frame in frames)


def test_live_event_projection_service_filters_replayed_cursor(project_root) -> None:
    run_dir = _write_terminal_agent_run(project_root)
    service = LiveEventProjectionService(run_dir, history="tail")

    frames = service.initial_history_frames(after_seq=1)
    live_events = [parse_sse_frame(frame) for frame in frames]
    live_events = [event for event in live_events if event is not None]

    assert [event["seq"] for event in live_events] == [2]
    assert live_events[0]["type"] == "agent_message"


def test_live_event_projection_service_preserves_idle_heartbeat(project_root, monkeypatch) -> None:
    run_dir = project_root / "runs" / "idle_projection_run"
    run_dir.mkdir(parents=True, exist_ok=True)

    async def scenario() -> str:
        service = LiveEventProjectionService(run_dir, heartbeat_seconds=0.0)
        stream = service.stream_sse(_DisconnectAfterFirstIdle())
        return await stream.__anext__()

    frame = asyncio.run(scenario())

    assert frame.startswith(": heartbeat")
