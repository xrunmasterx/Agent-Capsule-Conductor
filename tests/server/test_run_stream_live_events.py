from __future__ import annotations

import json
import re

from acc.server.live_events import STREAM_NODE_LOG_TAIL_BYTES, LiveEventProjectionService
from tests.server.test_live_event_projection_service import _write_terminal_agent_run


def _payloads(frames: list[str], event_name: str) -> list[dict]:
    pattern = re.compile(rf"event: {re.escape(event_name)}\ndata: (.*?)\n\n", re.DOTALL)
    payloads: list[dict] = []
    for frame in frames:
        payloads.extend(json.loads(match) for match in pattern.findall(frame))
    return payloads


def test_live_event_projection_full_history_large_log_does_not_skip_tail(project_root) -> None:
    large_log = "x" * (STREAM_NODE_LOG_TAIL_BYTES + 32)
    run_dir = _write_terminal_agent_run(
        project_root,
        run_id="large_full_history_run",
        stdout_text=large_log,
    )

    service = LiveEventProjectionService(run_dir, history="full")
    frames = service.initial_history_frames(after_seq=0)

    node_log_payloads = _payloads(frames, "node_log_delta")
    assert "".join(str(payload.get("text") or "") for payload in node_log_payloads) == large_log


def test_live_event_projection_reconnect_history_none_after_seq_emits_new_event(
    project_root,
) -> None:
    run_dir = _write_terminal_agent_run(project_root, run_id="reconnect_run")
    node_dir = run_dir / "nodes" / "agent"
    service = LiveEventProjectionService(run_dir, history="none")

    assert service.initial_history_frames(after_seq=2) == []
    (node_dir / "stdout.log").write_text("hello live\nnew live\n", encoding="utf-8")

    frames = service.live_frames(after_seq=2)
    live_events = _payloads(frames, "live_event")

    assert live_events
    assert live_events[0]["seq"] == 3
    assert "new live" in live_events[0]["text"]
