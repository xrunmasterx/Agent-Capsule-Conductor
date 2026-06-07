from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from acc.adapters.codex_app_server import CodexAppServerAdapter
from acc.adapters.streaming import AgentApprovalDecision, StreamingAgentTurnRequest


def test_codex_app_server_adapter_runs_thread_start_turn_start(tmp_path: Path) -> None:
    asyncio.run(run_thread_start_turn_start(tmp_path))


async def run_thread_start_turn_start(tmp_path: Path) -> None:
    command = fake_codex_command(tmp_path)
    request = make_request(tmp_path, command)

    result = await CodexAppServerAdapter().run_turn(request)

    assert result.status == "success"
    assert result.provider_session_id == "thread_1"
    assert json.loads(request.output_json_path.read_text(encoding="utf-8")) == {
        "schema_version": "test.output.v1",
        "summary": "done",
    }
    events = read_jsonl(request.events_log_path)
    assert [event["type"] for event in events] == [
        "agent_turn_started",
        "agent_message",
        "agent_usage",
        "agent_output_draft",
        "agent_turn_completed",
    ]
    provider_events = read_jsonl(request.provider_events_log_path)
    assert any(event.get("method") == "turn/completed" for event in provider_events)
    writes = read_jsonl(tmp_path / "rpc_writes.jsonl")
    initialize = next(item for item in writes if item.get("method") == "initialize")
    assert initialize["params"]["clientInfo"]["name"] == "acc"


def test_codex_app_server_adapter_resumes_prior_thread(tmp_path: Path) -> None:
    asyncio.run(run_resumes_prior_thread(tmp_path))


async def run_resumes_prior_thread(tmp_path: Path) -> None:
    command = fake_codex_command(tmp_path)
    request = make_request(tmp_path, command, provider_session_id="prior_thread")

    result = await CodexAppServerAdapter().run_turn(request)

    assert result.status == "success"
    assert result.provider_session_id == "prior_thread"
    writes = (tmp_path / "rpc_writes.jsonl").read_text(encoding="utf-8")
    assert '"method": "thread/resume"' in writes


def test_codex_app_server_normalizes_model_and_reasoning(tmp_path: Path) -> None:
    asyncio.run(run_normalizes_model_and_reasoning(tmp_path))


async def run_normalizes_model_and_reasoning(tmp_path: Path) -> None:
    command = fake_codex_command(tmp_path)
    request = make_request(tmp_path, command, model="gpt5.5", reasoning_effort="max")

    result = await CodexAppServerAdapter().run_turn(request)

    assert result.status == "success"
    writes = read_jsonl(tmp_path / "rpc_writes.jsonl")
    thread_start = next(item for item in writes if item.get("method") == "thread/start")
    assert thread_start["params"]["model"] == "gpt-5.5"
    assert thread_start["params"]["config"]["model_reasoning_effort"] == "xhigh"


def test_codex_app_server_chat_mode_accepts_plain_message(tmp_path: Path) -> None:
    asyncio.run(run_chat_mode_accepts_plain_message(tmp_path))


async def run_chat_mode_accepts_plain_message(tmp_path: Path) -> None:
    command = fake_codex_command(tmp_path, message="plain reply")
    request = make_request(tmp_path, command, response_mode="chat_optional_output")

    result = await CodexAppServerAdapter().run_turn(request)

    assert result.status == "success"
    assert result.output_json_path is None
    assert result.assistant_messages == ("plain reply",)
    assert not request.output_json_path.exists()


def test_codex_app_server_authoring_mode_accepts_plain_message(tmp_path: Path) -> None:
    asyncio.run(run_authoring_mode_accepts_plain_message(tmp_path))


async def run_authoring_mode_accepts_plain_message(tmp_path: Path) -> None:
    command = fake_codex_command(tmp_path, message="plain authoring reply")
    request = make_request(tmp_path, command, response_mode="authoring_optional_proposal")

    result = await CodexAppServerAdapter().run_turn(request)

    assert result.status == "success"
    assert result.output_json_path is None
    assert result.assistant_messages == ("plain authoring reply",)
    assert not request.output_json_path.exists()


def test_codex_app_server_extracts_json_object_from_markdown_message(tmp_path: Path) -> None:
    asyncio.run(run_extracts_json_object_from_markdown_message(tmp_path))


async def run_extracts_json_object_from_markdown_message(tmp_path: Path) -> None:
    message = (
        "Here is the draft:\n"
        "```json\n"
        '{"schema_version":"test.output.v1","summary":"from fenced json"}'
        "\n```"
    )
    command = fake_codex_command(tmp_path, message=message)
    request = make_request(tmp_path, command, response_mode="authoring_optional_proposal")

    result = await CodexAppServerAdapter().run_turn(request)

    assert result.status == "success"
    assert json.loads(request.output_json_path.read_text(encoding="utf-8")) == {
        "schema_version": "test.output.v1",
        "summary": "from fenced json",
    }


def test_codex_app_server_cancel_marker_cancels_turn(tmp_path: Path) -> None:
    asyncio.run(run_cancel_marker_cancels_turn(tmp_path))


async def run_cancel_marker_cancels_turn(tmp_path: Path) -> None:
    command = fake_codex_command(tmp_path, wait_forever=True)
    cancel_path = tmp_path / "cancel_requested"
    request = make_request(tmp_path, command, cancel_path=cancel_path)
    cancel_path.write_text("cancel", encoding="utf-8")

    result = await CodexAppServerAdapter().run_turn(request)

    assert result.status == "cancelled"
    assert any(
        event["type"] == "agent_turn_cancelled" for event in read_jsonl(request.events_log_path)
    )


