"""Unit tests for ``acc.scheduler.compute_ready_set``.

Covers TEST_PLAN.md cases:
- test_ready_set_includes_node_with_all_deps_completed
- test_ready_set_excludes_node_with_pending_dep
- test_ready_set_excludes_already_completed
"""

from __future__ import annotations

from acc.scheduler import compute_ready_set


def test_ready_set_includes_node_with_all_deps_completed() -> None:
    graph_nodes = {"a", "b", "c"}
    control_edges = [("a", "b"), ("a", "c")]
    completed = {"a"}

    ready = compute_ready_set(graph_nodes, control_edges, completed)

    # ``b`` and ``c`` have only one predecessor (``a``) which is done.
    assert ready == {"b", "c"}


def test_ready_set_excludes_node_with_pending_dep() -> None:
    graph_nodes = {"a", "b", "c"}
    control_edges = [("a", "c"), ("b", "c")]
    completed = {"a"}  # ``b`` is still pending

    ready = compute_ready_set(graph_nodes, control_edges, completed)

    # ``c`` cannot run yet because ``b`` is not completed.
    assert "c" not in ready
    # ``b`` has no incoming edges, so it is ready.
    assert "b" in ready
    # ``a`` is already completed, so it is not in the ready set.
    assert "a" not in ready


def test_ready_set_excludes_already_completed() -> None:
    graph_nodes = {"a", "b"}
    control_edges = [("a", "b")]
    completed = {"a", "b"}

    ready = compute_ready_set(graph_nodes, control_edges, completed)

    # No node should appear twice — completed nodes are excluded.
    assert ready == set()
