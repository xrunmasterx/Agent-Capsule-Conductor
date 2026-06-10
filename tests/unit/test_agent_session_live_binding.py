from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from acc.adapters.streaming import StreamingAgentTurnRequest, StreamingAgentTurnResult
from acc.app.agent_sessions import AgentTurnService
from acc.models import (
    AgentClassTemplate,
    CallableRef,
    NodeInvocationSpec,
    ScopeFrame,
    SessionInstance,
)


def test_workflow_node_turn_writes_live_binding_before_adapter_completes(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    monkeypatch.setenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", "1")
    node_dir = tmp_path / "runs" / "run_live" / "nodes" / "research"
    node_dir.mkdir(parents=True)
    scope = ScopeFrame(
        frame_id="scope_live",
        invocation_id="invocation_live",
        parent_frame_id=None,
        call_depth=0,
        workflow_id="workflow_live",
        workspace_root=tmp_path,
        environment_root=tmp_path / "runs" / "run_live",
        inbox_root=tmp_path / "runs" / "run_live" / ".acc" / "inbox",
        outbox_root=tmp_path / "runs" / "run_live" / ".acc" / "outbox",
        artifact_root=tmp_path / "runs" / "run_live" / ".acc" / "artifacts",
        behavior_snapshot_path=tmp_path / "runs" / "run_live" / ".acc" / "behavior.json",
        ephemeral=True,
    )
    node = NodeInvocationSpec(
        id="research",
        callable_ref=CallableRef(kind="agent_class", id="research.codex"),
        output_schema=simple_output_schema(),
    )
    session = SessionInstance(
        session_id="session_live",
        invocation_id="invocation_live",
        scope_frame_id="scope_live",
        node_id="research",
        callable_ref=node.callable_ref,
        callable_kind="agent_class",
        status="running",
        cwd=tmp_path,
        env_keys=(),
        input_path=node_dir / "input.json",
        output_path=node_dir / "output.json",
        artifact_dir=node_dir / "artifacts",
        event_log_path=node_dir / "events.jsonl",
    )
    adapter = RuntimeBindingAssertingAdapter(node_dir)
    service = AgentTurnService(project_root=tmp_path, adapter=adapter)

    output = asyncio.run(
        service.run_workflow_node_turn(
            CallableAssetFixture(
                AgentClassTemplate(
                    id="research.codex",
                    version="0.1.0",
                    runtime="codex_app_server",
                    metadata={"timeout_seconds": 30},
                )
            ),
            {"topic": "MSFT"},
            node_dir,
            node=node,
            scope=scope,
            session=session,
            binding_materializations=[],
        )
    )

    assert output == {"summary": "done"}
    assert adapter.runtime_during_turn is not None
    assert adapter.runtime_during_turn["agent_session_ref"]
    assert adapter.runtime_during_turn["turn_id"] == adapter.request_turn_id


class CallableAssetFixture:
    def __init__(self, template: AgentClassTemplate) -> None:
        self.template = template
        self.source_id = template.id


def simple_output_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {"summary": {"type": "string"}},
        "required": ["summary"],
    }


class RuntimeBindingAssertingAdapter:
    def __init__(self, node_dir: Path) -> None:
        self.node_dir = node_dir
        self.runtime_during_turn: dict[str, Any] | None = None
        self.request_turn_id = ""

    async def run_turn(self, request: StreamingAgentTurnRequest) -> StreamingAgentTurnResult:
        self.request_turn_id = request.turn_id
        self.runtime_during_turn = json.loads(
            (self.node_dir / "runtime.json").read_text(encoding="utf-8")
        )
        request.stdout_log_path.write_text("streamed while running\n", encoding="utf-8")
        request.output_json_path.write_text(
            json.dumps({"summary": "done"}),
            encoding="utf-8",
        )
        return StreamingAgentTurnResult(
            status="success",
            summary="done",
            output_json_path=request.output_json_path,
            event_log_path=request.events_log_path,
            provider_event_log_path=request.provider_events_log_path,
            provider_session_id="provider_live",
            assistant_messages=("done",),
        )
