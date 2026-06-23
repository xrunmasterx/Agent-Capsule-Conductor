from __future__ import annotations

from acc.run_status import (
    ACTIVE_RUN_STATUSES,
    RESTART_INTERRUPTED_RUN_STATUSES,
    RESUMING_RUN_STATUSES,
    TERMINAL_RUN_STATUSES,
    WAITING_RUN_STATUSES,
    is_active_run_status,
    is_cancelled_run_status,
    is_failed_run_status,
    is_restart_interrupted_run_status,
    is_resuming_run_status,
    is_terminal_run_status,
    is_timeout_run_status,
    is_waiting_run_status,
)


def test_run_status_sets_are_canonical_frozensets() -> None:
    assert frozenset(
        {"success", "failed", "cancelled", "crashed", "timeout"}
    ) == TERMINAL_RUN_STATUSES
    assert frozenset(
        {"waiting_interaction", "waiting_handoff", "waiting_timer"}
    ) == WAITING_RUN_STATUSES
    assert frozenset({"resuming"}) == RESUMING_RUN_STATUSES
    assert frozenset(
        {
            "queued",
            "running",
            "cancel_requested",
            "waiting_interaction",
            "waiting_handoff",
            "waiting_timer",
            "resuming",
        }
    ) == ACTIVE_RUN_STATUSES
    assert frozenset(
        {"queued", "running", "cancel_requested", "resuming"}
    ) == RESTART_INTERRUPTED_RUN_STATUSES


def test_run_status_predicates_classify_timeout_and_waiting_states() -> None:
    assert is_terminal_run_status("timeout")
    assert is_timeout_run_status("timeout")
    assert not is_active_run_status("timeout")
    assert not is_waiting_run_status("timeout")

    for status in ("waiting_interaction", "waiting_handoff", "waiting_timer"):
        assert is_waiting_run_status(status)
        assert is_active_run_status(status)
        assert not is_terminal_run_status(status)
        assert not is_restart_interrupted_run_status(status)

    assert is_resuming_run_status("resuming")
    assert is_active_run_status("resuming")
    assert is_restart_interrupted_run_status("resuming")
    assert not is_terminal_run_status("resuming")


def test_run_status_predicates_are_none_safe() -> None:
    assert not is_terminal_run_status(None)
    assert not is_active_run_status(None)
    assert not is_waiting_run_status(None)
    assert not is_resuming_run_status(None)
    assert not is_restart_interrupted_run_status(None)
    assert not is_failed_run_status(None)
    assert not is_cancelled_run_status(None)
    assert not is_timeout_run_status(None)


def test_optional_status_predicates_match_terminal_subfamilies() -> None:
    assert is_failed_run_status("failed")
    assert is_failed_run_status("crashed")
    assert not is_failed_run_status("timeout")
    assert is_cancelled_run_status("cancelled")
    assert not is_cancelled_run_status("cancel_requested")
