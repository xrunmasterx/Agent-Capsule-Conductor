from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi.testclient import TestClient


def test_agent_session_api_submits_async_turn(
    client: TestClient,
    project_root: Path,
) -> None:
    response = client.post(
        "/api/agent-sessions",
        json={
            "task_id": "task_canvas_default",
            "node_id": "research",
            "callable_ref": {"kind": "agent_class", "id": "research.codex"},
            "runtime": "codex_app_server",
            "workspace_ref": str(project_root),
            "output_schema": output_schema(),
        },
    )
    assert response.status_code == 200, response.text
    session_id = response.json()["session_id"]

    turn_response = client.post(
        f"/api/agent-sessions/{session_id}/turns/submit",
        json={"message": "Revise output.", "reason": "output_revision"},
    )

    assert turn_response.status_code == 200, turn_response.text
    payload = turn_response.json()
    assert payload["session_id"] == session_id
    assert payload["status"] in {"queued", "running", "success"}
    assert payload["events_url"].endswith(f"/turns/{payload['turn_id']}/events")


def test_workbench_assistant_session_creates_unbound_callable_agent(
    client: TestClient,
    project_root: Path,
) -> None:
    response = client.post(
        "/api/agent-sessions",
        json={
            "source": {
                "type": "workbench_assistant",
                "task_id": "task_canvas_default",
                "canvas_hash": "hash_1",
                "canvas_snapshot": assistant_canvas_snapshot(),
                "selection": {"type": "canvas"},
            }
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["session_kind"] == "workbench_assistant"
    assert payload["bound_run_id"] is None
    assert payload["runtime"] == "codex_app_server"
    assert Path(payload["session_dir"], "context_snapshot.json").exists()


def test_workbench_assistant_chat_turn_succeeds_without_draft(
    client: TestClient,
    project_root: Path,
) -> None:
    session = create_workbench_assistant_session(client)

    turn = client.post(
        f"/api/agent-sessions/{session['session_id']}/turns/submit",
        json={
            "message": "解释当前画布",
            "reason": "workbench_chat",
            "canvas_hash": "hash_1",
            "canvas_snapshot": assistant_canvas_snapshot(),
            "selection": {"type": "canvas"},
        },
    ).json()
    final_session = wait_for_session_ready(client, session["session_id"])

    assert final_session["status"] == "ready"
    assert final_session.get("current_output_turn_id") is None
    messages = client.get(f"/api/agent-sessions/{session['session_id']}/messages").json()
    assert any("Hermetic workbench assistant" in item["content"] for item in messages["messages"])
    events = client.get(
        f"/api/agent-sessions/{session['session_id']}/turns/{turn['turn_id']}/events"
    ).json()
    assert any(event["type"] == "agent_message" for event in events["events"])


def test_workbench_assistant_canvas_revision_writes_valid_draft(
    client: TestClient,
    project_root: Path,
) -> None:
    session = create_workbench_assistant_session(client)

    turn = client.post(
        f"/api/agent-sessions/{session['session_id']}/turns/submit",
        json={
            "message": "新增一个研究节点",
            "reason": "canvas_revision",
            "canvas_hash": "hash_1",
            "canvas_snapshot": assistant_canvas_snapshot(),
            "selection": {"type": "canvas"},
        },
    ).json()
    final_session = wait_for_session_ready(client, session["session_id"])

    assert final_session["current_output_turn_id"] == turn["turn_id"]
    validate_response = client.post(
        f"/api/agent-sessions/{session['session_id']}/assistant-draft/validate",
        json={"expected_turn_id": turn["turn_id"]},
    )
    assert validate_response.status_code == 200, validate_response.text
    assert validate_response.json()["status"] == "valid"
    assert validate_response.json()["proposal"]["base_canvas_hash"] == "hash_1"


def test_workbench_assistant_sse_stream_returns_canonical_events(
    client: TestClient,
    project_root: Path,
) -> None:
    session = create_workbench_assistant_session(client)
    turn = client.post(
        f"/api/agent-sessions/{session['session_id']}/turns/submit",
        json={
            "message": "新增一个研究节点",
            "reason": "canvas_revision",
            "canvas_hash": "hash_1",
            "canvas_snapshot": assistant_canvas_snapshot(),
            "selection": {"type": "canvas"},
        },
    ).json()
    wait_for_session_ready(client, session["session_id"])

    with client.stream(
        "GET",
        f"/api/agent-sessions/{session['session_id']}/turns/{turn['turn_id']}/stream",
    ) as response:
        text = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: agent_event" in text
    assert "agent_output_draft" in text
    assert "provider_events" not in text


def test_agent_session_publish_requires_bound_run_node(
    client: TestClient,
    project_root: Path,
) -> None:
    response = client.post(
        "/api/agent-sessions",
        json={
            "task_id": "task",
            "node_id": "node",
            "callable_ref": {"kind": "agent_class", "id": "node.codex"},
            "workspace_ref": str(project_root),
            "output_schema": output_schema(),
        },
    )
    session_id = response.json()["session_id"]

    publish_response = client.post(
        f"/api/agent-sessions/{session_id}/output/publish",
        json={"expected_turn_id": "turn_missing"},
    )

    assert publish_response.status_code == 400
    assert "not bound" in publish_response.json()["detail"]


def test_workbench_assistant_publish_output_is_rejected(
    client: TestClient,
    project_root: Path,
) -> None:
    session = create_workbench_assistant_session(client)

    publish_response = client.post(
        f"/api/agent-sessions/{session['session_id']}/output/publish",
        json={"expected_turn_id": "turn_missing"},
    )

    assert publish_response.status_code == 400
    assert "not bound" in publish_response.json()["detail"]


def test_agent_session_publish_writes_only_bound_node_output(
    client: TestClient,
    project_root: Path,
) -> None:
    node_dir = project_root / "runs" / "server_run" / "nodes" / "agent_node"
    node_dir.mkdir(parents=True)
    write_json(
        node_dir / "runtime.json",
        {"runtime": "codex_app_server", "workspace_dir": str(project_root)},
    )
    write_json(node_dir / "output_schema.json", output_schema())

    response = client.post(
        "/api/agent-sessions",
        json={"source": {"type": "run_node", "run_id": "server_run", "node_id": "agent_node"}},
    )
    assert response.status_code == 200, response.text
    session = response.json()
    session_dir = Path(session["session_dir"])
    turn_id = "turn_publish"
    turn_dir = session_dir / "turns" / turn_id
    turn_dir.mkdir(parents=True)
    (turn_dir / "events.jsonl").write_text("", encoding="utf-8")
    write_json(session_dir / "current_output.json", {"summary": "published"})
    session_payload = json.loads((session_dir / "session.json").read_text(encoding="utf-8"))
    session_payload["current_output_turn_id"] = turn_id
    write_json(session_dir / "session.json", session_payload)

    publish_response = client.post(
        f"/api/agent-sessions/{session['session_id']}/output/publish",
        json={"expected_turn_id": turn_id},
    )

    assert publish_response.status_code == 200, publish_response.text
    assert json.loads((node_dir / "output.json").read_text(encoding="utf-8")) == {
        "summary": "published"
    }


def test_agent_session_publish_rejects_stale_turn(
    client: TestClient,
    project_root: Path,
) -> None:
    node_dir = project_root / "runs" / "server_run" / "nodes" / "agent_node"
    node_dir.mkdir(parents=True)
    write_json(
        node_dir / "runtime.json",
        {"runtime": "codex_app_server", "workspace_dir": str(project_root)},
    )
    write_json(node_dir / "output_schema.json", output_schema())
    session = client.post(
        "/api/agent-sessions",
        json={"source": {"type": "run_node", "run_id": "server_run", "node_id": "agent_node"}},
    ).json()
    session_dir = Path(session["session_dir"])
    write_json(session_dir / "current_output.json", {"summary": "draft"})
    session_payload = json.loads((session_dir / "session.json").read_text(encoding="utf-8"))
    session_payload["current_output_turn_id"] = "turn_current"
    write_json(session_dir / "session.json", session_payload)

    publish_response = client.post(
        f"/api/agent-sessions/{session['session_id']}/output/publish",
        json={"expected_turn_id": "turn_old"},
    )

    assert publish_response.status_code == 400
    assert "stale" in publish_response.json()["detail"]


def output_schema() -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {"summary": {"type": "string"}},
        "required": ["summary"],
    }


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def create_workbench_assistant_session(client: TestClient) -> dict:
    response = client.post(
        "/api/agent-sessions",
        json={
            "source": {
                "type": "workbench_assistant",
                "task_id": "task_canvas_default",
                "canvas_hash": "hash_1",
                "canvas_snapshot": assistant_canvas_snapshot(),
                "selection": {"type": "canvas"},
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def assistant_canvas_snapshot() -> dict:
    return {
        "task_id": "task_canvas_default",
        "nodes": [],
        "callable_catalog": [
            {
                "id": "echo-test.generic",
                "kind": "agent_class",
                "name": "Echo Test",
                "runtime": "generic_cli",
            }
        ],
        "workflow_catalog": [],
    }


def wait_for_session_ready(client: TestClient, session_id: str) -> dict:
    for _ in range(20):
        payload = client.get(f"/api/agent-sessions/{session_id}").json()
        if payload.get("status") not in {"queued", "running"}:
            return payload
        time.sleep(0.05)
    raise AssertionError("agent session did not become ready")
