"""ResultStore module: (run_id, node_id, port_id) addressable storage.

Phase 1 substrate per docs/codex_goal_workflow_message_routing/
IMPLEMENTATION_STRATEGY.md §6.1 PR-1.3 and DESIGN.md §13.

Public API exported here is the only surface other ACC layers may import.
Layering contracts (R2 / AUDIT L-002) forbid acc.result_store from
importing acc.server, acc.cli, acc.app, fastapi, or typer.
"""

from __future__ import annotations

from acc.result_store.filesystem import FilesystemResultStore
from acc.result_store.types import (
    ArtifactBundle,
    MissingNodeResultError,
    NodeId,
    NodeResult,
    PortId,
    RunId,
)

__all__ = [
    "ArtifactBundle",
    "FilesystemResultStore",
    "MissingNodeResultError",
    "NodeId",
    "NodeResult",
    "PortId",
    "RunId",
]
