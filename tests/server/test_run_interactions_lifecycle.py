from __future__ import annotations

import json
from pathlib import Path

from acc.app.interactions import create_interaction, get_interaction
from acc.domain import (
    CallableRef,
    DecisionRecord,
    PlanStep,
    PlanStepTransitionRecord,
    RunPlan,
)
from acc.store.control_ledger import (
    append_decision_record,
    append_plan_step_transition,
    load_plan_steps,
    write_run_plan,
)


def test_terminal_run_answer_is_rejected(client, project_root: Path) -> None:
    run_dir = project_root / "runs" / "server_run"
    interaction = create_interaction(
        run_dir,
        run_id="server_run",
        kind="approval",
        prompt="approve?",
        node_id="server_node",
    )

    response = client.post(
        f"/api/runs/server_run/interactions/{interaction.interaction_id}/answer",
        json={"answer": {"decision": "approve"}},
    )

    assert response.status_code == 400, response.text
    assert "Terminal run cannot be answered or woken" in response.json()["detail"]
    assert get_interaction(run_dir, interaction.interaction_id).status == "pending"


def test_waiting_interaction_answer_triggers_resume_service(
    client,
    project_root: Path,
) -> None:
    run_dir = project_root / "runs" / "waiting_run"
    run_dir.mkdir(parents=True)
    _write_run_summary(run_dir, "waiting_interaction")
    interaction = create_interaction(
        run_dir,
        run_id="waiting_run",
        kind="approval",
        prompt="approve?",
        node_id="gate",
    )
    _write_waiting_ledger(run_dir, interaction_id=interaction.interaction_id)

    response = client.post(
        f"/api/runs/waiting_run/interactions/{interaction.interaction_id}/answer",
        json={"answer": {"decision": "approve"}},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    summary = json.loads((run_dir / "run_summary.json").read_text(encoding="utf-8"))
    latest_steps = {step.plan_step_id: step for step in load_plan_steps(run_dir).value}
    assert payload["status"] == "answered"
    assert payload["resume"]["status"] == "resuming"
    assert payload["resume"]["resumed_step_ids"] == ["step_gate"]
    assert summary["status"] == "resuming"
    assert latest_steps["step_gate"].status == "ready"
    assert (run_dir / "wakeup_queue.jsonl").exists()


def _write_run_summary(run_dir: Path, status: str) -> None:
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": run_dir.name,
                "workflow_id": "workflow_resume",
                "status": status,
                "run_dir": str(run_dir.resolve()),
                "node_count": 0,
                "failed_nodes": [],
                "nodes": [],
            }
        ),
        encoding="utf-8",
    )


def _write_waiting_ledger(run_dir: Path, *, interaction_id: str) -> None:
    write_run_plan(
        run_dir,
        RunPlan(
            run_plan_id=f"run_plan_{run_dir.name}",
            run_id=run_dir.name,
            workflow_function_id="workflow_resume",
            invocation_id=f"invocation_{run_dir.name}",
            source="fixed",
            schema_version="acc.control.v1",
            template_snapshot_ref="function_invocation.json",
            control_policy_id="fixed_control_policy",
            created_at="2026-06-03T00:00:00Z",
            status="active",
            step_count=1,
        ),
    )
    step = PlanStep(
        plan_step_id="step_gate",
        run_plan_id=f"run_plan_{run_dir.name}",
        run_id=run_dir.name,
        node_id="gate",
        callable_ref=CallableRef(kind="agent_class", id="gate.codex"),
        depends_on=(),
        source="fixed",
        status="waiting_interaction",
        required_interaction_id=interaction_id,
        created_at="2026-06-03T00:00:00Z",
        updated_at="2026-06-03T00:00:00Z",
    )
    append_plan_step_transition(
        run_dir,
        PlanStepTransitionRecord(
            sequence=1,
            recorded_at="2026-06-03T00:00:00Z",
            plan_step_id=step.plan_step_id,
            previous_status=None,
            next_status="waiting_interaction",
            snapshot=step,
            reason="test waiting ledger",
        ),
    )
    append_decision_record(
        run_dir,
        DecisionRecord(
            decision_id="decision_gate",
            run_id=run_dir.name,
            run_plan_id=f"run_plan_{run_dir.name}",
            actor="human",
            kind="approval",
            timestamp="2026-06-03T00:00:00Z",
            input_evidence_refs=(f"interactions/{interaction_id}.json",),
            selected={"interaction_id": interaction_id},
        ),
    )
