"""Persistence skeleton for Phase 1 substrate hardening.

DESIGN anchor: §11.2 (RunManifest checkpoint) + §13 Phase 1 deliverable.
STRATEGY anchor: §6.1 PR-1.1 (atomic_write + run_manifest skeleton) and
PR-1.13 (cache_key producer).

This package only owns persistence primitives and is forbidden from
importing acc.app / acc.server / acc.cli / acc.runtime / acc.adapters
(import-linter contract L-009).
"""

from __future__ import annotations

from acc.persistence.cache_key import compute_cache_key
from acc.persistence.events import EventsWriter
from acc.persistence.manifest import (
    ManifestCorruptError,
    RunManifest,
    read,
    write_atomic,
)

__all__ = [
    "EventsWriter",
    "ManifestCorruptError",
    "RunManifest",
    "compute_cache_key",
    "read",
    "write_atomic",
]
