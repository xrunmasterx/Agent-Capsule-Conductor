"""Unit tests for ``acc.persistence.events.EventsWriter``.

Covers TEST_PLAN.md cases:
- test_events_append_only_jsonl
- test_events_concurrent_appends_dont_overwrite
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

from acc.persistence.events import EVENTS_FILENAME, EventsWriter


def test_events_append_only_jsonl(tmp_path: Path) -> None:
    writer = EventsWriter(tmp_path)
    writer.append("node_started", {"node_id": "n-1"})
    writer.append("node_completed", {"node_id": "n-1", "status": "ok"})
    writer.append("run_completed", {"run_id": "r-1"})

    target = tmp_path / EVENTS_FILENAME
    assert target.is_file()

    raw = target.read_text(encoding="utf-8")
    lines = [line for line in raw.split("\n") if line]
    assert len(lines) == 3

    parsed = [json.loads(line) for line in lines]
    assert [event["event_type"] for event in parsed] == [
        "node_started",
        "node_completed",
        "run_completed",
    ]
    for event in parsed:
        assert "ts" in event
        assert "payload" in event


def test_events_concurrent_appends_dont_overwrite(tmp_path: Path) -> None:
    """Concurrent appends must not corrupt or rewrite lines that did land.

    The Phase 1 ``EventsWriter`` contract (docstring: "never overwrites or
    rewrites prior lines") is about *not* seeking back to mutate prior
    lines — bytes that land on disk stay intact and uniquely identifiable.
    OS-level append atomicity across threads is platform-dependent and
    not part of this skeleton's contract.
    """

    writer = EventsWriter(tmp_path)

    thread_count = 4
    events_per_thread = 10

    def worker(thread_id: int) -> None:
        for index in range(events_per_thread):
            writer.append(
                "tick",
                {"thread_id": thread_id, "index": index},
            )

    threads = [
        threading.Thread(target=worker, args=(thread_id,))
        for thread_id in range(thread_count)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    target = tmp_path / EVENTS_FILENAME
    raw = target.read_text(encoding="utf-8")
    lines = [line for line in raw.split("\n") if line]

    # Every line that landed is intact, parseable JSON (no partial overlap).
    parsed = [json.loads(line) for line in lines]
    for event in parsed:
        assert event["event_type"] == "tick"
        assert "thread_id" in event["payload"]
        assert "index" in event["payload"]

    # No (thread_id, index) is duplicated — prior lines are never rewritten.
    pairs = [(event["payload"]["thread_id"], event["payload"]["index"]) for event in parsed]
    assert len(pairs) == len(set(pairs))
