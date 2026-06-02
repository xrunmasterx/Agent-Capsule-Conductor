"""ResultStore value types and identifier NewTypes.

Phase 1 substrate per docs/codex_goal_workflow_message_routing/
IMPLEMENTATION_STRATEGY.md §4.4 / §5.2 / §6.1 PR-1.3 and DESIGN.md §13
(ResultStore (run_id, node_id, port_id) addressing — AUDIT C-012).

The dataclasses defined here describe per-(run_id, node_id, port_id)
storage records. They are intentionally distinct from
``acc.domain.ArtifactBundle`` (which is a per-node domain artifact bundle):
the storage-level bundle here records sha256/size/materialization for a
single port, while the domain-level one tracks node-wide outputs and
provenance.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import NewType

RunId = NewType("RunId", str)
NodeId = NewType("NodeId", str)
PortId = NewType("PortId", str)


@dataclass(frozen=True)
class ArtifactBundle:
    """Storage-level descriptor for a single port output."""

    bundle_id: str
    relative_path: str  # relative to runs/<run_id>/
    sha256: str
    size_bytes: int
    materialization_mode: str  # "inline" | "reference"


@dataclass(frozen=True)
class NodeResult:
    """Per-port result record stored under a single run."""

    run_id: RunId
    node_id: NodeId
    port_id: PortId
    bundle: ArtifactBundle
    inline_value: bytes | None
    produced_at: str


class MissingNodeResultError(LookupError):
    """Raised when a caller demands a NodeResult that is absent.

    ``FilesystemResultStore.get`` returns ``None`` on miss; callers that
    need fail-fast semantics raise this explicitly.
    """
