from __future__ import annotations

from pathlib import Path

from acc.models import (
    CallableRef,
    DecisionRecord,
    DispatchEnvelope,
    DispatchTransitionRecord,
    PlanStep,
    PlanStepTransitionRecord,
    RunPlan,
)
from acc.store.control_ledger import (
    append_decision_record,
    append_dispatch_transition,
    append_plan_step_transition,
    write_run_plan,
)


def test_control_ledger_missing_files_return_warnings_without_writes(client, project_root: Path):
    run_dir = project_root / "runs" / "server_run"

    plan_response = client.get("/api/runs/server_run/plan")
    steps_response = client.get("/api/runs/server_run/steps")
    dispatches_response = client.get("/api/runs/server_run/dispatches")
    decisions_response = client.get("/api/runs/server_run/decisions")

    assert plan_response.status_code == 200, plan_response.text
    assert steps_response.status_code == 200, steps_response.text
    assert dispatches_response.status_code == 200, dispatches_response.text
    assert decisions_response.status_code == 200, decisions_response.text
    assert plan_response.json()["plan"] is None
    assert "run_plan.json" in plan_response.json()["warnings"][0]
    assert steps_response.json()["steps"] == []
    assert dispatches_response.json()["dispatches"] == []
    assert decisions_response.json()["decisions"] == []
    assert not (run_dir / "run_plan.json").exists()
    assert not (run_dir / "plan_steps.jsonl").exists()
    assert not (run_dir / "dispatches.jsonl").exists()
    assert not (run_dir / "decisions.jsonl").exists()


def test_control_ledger_endpoints_read_fixed_run_projection(client, project_root: Path) -> None:
    run_dir = project_root / "runs" / "server_run"
    write_fixed_ledger(run_dir)

    plan = client.get("/api/runs/server_run/plan").json()
    steps = client.get("/api/runs/server_run/steps").json()
    dispatches = client.get("/api/runs/server_run/dispatches").json()
    decisions = client.get("/api/runs/server_run/decisions").json()
    aggregate = client.get("/api/runs/server_run/control-ledger").json()

    assert plan["plan"]["source"] == "fixed"
    assert plan["events_ref"] == "runs/server_run/events.jsonl"
    assert plan["warnings"] == []
    assert steps["steps"][0]["status"] == "success"
    assert dispatches["dispatches"][0]["status"] == "completed"
    assert decisions["decisions"][0]["kind"] == "dispatch"
    assert aggregate["plan"]["run_plan_id"] == "run_plan_server_run"
    assert aggregate["steps"][0]["artifact_bundle_id"] == "bundle_server_run_server_node"
    assert aggregate["dispatches"][0]["dispatch_id"] == "dispatch_server_run_server_node"
    assert aggregate["decisions"][0]["decision_id"] == "decision_server_run_dispatch"


def test_decision_inbox_remains_separate_from_run_scoped_decisions(
    client,
    project_root: Path,
) -> None:
    write_fixed_ledger(project_root / "runs" / "server_run")

    response = client.get("/api/decisions?include_graphops=false")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["items"] == []
    assert payload["counts"]["open"] == 0


def write_fixed_ledger(run_dir: Path) -> None:
    write_run_plan(
        run_dir,
        RunPlan(
            run_plan_id="run_plan_server_run",
            run_id="server_run",
            workflow_function_id="server_workflow",
            invocation_id="invocation_server_run",
            source="fixed",
            schema_version="acc.control.v1",
            template_snapshot_ref="function_invocation.json",
            control_policy_id="fixed_control_policy",
            created_at="2026-06-03T00:00:00Z",
            status="active",
            step_count=1,
        ),
    )
    step_ready = plan_step(status="ready")
    step_dispatching = plan_step(
        status="dispatching",
        dispatch_id="dispatch_server_run_server_node",
    )
    step_running = plan_step(status="running", dispatch_id="dispatch_server_run_server_node")
    step_success = plan_step(
        status="success",
        dispatch_id="dispatch_server_run_server_node",
        decision_id="decision_server_run_dispatch",
        session_id="session_test",
        artifact_bundle_id="bundle_server_run_server_node",
    )
    for sequence, previous, current in (
        (1, None, step_ready),
        (2, "ready", step_dispatching),
        (3, "dispatching", step_running),
        (4, "running", step_success),
    ):
        append_plan_step_transition(
            run_dir,
            PlanStepTransitionRecord(
                sequence=sequence,
                recorded_at="2026-06-03T00:00:00Z",
                plan_step_id=current.plan_step_id,
                previous_status=previous,  # type: ignore[arg-type]
                next_status=current.status,
                snapshot=current,
                reason="test projection",
                decision_id=current.decision_id,
                dispatch_id=current.dispatch_id,
            ),
        )
    started = dispatch(status="started")
    completed = dispatch(status="completed", result_refs=("nodes/server_node/output.json",))
    for sequence, previous, current in ((1, None, started), (2, "started", completed)):
        append_dispatch_transition(
            run_dir,
            DispatchTransitionRecord(
                sequence=sequence,
                recorded_at="2026-06-03T00:00:00Z",
                dispatch_id=current.dispatch_id,
                previous_status=previous,  # type: ignore[arg-type]
                next_status=current.status,
                snapshot=current,
                reason="test projection",
                decision_id="decision_server_run_dispatch",
                plan_step_id="step_server_node",
            ),
        )
    append_decision_record(
        run_dir,
        DecisionRecord(
            decision_id="decision_server_run_dispatch",
            run_id="server_run",
            run_plan_id="run_plan_server_run",
            actor="system",
            kind="dispatch",
            timestamp="2026-06-03T00:00:00Z",
            input_evidence_refs=("run_plan.json",),
            selected={"action": "dispatch", "plan_step_id": "step_server_node"},
        ),
    )


def plan_step(
    *,
    status: str,
    dispatch_id: str | None = None,
    decision_id: str | None = None,
    session_id: str | None = None,
    artifact_bundle_id: str | None = None,
) -> PlanStep:
    return PlanStep(
        plan_step_id="step_server_node",
        run_plan_id="run_plan_server_run",
        run_id="server_run",
        node_id="server_node",
        callable_ref=callable_ref(),
        depends_on=(),
        source="fixed",
        status=status,  # type: ignore[arg-type]
        dispatch_id=dispatch_id,
        decision_id=decision_id,
        session_id=session_id,
        artifact_bundle_id=artifact_bundle_id,
        created_at="2026-06-03T00:00:00Z",
        updated_at="2026-06-03T00:00:00Z",
    )


def dispatch(
    *,
    status: str,
    result_refs: tuple[str, ...] = (),
) -> DispatchEnvelope:
    return DispatchEnvelope(
        dispatch_id="dispatch_server_run_server_node",
        run_id="server_run",
        run_plan_id="run_plan_server_run",
        plan_step_id="step_server_node",
        node_id="server_node",
        callable_ref=callable_ref(),
        scope_frame_id="scope_server_run_root",
        invocation_id="invocation_server_run",
        idempotency_key="server_run:step_server_node:1",
        correlation_id="decision_server_run_dispatch",
        input_ref="nodes/server_node/input.json",
        policy_snapshot_ref="run_plan.json",
        created_by_decision_id="decision_server_run_dispatch",
        attempt=1,
        created_at="2026-06-03T00:00:00Z",
        status=status,  # type: ignore[arg-type]
        result_refs=result_refs,
    )


def callable_ref() -> CallableRef:
    return CallableRef(kind="agent_class", id="echo-test.generic")
