from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from acc.adapters.base import ResumeRequest
from acc.adapters.capabilities import (
    default_adapter_capabilities,
    merge_capabilities,
    resolve_capsule_capabilities,
)
from acc.adapters.generic_cli import GenericCliAdapter
from acc.domain import AccError, AgentCapabilities
from acc.registry import CapsuleRegistry


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
    capsule = AgentCapabilities(resumable_session=True)
    merged, warnings = merge_capabilities(adapter, capsule)
    assert merged.log_streaming is True
    assert "resumable_session" in warnings[0]


def test_resolve_capsule_capabilities_from_registry(tmp_path) -> None:
    registry = CapsuleRegistry(tmp_path / "capsules")
    (tmp_path / "capsules" / "demo.generic").mkdir(parents=True)
    (tmp_path / "capsules" / "demo.generic" / "capsule.yaml").write_text(
        """
id: demo.generic
version: 0.1.0
name: Demo
description: Demo
runtime:
  type: generic_cli
  command: python
  args_base: ["-c", "print('ok')"]
  capabilities:
    log_streaming: true
workspace:
  mode: existing_dir
permissions:
  sandbox: read-only
  network: false
  write_files: false
  timeout_seconds: 10
  allow_dangerous: false
prompt:
  template: prompt_template.md
schema:
  input: input_schema.json
  output: output_schema.json
artifacts:
  manifest: artifact_manifest.yaml
""".strip(),
        encoding="utf-8",
    )
    for name in (
        "prompt_template.md",
        "input_schema.json",
        "output_schema.json",
        "artifact_manifest.yaml",
    ):
        (tmp_path / "capsules" / "demo.generic" / name).write_text("{}", encoding="utf-8")
    capsule = registry.get("demo.generic")
    caps = resolve_capsule_capabilities(capsule)
    assert caps.log_streaming is True


def test_generic_cli_resume_rejected() -> None:
    adapter = GenericCliAdapter()

    async def _run() -> None:
        with pytest.raises(AccError, match="does not support resume"):
            await adapter.resume(
                ResumeRequest(
                    capsule_id="demo",
                    run_dir=Path("."),
                    workspace_dir=Path("."),
                    external_session_id="sess",
                    timeout_seconds=10,
                )
            )

    asyncio.run(_run())
