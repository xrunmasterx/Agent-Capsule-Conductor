from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from acc.app.runtime.continuation import continue_persisted_run
from acc.app.runtime.orchestrator import run_core_v2_workflow_path
from acc.app.supervisor import (
    materialize_supervisor_plan_steps,
    replay_supervisor_plan_from_recorded_decision,
)
from acc.models import (
    AccError,
    AgentCapabilities,
    CallableRef,
    ControlPolicy,
    DynamicInvocationIntent,
    PlanStep,
    PlanStepTransitionRecord,
    RosterEntry,
    RunPlan,
    SupervisorPlan,
    SupervisorRoster,
)
from acc.session import utc_now_iso
from acc.store.control_ledger import (
    append_plan_step_transition,
    load_decisions,
    load_dispatches,
    load_plan_steps,
    load_run_plan,
    write_run_plan,
)


def test_supervisor_plan_p0_writes_decision_and_steps_without_worker_execution(
    tmp_path: Path,
) -> None:
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    run_plan = _run_plan()
    write_run_plan(run_dir, run_plan)
    _append_supervisor_success_step(run_dir)
    plan = _approved_plan()

    result = materialize_supervisor_plan_steps(
        run_dir,
        plan=plan,
        roster=_roster("worker"),
        control_policy=_policy(allowed_targets=(CallableRef(kind="agent_class", id="worker"),)),
        run_plan=run_plan,
    )

    steps = {step.node_id: step for step in load_plan_steps(run_dir).value}
    decisions = load_decisions(run_dir).value
    assert result["decision"]["kind"] == "supervisor_plan"
    assert result["steps"][0]["node_id"] == "worker_task"
    assert steps["worker_task"].source == "supervisor"
    assert steps["worker_task"].status == "ready"
    assert steps["worker_task"].depends_on == ("step_sup",)
    assert steps["worker_task"].input_snapshot_refs == (
        "supervisor_plans/plan1/intents/c1.json",
    )
    assert steps["worker_task"].metadata["typed_input_refs"] == [
        {
            "kind": "supervisor_intent_snapshot",
            "source": "supervisor",
            "path": "supervisor_plans/plan1/intents/c1.json",
            "payload_key": "input_payload",
            "correlation_id": "c1",
        }
    ]
    assert "supervisor_plans/plan1/intents/c1.json" in decisions[-1].input_evidence_refs
    assert decisions[-1].kind == "supervisor_plan"
    assert (run_dir / "supervisor_plans" / "plan1.json").exists()
    assert (run_dir / "supervisor_plans" / "plan1" / "intents" / "c1.json").exists()
    assert not (run_dir / "nodes" / "worker_task" / "output.json").exists()
    assert not (run_dir / "nodes" / "worker_task" / "session_instance_manifest.json").exists()


def test_supervisor_plan_p0_rejects_invalid_roster_without_appending_steps(
    tmp_path: Path,
) -> None:
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    run_plan = _run_plan()
    write_run_plan(run_dir, run_plan)
    _append_supervisor_success_step(run_dir)

    with pytest.raises(AccError, match="not in supervisor roster"):
        materialize_supervisor_plan_steps(
            run_dir,
            plan=_approved_plan(),
            roster=_roster("other"),
            control_policy=_policy(),
            run_plan=run_plan,
        )

    steps = load_plan_steps(run_dir).value
    assert tuple(step.node_id for step in steps) == ("sup",)
    assert load_decisions(run_dir).value == ()
    assert not (run_dir / "supervisor_plans" / "plan1.json").exists()


