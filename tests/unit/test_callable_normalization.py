from __future__ import annotations

from acc.callable_runner import codex_execution_mode_for_node
from acc.constants import CODEX_DANGER_FULL_ACCESS, CODEX_EXECUTION_MODE_METADATA_KEY
from acc.models import CallableRef, NodeInvocationSpec
from acc.runner import codex_execution_mode_from_node


def test_codex_execution_mode_metadata_matches_runtime_normalizer() -> None:
    raw_node = {
        "id": "research",
        "callable_ref": {"kind": "agent_class", "id": "worker.codex"},
        "metadata": {CODEX_EXECUTION_MODE_METADATA_KEY: CODEX_DANGER_FULL_ACCESS},
    }
    node = NodeInvocationSpec(
        id="research",
        callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
        metadata={CODEX_EXECUTION_MODE_METADATA_KEY: CODEX_DANGER_FULL_ACCESS},
    )

    assert codex_execution_mode_from_node(raw_node) == codex_execution_mode_for_node(node)


def test_legacy_top_level_codex_execution_mode_is_preflight_only() -> None:
    raw_node = {
        "id": "research",
        "callable_ref": {"kind": "agent_class", "id": "worker.codex"},
        "codex_execution_mode": CODEX_DANGER_FULL_ACCESS,
    }
    node = NodeInvocationSpec(
        id="research",
        callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
    )

    assert codex_execution_mode_from_node(raw_node) == CODEX_DANGER_FULL_ACCESS
    assert codex_execution_mode_for_node(node) is None
