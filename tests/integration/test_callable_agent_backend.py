from __future__ import annotations

from pathlib import Path

import pytest

from acc.app import WorkflowAppService
from acc.utils import load_json

DEMO_GRAPH = Path("examples/workflows/demo_two_node.graph.json")


def run_demo(run_dir: Path) -> dict:
    return WorkflowAppService().run_sync(DEMO_GRAPH, run_dir)


def test_accflow_real_capsule_runs_via_callable_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ACC_USE_CALLABLE_DISPATCH", "1")
    run_dir = tmp_path / "callable_run"

    result = run_demo(run_dir)

    assert result["status"] == "success"
    nodes = {node["node_id"]: node for node in result["nodes"]}
    assert set(nodes) == {"echo", "fake"}
    for node in nodes.values():
        assert node["status"] == "success"
        manifest_path = node.get("session_instance_manifest")
        assert manifest_path is not None
        assert Path(manifest_path).exists()

    # Under the flag, the importer writes callable_id so the persisted callable_ref
    # resolves to the real capsule id rather than the runtime="capsule" sentinel.
    echo_manifest = load_json(Path(nodes["echo"]["session_instance_manifest"]))
    assert echo_manifest["callable_ref"]["id"] == "echo-test.generic"
    fake_manifest = load_json(Path(nodes["fake"]["session_instance_manifest"]))
    assert fake_manifest["callable_ref"]["id"] == "fake-agent.generic"


def test_callable_path_matches_legacy_path_outcome(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ACC_USE_CALLABLE_DISPATCH", raising=False)
    legacy = run_demo(tmp_path / "legacy_run")

    monkeypatch.setenv("ACC_USE_CALLABLE_DISPATCH", "1")
    callable_run = run_demo(tmp_path / "callable_run")

    assert legacy["status"] == callable_run["status"] == "success"

    legacy_nodes = {node["node_id"]: node["status"] for node in legacy["nodes"]}
    callable_nodes = {node["node_id"]: node["status"] for node in callable_run["nodes"]}
    assert legacy_nodes == callable_nodes

    # Node outputs (written by the capsule runner) carry the same summary on both paths.
    for node_id in ("echo", "fake"):
        legacy_output = load_json(tmp_path / "legacy_run" / "nodes" / node_id / "output.json")
        callable_output = load_json(tmp_path / "callable_run" / "nodes" / node_id / "output.json")
        assert legacy_output["summary"] == callable_output["summary"]
