from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from acc.adapters.base import ResumeRequest
from acc.adapters.capabilities import (
    default_adapter_capabilities,
    merge_capabilities,
    resolve_class_template_capabilities,
)
from acc.adapters.generic_cli import GenericCliAdapter
from acc.domain import AccError, AgentCapabilities, AgentClassTemplate


def test_agent_capabilities_defaults() -> None:
    caps = AgentCapabilities()
    assert caps.as_dict() == {
        "resumable_session": False,
        "status_updates": False,
        "log_streaming": False,
        "token_usage": False,
    }
    assert caps.effective_keys() == ()


def test_adapter_default_capabilities() -> None:
    codex = default_adapter_capabilities("codex_cli")
    assert codex.resumable_session is True
    assert codex.log_streaming is True
    generic = default_adapter_capabilities("unknown")
    assert generic == AgentCapabilities()


def test_merge_capabilities_warns_on_over_declaration() -> None:
    adapter = AgentCapabilities(log_streaming=True)
    callable = AgentCapabilities(resumable_session=True)
    merged, warnings = merge_capabilities(adapter, callable)
    assert merged.log_streaming is True
    assert "resumable_session" in warnings[0]


def test_resolve_class_template_capabilities() -> None:
    template = AgentClassTemplate(
        id="demo.agent",
        version="0.1.0",
        runtime="generic_cli",
        metadata={"capabilities": {"log_streaming": True}},
    )
    caps = resolve_class_template_capabilities(template)
    assert caps.log_streaming is True


def test_generic_cli_resume_rejected() -> None:
    adapter = GenericCliAdapter()

    async def _run() -> None:
        with pytest.raises(AccError, match="does not support resume"):
            await adapter.resume(
                ResumeRequest(
                    callable_id="demo",
                    run_dir=Path("."),
                    workspace_dir=Path("."),
                    external_session_id="sess",
                    timeout_seconds=10,
                )
            )

    asyncio.run(_run())

