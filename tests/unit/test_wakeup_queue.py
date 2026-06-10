from __future__ import annotations

from pathlib import Path

from acc.app.scheduler import (
    claim_next_human_wakeup_for_resume,
    claim_next_ready,
    enqueue_wakeup,
    load_wakeup_state,
    new_wakeup_request,
    reconcile_wakeup_state,
    scan_session_health,
)
from acc.models import CallableRef


def test_enqueue_wakeup_coalesces_by_key(tmp_path: Path) -> None:
    run_dir = tmp_path / "run1"
    run_dir.mkdir()
    req1 = new_wakeup_request(
        run_id="run1",
        reason="supervisor",
        coalesce_key="sup:wake",
        target_node_id="sup",
    )
    req2 = new_wakeup_request(
        run_id="run1",
        reason="supervisor",
        coalesce_key="sup:wake",
        target_node_id="sup",
        payload={"attempt": 2},
    )
    enqueue_wakeup(run_dir, req1)
    enqueue_wakeup(run_dir, req2)
    state = load_wakeup_state(run_dir)
    assert len(state["pending"]) == 1


def test_reconcile_after_restart(tmp_path: Path) -> None:
    run_dir = tmp_path / "run2"
    run_dir.mkdir()
    req = new_wakeup_request(run_id="run2", reason="dependency_met", target_node_id="n1")
    enqueue_wakeup(run_dir, req)
    state = reconcile_wakeup_state(run_dir)
    assert len(state["pending"]) == 1


def test_claim_next_ready_consumes_item(tmp_path: Path) -> None:
    run_dir = tmp_path / "run3"
    run_dir.mkdir()
    enqueue_wakeup(
        run_dir,
        new_wakeup_request(
            run_id="run3",
            reason="timer",
            target_callable_ref=CallableRef(kind="agent_class", id="worker"),
        ),
    )
    claimed = claim_next_ready(run_dir)
    assert claimed is not None
    assert claimed.target_callable_ref is not None
    assert claim_next_ready(run_dir) is None


def test_claim_next_human_wakeup_triggers_resume_service(tmp_path: Path, monkeypatch) -> None:
    run_dir = tmp_path / "run-human"
    run_dir.mkdir()
    calls: list[dict[str, str]] = []

    class _ResumeResult:
        def as_payload(self) -> dict[str, str]:
            return {"status": "resuming"}

    def fake_resume_waiting_run(
        received_run_dir: Path,
        *,
        reason: str,
        interaction_id: str | None,
    ) -> _ResumeResult:
        calls.append(
            {
                "run_dir": str(received_run_dir),
                "reason": reason,
                "interaction_id": interaction_id or "",
            }
        )
        return _ResumeResult()

    monkeypatch.setattr(
        "acc.app.scheduler.resume_waiting_run",
        fake_resume_waiting_run,
    )
    enqueue_wakeup(
        run_dir,
        new_wakeup_request(
            run_id="run-human",
            reason="human",
            coalesce_key="interaction:ask",
            payload={"interaction_id": "ask"},
        ),
    )

    result = claim_next_human_wakeup_for_resume(run_dir)

    assert result is not None
    assert result["resume"]["status"] == "resuming"
    assert calls == [
        {
            "run_dir": str(run_dir),
            "reason": "human",
            "interaction_id": "ask",
        }
    ]
    assert load_wakeup_state(run_dir)["pending"] == []


def test_scan_session_health_stale() -> None:
    health = scan_session_health(
        {"status": "running", "started_at": "2020-01-01T00:00:00Z"},
        now_iso="2026-05-29T00:00:00Z",
        stale_after_seconds=60,
    )
    assert health == "stale"
