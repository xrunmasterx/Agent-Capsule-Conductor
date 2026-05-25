from __future__ import annotations

from pathlib import Path

from acc.events import read_jsonl_events


def test_read_jsonl_events_streams_without_path_read_text(
    tmp_path: Path,
    monkeypatch,
) -> None:
    event_log = tmp_path / "events.jsonl"
    event_log.write_text('{"type":"one"}\n{"type":"two"}\n', encoding="utf-8")

    def fail_read_text(*_args, **_kwargs):
        raise AssertionError("read_text should not be used for JSONL streaming")

    monkeypatch.setattr(Path, "read_text", fail_read_text)

    payload = read_jsonl_events(event_log)

    assert [event["type"] for event in payload] == ["one", "two"]
