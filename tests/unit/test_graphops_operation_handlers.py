from __future__ import annotations

import pytest

from acc.graphops import (
    _handle_create_agent_class,
    _handle_create_tool_class,
)
from acc.models import AccError


def test_handle_create_agent_class_valid() -> None:
    template = {
        "id": "reviewer.codex",
        "runtime": "codex_cli",
        "default_prompt": "Review the input.",
        "input_ports": {"main": {"type": "artifact", "required": False}},
        "output_ports": {"main": {"type": "artifact", "required": True}},
    }
    result = _handle_create_agent_class(
        "callables/agents/reviewer.codex.yaml",
        template,
        {},
    )
    assert result["kind"] == "agent_class"
    assert "reviewer.codex" in result["content"]
    assert isinstance(result["payload"], dict)


def test_handle_create_agent_class_id_filename_mismatch() -> None:
    template = {"id": "mismatched_id", "runtime": "codex_cli", "default_prompt": "x"}
    with pytest.raises(AccError, match="callable id must match target file name"):
        _handle_create_agent_class(
            "callables/agents/reviewer.codex.yaml",
            template,
            {},
        )


def test_handle_create_tool_class_missing_runner() -> None:
    template = {"id": "my_tool"}
    with pytest.raises(AccError, match="runner"):
        _handle_create_tool_class(
            "callables/tools/my_tool.yaml",
            template,
            {},
        )


def test_handle_create_tool_class_valid() -> None:
    template = {"id": "my_tool", "runner": "python", "version": "1.0.0"}
    result = _handle_create_tool_class(
        "callables/tools/my_tool.yaml",
        template,
        {},
    )
    assert result["kind"] == "tool_class"
    assert "my_tool" in result["content"]
    assert "python" in result["content"]
