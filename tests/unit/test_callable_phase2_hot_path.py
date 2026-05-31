from __future__ import annotations

from pathlib import Path

import pytest

from acc.app import WorkflowAppService
from acc.engine import normalize_node_invocation_spec
from acc.registry import CapsuleRegistry

DEMO_GRAPH = Path("examples/workflows/demo_two_node.graph.json")


def test_workflow_run_normalizes_each_node_once_at_load(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ACC_USE_CALLABLE_DISPATCH", raising=False)
    call_count = 0
    original = normalize_node_invocation_spec

    def counting_normalize(node):  # type: ignore[no-untyped-def]
        nonlocal call_count
        call_count += 1
        return original(node)

    monkeypatch.setattr("acc.engine.normalize_node_invocation_spec", counting_normalize)

    registry = CapsuleRegistry()
    service = WorkflowAppService(registry=registry)
    result = service.run_sync(DEMO_GRAPH, tmp_path / "run")

    assert result["status"] == "success"
    node_count = len(result["nodes"])
    assert node_count == 2
    # One normalize per node during bundle build; no per-node hot-path repeats.
    assert call_count == node_count


def test_workflow_run_reuses_service_registry_instance(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ACC_USE_CALLABLE_DISPATCH", "1")
    init_count = 0
    original_init = CapsuleRegistry.__init__

    def counting_init(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        nonlocal init_count
        init_count += 1
        return original_init(self, *args, **kwargs)

    monkeypatch.setattr(CapsuleRegistry, "__init__", counting_init)

    registry = CapsuleRegistry()
    service = WorkflowAppService(registry=registry)
    result = service.run_sync(DEMO_GRAPH, tmp_path / "run")

    assert result["status"] == "success"
    # Service construction + no extra registry scans per node on the hot path.
    assert init_count == 1