def test_supervisor_plan_p1_dispatches_dynamic_step_through_core_v2_path(
    tmp_path: Path,
) -> None:
    workflow_path = tmp_path / "supervised.accflow.json"
    _write_supervisor_workflow(workflow_path)
    run_dir = tmp_path / "run"
    asyncio.run(run_core_v2_workflow_path(workflow_path, run_dir))
    run_plan = load_run_plan(run_dir).value
    assert run_plan is not None
    plan = _approved_plan(
        target=CallableRef(kind="agent_class", id="generic_fake_agent"),
        node_id_suggestion="dynamic worker",
    )
    materialize_supervisor_plan_steps(
        run_dir,
        plan=plan,
        roster=_roster_ref(CallableRef(kind="agent_class", id="generic_fake_agent")),
        control_policy=_policy(
            allowed_targets=(CallableRef(kind="agent_class", id="generic_fake_agent"),)
        ),
        run_plan=run_plan,
    )

    result = asyncio.run(continue_persisted_run(run_dir, reason="supervisor"))

    output = json.loads((run_dir / "nodes" / "dynamic_worker" / "output.json").read_text())
    binding_manifest = json.loads(
        (run_dir / "nodes" / "dynamic_worker" / "binding_manifest.json").read_text()
    )
    steps = {step.node_id: step for step in load_plan_steps(run_dir).value}
    dispatches = load_dispatches(run_dir).value
    assert result["status"] == "success"
    assert result["dispatched_step_ids"] == ["step_dynamic_worker"]
    assert output["status"] == "success"
    assert output["input"] == {"task": "do work"}
    assert binding_manifest["bindings"][0]["source_kind"] == "snapshot_input"
    assert (
        binding_manifest["bindings"][0]["snapshot_input_ref"]["kind"]
        == "supervisor_intent_snapshot"
    )
    assert steps["dynamic_worker"].status == "success"
    assert dispatches[-1].status == "completed"
    assert (run_dir / "nodes" / "dynamic_worker" / "artifact_bundle.json").exists()
    assert (run_dir / "result_store" / "dynamic_worker" / "default.bin").exists()


def test_supervisor_plan_p1_worker_failure_writes_normal_failure_ledger(
    tmp_path: Path,
) -> None:
    workflow_path = tmp_path / "supervised.accflow.json"
    _write_supervisor_workflow(workflow_path)
    run_dir = tmp_path / "run"
    asyncio.run(run_core_v2_workflow_path(workflow_path, run_dir))
    run_plan = load_run_plan(run_dir).value
    assert run_plan is not None
    plan = _approved_plan(
        target=CallableRef(kind="tool_class", id="fail"),
        node_id_suggestion="bad worker",
    )
    materialize_supervisor_plan_steps(
        run_dir,
        plan=plan,
        roster=_roster_ref(CallableRef(kind="tool_class", id="fail")),
        control_policy=_policy(allowed_targets=(CallableRef(kind="tool_class", id="fail"),)),
        run_plan=run_plan,
    )

    result = asyncio.run(continue_persisted_run(run_dir, reason="supervisor"))

    steps = {step.node_id: step for step in load_plan_steps(run_dir).value}
    dispatches = load_dispatches(run_dir).value
    assert result["status"] == "failed"
    assert steps["bad_worker"].status == "failed"
    assert steps["bad_worker"].failure_id == "failure_run_bad_worker"
    assert dispatches[-1].status == "failed"
    assert (run_dir / "failures" / "failure_run_bad_worker.json").exists()
    assert not (run_dir / "nodes" / "bad_worker" / "output.json").exists()


