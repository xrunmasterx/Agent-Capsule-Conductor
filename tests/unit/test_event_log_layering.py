from __future__ import annotations

import json
from pathlib import Path

from acc.events import EVENT_PAYLOAD_MAX_BYTES, JsonlEventEmitter, sanitize_event_payload


def test_sanitize_event_payload_truncates_heavy_text() -> None:
    payload = sanitize_event_payload({"stdout": "x" * 10_000})
    assert "stdout" not in payload
    assert "excerpt" in payload
    assert len(json.dumps(payload).encode("utf-8")) <= EVENT_PAYLOAD_MAX_BYTES


def test_jsonl_event_line_stays_small(tmp_path: Path) -> None:
    log_path = tmp_path / "events.jsonl"
    emitter = JsonlEventEmitter(log_path, session_id="sess_test")
    emitter.emit("adapter_output", payload={"stdout": "line\n" * 5000})
    line = log_path.read_text(encoding="utf-8").strip()
    assert len(line.encode("utf-8")) < EVENT_PAYLOAD_MAX_BYTES + 512
