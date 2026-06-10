from __future__ import annotations

import json
from pathlib import Path

import pytest

from acc.app.interactions import answer_interaction, create_interaction
from acc.app.run_lifecycle import (
    ACTIVE_RUN_STATUSES,
    RESTART_INTERRUPTED_RUN_STATUSES,
    TERMINAL_RUN_STATUSES,
    WAITING_RUN_STATUSES,
    is_active_run_status,
    is_restart_interrupted_run_status,
    is_terminal_run_status,
    resume_waiting_run,
)
from acc.models import (
    AccError,
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


def test_run_status_classification_keeps_waiting_and_resuming_non_terminal() -> None:
    assert frozenset({"success", "failed", "cancelled", "crashed"}) == TERMINAL_RUN_STATUSES
    assert (
        frozenset({"waiting_interaction", "waiting_handoff", "waiting_timer"})
        == WAITING_RUN_STATUSES
    )
    assert "resuming" in ACTIVE_RUN_STATUSES
    assert "waiting_interaction" in ACTIVE_RUN_STATUSES
    assert "waiting_interaction" not in TERMINAL_RUN_STATUSES
    assert is_active_run_status("waiting_interaction")
    assert is_active_run_status("resuming")
    assert not is_terminal_run_status("waiting_interaction")
    assert not is_terminal_run_status("resuming")
    assert not is_restart_interrupted_run_status("waiting_interaction")
    assert "resuming" in RESTART_INTERRUPTED_RUN_STATUSES


def test_resume_waiting_run_is_non_destructive_and_does_not_rerun_success_steps(
    tmp_path: Path,
) -> None:
    run_dir = tmp_path / "run_waiting"
    run_dir.mkdir()
    sentinel = run_dir / "sentinel.txt"
    sentinel.write_text("keep", encoding="utf-8")
    _write_run_summary(run_dir, "waiting_interaction")
    interaction = create_interaction(
        run_dir,
        run_id=run_dir.name,
        kind="approval",
        prompt="approve?",
        node_id="gate",
    )
    answer_interaction(run_dir, interaction.interaction_id, {"decision": "approve"})
    _write_resume_ledger(run_dir, interaction_id=interaction.interaction_id)

    result = resume_waiting_run(
        run_dir,
        reason="human",
        interaction_id=interaction.interaction_id,
    )

    summary = json.loads((run_dir / "run_summary.json").read_text(encoding="utf-8"))
    latest_steps = {step.plan_step_id: step for step in load_plan_steps(run_dir).value}
    assert result.status == "resuming"
    assert result.resumed_step_ids == ("step_gate",)
    assert result.skipped_success_step_ids == ("step_done",)
    assert sentinel.read_text(encoding="utf-8") == "keep"
    assert summary["status"] == "resuming"
    assert "ended_at" not in summary
    assert latest_steps["step_done"].status == "success"
    assert latest_steps["step_done"].artifact_bundle_id == "bundle_done"
    assert latest_steps["step_gate"].status == "ready"


def test_resume_waiting_run_rejects_terminal_run(tmp_path: Path) -> None:
    run_dir = tmp_path / "run_terminal"
    run_dir.mkdir()
    _write_run_summary(run_dir, "success")

    with pytest.raises(AccError, match="Cannot resume terminal run"):
        resume_waiting_run(run_dir, reason="human", interaction_id="interaction_1")


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


def _write_resume_ledger(run_dir: Path, *, interaction_id: str) -> None:
    write_run_plan(
        run_dir,
        RunPlan(
            run_plan_id="run_plan_run_waiting",
            run_id=run_dir.name,
            workflow_function_id="workflow_resume",
            invocation_id="invocation_run_waiting",
            source="fixed",
            schema_version="acc.control.v1",
            template_snapshot_ref="function_invocation.json",
            control_policy_id="fixed_control_policy",
            created_at="2026-06-03T00:00:00Z",
            status="active",
            step_count=2,
        ),
    )
    transitions = [
        (1, None, _step("step_done", "done", "ready")),
        (2, "ready", _step("step_done", "done", "dispatching")),
        (3, "dispatching", _step("step_done", "done", "running")),
        (
            4,
            "running",
            _step(
                "step_done",
                "done",
                "success",
                session_id="session_done",
                artifact_bundle_id="bundle_done",
            ),
        ),
        (
            5,
            None,
            _step(
                "step_gate",
                "gate",
                "waiting_interaction",
                depends_on=("step_done",),
                required_interaction_id=interaction_id,
            ),
        ),
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
                reason="test resume ledger",
            ),
        )
    append_decision_record(
        run_dir,
        DecisionRecord(
            decision_id="decision_gate",
            run_id=run_dir.name,
            run_plan_id="run_plan_run_waiting",
            actor="human",
            kind="approval",
            timestamp="2026-06-03T00:00:00Z",
            input_evidence_refs=(f"interactions/{interaction_id}.json",),
            selected={"interaction_id": interaction_id, "decision": "approve"},
        ),
    )


def _step(
    plan_step_id: str,
    node_id: str,
    status: str,
    *,
    depends_on: tuple[str, ...] = (),
    required_interaction_id: str | None = None,
    session_id: str | None = None,
    artifact_bundle_id: str | None = None,
) -> PlanStep:
    return PlanStep(
        plan_step_id=plan_step_id,
        run_plan_id="run_plan_run_waiting",
        run_id="run_waiting",
        node_id=node_id,
        callable_ref=CallableRef(kind="agent_class", id=f"{node_id}.codex"),
        depends_on=depends_on,
        source="fixed",
        status=status,  # type: ignore[arg-type]
        dependency_node_ids=tuple(dep.removeprefix("step_") for dep in depends_on),
        required_interaction_id=required_interaction_id,
        session_id=session_id,
        artifact_bundle_id=artifact_bundle_id,
        created_at="2026-06-03T00:00:00Z",
        updated_at="2026-06-03T00:00:00Z",
    )
