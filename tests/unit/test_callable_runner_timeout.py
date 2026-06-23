from __future__ import annotations

import pytest

from acc.callable_runner import effective_timeout_seconds
from acc.models import AgentClassTemplate, CallableRef, InvocationPolicy, NodeInvocationSpec


def test_codex_app_server_node_uses_production_default_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ACC_CODEX_APP_SERVER_TIMEOUT_SECONDS", raising=False)
    monkeypatch.delenv("ACC_RUN_MODE", raising=False)
    template = AgentClassTemplate(
        id="agent.codex",
        version="0.1.0",
        runtime="codex_app_server",
    )
    node = NodeInvocationSpec(
        id="agent",
        callable_ref=CallableRef(kind="agent_class", id="agent.codex"),
    )

    assert effective_timeout_seconds(template, node) == 1200


def test_codex_app_server_node_explicit_timeout_wins(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ACC_CODEX_APP_SERVER_TIMEOUT_SECONDS", "600")
    template = AgentClassTemplate(
        id="agent.codex",
        version="0.1.0",
        runtime="codex_app_server",
    )
    node = NodeInvocationSpec(
        id="agent",
        callable_ref=CallableRef(kind="agent_class", id="agent.codex"),
        invocation_policy=InvocationPolicy(timeout_seconds=120),
    )

    assert effective_timeout_seconds(template, node) == 120