def test_supervisor_replay_reuses_recorded_decision_without_parser(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run_dir = _prepare_supervisor_plan_run(tmp_path)
    called = False

    def fail_if_parser_called(raw):
        nonlocal called
        called = True
        raise AssertionError("supervisor parser must not be called during replay")

    monkeypatch.setattr("acc.app.supervisor.parse_supervisor_plan", fail_if_parser_called)

    replay = replay_supervisor_plan_from_recorded_decision(run_dir, plan_id="plan1")

    assert called is False
    assert replay["mode"] == "reuse_recorded_decisions"
    assert replay["plan_id"] == "plan1"
    assert replay["steps"][0]["node_id"] == "dynamic_worker"
    assert (run_dir / "supervisor_replay_manifest.json").exists()


def test_supervisor_replay_missing_decision_fails_explicitly(tmp_path: Path) -> None:
    workflow_path = tmp_path / "supervised.accflow.json"
    _write_supervisor_workflow(workflow_path)
    run_dir = tmp_path / "run"
    asyncio.run(run_core_v2_workflow_path(workflow_path, run_dir))

    with pytest.raises(AccError, match="supervisor_plan decision not found"):
        replay_supervisor_plan_from_recorded_decision(run_dir, plan_id="plan1")


def test_supervisor_replay_incompatible_snapshot_fails_explicitly(tmp_path: Path) -> None:
    run_dir = _prepare_supervisor_plan_run(tmp_path)
    snapshot_path = run_dir / "behavior_snapshot" / "workflow_function_template.json"
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    snapshot["id"] = "different_workflow"
    snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")

    with pytest.raises(AccError, match="snapshot workflow is incompatible"):
        replay_supervisor_plan_from_recorded_decision(run_dir, plan_id="plan1")


def _prepare_supervisor_plan_run(tmp_path: Path) -> Path:
    workflow_path = tmp_path / "supervised.accflow.json"
    _write_supervisor_workflow(workflow_path)
    run_dir = tmp_path / "run"
    asyncio.run(run_core_v2_workflow_path(workflow_path, run_dir))
    run_plan = load_run_plan(run_dir).value
    assert run_plan is not None
    materialize_supervisor_plan_steps(
        run_dir,
        plan=_approved_plan(
            target=CallableRef(kind="agent_class", id="generic_fake_agent"),
            node_id_suggestion="dynamic worker",
        ),
        roster=_roster_ref(CallableRef(kind="agent_class", id="generic_fake_agent")),
        control_policy=_policy(
            allowed_targets=(CallableRef(kind="agent_class", id="generic_fake_agent"),)
        ),
        run_plan=run_plan,
    )
    return run_dir


def _approved_plan(
    *,
    target: CallableRef | None = None,
    node_id_suggestion: str = "worker task",
) -> SupervisorPlan:
    target_ref = target or CallableRef(kind="agent_class", id="worker")
    return SupervisorPlan(
        plan_id="plan1",
        supervisor_node_id="sup",
        intents=(
            DynamicInvocationIntent(
                target_callable_ref=target_ref,
                input_payload={"task": "do work"},
                rationale="worker needed",
                correlation_id="c1",
                node_id_suggestion=node_id_suggestion,
            ),
        ),
        created_at="2026-06-03T00:00:00Z",
        status="approved",
    )


def _roster(*ids: str) -> SupervisorRoster:
    return _roster_ref(*(CallableRef(kind="agent_class", id=ref_id) for ref_id in ids))


def _roster_ref(*refs: CallableRef) -> SupervisorRoster:
    return SupervisorRoster(
        entries=tuple(
            RosterEntry(
                callable_ref=ref,
                title=ref.id,
                capabilities=AgentCapabilities(),
                input_ports={},
                output_ports={},
            )
            for ref in refs
        ),
        generated_at=utc_now_iso(),
    )


def _policy(
    *,
    allowed_targets: tuple[CallableRef, ...] = (),
) -> ControlPolicy:
    return ControlPolicy(
        policy_id="policy_supervisor",
        mode="supervisor",
        actor="supervisor:sup",
        allowed_targets=allowed_targets,
    )


def _run_plan() -> RunPlan:
    return RunPlan(
        run_plan_id="run_plan_run",
        run_id="run",
        workflow_function_id="workflow",
        invocation_id="invocation_run",
        source="fixed",
        schema_version="acc.control.v1",
        template_snapshot_ref="behavior_snapshot/workflow_function_template.json",
        control_policy_id="policy_supervisor",
        created_at="2026-06-03T00:00:00Z",
        status="active",
        step_count=1,
    )


def _append_supervisor_success_step(run_dir: Path) -> None:
    transitions = [
        (1, None, _supervisor_step("ready")),
        (2, "ready", _supervisor_step("dispatching")),
        (3, "dispatching", _supervisor_step("running")),
        (4, "running", _supervisor_step("success", session_id="session_sup")),
    ]
    for sequence, previous, step in transitions:
        append_plan_step_transition(
            run_dir,
            PlanStepTransitionRecord(
                sequence=sequence,
                recorded_at="2026-06-03T00:00:00Z",
                plan_step_id=step.plan_step_id,
                previous_status=previous,  # type: ignore[arg-type]
                next_status=step.status,
                snapshot=step,
                reason="test supervisor step",
            ),
        )


def _supervisor_step(status: str, *, session_id: str | None = None) -> PlanStep:
    return PlanStep(
        plan_step_id="step_sup",
        run_plan_id="run_plan_run",
        run_id="run",
        node_id="sup",
        callable_ref=CallableRef(kind="agent_class", id="supervisor"),
        depends_on=(),
        source="fixed",
        status=status,  # type: ignore[arg-type]
        session_id=session_id,
        created_at="2026-06-03T00:00:00Z",
        updated_at="2026-06-03T00:00:00Z",
    )


def _write_supervisor_workflow(path: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "schema_version": "acc.core.v2",
                "id": "supervised",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "sup",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
