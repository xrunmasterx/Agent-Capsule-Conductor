from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from acc.server.routes import runs as runs_route


def test_get_node_includes_projection_fields(client, project_root) -> None:
    run_dir = project_root / "runs" / "projection_fixture_run"
    node_dir = run_dir / "nodes" / "echo"
    node_dir.mkdir(parents=True, exist_ok=True)
    (node_dir / "stdout.log").write_text("hello stdout\nsecond line\n", encoding="utf-8")
    (node_dir / "output.json").write_text(
        json.dumps({"summary": "done", "value": "ok"}),
        encoding="utf-8",
    )
    (node_dir / "events.jsonl").write_text(
        json.dumps(
            {
                "event_id": "evt_1",
                "type": "session_started",
                "timestamp": "2026-05-29T00:00:00Z",
                "status": "running",
                "payload": {"summary": "started"},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": "projection_fixture_run",
                "status": "success",
                "run_dir": str(run_dir.resolve()),
                "node_count": 1,
                "nodes": [
                    {
                        "node_id": "echo",
                        "callable_id": "echo-test.generic",
                        "status": "success",
                        "summary": "done",
                        "run_dir": str(node_dir.resolve()),
                        "output_path": str((node_dir / "output.json").resolve()),
                        "stdout_log": str((node_dir / "stdout.log").resolve()),
                        "event_log": str((node_dir / "events.jsonl").resolve()),
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    response = client.get("/api/runs/projection_fixture_run/nodes/echo")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["output_preview"]["summary"] == "done"
    assert payload["steps"]
    assert payload["log_excerpt"]
    assert payload["log_ref"]


def test_read_run_evidence_allows_node_output_inside_run(client, project_root) -> None:
    run_dir = project_root / "runs" / "projection_fixture_run"
    node_dir = run_dir / "nodes" / "echo"
    node_dir.mkdir(parents=True, exist_ok=True)
    output_path = node_dir / "output.json"
    output_path.write_text(json.dumps({"summary": "done"}), encoding="utf-8")
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": "projection_fixture_run",
                "status": "success",
                "run_dir": str(run_dir.resolve()),
                "node_count": 1,
                "nodes": [],
            }
        ),
        encoding="utf-8",
    )

    response = client.get(
        "/api/runs/projection_fixture_run/evidence",
        params={"path": str(output_path.resolve())},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["type"] == "json"
    assert payload["path"] == "runs/projection_fixture_run/nodes/echo/output.json"
    assert json.loads(payload["content"]) == {"summary": "done"}


def test_read_run_evidence_rejects_paths_outside_run(client, project_root) -> None:
    run_dir = project_root / "runs" / "projection_fixture_run"
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": "projection_fixture_run",
                "status": "success",
                "run_dir": str(run_dir.resolve()),
                "node_count": 0,
                "nodes": [],
            }
        ),
        encoding="utf-8",
    )

    response = client.get(
        "/api/runs/projection_fixture_run/evidence",
        params={"path": str((project_root / ".env").resolve())},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "artifact_policy_denied"


def test_run_state_includes_recursive_nested_node_snapshot(client, project_root) -> None:
    run_dir = project_root / "runs" / "state_snapshot_run"
    workflow_a_dir = run_dir / "nodes" / "workflow_a"
    workflow_a_nested = workflow_a_dir / "nested_workflow"
    workflow_b_dir = workflow_a_nested / "nodes" / "workflow_b"
    workflow_b_nested = workflow_b_dir / "nested_workflow"
    workflow_c_dir = run_dir / "nodes" / "workflow_c"
    workflow_c_nested = workflow_c_dir / "nested_workflow"
    fallback_node_dir = workflow_c_nested / "nodes" / "fallback_agent"
    agent_1_dir = workflow_a_nested / "nodes" / "agent_1"
    agent_2_dir = workflow_b_nested / "nodes" / "agent_2"
    for path in [workflow_a_dir, workflow_b_dir, workflow_c_dir, fallback_node_dir, agent_1_dir, agent_2_dir]:
        path.mkdir(parents=True, exist_ok=True)
    (fallback_node_dir / "output.json").write_text(json.dumps({"ok": True}), encoding="utf-8")
    (fallback_node_dir / "runtime.json").write_text(
        json.dumps({"callable_ref": {"id": "fallback-agent.generic"}}),
        encoding="utf-8",
    )
    (run_dir / "events.jsonl").write_text(
        json.dumps({"type": "node_completed", "node_id": "workflow_c", "timestamp": "2026-06-05T00:00:04Z"})
        + "\n",
        encoding="utf-8",
    )
    write_run_summary_payload(
        run_dir,
        "state_snapshot_run",
        [
            node_summary_payload(workflow_a_dir, "workflow_a", "workflow-a.accflow", "success"),
            node_summary_payload(workflow_c_dir, "workflow_c", "workflow-c.accflow", "success"),
        ],
    )
    write_run_summary_payload(
        workflow_a_nested,
        "nested_workflow",
        [
            node_summary_payload(agent_1_dir, "agent_1", "agent-one.generic", "success"),
            node_summary_payload(workflow_b_dir, "workflow_b", "workflow-b.accflow", "success"),
        ],
    )
    write_run_summary_payload(
        workflow_b_nested,
        "nested_workflow",
        [node_summary_payload(agent_2_dir, "agent_2", "agent-two.generic", "success")],
    )

    events_response = client.get("/api/runs/state_snapshot_run/events", params={"limit": 1})
    assert events_response.status_code == 200, events_response.text

    response = client.get("/api/runs/state_snapshot_run/state")

    assert response.status_code == 200, response.text
    nodes = {node.get("ui_node_id") or node["node_id"]: node for node in response.json()["nodes"]}
    assert nodes["workflow_a"]["status"] == "success"
    assert nodes["workflow_a__internal__agent_1"]["status"] == "success"
    assert nodes["workflow_a__internal__workflow_b"]["node_run_dir"] == str(workflow_b_dir.resolve())
    assert nodes["workflow_a__internal__workflow_b__internal__agent_2"]["status"] == "success"
    assert nodes["workflow_c__internal__fallback_agent"]["status"] == "success"
    assert nodes["workflow_c__internal__fallback_agent"]["callable_id"] == "fallback-agent.generic"


def test_run_state_includes_nested_node_binding_manifest_and_output_preview(
    client,
    project_root,
) -> None:
    run_dir = project_root / "runs" / "state_nested_evidence_run"
    parent_dir = run_dir / "nodes" / "workflow_parent"
    nested_run_dir = parent_dir / "nested_workflow"
    writer_dir = nested_run_dir / "nodes" / "writer"
    writer_dir.mkdir(parents=True, exist_ok=True)
    parent_dir.mkdir(parents=True, exist_ok=True)
    (writer_dir / "binding_manifest.json").write_text(
        json.dumps(
            {
                "bindings": [
                    {
                        "binding_kind": "workflow_input",
                        "source_port": "main",
                        "target_node": "writer",
                        "target_port": "main",
                    }
                ],
                "inputs": ["main"],
            }
        ),
        encoding="utf-8",
    )
    (writer_dir / "output.json").write_text(
        json.dumps({"status": "success", "summary": "writer received workflow input"}),
        encoding="utf-8",
    )
    (writer_dir / "events.jsonl").write_text("", encoding="utf-8")
    write_run_summary_payload(
        run_dir,
        "state_nested_evidence_run",
        [node_summary_payload(parent_dir, "workflow_parent", "child.accflow.json", "success")],
    )
    write_run_summary_payload(
        nested_run_dir,
        "nested_workflow",
        [node_summary_payload(writer_dir, "writer", "writer.codex", "success")],
    )

    response = client.get("/api/runs/state_nested_evidence_run/state")

    assert response.status_code == 200, response.text
    nodes = {node.get("ui_node_id") or node["node_id"]: node for node in response.json()["nodes"]}
    writer = nodes["workflow_parent__internal__writer"]
    assert writer["binding_manifest"]["bindings"][0]["binding_kind"] == "workflow_input"
    assert writer["binding_manifest"]["inputs"] == ["main"]
    assert writer["output_preview"]["summary"] == "writer received workflow input"


def test_node_events_include_agent_session_timeline(client, project_root) -> None:
    run_dir = project_root / "runs" / "agent_events_run"
    node_dir = run_dir / "nodes" / "agent"
    session_dir = project_root / "runs" / "_agent_sessions" / "agent_events_run" / "agent"
    turn_dir = session_dir / "turns" / "turn_1"
    turn_dir.mkdir(parents=True)
    node_dir.mkdir(parents=True)
    (node_dir / "events.jsonl").write_text(
        json.dumps(
            {
                "type": "node_started",
                "timestamp": "2026-06-05T00:00:00Z",
                "node_id": "agent",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (node_dir / "runtime.json").write_text(
        json.dumps({"agent_session_ref": str(session_dir.resolve()), "turn_id": "turn_1"}),
        encoding="utf-8",
    )
    (turn_dir / "events.jsonl").write_text(
        json.dumps(
            {
                "type": "agent_message",
                "timestamp": "2026-06-05T00:00:01Z",
                "session_id": "agent_session_test",
                "turn_id": "turn_1",
                "payload": {"content": "done"},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": "agent_events_run",
                "status": "success",
                "run_dir": str(run_dir.resolve()),
                "node_count": 1,
                "nodes": [],
            }
        ),
        encoding="utf-8",
    )

    response = client.get("/api/runs/agent_events_run/nodes/agent/events")

    assert response.status_code == 200, response.text
    events = response.json()["events"]
    assert [event["type"] for event in events] == ["node_started", "agent_message"]
    assert events[1]["source"] == "agent_session"
    assert events[1]["agent_session_id"] == "agent_session_test"
    assert events[1]["agent_turn_id"] == "turn_1"
    assert events[1]["projection"]["schema_version"] == "acc.transcript_projection.v1"
    assert events[1]["projection"]["source"] == "computed_legacy"
    assert events[1]["projection"]["visibility"] == "primary"
    assert events[1]["projection"]["category"] == "assistant_text"


def test_get_node_uses_agent_turn_log_projection(client, project_root) -> None:
    run_dir = project_root / "runs" / "agent_log_projection_run"
    node_dir = run_dir / "nodes" / "agent"
    session_dir = project_root / "runs" / "_agent_sessions" / "agent_log_projection_run" / "agent"
    turn_dir = session_dir / "turns" / "turn_1"
    node_dir.mkdir(parents=True, exist_ok=True)
    turn_dir.mkdir(parents=True)
    (node_dir / "stdout.log").write_bytes(b"")
    (node_dir / "runtime.json").write_text(
        json.dumps({"agent_session_ref": str(session_dir.resolve()), "turn_id": "turn_1"}),
        encoding="utf-8",
    )
    (turn_dir / "stdout.log").write_bytes(b"agent log line\n")
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": "agent_log_projection_run",
                "status": "success",
                "run_dir": str(run_dir.resolve()),
                "node_count": 1,
                "nodes": [
                    {
                        "node_id": "agent",
                        "callable_id": "agent.codex",
                        "status": "success",
                        "summary": "done",
                        "run_dir": str(node_dir.resolve()),
                        "stdout_log": str((node_dir / "stdout.log").resolve()),
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    response = client.get("/api/runs/agent_log_projection_run/nodes/agent")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["log_excerpt"] == "agent log line\n"
    assert payload["log_ref"].replace("\\", "/").endswith(
        "runs/_agent_sessions/agent_log_projection_run/agent/turns/turn_1/stdout.log"
    )


def test_run_stream_emits_agent_session_events(client, project_root) -> None:
    run_dir = project_root / "runs" / "server_run"
    node_dir = run_dir / "nodes" / "server_node"
    session_dir = project_root / "runs" / "_agent_sessions" / "server_run" / "server_node"
    turn_dir = session_dir / "turns" / "turn_1"
    node_dir.mkdir(parents=True, exist_ok=True)
    turn_dir.mkdir(parents=True)
    (node_dir / "runtime.json").write_text(
        json.dumps({"agent_session_ref": str(session_dir.resolve()), "turn_id": "turn_1"}),
        encoding="utf-8",
    )
    (turn_dir / "events.jsonl").write_text(
        json.dumps(
            {
                "event_id": "agent_evt_1",
                "type": "agent_message",
                "timestamp": "2026-06-05T00:00:01Z",
                "session_id": "agent_session_test",
                "turn_id": "turn_1",
                "payload": {"content": "streamed"},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": "server_run",
                "status": "success",
                "run_dir": str(run_dir.resolve()),
                "node_count": 1,
                "nodes": [],
            }
        ),
        encoding="utf-8",
    )

    with client.stream("GET", "/api/runs/server_run/stream?history=tail") as response:
        text = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: agent_event" in text
    assert "event: live_event" not in text
    assert '"node_id": "server_node"' in text
    assert '"agent_turn_id": "turn_1"' in text
    assert '"projection":' in text
    assert '"event_seq":' in text
    assert "streamed" in text


def test_run_stream_history_none_on_terminal_run_emits_summary_without_history(client, project_root) -> None:
    run_dir = project_root / "runs" / "terminal_stream_run"
    node_dir = run_dir / "nodes" / "agent"
    session_dir = project_root / "runs" / "_agent_sessions" / "terminal_stream_run" / "agent"
    turn_dir = session_dir / "turns" / "turn_1"
    node_dir.mkdir(parents=True, exist_ok=True)
    turn_dir.mkdir(parents=True)
    (node_dir / "runtime.json").write_text(
        json.dumps({"agent_session_ref": str(session_dir.resolve()), "turn_id": "turn_1"}),
        encoding="utf-8",
    )
    (node_dir / "stdout.log").write_text("historical stdout\n", encoding="utf-8")
    (turn_dir / "events.jsonl").write_text(
        json.dumps({"event_id": "agent_evt_1", "type": "agent_message", "payload": {"content": "old"}})
        + "\n",
        encoding="utf-8",
    )
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": "terminal_stream_run",
                "status": "success",
                "run_dir": str(run_dir.resolve()),
                "node_count": 1,
                "nodes": [],
            }
        ),
        encoding="utf-8",
    )

    with client.stream("GET", "/api/runs/terminal_stream_run/stream") as response:
        text = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: summary" in text
    assert "event: node_log_delta" not in text
    assert "event: agent_event" not in text
    assert "event: live_event" not in text


def test_run_stream_emits_heartbeat_when_idle(monkeypatch, project_root) -> None:
    run_dir = project_root / "runs" / "idle_stream_run"
    run_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(runs_route, "STREAM_HEARTBEAT_INTERVAL_SECONDS", 0.0, raising=False)

    async def read_first_frame() -> str:
        response = await runs_route.stream_run(
            "idle_stream_run",
            _FakeStreamRequest(project_root),
        )
        return await response.body_iterator.__anext__()

    frame = asyncio.run(read_first_frame())

    assert frame.startswith(": heartbeat") or "event: heartbeat" in frame


def test_run_stream_projects_agent_message_delta_live_event(client, project_root) -> None:
    run_dir = project_root / "runs" / "server_delta_run"
    node_dir = run_dir / "nodes" / "server_node"
    session_dir = project_root / "runs" / "_agent_sessions" / "server_delta_run" / "server_node"
    turn_dir = session_dir / "turns" / "turn_1"
    node_dir.mkdir(parents=True, exist_ok=True)
    turn_dir.mkdir(parents=True)
    (node_dir / "runtime.json").write_text(
        json.dumps({"agent_session_ref": str(session_dir.resolve()), "turn_id": "turn_1"}),
        encoding="utf-8",
    )
    (turn_dir / "events.jsonl").write_text(
        json.dumps(
            {
                "event_id": "agent_delta_evt_1",
                "type": "agent_message_delta",
                "timestamp": "2026-06-05T00:00:01Z",
                "session_id": "agent_session_test",
                "turn_id": "turn_1",
                "payload": {"delta": "模", "item_id": "msg_1"},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": "server_delta_run",
                "status": "success",
                "run_dir": str(run_dir.resolve()),
                "node_count": 1,
                "nodes": [],
            }
        ),
        encoding="utf-8",
    )

    with client.stream("GET", "/api/runs/server_delta_run/stream?history=tail") as response:
        text = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: agent_event" in text
    assert "event: live_event" not in text
    assert '"type": "agent_message_delta"' in text
    assert "agent_delta_evt_1" in text


def test_run_stream_emits_nested_agent_session_events(client, project_root) -> None:
    node_dir = (
        project_root
        / "runs"
        / "server_run"
        / "nodes"
        / "workflow_parent"
        / "nested_workflow"
        / "nodes"
        / "agent_node"
    )
    session_dir = (
        project_root
        / "runs"
        / "server_run"
        / "nodes"
        / "workflow_parent"
        / "runs"
        / "_agent_sessions"
        / "nested_workflow"
        / "agent_node"
    )
    turn_dir = session_dir / "turns" / "turn_nested"
    node_dir.mkdir(parents=True, exist_ok=True)
    turn_dir.mkdir(parents=True)
    (node_dir / "runtime.json").write_text(
        json.dumps({"agent_session_ref": str(session_dir.resolve()), "turn_id": "turn_nested"}),
        encoding="utf-8",
    )
    (turn_dir / "events.jsonl").write_text(
        json.dumps(
            {
                "event_id": "nested_agent_evt_1",
                "type": "agent_message",
                "timestamp": "2026-06-05T00:00:01Z",
                "session_id": "nested_agent_session_test",
                "turn_id": "turn_nested",
                "payload": {"content": "nested streamed"},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    run_dir = project_root / "runs" / "server_run"
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": "server_run",
                "status": "success",
                "run_dir": str(run_dir.resolve()),
                "node_count": 1,
                "nodes": [],
            }
        ),
        encoding="utf-8",
    )

    with client.stream("GET", "/api/runs/server_run/stream?history=tail") as response:
        text = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: agent_event" in text
    assert "event: live_event" not in text
    assert '"node_id": "agent_node"' in text
    assert '"parent_node_id": "workflow_parent"' in text
    assert '"ui_node_id": "workflow_parent__internal__agent_node"' in text
    assert '"agent_turn_id": "turn_nested"' in text
    assert "nested streamed" in text


def test_nested_node_events_can_be_read_by_node_run_dir(client, project_root) -> None:
    node_dir = (
        project_root
        / "runs"
        / "server_run"
        / "nodes"
        / "workflow_parent"
        / "nested_workflow"
        / "nodes"
        / "agent_node"
    )
    session_dir = (
        project_root
        / "runs"
        / "server_run"
        / "nodes"
        / "workflow_parent"
        / "runs"
        / "_agent_sessions"
        / "nested_workflow"
        / "agent_node"
    )
    turn_dir = session_dir / "turns" / "turn_nested"
    node_dir.mkdir(parents=True, exist_ok=True)
    turn_dir.mkdir(parents=True)
    (node_dir / "events.jsonl").write_text(
        json.dumps({"type": "node_started", "timestamp": "2026-06-05T00:00:00Z"}) + "\n",
        encoding="utf-8",
    )
    (node_dir / "runtime.json").write_text(
        json.dumps({"agent_session_ref": str(session_dir.resolve()), "turn_id": "turn_nested"}),
        encoding="utf-8",
    )
    (turn_dir / "events.jsonl").write_text(
        json.dumps(
            {
                "type": "agent_message",
                "timestamp": "2026-06-05T00:00:01Z",
                "session_id": "nested_agent_session_test",
                "turn_id": "turn_nested",
                "payload": {"content": "nested event"},
            }
        )
        + "\n",
        encoding="utf-8",
    )

    response = client.get(
        "/api/runs/server_run/nodes/agent_node/events",
        params={"node_run_dir": str(node_dir.resolve())},
    )

    assert response.status_code == 200, response.text
    events = response.json()["events"]
    assert [event["type"] for event in events] == ["node_started", "agent_message"]
    assert events[0]["ui_node_id"] == "workflow_parent__internal__agent_node"
    assert events[1]["agent_turn_id"] == "turn_nested"
    assert events[1]["payload"]["content"] == "nested event"


def test_run_events_include_recursive_nested_workflow_scope(client, project_root) -> None:
    run_dir = project_root / "runs" / "recursive_nested_events_run"
    workflow_a_nested = run_dir / "nodes" / "workflow_a" / "nested_workflow"
    workflow_b_nested = workflow_a_nested / "nodes" / "workflow_b" / "nested_workflow"
    workflow_b_node_dir = workflow_a_nested / "nodes" / "workflow_b"
    agent_node_dir = workflow_b_nested / "nodes" / "agent_1"
    agent_node_dir.mkdir(parents=True, exist_ok=True)
    workflow_b_node_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "events.jsonl").parent.mkdir(parents=True, exist_ok=True)
    (run_dir / "events.jsonl").write_text(
        json.dumps(
            {
                "type": "node_started",
                "timestamp": "2026-06-05T00:00:00Z",
                "node_id": "workflow_a",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (workflow_a_nested / "events.jsonl").write_text(
        json.dumps(
            {
                "type": "node_started",
                "timestamp": "2026-06-05T00:00:01Z",
                "node_id": "workflow_b",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (workflow_b_nested / "events.jsonl").write_text(
        json.dumps(
            {
                "type": "node_started",
                "timestamp": "2026-06-05T00:00:02Z",
                "node_id": "agent_1",
            }
        )
        + "\n",
        encoding="utf-8",
    )

    response = client.get("/api/runs/recursive_nested_events_run/events")

    assert response.status_code == 200, response.text
    events = response.json()["events"]
    assert events == [
        {
            "type": "node_started",
            "timestamp": "2026-06-05T00:00:00Z",
            "node_id": "workflow_a",
        },
        {
            "type": "node_started",
            "timestamp": "2026-06-05T00:00:01Z",
            "node_id": "workflow_b",
            "nested": True,
            "parent_node_id": "workflow_a",
            "ui_node_id": "workflow_a__internal__workflow_b",
            "node_run_dir": str(workflow_b_node_dir.resolve()),
        },
        {
            "type": "node_started",
            "timestamp": "2026-06-05T00:00:02Z",
            "node_id": "agent_1",
            "nested": True,
            "parent_node_id": "workflow_a__internal__workflow_b",
            "ui_node_id": "workflow_a__internal__workflow_b__internal__agent_1",
            "node_run_dir": str(agent_node_dir.resolve()),
        },
    ]


def node_summary_payload(node_dir, node_id: str, callable_id: str, status: str) -> dict:
    return {
        "node_id": node_id,
        "callable_id": callable_id,
        "status": status,
        "run_dir": str(node_dir.resolve()),
        "output_path": str((node_dir / "output.json").resolve()),
        "event_log": str((node_dir / "events.jsonl").resolve()),
        "errors": [],
    }


def write_run_summary_payload(run_dir, run_id: str, nodes: list[dict]) -> None:
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": run_id,
                "workflow_id": run_id,
                "status": "success",
                "run_dir": str(run_dir.resolve()),
                "node_count": len(nodes),
                "failed_nodes": [],
                "nodes": nodes,
            }
        ),
        encoding="utf-8",
    )


class _FakeStreamRequest:
    def __init__(self, project_root) -> None:
        self.app = SimpleNamespace(state=SimpleNamespace(project_root=project_root))
        self._disconnect_checks = 0

    async def is_disconnected(self) -> bool:
        self._disconnect_checks += 1
        return self._disconnect_checks > 1