def test_codex_app_server_approval_bridge_decides_provider_response(tmp_path: Path) -> None:
    asyncio.run(run_approval_bridge_decides_provider_response(tmp_path))


async def run_approval_bridge_decides_provider_response(tmp_path: Path) -> None:
    bridge = ApprovingBridge()
    command = fake_codex_command(tmp_path, request_approval=True)
    request = make_request(tmp_path, command, approval_bridge=bridge)

    result = await CodexAppServerAdapter().run_turn(request)

    assert result.status == "success"
    assert bridge.calls == ["item/commandExecution/requestApproval"]
    writes = (tmp_path / "rpc_writes.jsonl").read_text(encoding="utf-8")
    assert '"approved": true' in writes.lower()


def make_request(
    tmp_path: Path,
    command: str,
    *,
    provider_session_id: str | None = None,
    response_mode: str = "structured_required",
    cancel_path: Path | None = None,
    approval_bridge=None,
    model: str | None = None,
    reasoning_effort: str | None = None,
) -> StreamingAgentTurnRequest:
    run_dir = tmp_path / "turn"
    run_dir.mkdir()
    prompt_path = run_dir / "resolved_prompt.md"
    prompt_path.write_text("Return JSON.", encoding="utf-8")
    schema_path = run_dir / "output_schema.json"
    schema_path.write_text(
        json.dumps(
            {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "schema_version": {"type": "string"},
                    "summary": {"type": "string"},
                },
                "required": ["schema_version", "summary"],
            }
        ),
        encoding="utf-8",
    )
    return StreamingAgentTurnRequest(
        callable_id="worker.codex",
        runtime="codex_app_server",
        run_dir=run_dir,
        workspace_dir=tmp_path,
        prompt_path=prompt_path,
        input_payload={"main": "hello"},
        output_schema_path=schema_path,
        output_json_path=run_dir / "output_draft.json",
        events_log_path=run_dir / "events.jsonl",
        provider_events_log_path=run_dir / "provider_events.jsonl",
        stdout_log_path=run_dir / "stdout.log",
        stderr_log_path=run_dir / "stderr.log",
        timeout_seconds=5,
        command=command,
        session_id="agent_session_test",
        turn_id="turn_test",
        provider_session_id=provider_session_id,
        cancel_path=cancel_path,
        model=model,
        reasoning_effort=reasoning_effort,
        response_mode=response_mode,  # type: ignore[arg-type]
        approval_bridge=approval_bridge,
    )


class ApprovingBridge:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def request_approval(self, **kwargs) -> AgentApprovalDecision:
        self.calls.append(kwargs["provider_method"])
        return AgentApprovalDecision(approved=True, response={"approved": True}, reason="test")


def fake_codex_command(
    tmp_path: Path,
    *,
    message: str | None = None,
    wait_forever: bool = False,
    request_approval: bool = False,
) -> str:
    script = tmp_path / "fake_codex.py"
    script_text = """
from __future__ import annotations
import json
import pathlib
import sys
import time

log = pathlib.Path(__file__).with_name("rpc_writes.jsonl")
MESSAGE = __MESSAGE_LITERAL__
WAIT_FOREVER = __WAIT_FOREVER_LITERAL__
REQUEST_APPROVAL = __REQUEST_APPROVAL_LITERAL__

def emit(payload):
    print(json.dumps(payload), flush=True)

for line in sys.stdin:
    payload = json.loads(line)
    with log.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True) + "\\n")
    method = payload.get("method")
    request_id = payload.get("id")
    if method == "initialize":
        if "clientInfo" not in payload.get("params", {}):
            emit({
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {
                    "code": -32600,
                    "message": "Invalid request: missing field `clientInfo`",
                },
            })
            continue
        emit({"jsonrpc": "2.0", "id": request_id, "result": {}})
    elif method == "thread/resume":
        emit({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {"threadId": payload["params"]["threadId"]},
        })
    elif method == "thread/start":
        emit({"jsonrpc": "2.0", "id": request_id, "result": {"threadId": "thread_1"}})
    elif method == "turn/start":
        emit({"jsonrpc": "2.0", "id": request_id, "result": {}})
        if WAIT_FOREVER:
            while True:
                time.sleep(1)
        if REQUEST_APPROVAL:
            emit({
                "jsonrpc": "2.0",
                "id": 99,
                "method": "item/commandExecution/requestApproval",
                "params": {"command": "echo ok"},
            })
            approval = json.loads(sys.stdin.readline())
            with log.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(approval, sort_keys=True) + "\\n")
        emit({
            "jsonrpc": "2.0",
            "method": "item/completed",
            "params": {
                "item": {
                    "type": "agentMessage",
                    "text": MESSAGE or json.dumps({
                        "schema_version": "test.output.v1",
                        "summary": "done",
                    }),
                }
            },
        })
        emit({
            "jsonrpc": "2.0",
            "method": "turn/completed",
            "params": {"usage": {"input_tokens": 1, "output_tokens": 2}},
        })
        break
"""
    script.write_text(
        script_text.replace("__MESSAGE_LITERAL__", repr(message))
        .replace("__WAIT_FOREVER_LITERAL__", "True" if wait_forever else "False")
        .replace("__REQUEST_APPROVAL_LITERAL__", "True" if request_approval else "False"),
        encoding="utf-8",
    )
    if sys.platform.startswith("win"):
        command = tmp_path / "fake_codex.cmd"
        command.write_text(
            f'@echo off\r\n"{sys.executable}" "{script}" %*\r\n',
            encoding="utf-8",
        )
        return str(command)
    command = tmp_path / "fake_codex"
    command.write_text(
        f"#!/bin/sh\nexec {sys.executable} {script} \"$@\"\n",
        encoding="utf-8",
    )
    command.chmod(0o755)
    return str(command)


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
