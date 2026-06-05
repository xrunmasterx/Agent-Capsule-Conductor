from __future__ import annotations

HERMETIC_TOOL_CLASS_IDS: frozenset[str] = frozenset(
    {"fake_producer", "fake", "merge", "fail"}
)
HERMETIC_AGENT_CLASS_IDS: frozenset[str] = frozenset(
    {"generic_fake_agent", "fake-agent.generic"}
)

HERMETIC_CALLABLE_REFS: frozenset[tuple[str, str]] = frozenset(
    {("tool_class", callable_id) for callable_id in HERMETIC_TOOL_CLASS_IDS}
    | {("agent_class", callable_id) for callable_id in HERMETIC_AGENT_CLASS_IDS}
)
