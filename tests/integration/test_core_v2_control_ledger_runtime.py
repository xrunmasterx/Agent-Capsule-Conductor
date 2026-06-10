from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

import acc.app.core_v2_runtime as core_v2_runtime
import acc.app.runtime.executor as _executor_module
import acc.ledger_writer as _ledger_writer_module
from acc.app.core_v2_runtime import run_core_v2_workflow_path
from acc.app.human_gate_service import answer_human_gate
from acc.app.interactions import list_interactions
from acc.models import CORE_V2_SCHEMA_VERSION
from acc.store.control_ledger import (
    load_decisions,
    load_dispatches,
    load_plan_steps,
    load_run_plan,
)


def test_fixed_two_node_success_writes_control_ledger(tmp_path: Path) -> None:
    workflow_path = tmp_path / "dag.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "dag",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "produce",
                    "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    "ports": {"outputs": {"main": {"type": "json"}}},
                },
                {
                    "id": "consume",
                    "callable_ref": {"kind": "agent_class", "id": "generic_fake_agent"},
                    "ports": {"inputs": {"main": {"type": "json"}}},
                    "input_bindings": [
                        {
                            "source": {"node": "produce", "port": "main"},
                            "target_port": "main",
                        }
                    ],
                },
            ],
            "control_edges": [{"from": "produce", "to": "consume"}],
        },
    )

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))

    run_plan = load_run_plan(tmp_path / "run").value
    steps = {step.node_id: step for step in load_plan_steps(tmp_path / "run").value}
    dispatches = load_dispatches(tmp_path / "run").value
    decisions = load_decisions(tmp_path / "run").value
    events = read_jsonl(tmp_path / "run" / "events.jsonl")

    assert record.status == "success"
    assert run_plan is not None
    assert run_plan.source == "fixed"
    assert run_plan.step_count == 2
    assert steps["produce"].status == "success"
    assert steps["consume"].status == "success"
    assert steps["consume"].depends_on == ("step_produce",)
    assert len(dispatches) == 2
    assert {dispatch.status for dispatch in dispatches} == {"completed"}
    assert [decision.kind for decision in decisions].count("compile_plan") == 1
    assert [decision.kind for decision in decisions].count("dispatch") == 2
    assert any(event.get("type") == "dispatch_completed" for event in events)
    assert all("workflow_run_id" not in event for event in events)


def test_fixed_failure_writes_failed_step_and_dispatch(tmp_path: Path) -> None:
    workflow_path = tmp_path / "failure.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "failure",
            "version": "0.1.0",
            "nodes": [
                {"id": "fail", "callable_ref": {"kind": "tool_class", "id": "fail"}},
                {
                    "id": "after",
                    "callable_ref": {"kind": "agent_class", "id": "generic_fake_agent"},
                },
            ],
            "control_edges": [{"from": "fail", "to": "after"}],
        },
    )

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))

    steps = {step.node_id: step for step in load_plan_steps(tmp_path / "run").value}
    dispatches = load_dispatches(tmp_path / "run").value

    assert record.status == "failed"
    assert steps["fail"].status == "failed"
    assert steps["fail"].failure_id == "failure_run_fail"
    assert steps["after"].status == "skipped"
    assert steps["after"].metadata["skip_reason"] == "dependency_failed"
    assert len(dispatches) == 1
    assert dispatches[0].status == "failed"
    assert dispatches[0].result_refs == ("failures/failure_run_fail.json",)
    assert (tmp_path / "run" / "failures" / "failure_run_fail.json").exists()


def test_ready_queue_does_not_wait_for_unrelated_slow_branch(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    workflow_path = tmp_path / "independent.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "independent",
            "version": "0.1.0",
            "nodes": [
                {"id": "fast_a", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}},
                {"id": "fast_c", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}},
                {"id": "slow_b", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}},
            ],
            "control_edges": [{"from": "fast_a", "to": "fast_c"}],
        },
    )

    async def fake_callable(*args, **kwargs):
        _template, node, _payload, *_rest = args
        _ = kwargs
        if node.id == "slow_b":
            await asyncio.sleep(0.05)
        return {"status": "success", "producer_node_id": node.id}

    monkeypatch.setattr(_executor_module, "execute_core_v2_callable", fake_callable)

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))
    events = read_jsonl(tmp_path / "run" / "events.jsonl")

    assert record.status == "success"
    assert event_index(events, "node_started", "fast_c") < event_index(
        events,
        "node_completed",
        "slow_b",
    )


