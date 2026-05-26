from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from acc.app import (
    load_clean_workflow_template,
    run_clean_workflow_template,
    validate_clean_workflow_file,
)
from acc.engine import topological_levels
from acc.utils import AccError


def write_template(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def clean_template(nodes: list[dict[str, Any]], **updates: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": "clean_test",
        "version": "0.1.0",
        "nodes": nodes,
        "control_edges": [],
        "data_edges": [],
        "policies": {"max_concurrency": 2, "failure_mode": "fail_fast"},
    }
    payload.update(updates)
    return payload


def tool_node(node_id: str, **updates: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": node_id,
        "kind": "tool",
        "tool": "fake_producer",
        "ports": {"outputs": {"main": {"type": "artifact"}}},
    }
    payload.update(updates)
    return payload


def test_clean_template_rejects_absolute_workspace_path(tmp_path: Path) -> None:
    path = tmp_path / "bad.accflow.json"
    write_template(
        path,
        clean_template(
            [tool_node("a")],
            workspace_root=str(tmp_path.resolve()),
        ),
    )

    with pytest.raises(AccError, match="absolute workspace"):
        load_clean_workflow_template(path)


def test_clean_template_rejects_missing_data_port(tmp_path: Path) -> None:
    path = tmp_path / "bad_port.accflow.json"
    write_template(
        path,
        clean_template(
            [
                tool_node("a"),
                {
                    "id": "b",
                    "kind": "agent",
                    "runtime": "generic_fake_agent",
                    "ports": {"inputs": {"in": {"type": "artifact"}}},
                },
            ],
            control_edges=[{"from": "a", "to": "b"}],
            data_edges=[
                {
                    "from": {"node": "a", "port": "missing"},
                    "to": {"node": "b", "port": "in"},
                }
            ],
        ),
    )

    with pytest.raises(AccError, match="missing output port"):
        validate_clean_workflow_file(path)


def test_clean_template_rejects_data_edge_without_control_dependency(tmp_path: Path) -> None:
    path = tmp_path / "bad_data_dependency.accflow.json"
    write_template(
        path,
        clean_template(
            [
                tool_node("a"),
                {
                    "id": "b",
                    "kind": "agent",
                    "runtime": "generic_fake_agent",
                    "ports": {"inputs": {"main": {"type": "artifact"}}},
                },
            ],
            data_edges=[
                {
                    "from": {"node": "a", "port": "main"},
                    "to": {"node": "b", "port": "main"},
                }
            ],
        ),
    )

    with pytest.raises(AccError, match="upstream control dependency"):
        validate_clean_workflow_file(path)


def test_clean_topological_levels_large_dag_is_linear_time_shape(tmp_path: Path) -> None:
    nodes = [tool_node(f"n_{index}") for index in range(1000)]
    edges = [{"from": f"n_{index}", "to": f"n_{index + 1}"} for index in range(999)]
    path = tmp_path / "large.accflow.json"
    write_template(path, clean_template(nodes, control_edges=edges))

    template = load_clean_workflow_template(path)
    levels = topological_levels(template)

    assert len(levels) == 1000
    assert levels[0] == ["n_0"]
    assert levels[-1] == ["n_999"]


def test_clean_template_rejects_invalid_policy(tmp_path: Path) -> None:
    path = tmp_path / "bad_policy.accflow.json"
    write_template(
        path,
        clean_template(
            [tool_node("a")],
            policies={"failure_mode": "unknown", "max_concurrency": 1},
        ),
    )

    with pytest.raises(AccError, match="Unsupported failure_mode"):
        validate_clean_workflow_file(path)


def test_clean_scheduler_respects_bounded_concurrency(monkeypatch, tmp_path: Path) -> None:
    path = tmp_path / "bounded.accflow.json"
    write_template(
        path,
        clean_template(
            [tool_node("a"), tool_node("b")],
            policies={"max_concurrency": 1},
        ),
    )
    active = 0
    max_active = 0

    async def fake_execute(node, _workflow_path, _run_dir, node_dir, _frame):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.01)
        output = {"status": "success", "summary": f"ran {node.id}"}
        (node_dir / "output.json").write_text(json.dumps(output), encoding="utf-8")
        active -= 1
        return output

    monkeypatch.setattr("acc.app.execute_clean_node", fake_execute)

    result = asyncio.run(run_clean_workflow_template(path, tmp_path / "run"))

    assert result["status"] == "success"
    assert max_active == 1


