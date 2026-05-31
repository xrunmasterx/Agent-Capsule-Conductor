from __future__ import annotations

from typing import Any

from acc.domain import AgentCapabilities
from acc.registry import CapsuleDefinition

ADAPTER_DEFAULT_CAPABILITIES: dict[str, AgentCapabilities] = {
    "generic_cli": AgentCapabilities(log_streaming=True),
    "codex_cli": AgentCapabilities(
        resumable_session=True,
        status_updates=True,
        log_streaming=True,
        token_usage=True,
    ),
    "claude_sdk": AgentCapabilities(status_updates=True, log_streaming=True),
}


def default_adapter_capabilities(adapter_key: str) -> AgentCapabilities:
    return ADAPTER_DEFAULT_CAPABILITIES.get(adapter_key, AgentCapabilities())


def capabilities_from_mapping(raw: dict[str, Any] | None) -> AgentCapabilities:
    if not isinstance(raw, dict):
        return AgentCapabilities()
    return AgentCapabilities(
        resumable_session=bool(raw.get("resumable_session")),
        status_updates=bool(raw.get("status_updates")),
        log_streaming=bool(raw.get("log_streaming")),
        token_usage=bool(raw.get("token_usage")),
    )


def merge_capabilities(
    adapter_caps: AgentCapabilities,
    capsule_caps: AgentCapabilities,
) -> tuple[AgentCapabilities, list[str]]:
    warnings: list[str] = []
    merged = AgentCapabilities(
        resumable_session=capsule_caps.resumable_session or adapter_caps.resumable_session,
        status_updates=capsule_caps.status_updates or adapter_caps.status_updates,
        log_streaming=capsule_caps.log_streaming or adapter_caps.log_streaming,
        token_usage=capsule_caps.token_usage or adapter_caps.token_usage,
    )
    for key in capsule_caps.effective_keys():
        if key not in adapter_caps.effective_keys():
            warnings.append(
                f"Capsule declares capability {key!r} but adapter does not implement it"
            )
    return merged, warnings


def resolve_capsule_capabilities(capsule: CapsuleDefinition) -> AgentCapabilities:
    adapter_key = capsule.spec.runtime.type
    adapter_caps = default_adapter_capabilities(adapter_key)
    yaml_caps = getattr(capsule.spec.runtime, "capabilities", None)
    capsule_caps = (
        capabilities_from_mapping(yaml_caps.model_dump())
        if yaml_caps is not None
        else AgentCapabilities()
    )
    merged, _warnings = merge_capabilities(adapter_caps, capsule_caps)
    return merged