def test_failure_skips_only_descendants_and_allows_independent_chain(
    tmp_path: Path,
) -> None:
    workflow_path = tmp_path / "branch_failure.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "branch_failure",
            "version": "0.1.0",
            "nodes": [
                {"id": "fail", "callable_ref": {"kind": "tool_class", "id": "fail"}},
                {"id": "blocked", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}},
                {"id": "ok_a", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}},
                {"id": "ok_b", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}},
            ],
            "control_edges": [
                {"from": "fail", "to": "blocked"},
                {"from": "ok_a", "to": "ok_b"},
            ],
        },
    )

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))
    steps = {step.node_id: step for step in load_plan_steps(tmp_path / "run").value}
    run_plan = load_run_plan(tmp_path / "run").value

    assert record.status == "failed"
    assert run_plan is not None
    assert run_plan.status == "failed"
    assert steps["fail"].status == "failed"
    assert steps["blocked"].status == "skipped"
    assert steps["ok_a"].status == "success"
    assert steps["ok_b"].status == "success"
    assert not (tmp_path / "run" / "nodes" / "blocked" / "output.json").exists()


def test_ready_queue_respects_workflow_max_concurrency(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    workflow_path = tmp_path / "max_concurrency.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "max_concurrency",
            "version": "0.1.0",
            "policies": {"max_concurrency": 2},
            "nodes": [
                {"id": "one", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}},
                {"id": "two", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}},
                {"id": "three", "callable_ref": {"kind": "tool_class", "id": "fake_producer"}},
            ],
        },
    )
    active = 0
    peak = 0
    lock = asyncio.Lock()

    async def fake_callable(*args, **kwargs):
        nonlocal active, peak
        _template, node, _payload, *_rest = args
        _ = kwargs
        async with lock:
            active += 1
            peak = max(peak, active)
        await asyncio.sleep(0.02)
        async with lock:
            active -= 1
        return {"status": "success", "producer_node_id": node.id}

    monkeypatch.setattr(_executor_module, "execute_core_v2_callable", fake_callable)

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))

    assert record.status == "success"
    assert peak == 2


def test_empty_input_policy_block_fails_before_callable(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    workflow_path = tmp_path / "empty_input_block.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "empty_input_block",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "identify",
                    "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    "metadata": {"empty_input_policy": "block"},
                }
            ],
        },
    )
    called = False

    async def fake_callable(*args, **kwargs):
        nonlocal called
        _ = args, kwargs
        called = True
        return {"status": "success"}

    monkeypatch.setattr(_executor_module, "execute_core_v2_callable", fake_callable)

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))

    assert record.status == "failed"
    assert called is False
    assert json.loads((tmp_path / "run" / "nodes" / "identify" / "input.json").read_text()) == {}
    assert "requires runtime input" in (tmp_path / "run" / "nodes" / "identify" / "stderr.txt").read_text()
    assert not (tmp_path / "run" / "nodes" / "identify" / "output.json").exists()


def test_nested_workflow_function_still_uses_core_v2_nested_path(tmp_path: Path) -> None:
    child_path = tmp_path / "child.accflow.json"
    write_v2(
        child_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "child",
            "version": "0.1.0",
            "exposed_inputs": {"topic": {"direction": "input", "type": "json"}},
            "exposed_outputs": {"report": {"direction": "output", "type": "json"}},
            "nodes": [
                {
                    "id": "produce",
                    "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    "ports": {"inputs": {"topic": {}}, "outputs": {"main": {}}},
                }
            ],
            "workflow_input_bindings": [
                {"source_port": "topic", "target": {"node": "produce", "port": "topic"}}
            ],
            "workflow_output_bindings": [
                {"source": {"node": "produce", "port": "main"}, "target_port": "report"}
            ],
        },
    )
    parent_path = tmp_path / "parent.accflow.json"
    write_v2(
        parent_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "parent",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "subflow",
                    "callable_ref": {"kind": "workflow_function", "id": child_path.name},
                    "input_bindings": [
                        {"target_port": "topic", "static_value": {"value": "nested"}}
                    ],
                    "ports": {"outputs": {"report": {"type": "json"}}},
                }
            ],
        },
    )

    record = asyncio.run(run_core_v2_workflow_path(parent_path, tmp_path / "run"))

    nested_run = tmp_path / "run" / "nodes" / "subflow" / "nested_workflow"
    parent_steps = load_plan_steps(tmp_path / "run").value
    nested_steps = load_plan_steps(nested_run).value

    assert record.status == "success"
    assert (nested_run / "run_record.json").exists()
    assert load_run_plan(nested_run).value is not None
    assert parent_steps[0].status == "success"
    assert nested_steps[0].node_id == "produce"
    assert nested_steps[0].status == "success"


def test_ledger_failure_after_node_success_marks_run_crashed_not_node_failed(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    workflow_path = tmp_path / "single.accflow.json"
    write_v2(
        workflow_path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "single",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "produce",
                    "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    "ports": {"outputs": {"main": {"type": "json"}}},
                }
            ],
        },
    )
    real_append = _ledger_writer_module.append_plan_step_transition

    def fail_on_success_transition(run_dir, transition):
        if transition.next_status == "success":
            raise OSError("audit sink unavailable")
        real_append(run_dir, transition)

    monkeypatch.setattr(_ledger_writer_module, "append_plan_step_transition", fail_on_success_transition)

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))
    session = json.loads(
        (tmp_path / "run" / "nodes" / "produce" / "session_instance_manifest.json").read_text(
            encoding="utf-8"
        )
    )
    summary = json.loads((tmp_path / "run" / "run_summary.json").read_text(encoding="utf-8"))

    assert record.status == "crashed"
    assert session["status"] == "success"
    assert summary["status"] == "crashed"
    assert summary["failed_nodes"] == []
    assert (tmp_path / "run" / "nodes" / "produce" / "output.json").exists()