def test_clean_scheduler_write_lock_serializes_workspace_writers(
    monkeypatch,
    tmp_path: Path,
) -> None:
    path = tmp_path / "locks.accflow.json"
    write_template(
        path,
        clean_template(
            [
                tool_node("a", write_workspace=True),
                tool_node("b", write_workspace=True),
            ],
            policies={"max_concurrency": 2},
        ),
    )
    active = 0
    max_active = 0

    async def fake_execute(node, _workflow_path, _run_dir, node_dir, _frame):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.01)
        output = {"status": "success", "summary": f"ran {node.id}"}
        (node_dir / "output.json").write_text(json.dumps(output), encoding="utf-8")
        active -= 1
        return output

    monkeypatch.setattr("acc.app.execute_clean_node", fake_execute)

    result = asyncio.run(run_clean_workflow_template(path, tmp_path / "run"))

    assert result["status"] == "success"
    assert max_active == 1


def test_clean_scheduler_retry_allows_later_success(monkeypatch, tmp_path: Path) -> None:
    path = tmp_path / "retry.accflow.json"
    write_template(
        path,
        clean_template([tool_node("a", retry={"max_attempts": 2})]),
    )
    attempts = 0

    async def flaky_execute(node, _workflow_path, _run_dir, node_dir, _frame):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise AccError("first attempt failed")
        output = {"status": "success", "summary": f"ran {node.id}"}
        (node_dir / "output.json").write_text(json.dumps(output), encoding="utf-8")
        return output

    monkeypatch.setattr("acc.app.execute_clean_node", flaky_execute)

    result = asyncio.run(run_clean_workflow_template(path, tmp_path / "run"))

    assert result["status"] == "success"
    assert result["nodes"][0]["attempts"] == 2


def test_clean_scheduler_retry_clears_failed_attempt_outputs(
    monkeypatch,
    tmp_path: Path,
) -> None:
    path = tmp_path / "retry_clean.accflow.json"
    write_template(
        path,
        clean_template([tool_node("a", retry={"max_attempts": 2})]),
    )
    attempts = 0

    async def dirty_flaky_execute(node, _workflow_path, _run_dir, node_dir, _frame):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            stale = {"status": "failed", "summary": "stale"}
            (node_dir / "output.json").write_text(json.dumps(stale), encoding="utf-8")
            (node_dir / "artifacts" / "stale.txt").write_text("stale", encoding="utf-8")
            raise AccError("first attempt failed")
        output = {"status": "success", "summary": f"ran {node.id}"}
        (node_dir / "output.json").write_text(json.dumps(output), encoding="utf-8")
        return output

    monkeypatch.setattr("acc.app.execute_clean_node", dirty_flaky_execute)

    result = asyncio.run(run_clean_workflow_template(path, tmp_path / "run"))

    assert result["status"] == "success"
    assert not (tmp_path / "run" / "nodes" / "a" / "artifacts" / "stale.txt").exists()


def test_clean_scheduler_timeout_marks_workflow_failed(monkeypatch, tmp_path: Path) -> None:
    path = tmp_path / "timeout.accflow.json"
    write_template(path, clean_template([tool_node("a", timeout_seconds=0.001)]))

    async def slow_execute(node, _workflow_path, _run_dir, node_dir, _frame):
        await asyncio.sleep(0.05)
        output = {"status": "success", "summary": f"ran {node.id}"}
        (node_dir / "output.json").write_text(json.dumps(output), encoding="utf-8")
        return output

    monkeypatch.setattr("acc.app.execute_clean_node", slow_execute)

    result = asyncio.run(run_clean_workflow_template(path, tmp_path / "run"))

    assert result["status"] == "failed"
    assert "timed out" in result["errors"][0]


def test_clean_scheduler_continue_on_error_keeps_workflow_success(tmp_path: Path) -> None:
    path = tmp_path / "continue.accflow.json"
    write_template(
        path,
        clean_template(
            [
                tool_node("fail", tool="fail"),
                tool_node("ok"),
            ],
            policies={"max_concurrency": 1, "failure_mode": "continue_on_error"},
        ),
    )

    result = asyncio.run(run_clean_workflow_template(path, tmp_path / "run"))

    assert result["status"] == "success"
    assert result["errors"]
    assert {node["node_id"]: node["status"] for node in result["nodes"]} == {
        "fail": "failed",
        "ok": "success",
    }


def test_clean_node_event_log_is_written(tmp_path: Path) -> None:
    path = tmp_path / "events.accflow.json"
    write_template(path, clean_template([tool_node("a")]))

    result = asyncio.run(run_clean_workflow_template(path, tmp_path / "run"))

    assert result["status"] == "success"
    event_log = tmp_path / "run" / "nodes" / "a" / "events.jsonl"
    assert event_log.exists()
    event_text = event_log.read_text(encoding="utf-8")
    assert "node_scheduled" in event_text
    assert "node_completed" in event_text
