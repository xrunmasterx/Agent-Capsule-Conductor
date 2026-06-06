"""Pure ready-set and ready-queue scheduling for control-edge DAGs.

This module intentionally stays side-effect free. It does not import app,
runtime, server, or store primitives; runtime code owns dispatch and evidence
writing.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field


def compute_ready_set(
    graph_nodes: set[str],
    control_edges: list[tuple[str, str]],
    completed: set[str],
) -> set[str]:
    """Return nodes whose control-edge senders are all in ``completed``."""
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


@dataclass
class DAGScheduler:
    """Pure ready-queue state machine for a control-edge DAG.

    The scheduler owns only in-memory dependency state. It does not dispatch
    callables, write evidence, or know anything about the filesystem. Runtime
    code records the returned transitions in the control ledger.
    """

    node_order: tuple[str, ...]
    dependencies: Mapping[str, tuple[str, ...]]
    successors: dict[str, tuple[str, ...]] = field(init=False)
    statuses: dict[str, str] = field(init=False)

    def __post_init__(self) -> None:
        known = set(self.node_order)
        self.statuses = {node_id: "pending" for node_id in self.node_order}
        successors: dict[str, list[str]] = {node_id: [] for node_id in self.node_order}
        for node_id in self.node_order:
            for dependency in self.dependencies.get(node_id, ()):
                if dependency not in known:
                    raise ValueError(
                        f"Node {node_id!r} depends on unknown node {dependency!r}"
                    )
                successors[dependency].append(node_id)
        self.successors = {
            node_id: tuple(children) for node_id, children in successors.items()
        }

    @classmethod
    def from_control_edges(
        cls,
        node_ids: Iterable[str],
        control_edges: Iterable[tuple[str, str]],
    ) -> "DAGScheduler":
        node_order = tuple(node_ids)
        dependencies: dict[str, list[str]] = {node_id: [] for node_id in node_order}
        known = set(node_order)
        for source, target in control_edges:
            if source not in known or target not in known:
                continue
            dependencies[target].append(source)
        return cls(
            node_order=node_order,
            dependencies={
                node_id: tuple(values) for node_id, values in dependencies.items()
            },
        )

    def ready_nodes(self) -> tuple[str, ...]:
        return tuple(
            node_id
            for node_id in self.node_order
            if self.statuses[node_id] == "pending"
            and all(
                self.statuses[dependency] == "success"
                for dependency in self.dependencies.get(node_id, ())
            )
        )

    def mark_running(self, node_id: str) -> None:
        self._require_status(node_id, {"pending"})
        self.statuses[node_id] = "running"

    def mark_success(self, node_id: str) -> None:
        self._require_status(node_id, {"running"})
        self.statuses[node_id] = "success"

    def mark_waiting(self, node_id: str) -> None:
        self._require_status(node_id, {"running"})
        self.statuses[node_id] = "waiting_interaction"

    def mark_failed_and_skip_descendants(self, node_id: str) -> tuple[str, ...]:
        self._require_status(node_id, {"running"})
        self.statuses[node_id] = "failed"
        skipped: list[str] = []
        stack = list(self.successors.get(node_id, ()))
        while stack:
            current = stack.pop()
            status = self.statuses[current]
            if status in {"success", "failed", "skipped", "cancelled"}:
                continue
            if status == "running":
                continue
            self.statuses[current] = "skipped"
            skipped.append(current)
            stack.extend(self.successors.get(current, ()))
        order = {node_id: index for index, node_id in enumerate(self.node_order)}
        skipped.sort(key=lambda value: order[value])
        return tuple(skipped)

    def cancel_unstarted(self) -> tuple[str, ...]:
        cancelled: list[str] = []
        for node_id in self.node_order:
            if self.statuses[node_id] != "pending":
                continue
            self.statuses[node_id] = "cancelled"
            cancelled.append(node_id)
        return tuple(cancelled)

    def has_running_nodes(self) -> bool:
        return any(status == "running" for status in self.statuses.values())

    def has_pending_nodes(self) -> bool:
        return any(status == "pending" for status in self.statuses.values())

    def has_failures_or_skips(self) -> bool:
        return any(status in {"failed", "skipped"} for status in self.statuses.values())

    def all_terminal(self) -> bool:
        return all(
            status in {"success", "failed", "skipped", "cancelled", "waiting_interaction"}
            for status in self.statuses.values()
        )

    def _require_status(self, node_id: str, allowed: set[str]) -> None:
        status = self.statuses.get(node_id)
        if status not in allowed:
            raise ValueError(
                f"Node {node_id!r} cannot transition from {status!r}; "
                f"expected one of {sorted(allowed)!r}"
            )


class ApprovalBarrier:
    """Placeholder for the human-gate resume scheduler batch."""

    def __init__(self, *args: object, **kwargs: object) -> None:  # noqa: D401
        raise NotImplementedError("ApprovalBarrier is a later deliverable")


_PUBLIC: Iterable[str] = ("compute_ready_set", "DAGScheduler", "ApprovalBarrier")
