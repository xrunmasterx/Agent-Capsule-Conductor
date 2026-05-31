from __future__ import annotations

from pathlib import Path

import pytest

from acc.app import use_supervisor
from acc.app.supervisor import (
    SupervisorRouter,
    build_supervisor_roster,
    load_supervisor_state,
)
from acc.domain import CallableRef, DynamicInvocationIntent
from acc.registry import CapsuleRegistry


@pytest.fixture()
def registry_with_agent(tmp_path: Path) -> CapsuleRegistry:
    capsule_dir = tmp_path / "capsules" / "worker.generic"
    capsule_dir.mkdir(parents=True)
    (capsule_dir / "capsule.yaml").write_text(
        """
id: worker.generic
version: 0.1.0
name: Worker
description: Worker
runtime:
  type: generic_cli
  command: python
  args_base: ["-c", "print('ok')"]
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
        (capsule_dir / name).write_text("{}", encoding="utf-8")
    return CapsuleRegistry(tmp_path / "capsules")


def test_build_supervisor_roster_stable_sort(registry_with_agent: CapsuleRegistry) -> None:
    roster = build_supervisor_roster(registry_with_agent)
    assert len(roster.entries) == 1
    assert roster.entries[0].callable_ref.id == "worker.generic"


def test_supervisor_dedupe_correlation_id(
    registry_with_agent: CapsuleRegistry,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ACC_ENABLE_SUPERVISOR", "1")
    assert use_supervisor() is True
    run_dir = tmp_path / "sup_run"
    run_dir.mkdir()
    from acc.app.invocation import CallableInvocationService

    router = SupervisorRouter(
        registry=registry_with_agent,
        callable_service=CallableInvocationService(registry=registry_with_agent),
        run_dir=run_dir,
        supervisor_node_id="sup",
    )
    intent = DynamicInvocationIntent(
        target_callable_ref=CallableRef(kind="agent_class", id="worker.generic"),
        input_payload={"message": "hi"},
        rationale="dispatch",
        correlation_id="cid-dup",
    )
    router.record_dispatch(intent, session_id="sess1")
    state = load_supervisor_state(run_dir)
    assert state["correlation_ids"]["cid-dup"] == "sess1"
    assert router.existing_session_for_correlation("cid-dup") == "sess1"


def test_supervisor_router_rejects_unknown_intent(
    registry_with_agent: CapsuleRegistry, tmp_path: Path
) -> None:
    from acc.app.invocation import CallableInvocationService

    router = SupervisorRouter(
        registry=registry_with_agent,
        callable_service=CallableInvocationService(registry=registry_with_agent),
        run_dir=tmp_path / "run",
        supervisor_node_id="sup",
    )
    intent = DynamicInvocationIntent(
        target_callable_ref=CallableRef(kind="agent_class", id="missing"),
        input_payload={},
        rationale="x",
        correlation_id="c1",
    )
    with pytest.raises(Exception, match="not in supervisor roster"):
        router.validate_intent(intent)
