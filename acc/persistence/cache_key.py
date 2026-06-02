"""Deterministic node cache key for future Phase 3 resume cache.

DESIGN anchor: §11.2 explicit checkpoint and pause/resume.
STRATEGY anchor: §6.1 PR-1.13 — Phase 1 ships the *producer* function;
the *consumer* (pause/resume short-circuit in DAGScheduler) is wired in
Phase 3 (§6.3). Keep this module dependency-free so the import-linter
contract for ``acc/persistence/`` stays clean.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence


def compute_cache_key(
    callable_id: str,
    callable_version: str,
    ordered_binding_inputs_sha256: Sequence[str],
) -> str:
    """Return ``sha256(callable_id|callable_version|<inputs joined by '|'>)``.

    The caller is responsible for ordering ``ordered_binding_inputs_sha256``
    deterministically (typically by ``(node_id, port_id)``). The function
    only concatenates with ``|`` and hashes; it does not sort or
    canonicalize the input list.
    """

    joined = "|".join(ordered_binding_inputs_sha256)
    raw = f"{callable_id}|{callable_version}|{joined}".encode()
    return hashlib.sha256(raw).hexdigest()
