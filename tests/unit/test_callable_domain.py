from __future__ import annotations

from dataclasses import fields, is_dataclass
from pathlib import Path

from acc.models import (
    AgentClassTemplate,
    CallableOverride,
    CallableRef,
    ControlEdge,
    DataEdge,
    DataEndpoint,
    FunctionInvocation,
    NodeInvocationSpec,
    PermissionProfile,
    PortContract,
    ScopeFrame,
    SessionInstance,
    ToolClassTemplate,
    WorkflowCallInputBinding,
    WorkflowCallOutputBinding,
    WorkflowFunctionTemplate,
)


def field_names(model: type[object]) -> set[str]:
    return {field.name for field in fields(model)}


def test_callable_domain_types_are_first_class_dataclasses() -> None:
    for model in [
        CallableRef,
        AgentClassTemplate,
        ToolClassTemplate,
        WorkflowFunctionTemplate,
        NodeInvocationSpec,
        FunctionInvocation,
        ScopeFrame,
        SessionInstance,
    ]:
        assert is_dataclass(model)


def test_agent_and_tool_class_templates_do_not_store_runtime_state() -> None:
    forbidden = {
        "session_id",
        "run_id",
        "run_dir",
        "workspace_root",
        "conversation_memory",
        "input_path",
        "output_path",
    }

    assert field_names(AgentClassTemplate).isdisjoint(forbidden)
    assert field_names(ToolClassTemplate).isdisjoint(forbidden)


def test_workflow_function_template_is_stateless_function_definition() -> None:
    forbidden = {
        "workspace_root",
        "run_dir",
        "session_id",
        "root_scope_frame_id",
        "parent_invocation_id",
        "started_at",
        "ended_at",
    }

    assert field_names(WorkflowFunctionTemplate).isdisjoint(forbidden)

    node = NodeInvocationSpec(
        id="analyze",
        callable_ref=CallableRef(
            kind="agent_class",
            id="source_analyzer.codex",
            version="0.1.0",
        ),
    )
    template = WorkflowFunctionTemplate(
        id="review",
        version="0.1.0",
        node_invocations={node.id: node},
        control_edges=[],
        data_edges=[],
        exposed_inputs={
            "brief": PortContract(id="brief", direction="input", required=True)
        },
        exposed_outputs={
            "report": PortContract(id="report", direction="output", required=True)
        },
    )

    assert template.node_invocations["analyze"].callable_ref.kind == "agent_class"
    assert template.exposed_inputs["brief"].direction == "input"
    assert template.exposed_outputs["report"].direction == "output"


def test_node_invocation_spec_keeps_call_site_overrides_local() -> None:
    node = NodeInvocationSpec(
        id="merge",
        callable_ref=CallableRef(kind="tool_class", id="merge_reports.local"),
        overrides=CallableOverride(
            prompt="Use concise findings only.",
            permission_profile=PermissionProfile(workspace_access="writes_run_only"),
            static_input={"format": "markdown"},
        ),
    )

    assert node.callable_ref.kind == "tool_class"
    assert node.overrides.static_input == {"format": "markdown"}
    assert "default_prompt" not in field_names(NodeInvocationSpec)
    assert "session_id" not in field_names(NodeInvocationSpec)


def test_workflow_call_bindings_model_function_parameters_and_returns() -> None:
    node = NodeInvocationSpec(
        id="subflow",
        callable_ref=CallableRef(kind="workflow_function", id="child_review"),
        workflow_call_input_bindings=[
            WorkflowCallInputBinding(
                source=DataEndpoint(node="plan", port="brief"),
                workflow_input="question",
            )
        ],
        workflow_call_output_bindings=[
            WorkflowCallOutputBinding(
                workflow_output="report",
                parent_port="summary",
            )
        ],
    )

    assert node.workflow_call_input_bindings[0].workflow_input == "question"
    assert node.workflow_call_output_bindings[0].parent_port == "summary"


def test_invocation_scope_and_session_separate_runtime_state() -> None:
    invocation = FunctionInvocation(
        invocation_id="invocation_001",
        workflow_function_id="review",
        run_id="run_001",
        status="running",
        input_payload={"brief": "inspect architecture"},
        root_scope_frame_id="scope_001",
    )
    scope = ScopeFrame(
        frame_id="scope_001",
        invocation_id=invocation.invocation_id,
        parent_frame_id=None,
        call_depth=0,
        workflow_id="review",
        workspace_root=Path("runs/run_001/environments/root_env/workspace"),
        environment_root=Path("runs/run_001/environments/root_env"),
        inbox_root=Path("runs/run_001/environments/root_env/.acc/inbox"),
        outbox_root=Path("runs/run_001/environments/root_env/.acc/outbox"),
        artifact_root=Path("runs/run_001/environments/root_env/.acc/artifacts"),
        behavior_snapshot_path=Path(
            "runs/run_001/environments/root_env/.acc/behavior_pack_snapshot.json"
        ),
        ephemeral=True,
    )
    session = SessionInstance(
        session_id="session_001",
        invocation_id=invocation.invocation_id,
        scope_frame_id=scope.frame_id,
        node_id="analyze",
        callable_ref=CallableRef(kind="agent_class", id="source_analyzer.codex"),
        callable_kind="agent_class",
        status="success",
        cwd=scope.workspace_root,
        env_keys=("ACC_RUN_DIR", "ACC_NODE_ID"),
        input_path=Path("nodes/analyze/input.json"),
        output_path=Path("nodes/analyze/output.json"),
        artifact_dir=Path("nodes/analyze/artifacts"),
        event_log_path=Path("nodes/analyze/events.jsonl"),
    )

    assert invocation.root_scope_frame_id == scope.frame_id
    assert session.invocation_id == invocation.invocation_id
    assert session.scope_frame_id == scope.frame_id


def test_workflow_function_template_uses_existing_edge_contracts() -> None:
    edge = DataEdge(
        source=DataEndpoint(node="a", port="main"),
        target=DataEndpoint(node="b", port="main"),
    )
    template = WorkflowFunctionTemplate(
        id="edge_demo",
        version="0.1.0",
        node_invocations={
            "a": NodeInvocationSpec(
                id="a",
                callable_ref=CallableRef(kind="tool_class", id="producer"),
            ),
            "b": NodeInvocationSpec(
                id="b",
                callable_ref=CallableRef(kind="agent_class", id="consumer"),
            ),
        },
        control_edges=[ControlEdge(source="a", target="b")],
        data_edges=[edge],
    )

    assert template.control_edges[0].source == "a"
    assert template.data_edges[0].target.node == "b"
