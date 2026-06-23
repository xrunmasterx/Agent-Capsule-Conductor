from __future__ import annotations

TERMINAL_RUN_STATUSES = frozenset({"success", "failed", "cancelled", "crashed", "timeout"})
WAITING_RUN_STATUSES = frozenset(
    {"waiting_interaction", "waiting_handoff", "waiting_timer"}
)
RESUMING_RUN_STATUSES = frozenset({"resuming"})
ACTIVE_RUN_STATUSES = (
    frozenset({"queued", "running", "cancel_requested"})
    | WAITING_RUN_STATUSES
    | RESUMING_RUN_STATUSES
)
RESTART_INTERRUPTED_RUN_STATUSES = frozenset(
    {"queued", "running", "cancel_requested", "resuming"}
)


def is_terminal_run_status(status: str | None) -> bool:
    return status in TERMINAL_RUN_STATUSES


def is_active_run_status(status: str | None) -> bool:
    return status in ACTIVE_RUN_STATUSES


def is_waiting_run_status(status: str | None) -> bool:
    return status in WAITING_RUN_STATUSES


def is_resuming_run_status(status: str | None) -> bool:
    return status in RESUMING_RUN_STATUSES


def is_restart_interrupted_run_status(status: str | None) -> bool:
    return status in RESTART_INTERRUPTED_RUN_STATUSES


def is_failed_run_status(status: str | None) -> bool:
    return status in {"failed", "crashed"}


def is_cancelled_run_status(status: str | None) -> bool:
    return status == "cancelled"


def is_timeout_run_status(status: str | None) -> bool:
    return status == "timeout"
