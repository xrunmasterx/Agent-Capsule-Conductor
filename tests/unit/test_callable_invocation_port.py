from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from acc.app.runtime.context import build_execution_context
from acc.app.runtime.invocation_port import CallableInvocationPort, NodeExecutionEnvelope
from acc.callable_registry import CallableAsset, CallableRegistry
from acc.models import (
    AccError,
    AgentClassTemplate,
    CallableRef,
    NodeInvocationSpec,
    ScopeFrame,
    SessionInstance,
    WorkflowFunctionTemplate,
)


def make_scope(tmp_path: Path) -> ScopeFrame:
    return ScopeFrame(
        frame_id="frame_test",
        invocation_id="inv_test",
        parent_frame_id=None,
        call_depth=0,
        workflow_id="workflow_test",
        workspace_root=tmp_path,
        environment_root=tmp_path / "run",
        inbox_root=tmp_path / "inbox",
        outbox_root=tmp_path / "outbox",
        artifact_root=tmp_path / "artifacts",
        behavior_snapshot_path=tmp_path / "behavior.json",
        ephemeral=True,
        binding_path=None,
    )


def make_session(node: NodeInvocationSpec, scope: ScopeFrame) -> SessionInstance:
    return SessionInstance(
        session_id="session_test",
        invocation_id=scope.invocation_id,
        scope_frame_id=scope.frame_id,
        node_id=node.id,
        callable_ref=node.callable_ref,
        callable_kind=node.callable_ref.kind,
        status="running",
        cwd=scope.workspace_root,
        env_keys=(),
        input_path=scope.environment_root / "nodes" / node.id / "agent_payload.json",
        output_path=scope.environment_root / "nodes" / node.id / "output.json",
        artifact_dir=scope.environment_root / "nodes" / node.id / "artifacts",
        event_log_path=scope.environment_root / "nodes" / node.id / "events.jsonl",
        started_at="2026-06-22T00:00:00Z",
    )


def make_envelope(
    tmp_path: Path,
    *,
    node: NodeInvocationSpec,
    callable_registry: CallableRegistry | None = None,
) -> NodeExecutionEnvelope:
    scope = make_scope(tmp_path)
    node_dir = scope.environment_root / "nodes" / node.id
    node_dir.mkdir(parents=True, exist_ok=True)
    return NodeExecutionEnvelope(
        template=WorkflowFunctionTemplate(
            id="parent",
            version="0.1.0",
            node_invocations={node.id: node},
            control_edges=[],
            data_edges=[],
        ),
        node=node,
        payload={"main": "hello"},
        node_dir=node_dir,
        scope=scope,
        session=make_session(node, scope),
        binding_materializations=[{"target_port": "main", "source_kind": "static"}],
        callable_registry=callable_registry,
        execution_context=build_execution_context(
            run_dir=scope.environment_root,
            project_root=tmp_path,
        ),
    )


def test_port_routes_hermetic_tool_class(tmp_path: Path) -> None:
    node = NodeInvocationSpec(
        id="produce",
        callable_ref=CallableRef(kind="tool_class", id="fake_producer"),
    )

    output = asyncio.run(CallableInvocationPort().invoke(make_envelope(tmp_path, node=node)))

    assert output["status"] == "success"
    assert output["producer_node_id"] == "produce"
    assert output["input"] == {"main": "hello"}


def test_port_routes_hermetic_agent_class(tmp_path: Path) -> None:
    node = NodeInvocationSpec(
        id="agent",
        callable_ref=CallableRef(kind="agent_class", id="generic_fake_agent"),
    )

    output = asyncio.run(CallableInvocationPort().invoke(make_envelope(tmp_path, node=node)))

    assert output["status"] == "success"
    assert output["input"] == {"main": "hello"}
    assert output["prompt"] == ""


