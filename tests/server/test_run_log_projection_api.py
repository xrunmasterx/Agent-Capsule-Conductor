from __future__ import annotations

import json


def test_node_log_delta_reads_by_offset(client, project_root) -> None:
    node_dir = project_root / "runs" / "server_run" / "nodes" / "server_node"
    node_dir.mkdir(parents=True)
    (node_dir / "stdout.log").write_bytes(b"alpha\nbeta\n")
    (node_dir / "stderr.log").write_bytes(b"err\n")

    response = client.get("/api/runs/server_run/nodes/server_node/logs/stdout?offset=6")

    assert response.status_code == 200
    payload = response.json()
    assert payload["type"] == "node_log_delta"
    assert payload["run_id"] == "server_run"
    assert payload["node_id"] == "server_node"
    assert payload["stream"] == "stdout"
    assert payload["offset"] == 6
    assert payload["next_offset"] == 11
    assert payload["text"] == "beta\n"


def test_node_log_delta_reads_agent_turn_log_when_available(client, project_root) -> None:
    node_dir = project_root / "runs" / "server_run" / "nodes" / "server_node"
    session_dir = project_root / "runs" / "_agent_sessions" / "server_run" / "server_node"
    turn_dir = session_dir / "turns" / "turn_1"
    node_dir.mkdir(parents=True, exist_ok=True)
    turn_dir.mkdir(parents=True)
    (node_dir / "stdout.log").write_bytes(b"")
    (node_dir / "runtime.json").write_text(
        json.dumps({"agent_session_ref": str(session_dir.resolve()), "turn_id": "turn_1"}),
        encoding="utf-8",
    )
    (turn_dir / "stdout.log").write_bytes(b"agent alpha\nagent beta\n")

    response = client.get("/api/runs/server_run/nodes/server_node/logs/stdout?offset=12")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["offset"] == 12
    assert payload["text"] == "agent beta\n"
    assert payload["next_offset"] == 23


def test_node_log_delta_ignores_agent_session_ref_outside_project(client, project_root, tmp_path) -> None:
    node_dir = project_root / "runs" / "server_run" / "nodes" / "server_node"
    outside_session_dir = tmp_path / "outside_agent_session"
    outside_turn_dir = outside_session_dir / "turns" / "turn_1"
    node_dir.mkdir(parents=True, exist_ok=True)
    outside_turn_dir.mkdir(parents=True)
    (node_dir / "stdout.log").write_bytes(b"node log\n")
    (node_dir / "runtime.json").write_text(
        json.dumps({"agent_session_ref": str(outside_session_dir.resolve()), "turn_id": "turn_1"}),
        encoding="utf-8",
    )
    (outside_turn_dir / "stdout.log").write_bytes(b"outside secret\n")

    response = client.get("/api/runs/server_run/nodes/server_node/logs/stdout")

    assert response.status_code == 200, response.text
    assert response.json()["text"] == "node log\n"


def test_node_log_delta_ignores_unsafe_agent_turn_id(client, project_root) -> None:
    node_dir = project_root / "runs" / "server_run" / "nodes" / "server_node"
    session_dir = project_root / "runs" / "_agent_sessions" / "server_run" / "server_node"
    node_dir.mkdir(parents=True, exist_ok=True)
    session_dir.mkdir(parents=True)
    (node_dir / "stdout.log").write_bytes(b"node log\n")
    (node_dir / "runtime.json").write_text(
        json.dumps({"agent_session_ref": str(session_dir.resolve()), "turn_id": "../turn_1"}),
        encoding="utf-8",
    )

    response = client.get("/api/runs/server_run/nodes/server_node/logs/stdout")

    assert response.status_code == 200, response.text
    assert response.json()["text"] == "node log\n"


def test_node_log_delta_rejects_path_traversal(client) -> None:
    response = client.get("/api/runs/server_run/nodes/../logs/stdout")

    assert response.status_code in {400, 404}


def test_node_log_delta_rejects_invalid_stream(client) -> None:
    response = client.get("/api/runs/server_run/nodes/server_node/logs/runtime")

    assert response.status_code == 400
