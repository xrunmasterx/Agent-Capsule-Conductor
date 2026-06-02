"""acc.binding — explicit binding model (Phase 1 skeleton).

Public API surfaced from this package is gated by import-linter contract R1
(see .importlinter / tests/architecture/test_import_boundaries.py): this
package may NOT import acc.app, acc.server, acc.cli, acc.scheduler,
acc.runtime, acc.adapters, fastapi, or typer.

DESIGN anchor: DESIGN.md §7 (Binding Model), §7.2 (ProvenanceObject).
STRATEGY anchor: IMPLEMENTATION_STRATEGY.md §6.1 PR-1.2 / PR-1.4.
"""
from __future__ import annotations

from acc.binding.provenance import ProvenanceObject
from acc.binding.selector import (
    ArtifactSelector,
    EachOfSelector,
    FieldSelector,
    OutboxSelector,
    Selector,
    SelectorParseError,
    parse_selector,
)

__all__ = [
    "ArtifactSelector",
    "EachOfSelector",
    "FieldSelector",
    "OutboxSelector",
    "ProvenanceObject",
    "Selector",
    "SelectorParseError",
    "parse_selector",
]