def test_human_gate_pending_step_does_not_execute_callable(tmp_path: Path) -> None:
    workflow_path = tmp_path / "gate.accflow.json"
    write_human_gate_workflow(workflow_path)

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))

    run_dir = tmp_path / "run"
    summary = json.loads((run_dir / "run_summary.json").read_text(encoding="utf-8"))
    steps = {step.node_id: step for step in load_plan_steps(run_dir).value}
    interactions = list_interactions(run_dir)
    events = read_jsonl(run_dir / "events.jsonl")
    assert record.status == "waiting_interaction"
    assert summary["status"] == "waiting_interaction"
    assert summary.get("ended_at") is None
    assert len(interactions) == 1
    assert interactions[0].status == "pending"
    assert steps["gate"].status == "waiting_interaction"
    assert steps["gate"].required_interaction_id == interactions[0].interaction_id
    assert not (run_dir / "nodes" / "gate" / "session_instance_manifest.json").exists()
    assert any(event.get("type") == "interaction_created" for event in events)


def test_human_gate_approve_records_decision_and_dispatches_step(tmp_path: Path) -> None:
    workflow_path = tmp_path / "gate.accflow.json"
    write_human_gate_workflow(workflow_path)
    run_dir = tmp_path / "run"
    asyncio.run(run_core_v2_workflow_path(workflow_path, run_dir))
    interaction = list_interactions(run_dir)[0]

    payload = answer_human_gate(
        run_dir,
        run_id="run",
        interaction_id=interaction.interaction_id,
        answer={"decision": "approve"},
    )

    summary = json.loads((run_dir / "run_summary.json").read_text(encoding="utf-8"))
    steps = {step.node_id: step for step in load_plan_steps(run_dir).value}
    decisions = load_decisions(run_dir).value
    dispatches = load_dispatches(run_dir).value
    assert payload["decision_id"] == f"decision_run_approval_{interaction.interaction_id}"
    assert payload["resume"]["status"] == "resuming"
    assert payload["dispatch"]["status"] == "success"
    assert summary["status"] == "success"
    assert steps["gate"].status == "success"
    assert steps["gate"].required_interaction_id == interaction.interaction_id
    assert [decision.kind for decision in decisions].count("approval") == 1
    assert decisions[-1].kind == "dispatch"
    assert dispatches[0].status == "completed"
    assert (run_dir / "nodes" / "gate" / "output.json").exists()
    assert (run_dir / "wakeup_queue.jsonl").exists()
    assert not (run_dir / "workflow_events.jsonl").exists()


def test_human_gate_reject_records_decision_and_skips_without_execution(
    tmp_path: Path,
) -> None:
    workflow_path = tmp_path / "gate.accflow.json"
    write_human_gate_workflow(workflow_path)
    run_dir = tmp_path / "run"
    asyncio.run(run_core_v2_workflow_path(workflow_path, run_dir))
    interaction = list_interactions(run_dir)[0]

    payload = answer_human_gate(
        run_dir,
        run_id="run",
        interaction_id=interaction.interaction_id,
        answer={"decision": "reject"},
    )

    summary = json.loads((run_dir / "run_summary.json").read_text(encoding="utf-8"))
    steps = {step.node_id: step for step in load_plan_steps(run_dir).value}
    decisions = load_decisions(run_dir).value
    dispatches = load_dispatches(run_dir).value
    assert payload["decision_id"] == f"decision_run_approval_{interaction.interaction_id}"
    assert payload["rejection"]["status"] == "failed"
    assert summary["status"] == "failed"
    assert steps["gate"].status == "skipped"
    assert steps["gate"].decision_id == payload["decision_id"]
    assert [decision.kind for decision in decisions].count("approval") == 1
    assert dispatches == ()
    assert not (run_dir / "nodes" / "gate" / "session_instance_manifest.json").exists()
    assert not (run_dir / "nodes" / "gate" / "output.json").exists()


def write_v2(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def write_human_gate_workflow(path: Path) -> None:
    write_v2(
        path,
        {
            "schema_version": CORE_V2_SCHEMA_VERSION,
            "id": "human_gate",
            "version": "0.1.0",
            "nodes": [
                {
                    "id": "gate",
                    "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    "control": {
                        "require_human_approval": True,
                        "approval_prompt": "Approve gate?",
                    },
                }
            ],
        },
    )


def read_jsonl(path: Path) -> list[dict[str, object]]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def event_index(events: list[dict[str, object]], event_type: str, node_id: str) -> int:
    for index, event in enumerate(events):
        if event.get("type") == event_type and event.get("node_id") == node_id:
            return index
    raise AssertionError(f"Missing event {event_type} for node {node_id}")
