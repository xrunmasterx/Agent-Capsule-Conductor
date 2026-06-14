from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from acc.adapters.streaming import StreamingAgentTurnRequest, StreamingAgentTurnResult
from acc.agent_events import append_agent_event
from acc.app.authoring import AUTHORING_OUTPUT_SCHEMA_VERSION
from acc.app.agent_sessions import AgentTurnService, AgentTurnTaskManager
from acc.models import AccError
from acc.server.live_events import WorkbenchLiveBus


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
    assert payload["owner_ref"] == "task:task_canvas_default"
    assert payload["retention"] == {"pinned": False, "retention_class": "normal"}
    assert payload["runtime"] == "codex_app_server"
    assert Path(payload["session_dir"], "context_snapshot.json").exists()
    assert Path(payload["session_dir"]).is_relative_to(project_root / ".acc" / "sessions")
    assert Path(payload["session_dir"], "retention.json").exists()


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
    assert "event: live_event" in text
    assert '"source": "assistant_turn"' in text
    assert '"projection":' in text
    assert '"event_seq":' in text
    assert "agent_output_draft" in text
    assert "provider_events" not in text


def test_create_agent_session_from_nested_run_node_accepts_safe_node_run_dir(
    client: TestClient,
    project_root: Path,
) -> None:
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
    node_dir.mkdir(parents=True)
    write_json(
        node_dir / "runtime.json",
        {"runtime": "codex_app_server", "workspace_dir": str(project_root)},
    )
    write_json(node_dir / "output_schema.json", output_schema())

    response = client.post(
        "/api/agent-sessions",
        json={
            "source": {
                "type": "run_node",
                "run_id": "server_run",
                "node_id": "agent_node",
                "node_run_dir": str(node_dir.resolve()),
            }
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["bound_run_id"] == "server_run"
    assert payload["bound_node_id"] == "agent_node"
    assert payload["owner_ref"] == "run_node:server_run/agent_node"
    assert Path(payload["session_dir"]).is_relative_to(node_dir / "sessions")
    runtime = json.loads((node_dir / "runtime.json").read_text(encoding="utf-8"))
    assert runtime["agent_session_ref"] == payload["session_dir"]


def test_agent_session_lookup_uses_new_session_index_after_service_reload(
    project_root: Path,
) -> None:
    service = AgentTurnService(project_root=project_root)
    session = service.create_workbench_assistant_session(
        task_id="task_canvas_default",
        canvas_hash="hash_1",
        canvas_snapshot=assistant_canvas_snapshot(),
        selection={"type": "canvas"},
    )

    reloaded_service = AgentTurnService(project_root=project_root)
    loaded = reloaded_service.get_session(session["session_id"])

    assert loaded["session_id"] == session["session_id"]
    assert Path(loaded["session_dir"]).is_relative_to(project_root / ".acc" / "sessions")
    index = json.loads((project_root / ".acc" / "session_index.json").read_text(encoding="utf-8"))
    assert session["session_id"] in index["sessions"]


def test_legacy_agent_session_folder_still_loads(project_root: Path) -> None:
    legacy_dir = project_root / "runs" / "_agent_sessions" / "task_legacy" / "node_legacy"
    legacy_dir.mkdir(parents=True)
    write_json(
        legacy_dir / "session.json",
        {
            "schema_version": "acc.agent_session.v1",
            "session_id": "agent_session_legacy",
            "task_id": "task_legacy",
            "node_id": "node_legacy",
            "callable_ref": {"kind": "agent_class", "id": "legacy.codex", "version": None},
            "runtime": "codex_app_server",
            "provider_session_id": None,
            "workspace_ref": str(project_root),
            "status": "ready",
            "created_at": "2026-06-13T00:00:00Z",
            "updated_at": "2026-06-13T00:00:00Z",
        },
    )
    (legacy_dir / "messages.jsonl").write_text(
        json.dumps({"role": "assistant", "content": "legacy"}) + "\n",
        encoding="utf-8",
    )

    service = AgentTurnService(project_root=project_root)
    loaded = service.get_session("agent_session_legacy")
    messages = service.messages("agent_session_legacy")

    assert loaded["session_dir"] == str(legacy_dir.resolve())
    assert messages["messages"][0]["content"] == "legacy"


def test_create_agent_session_from_run_node_rejects_outside_node_run_dir(
    client: TestClient,
    project_root: Path,
    tmp_path: Path,
) -> None:
    outside_dir = tmp_path / "outside" / "agent_node"
    outside_dir.mkdir(parents=True)

    response = client.post(
        "/api/agent-sessions",
        json={
            "source": {
                "type": "run_node",
                "run_id": "server_run",
                "node_id": "agent_node",
                "node_run_dir": str(outside_dir.resolve()),
            }
        },
    )

    assert response.status_code == 400
    assert "outside" in response.json()["detail"]


def test_workbench_live_bus_emits_gap_when_subscriber_queue_overflows() -> None:
    asyncio.run(run_live_bus_gap_test())


async def run_live_bus_gap_test() -> None:
    bus = WorkbenchLiveBus()
    async for queue in bus.subscribe("turn:test", max_queue_events=1):
        bus.publish(
            "turn:test",
            {"event_id": "evt_1", "seq": bus.next_seq("turn:test"), "type": "agent_event"},
        )
        bus.publish(
            "turn:test",
            {"event_id": "evt_2", "seq": bus.next_seq("turn:test"), "type": "agent_event"},
        )
        event = await queue.get()
        assert event["type"] == "gap"
        break


def test_agent_turn_task_manager_does_not_duplicate_adapter_failure_event(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    monkeypatch.setenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", "1")

    asyncio.run(run_agent_turn_task_manager_does_not_duplicate_failure_event(tmp_path))


async def run_agent_turn_task_manager_does_not_duplicate_failure_event(tmp_path: Path) -> None:
    service = AgentTurnService(project_root=tmp_path)
    session = service.create_session(
        task_id="task",
        node_id="node",
        callable_ref={"kind": "agent_class", "id": "node.codex"},
        runtime="codex_app_server",
        workspace_ref=str(tmp_path),
        output_schema=output_schema(),
    )
    turn = service.submit_agent_turn(
        session["session_id"],
        message="Run once.",
        reason="node_chat",
    )
    manager = AgentTurnTaskManager(project_root=tmp_path)

    manager.submit(
        session_id=session["session_id"],
        turn_id=turn["turn_id"],
        adapter=FailingStreamingAdapter(),
    )
    for _ in range(20):
        if not manager.tasks:
            break
        await asyncio.sleep(0.05)

    final_turn = service.get_turn(session["session_id"], turn["turn_id"])
    events = read_jsonl(
        Path(session["session_dir"]) / "turns" / turn["turn_id"] / "events.jsonl"
    )

    assert final_turn["status"] == "failed"
    assert [event["type"] for event in events].count("agent_turn_failed") == 1


def test_workbench_assistant_normalizes_missing_authoring_metadata(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    monkeypatch.setenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", "1")

    payload = {
        "schema_version": AUTHORING_OUTPUT_SCHEMA_VERSION,
        "assistant_message": "可以继续对话。",
        "proposal_kind": "canvas",
        "proposal": None,
    }

    asyncio.run(run_workbench_assistant_normalizes_missing_metadata(tmp_path, payload))


async def run_workbench_assistant_normalizes_missing_metadata(
    tmp_path: Path,
    payload: dict[str, Any],
) -> None:
    adapter = WorkbenchAuthoringPayloadAdapter(payload)
    service = AgentTurnService(
        project_root=tmp_path,
        adapter=adapter,
    )
    session = service.create_workbench_assistant_session(
        task_id="task_canvas_default",
        canvas_hash="hash_1",
        canvas_snapshot=assistant_canvas_snapshot(),
        selection={"type": "canvas"},
    )
    turn = service.submit_agent_turn(
        session["session_id"],
        message="你好",
        reason="canvas_revision",
        canvas_hash="hash_1",
        canvas_snapshot=assistant_canvas_snapshot(),
        selection={"type": "canvas"},
    )

    result = await service.execute_agent_turn(session["session_id"], turn["turn_id"])
    current_output = json.loads(
        Path(session["session_dir"], "current_output.json").read_text(encoding="utf-8")
    )
    draft_output = json.loads(
        Path(session["session_dir"], "turns", turn["turn_id"], "output_draft.json").read_text(
            encoding="utf-8"
        )
    )
    validation = service.validate_assistant_draft(
        session["session_id"],
        expected_turn_id=turn["turn_id"],
    )

    assert result["status"] == "success"
    assert adapter.response_modes == ["structured_required"]
    assert turn["draft_output_ref"] == "output_draft.json"
    assert turn["primary_channel"] == "output_draft"
    assert turn["expects_output_draft"] is True
    assert current_output["questions"] == []
    assert current_output["risk_notes"] == []
    assert current_output["confidence"] == "medium"
    assert draft_output == current_output
    assert validation["status"] == "valid"
    assert validation["questions"] == []
    assert validation["risk_notes"] == []
    assert validation["confidence"] == "medium"


def test_workbench_assistant_invalid_authoring_metadata_still_fails(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    monkeypatch.setenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", "1")

    payload = {
        "schema_version": AUTHORING_OUTPUT_SCHEMA_VERSION,
        "assistant_message": "可以继续对话。",
        "proposal_kind": "canvas",
        "proposal": None,
        "questions": [],
        "risk_notes": [],
        "confidence": 1,
    }

    with pytest.raises(AccError, match="confidence must be a string"):
        asyncio.run(run_workbench_assistant_rejects_payload(tmp_path, payload))


def test_workbench_assistant_invalid_authoring_output_persists_failure_metadata(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    monkeypatch.setenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", "1")

    payload = {
        "schema_version": AUTHORING_OUTPUT_SCHEMA_VERSION,
        "assistant_message": "draft",
        "proposal_kind": "canvas",
        "proposal": None,
        "questions": [],
        "risk_notes": [],
        "confidence": 1,
    }

    asyncio.run(run_invalid_authoring_output_persists_failure_metadata(tmp_path, payload))


async def run_invalid_authoring_output_persists_failure_metadata(
    tmp_path: Path,
    payload: dict[str, Any],
) -> None:
    service = AgentTurnService(
        project_root=tmp_path,
        adapter=WorkbenchAuthoringPayloadAdapter(payload, provider_session_id="thread_bad"),
    )
    session = service.create_workbench_assistant_session(
        task_id="task_canvas_default",
        canvas_hash="hash_1",
        canvas_snapshot=assistant_canvas_snapshot(),
        selection={"type": "canvas"},
    )
    turn = service.submit_agent_turn(
        session["session_id"],
        message="生成结构化修改",
        reason="canvas_revision",
        canvas_hash="hash_1",
        canvas_snapshot=assistant_canvas_snapshot(),
        selection={"type": "canvas"},
    )

    with pytest.raises(AccError, match="confidence must be a string"):
        await service.execute_agent_turn(session["session_id"], turn["turn_id"])

    final_session = service.get_session(session["session_id"])
    final_turn = service.get_turn(session["session_id"], turn["turn_id"])
    events = service.turn_events(session["session_id"], turn["turn_id"])["events"]
    failed_events = [event for event in events if event["type"] == "agent_turn_failed"]

    assert final_session["status"] == "failed"
    assert final_session["last_failure_kind"] == "invalid_authoring_output"
    assert final_session["last_recoverability"] == "retry_allowed"
    assert final_session["provider_session_policy"] == "clear_before_next_structured_turn"
    assert final_session["provider_session_health"] == "poisoned_for_structured_output"
    assert final_session["can_submit_next_turn"] is True
    assert final_turn["failure_kind"] == "invalid_authoring_output"
    assert final_turn["technical_detail"] == "Authoring agent output confidence must be a string"
    assert len(failed_events) == 1
    assert failed_events[0]["payload"]["user_summary"].startswith("本轮结构化输出无效")
    assert failed_events[0]["payload"]["technical_detail"] == final_turn["technical_detail"]
    assert failed_events[0]["projection"]["summary"].startswith("本轮结构化输出无效")

    next_turn = service.submit_agent_turn(
        session["session_id"],
        message="重新生成结构化修改",
        reason="canvas_revision",
        expected_provider_session_id="thread_bad",
        canvas_hash="hash_1",
        canvas_snapshot=assistant_canvas_snapshot(),
        selection={"type": "canvas"},
    )
    next_input = json.loads(
        Path(final_session["session_dir"], "turns", next_turn["turn_id"], "input.json").read_text(
            encoding="utf-8"
        )
    )
    next_session = service.get_session(session["session_id"])

    assert next_input["response_mode"] == "structured_required"
    assert next_session["provider_session_id"] is None
    assert next_session["provider_session_policy"] == "fresh_session_started"


def test_workbench_assistant_missing_required_authoring_fields_still_fails(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    monkeypatch.setenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", "1")

    payload = {
        "schema_version": AUTHORING_OUTPUT_SCHEMA_VERSION,
        "proposal_kind": "canvas",
        "proposal": None,
    }

    with pytest.raises(AccError, match="assistant_message must be a string"):
        asyncio.run(run_workbench_assistant_rejects_payload(tmp_path, payload))


def test_workbench_assistant_chat_text_does_not_create_draft(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    monkeypatch.setenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", "1")

    asyncio.run(run_workbench_assistant_chat_text_does_not_create_draft(tmp_path))


async def run_workbench_assistant_chat_text_does_not_create_draft(tmp_path: Path) -> None:
    assistant_text = (
        "可以直接对话。下面只是示例文本：\n"
        "```json\n"
        '{"schema_version":"acc.authoring.output.v1","assistant_message":"not a draft"}'
        "\n```"
    )
    adapter = WorkbenchChatTextAdapter(assistant_text, write_legacy_output=True)
    service = AgentTurnService(project_root=tmp_path, adapter=adapter)
    session = service.create_workbench_assistant_session(
        task_id="task_canvas_default",
        canvas_hash="hash_1",
        canvas_snapshot=assistant_canvas_snapshot(),
        selection={"type": "canvas"},
    )
    turn = service.submit_agent_turn(
        session["session_id"],
        message="解释一下，并给 JSON 示例",
        reason="workbench_chat",
        canvas_hash="hash_1",
        canvas_snapshot=assistant_canvas_snapshot(),
        selection={"type": "canvas"},
    )

    result = await service.execute_agent_turn(session["session_id"], turn["turn_id"])
    final_session = service.get_session(session["session_id"])
    messages = service.messages(session["session_id"])["messages"]
    turn_dir = Path(session["session_dir"], "turns", turn["turn_id"])

    assert result["status"] == "success"
    assert adapter.response_modes == ["chat_optional_output"]
    assert turn["draft_output_ref"] is None
    assert turn["primary_channel"] == "messages"
    assert turn["expects_output_draft"] is False
    assert final_session["current_output_turn_id"] is None
    assert not Path(session["session_dir"], "current_output.json").exists()
    assert not Path(turn_dir, "output_draft.json").exists()
    assert any(item["role"] == "assistant" and item["content"] == assistant_text for item in messages)


def test_workbench_assistant_canvas_revision_requires_draft(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ACC_RUN_MODE", "production")
    monkeypatch.setenv("ACC_ENABLE_EXTERNAL_AGENT_EXECUTION", "1")

    asyncio.run(run_workbench_assistant_canvas_revision_requires_draft(tmp_path))


async def run_workbench_assistant_canvas_revision_requires_draft(tmp_path: Path) -> None:
    adapter = WorkbenchChatTextAdapter("plain authoring text")
    service = AgentTurnService(project_root=tmp_path, adapter=adapter)
    session = service.create_workbench_assistant_session(
        task_id="task_canvas_default",
        canvas_hash="hash_1",
        canvas_snapshot=assistant_canvas_snapshot(),
        selection={"type": "canvas"},
    )
    turn = service.submit_agent_turn(
        session["session_id"],
        message="请修改画布",
        reason="canvas_revision",
        canvas_hash="hash_1",
        canvas_snapshot=assistant_canvas_snapshot(),
        selection={"type": "canvas"},
    )

    with pytest.raises(AccError, match="did not produce output_draft"):
        await service.execute_agent_turn(session["session_id"], turn["turn_id"])
    final_session = service.get_session(session["session_id"])

    assert adapter.response_modes == ["structured_required"]
    assert final_session["status"] == "failed"
    assert final_session["current_output_turn_id"] is None


async def run_workbench_assistant_rejects_payload(
    tmp_path: Path,
    payload: dict[str, Any],
) -> None:
    service = AgentTurnService(
        project_root=tmp_path,
        adapter=WorkbenchAuthoringPayloadAdapter(payload),
    )
    session = service.create_workbench_assistant_session(
        task_id="task_canvas_default",
        canvas_hash="hash_1",
        canvas_snapshot=assistant_canvas_snapshot(),
        selection={"type": "canvas"},
    )
    turn = service.submit_agent_turn(
        session["session_id"],
        message="你好",
        reason="canvas_revision",
        canvas_hash="hash_1",
        canvas_snapshot=assistant_canvas_snapshot(),
        selection={"type": "canvas"},
    )

    await service.execute_agent_turn(session["session_id"], turn["turn_id"])


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


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


class FailingStreamingAdapter:
    async def run_turn(self, request: StreamingAgentTurnRequest) -> StreamingAgentTurnResult:
        append_agent_event(
            request.events_log_path,
            "agent_turn_failed",
            session_id=request.session_id,
            turn_id=request.turn_id,
            run_id=request.run_id,
            node_id=request.node_id,
            payload={"error": "provider failed"},
        )
        return StreamingAgentTurnResult(
            status="failed",
            summary="provider failed",
            output_json_path=None,
            event_log_path=request.events_log_path,
            provider_event_log_path=request.provider_events_log_path,
            provider_session_id=None,
            error="provider failed",
        )


class WorkbenchAuthoringPayloadAdapter:
    def __init__(self, payload: dict[str, Any], *, provider_session_id: str | None = None) -> None:
        self.payload = payload
        self.provider_session_id = provider_session_id
        self.response_modes: list[str] = []

    async def run_turn(self, request: StreamingAgentTurnRequest) -> StreamingAgentTurnResult:
        self.response_modes.append(request.response_mode)
        write_json(request.output_json_path, self.payload)
        append_agent_event(
            request.events_log_path,
            "agent_output_draft",
            session_id=request.session_id,
            turn_id=request.turn_id,
            run_id=request.run_id,
            node_id=request.node_id,
            payload={"output_path": str(request.output_json_path)},
        )
        return StreamingAgentTurnResult(
            status="success",
            summary="assistant draft ready",
            output_json_path=request.output_json_path,
            event_log_path=request.events_log_path,
            provider_event_log_path=request.provider_events_log_path,
            provider_session_id=self.provider_session_id,
            assistant_messages=(json.dumps(self.payload, ensure_ascii=False),),
        )


class WorkbenchChatTextAdapter:
    def __init__(self, assistant_text: str, *, write_legacy_output: bool = False) -> None:
        self.assistant_text = assistant_text
        self.write_legacy_output = write_legacy_output
        self.response_modes: list[str] = []

    async def run_turn(self, request: StreamingAgentTurnRequest) -> StreamingAgentTurnResult:
        self.response_modes.append(request.response_mode)
        if self.write_legacy_output:
            write_json(
                request.output_json_path,
                {
                    "schema_version": AUTHORING_OUTPUT_SCHEMA_VERSION,
                    "assistant_message": "legacy draft should be ignored",
                    "proposal_kind": "canvas",
                    "proposal": None,
                },
            )
        return StreamingAgentTurnResult(
            status="success",
            summary="chat text ready",
            output_json_path=request.output_json_path if self.write_legacy_output else None,
            event_log_path=request.events_log_path,
            provider_event_log_path=request.provider_events_log_path,
            provider_session_id=None,
            assistant_messages=(self.assistant_text,),
        )


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
