from __future__ import annotations

from pathlib import Path

from acc.domain import (
    CallableRef,
    NodeSpec,
    PermissionProfile,
    WorkflowTemplate,
)
from acc.store import FileSystemWorkflowStore, load_json


def test_store_writes_function_invocation_scope_and_session_manifests(
    tmp_path: Path,
) -> None:
    template = WorkflowTemplate(
        id="store_invocation_demo",
        version="0.1.0",
        nodes={
            "agent": NodeSpec(
                id="agent",
                kind="agent",
                runtime="generic_fake_agent",
                permission_profile=PermissionProfile(),
            )
        },
        control_edges=[],
        data_edges=[],
    )
    store = FileSystemWorkflowStore(
        template=template,
        workflow_path=tmp_path / "demo.accflow.json",
        run_dir=tmp_path / "run",
    )

    store.prepare_run_dir()
    invocation = store.create_function_invocation(
        input_payload={"brief": "hello"},
        status="running",
        started_at="2026-05-28T00:00:00Z",
    )
    frame = store.create_environment_frame(invocation)
    node_dir = store.create_node_attempt("agent")
    store.write_session_instance_manifest(
        node=template.nodes["agent"],
        node_dir=node_dir,
        frame=frame,
        callable_ref=CallableRef(kind="agent_class", id="generic_fake_agent"),
        status="success",
        started_at="2026-05-28T00:00:01Z",
        ended_at="2026-05-28T00:00:02Z",
    )

    invocation_manifest = load_json(store.run_dir / "function_invocation_manifest.json")
    scope_manifest = load_json(store.run_dir / "scope_frame_manifest.json")
    session_manifest = load_json(node_dir / "session_instance_manifest.json")

    assert invocation_manifest["invocation_id"] == invocation.invocation_id
    assert invocation_manifest["root_scope_frame_id"] == scope_manifest["frame_id"]
    assert scope_manifest["invocation_id"] == invocation.invocation_id
    assert scope_manifest["call_depth"] == 0
    assert session_manifest["invocation_id"] == invocation.invocation_id
    assert session_manifest["scope_frame_id"] == scope_manifest["frame_id"]
    assert session_manifest["callable_ref"]["kind"] == "agent_class"
