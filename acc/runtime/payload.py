"""Agent-visible and ACC runtime-only payload split."""

from __future__ import annotations

from typing import TypedDict


class AgentPayload(TypedDict, total=False):
    """Keys visible to the agent's context."""


class RuntimePayload(TypedDict, total=False):
    """Runtime-only sidecar fields that are never surfaced to an agent prompt."""

    provenance: dict
    binding_materializations: list
    frame_id: str
    call_depth: int


RUNTIME_ONLY_KEYS: frozenset[str] = frozenset(
    {
        "__acc_runtime_metadata__",
        "__acc_provenance__",
        "__acc_frame_id__",
        "__acc_call_depth__",
    }
)


def split_payloads(merged: dict) -> tuple[AgentPayload, RuntimePayload]:
    """Split a merged input payload into agent-visible / runtime-only halves."""

    agent_dict: dict = {}
    runtime_dict: dict = {}
    for key, value in merged.items():
        if key in RUNTIME_ONLY_KEYS:
            runtime_dict[key] = value
        else:
            agent_dict[key] = value
    return agent_dict, runtime_dict  # type: ignore[return-value]


__all__ = [
    "AgentPayload",
    "RuntimePayload",
    "RUNTIME_ONLY_KEYS",
    "split_payloads",
]