def test_port_routes_registered_generic_agent_to_class_runner(tmp_path: Path) -> None:
    class StubRunner:
        async def run_agent_class(self, asset, input_payload, run_dir, execution_context):
            return {
                "asset": asset.source_id,
                "input": input_payload,
                "run_dir": str(run_dir),
                "node": execution_context.node.id,
                "scope": execution_context.scope.frame_id,
            }

    registry = CallableRegistry(
        {
            ("agent_class", "worker.generic"): CallableAsset(
                template=AgentClassTemplate(
                    id="worker.generic",
                    version="0.1.0",
                    runtime="generic_cli",
                ),
                backend="file",
                source_id="worker.generic",
            )
        },
        project_root=tmp_path,
    )
    node = NodeInvocationSpec(
        id="work",
        callable_ref=CallableRef(kind="agent_class", id="worker.generic"),
    )

    output = asyncio.run(
        CallableInvocationPort(class_runner=StubRunner()).invoke(
            make_envelope(tmp_path, node=node, callable_registry=registry)
        )
    )

    assert output["asset"] == "worker.generic"
    assert output["input"] == {"main": "hello"}
    assert output["node"] == "work"
    assert output["scope"] == "frame_test"


def test_port_routes_streaming_agent_to_agent_turn_service(tmp_path: Path) -> None:
    calls: dict[str, object] = {}

    class StubAgentTurnService:
        def __init__(self, project_root: Path) -> None:
            calls["project_root"] = project_root

        async def run_workflow_node_turn(
            self,
            asset,
            input_payload,
            node_dir,
            *,
            node,
            scope,
            session,
            binding_materializations,
        ):
            calls["asset"] = asset.source_id
            calls["node"] = node.id
            calls["session"] = session.session_id
            calls["bindings"] = binding_materializations
            return {"status": "success", "streamed": input_payload}

    registry = CallableRegistry(
        {
            ("agent_class", "worker.codex"): CallableAsset(
                template=AgentClassTemplate(
                    id="worker.codex",
                    version="0.1.0",
                    runtime="codex_app_server",
                ),
                backend="file",
                source_id="worker.codex",
            )
        },
        project_root=tmp_path,
    )
    node = NodeInvocationSpec(
        id="work",
        callable_ref=CallableRef(kind="agent_class", id="worker.codex"),
    )

    output = asyncio.run(
        CallableInvocationPort(agent_turn_service_factory=StubAgentTurnService).invoke(
            make_envelope(tmp_path, node=node, callable_registry=registry)
        )
    )

    assert output == {"status": "success", "streamed": {"main": "hello"}}
    assert calls["project_root"] == tmp_path
    assert calls["asset"] == "worker.codex"
    assert calls["node"] == "work"
    assert calls["session"] == "session_test"
    assert calls["bindings"] == [{"target_port": "main", "source_kind": "static"}]


def test_port_routes_workflow_function_to_nested_executor(monkeypatch, tmp_path: Path) -> None:
    async def fake_nested(
        template,
        node,
        payload,
        node_dir,
        scope,
        session,
        callable_registry,
        execution_context,
    ):
        return {
            "template": template.id,
            "node": node.id,
            "payload": payload,
            "node_dir": str(node_dir),
            "scope": scope.frame_id,
            "session": session.session_id,
            "registry": callable_registry,
            "request_id": execution_context.request_id,
        }

    monkeypatch.setattr(
        "acc.app.runtime.nested_workflow.execute_workflow_function_callable",
        fake_nested,
    )
    node = NodeInvocationSpec(
        id="subflow",
        callable_ref=CallableRef(kind="workflow_function", id="child.accflow.json"),
    )
    envelope = make_envelope(tmp_path, node=node)

    output = asyncio.run(CallableInvocationPort().invoke(envelope))

    assert output["template"] == "parent"
    assert output["node"] == "subflow"
    assert output["payload"] == {"main": "hello"}
    assert output["scope"] == "frame_test"
    assert output["session"] == "session_test"


def test_port_raises_for_unsupported_callable(tmp_path: Path) -> None:
    node = NodeInvocationSpec(
        id="unknown",
        callable_ref=CallableRef(kind="tool_class", id="missing"),
    )

    with pytest.raises(AccError, match="Unsupported Core v2 callable"):
        asyncio.run(CallableInvocationPort().invoke(make_envelope(tmp_path, node=node)))
