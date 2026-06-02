"""Pure ready-set computation for control-edge DAGs.

Phase 1 deliverable for PR-1.9 in
docs/codex_goal_workflow_message_routing/IMPLEMENTATION_STRATEGY.md
§6.1. The function is intentionally pure and side-effect free; it does
not import any acc.app / acc.runtime / acc.server / acc.store
primitives so the import-linter contracts (R-scheduler purity, AUDIT
L-010) hold.

Complexity contract: O(|control_edges| + |graph_nodes|) (AUDIT P-001).
"""

from __future__ import annotations

from collections.abc import Iterable


def compute_ready_set(
    graph_nodes: set[str],
    control_edges: list[tuple[str, str]],
    completed: set[str],
) -> set[str]:
    """Return nodes whose control-edge senders are all in ``completed``.

    A node ``n`` is ready iff:

    * ``n`` is a member of ``graph_nodes``,
    * ``n`` is not itself in ``completed``,
    * every ``(sender, n)`` control edge has ``sender in completed``.

    Pure function. Runs in O(|control_edges| + |graph_nodes|).
    """
    pending_predecessors: dict[str, int] = {node: 0 for node in graph_nodes}
    for sender, receiver in control_edges:
        if receiver not in pending_predecessors:
            continue
        if sender in completed:
            continue
        pending_predecessors[receiver] += 1

    ready: set[str] = set()
    for node, missing in pending_predecessors.items():
        if node in completed:
            continue
        if missing == 0:
            ready.add(node)
    return ready


class DAGScheduler:
    """Phase 3 placeholder — see STRATEGY §6.3 L388.

    The Phase 1 scheduling loop continues to live in
    ``acc/app/__init__.py``; this class exists only to lock the public
    name and the package boundary.
    """

    def __init__(self, *args: object, **kwargs: object) -> None:  # noqa: D401
        raise NotImplementedError("DAGScheduler is a Phase 3 deliverable")


class ApprovalBarrier:
    """Phase 3 placeholder — see STRATEGY §6.3 L388."""

    def __init__(self, *args: object, **kwargs: object) -> None:  # noqa: D401
        raise NotImplementedError("ApprovalBarrier is a Phase 3 deliverable")


# Re-export hints for type-checkers / linters that walk public names.
_PUBLIC: Iterable[str] = ("compute_ready_set", "DAGScheduler", "ApprovalBarrier")
