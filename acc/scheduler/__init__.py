"""acc.scheduler — Phase 1 scheduler skeleton.

Provides a pure `compute_ready_set` helper used to identify nodes whose
control-edge ancestors are all completed. The full DAGScheduler /
ApprovalBarrier are deferred to Phase 3 (see
docs/codex_goal_workflow_message_routing/IMPLEMENTATION_STRATEGY.md
§5.2 / §6.3) — the real scheduling loop in Phase 1 still lives in
`acc/app/__init__.py:534-575` and is intentionally left untouched
(STRATEGY §5.1 L252).

This module's Phase 1 purpose is to (a) stake out the package boundary
that the import-linter contracts in PR-1.8 enforce (R-runtime / R-app
purity rules) and (b) expose an O(|E|+|V|) ready-set primitive (AUDIT
P-001) for future consumers.
"""

from __future__ import annotations

from acc.scheduler.ready_set import (
    ApprovalBarrier,
    DAGScheduler,
    compute_ready_set,
)

__all__ = [
    "ApprovalBarrier",
    "DAGScheduler",
    "compute_ready_set",
]
