"""Append-only ``events.jsonl`` writer.

DESIGN anchor: §11.1 / §11.2 (events.jsonl as the durable, append-only
event log) and §13 Phase 1 (runtime-only metadata never enters
``input.json`` / ``resolved_prompt.md``).
STRATEGY anchor: §6.1 PR-1.1.

Phase 1 owns the primitive only. Higher layers (acc.app, acc.runtime)
will adopt it incrementally; this module never imports them
(import-linter contract L-009).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

EVENTS_FILENAME = "events.jsonl"


class EventsWriter:
    """Append-only JSON-lines writer for run-scoped events.

    Each call to :meth:`append` writes exactly one line of the form
    ``{"ts": ..., "event_type": ..., "payload": ...}`` and flushes the
    OS buffer. The writer never overwrites or rewrites prior lines.
    """

    def __init__(self, run_dir: Path) -> None:
        self._path = run_dir / EVENTS_FILENAME
        run_dir.mkdir(parents=True, exist_ok=True)

    @property
    def path(self) -> Path:
        return self._path

    def append(self, event_type: str, payload: dict[str, Any]) -> None:
        record = {
            "ts": datetime.now(UTC).isoformat(),
            "event_type": event_type,
            "payload": payload,
        }
        line = json.dumps(record, ensure_ascii=False, sort_keys=True)
        with self._path.open("a", encoding="utf-8") as handle:
            handle.write(line)
            handle.write("\n")
            handle.flush()
