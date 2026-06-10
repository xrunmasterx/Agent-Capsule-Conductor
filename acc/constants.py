"""Shared constants for ACC. Import from here; do not redefine in submodules."""

from __future__ import annotations

CODEX_EXECUTION_MODE_METADATA_KEY = "codex_execution_mode"
CODEX_LOCAL_READONLY_NO_SANDBOX = "local_readonly_no_sandbox"
CODEX_DANGER_FULL_ACCESS = "danger_full_access"
CODEX_EXECUTION_MODES: frozenset[str] = frozenset(
    {
        CODEX_LOCAL_READONLY_NO_SANDBOX,
        CODEX_DANGER_FULL_ACCESS,
    }
)
