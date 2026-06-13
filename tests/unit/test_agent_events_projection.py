from __future__ import annotations

import json
from pathlib import Path

from acc.agent_events import append_agent_event, ensure_agent_event_projection
from acc.server.live_events import live_event_from_agent_event


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def test_append_agent_event_writes_transcript_projection_and_event_seq(tmp_path: Path) -> None:
    event_log = tmp_path / "events.jsonl"

    first = append_agent_event(
        event_log,
        "agent_message_delta",
        session_id="session_1",
        turn_id="turn_1",
        payload={"delta": "hello", "item_id": "msg_1"},
    )
    second = append_agent_event(
        event_log,
        "agent_turn_failed",
        session_id="session_1",
        turn_id="turn_1",
        payload={"error": "bad output"},
    )

    assert first["event_seq"] == 1
    assert second["event_seq"] == 2
    assert first["projection"] == {
        "schema_version": "acc.transcript_projection.v1",
        "visibility": "primary",
        "category": "assistant_text",
        "severity": "info",
        "display_kind": "assistant_text",
        "source": "computed",
        "summary": "hello",
        "item_id": "msg_1",
    }
    assert second["projection"]["visibility"] == "primary"
    assert second["projection"]["category"] == "error"
    assert second["projection"]["severity"] == "error"
    assert [event["event_seq"] for event in read_jsonl(event_log)] == [1, 2]


def test_legacy_agent_event_projection_is_computed_without_rewrite(tmp_path: Path) -> None:
    event_log = tmp_path / "events.jsonl"
    legacy_event = {
        "event_id": "evt_legacy",
        "type": "agent_status",
        "session_id": "session_1",
        "turn_id": "turn_1",
        "payload": {"method": "response.output_item.added", "item_type": "reasoning"},
    }
    event_log.write_text(json.dumps(legacy_event) + "\n", encoding="utf-8")

    projected = ensure_agent_event_projection(legacy_event, fallback_event_seq=1)
    live_event = live_event_from_agent_event(legacy_event, 7, source="assistant_turn")

    assert projected["event_seq"] == 1
    assert projected["projection"]["source"] == "computed_legacy"
    assert projected["projection"]["visibility"] == "hidden"
    assert projected["projection"]["category"] == "provider"
    assert live_event["seq"] == 7
    assert live_event["event_seq"] is None
    assert live_event["projection"]["source"] == "computed_legacy"
    assert read_jsonl(event_log) == [legacy_event]


def test_projection_summary_does_not_store_raw_provider_frame(tmp_path: Path) -> None:
    event_log = tmp_path / "events.jsonl"
    raw_frame = '{"jsonrpc":"2.0","method":"item/updated","params":{"text":"secret"}}'

    event = append_agent_event(
        event_log,
        "agent_status",
        session_id="session_1",
        turn_id="turn_1",
        payload={"status": raw_frame},
    )

    assert event["projection"]["visibility"] == "technical"
    assert "summary" not in event["projection"]
