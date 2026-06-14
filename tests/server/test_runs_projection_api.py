from __future__ import annotations

import json


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

    with client.stream("GET", "/api/runs/server_run/stream") as response:
        text = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: agent_event" in text
    assert "event: live_event" in text
    assert '"node_id": "server_node"' in text
    assert '"agent_turn_id": "turn_1"' in text
    assert '"projection":' in text
    assert '"event_seq":' in text
    assert "streamed" in text


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

    with client.stream("GET", "/api/runs/server_delta_run/stream") as response:
        text = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: live_event" in text
    assert '"type": "agent_message_delta"' in text
    assert '"stream": "agent"' in text
    assert '"text": "模"' in text


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

    with client.stream("GET", "/api/runs/server_run/stream") as response:
        text = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: agent_event" in text
    assert "event: live_event" in text
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
