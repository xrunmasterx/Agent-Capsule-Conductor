from __future__ import annotations

import asyncio
import contextlib
import json
import os
import shutil
from pathlib import Path
from typing import Any

from acc.adapters.streaming import (
    AgentApprovalDecision,
    StreamingAgentTurnRequest,
    StreamingAgentTurnResult,
)
from acc.agent_events import append_agent_event, append_provider_event
from acc.runtime.codex_models import normalize_codex_model, normalize_codex_reasoning_effort
from acc.storage import append_bytes_locked, write_text_atomic
from acc.utils import AccError

APPROVAL_METHODS = frozenset(
    {
        "item/commandExecution/requestApproval",
        "execCommandApproval",
        "item/fileChange/requestApproval",
        "applyPatchApproval",
        "mcp/elicitation",
    }
)

CODEX_APP_SERVER_STREAM_LIMIT_BYTES = 16 * 1024 * 1024


class CodexAppServerAdapter:
    """Run Codex through app-server JSON-RPC, not one-shot ``codex exec``."""

    async def run_turn(
        self,
        request: StreamingAgentTurnRequest,
    ) -> StreamingAgentTurnResult:
        command = build_codex_app_server_command(request)
        env = os.environ.copy()
        env.update(request.env)
        env.setdefault("CODEX_HOME", str(prepare_codex_app_server_home(request)))
        request.run_dir.mkdir(parents=True, exist_ok=True)
        write_text_atomic(request.stdout_log_path, "")
        write_text_atomic(request.stderr_log_path, "")
        write_text_atomic(request.events_log_path, "")
        write_text_atomic(request.provider_events_log_path, "")

        client: CodexJsonRpcClient | None = None
        process = None
        try:
            process = await asyncio.create_subprocess_exec(
                *command,
                cwd=request.workspace_dir,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                limit=CODEX_APP_SERVER_STREAM_LIMIT_BYTES,
            )
            if (
                getattr(process, "stdin", None) is None
                or getattr(process, "stdout", None) is None
                or getattr(process, "stderr", None) is None
            ):
                stdout, stderr = await process.communicate()
                append_bytes(request.stdout_log_path, stdout)
                append_bytes(request.stderr_log_path, stderr)
                return failed_result(
                    request,
                    stderr.decode("utf-8", errors="replace").strip()
                    or "Codex app-server stdio pipes were not created",
                )
            stderr_task = asyncio.create_task(
                capture_stream_text(process.stderr, request.stderr_log_path)
            )
            client = CodexJsonRpcClient(process, request)
            reader_task = asyncio.create_task(client.read_stdout())
            turn_task = asyncio.create_task(run_codex_turn(client, request))
            timeout_task = asyncio.create_task(asyncio.sleep(request.timeout_seconds))
            wait_tasks = {turn_task, timeout_task}
            cancel_task = None
            if request.cancel_path is not None:
                cancel_task = asyncio.create_task(wait_for_cancel_marker(request.cancel_path))
                wait_tasks.add(cancel_task)
            done, pending = await asyncio.wait(wait_tasks, return_when=asyncio.FIRST_COMPLETED)
            try:
                if turn_task in done:
                    result = await turn_task
                elif timeout_task in done:
                    append_agent_event(
                        request.events_log_path,
                        "agent_turn_failed",
                        session_id=request.session_id,
                        turn_id=request.turn_id,
                        run_id=request.run_id,
                        node_id=request.node_id,
                        payload={"error": "Codex app-server timed out"},
                    )
                    await terminate_process_tree(process)
                    return StreamingAgentTurnResult(
                        status="timeout",
                        summary="Codex app-server timed out",
                        output_json_path=None,
                        event_log_path=request.events_log_path,
                        provider_event_log_path=request.provider_events_log_path,
                        provider_session_id=client.thread_id,
                        error="timeout",
                    )
                else:
                    append_agent_event(
                        request.events_log_path,
                        "agent_turn_cancelled",
                        session_id=request.session_id,
                        turn_id=request.turn_id,
                        run_id=request.run_id,
                        node_id=request.node_id,
                        payload={"reason": "cancel_requested"},
                    )
                    await terminate_process_tree(process)
                    return StreamingAgentTurnResult(
                        status="cancelled",
                        summary="Codex app-server turn cancelled",
                        output_json_path=None,
                        event_log_path=request.events_log_path,
                        provider_event_log_path=request.provider_events_log_path,
                        provider_session_id=client.thread_id,
                        error="cancelled",
                    )
            finally:
                for pending_task in pending:
                    pending_task.cancel()
                await gather_cancelled(*pending)
                await terminate_process_tree(process)
                reader_task.cancel()
                await gather_cancelled(reader_task)
                await gather_cancelled(stderr_task)
            return result
        except FileNotFoundError:
            write_text_atomic(request.stderr_log_path, "codex executable not found\n")
            return failed_result(request, "codex executable not found")
        except Exception as exc:
            if process is not None:
                await terminate_process_tree(process)
            return failed_result(request, str(exc), client.thread_id if client else None)


async def run_codex_turn(
    client: CodexJsonRpcClient,
    request: StreamingAgentTurnRequest,
) -> StreamingAgentTurnResult:
    prompt = request.prompt_path.read_text(encoding="utf-8")
    append_agent_event(
        request.events_log_path,
        "agent_turn_started",
        session_id=request.session_id,
        turn_id=request.turn_id,
        run_id=request.run_id,
        node_id=request.node_id,
        payload={"runtime": "codex_app_server"},
    )
    await client.request(
        "initialize",
        {
            "clientInfo": {
                "name": "acc",
                "title": "Agent Callable Conductor",
                "version": "0.1.0",
            },
            "capabilities": {"experimentalApi": True},
        },
    )
    await client.notify("initialized", {})
    thread_id = await start_or_resume_thread(client, request)
    await client.request(
        "turn/start",
        {
            "threadId": thread_id,
            "input": [{"type": "text", "text": prompt}],
        },
    )
    await client.completed.wait()
    output = None
    if request.response_mode != "chat_optional_output":
        output = latest_json_object(client.agent_messages)
    if output is None and request.response_mode != "chat_optional_output":
        raise AccError("Codex app-server did not produce a JSON object agent message")
    output_json_path = None
    if output is not None:
        write_text_atomic(
            request.output_json_path,
            json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True),
        )
        output_json_path = request.output_json_path
        append_agent_event(
            request.events_log_path,
            "agent_output_draft",
            session_id=request.session_id,
            turn_id=request.turn_id,
            run_id=request.run_id,
            node_id=request.node_id,
            payload={"output_path": str(request.output_json_path.resolve())},
        )
    append_agent_event(
        request.events_log_path,
        "agent_turn_completed",
        session_id=request.session_id,
        turn_id=request.turn_id,
        run_id=request.run_id,
        node_id=request.node_id,
        payload={"provider_session_id": thread_id},
    )
    return StreamingAgentTurnResult(
        status="success",
        summary="Codex app-server turn completed",
        output_json_path=output_json_path,
        event_log_path=request.events_log_path,
        provider_event_log_path=request.provider_events_log_path,
        provider_session_id=thread_id,
        usage=client.usage,
        assistant_messages=tuple(client.agent_messages),
    )


async def start_or_resume_thread(
    client: CodexJsonRpcClient,
    request: StreamingAgentTurnRequest,
) -> str:
    params: dict[str, Any] = {
        "cwd": str(request.workspace_dir.resolve()),
        "developerInstructions": None,
        "model": normalize_codex_model(request.model),
        "persistExtendedHistory": True,
    }
    reasoning_effort = normalize_codex_reasoning_effort(request.reasoning_effort)
    if reasoning_effort:
        params["config"] = {"model_reasoning_effort": reasoning_effort}
    if request.provider_session_id:
        try:
            result = await client.request(
                "thread/resume",
                {**params, "threadId": request.provider_session_id},
            )
            thread_id = extract_thread_id(result) or request.provider_session_id
            client.thread_id = thread_id
            return thread_id
        except AccError:
            pass
    result = await client.request("thread/start", params)
    thread_id = extract_thread_id(result)
    if not thread_id:
        raise AccError("Codex app-server thread/start did not return a thread id")
    client.thread_id = thread_id
    return thread_id


class CodexJsonRpcClient:
    def __init__(self, process: asyncio.subprocess.Process, request: StreamingAgentTurnRequest):
        self.process = process
        self.turn_request = request
        self.next_id = 1
        self.pending: dict[int, asyncio.Future[Any]] = {}
        self.completed = asyncio.Event()
        self.agent_messages: list[str] = []
        self.usage: dict[str, Any] | None = None
        self.thread_id: str | None = request.provider_session_id

    async def request(self, method: str, params: dict[str, Any]) -> Any:
        request_id = self.next_id
        self.next_id += 1
        loop = asyncio.get_running_loop()
        future: asyncio.Future[Any] = loop.create_future()
        self.pending[request_id] = future
        await self.write({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        result = await future
        return result

    async def notify(self, method: str, params: dict[str, Any]) -> None:
        await self.write({"jsonrpc": "2.0", "method": method, "params": params})

    async def write(self, payload: dict[str, Any]) -> None:
        if self.process.stdin is None:
            raise AccError("Codex app-server stdin closed")
        line = json.dumps(payload, ensure_ascii=False) + "\n"
        self.process.stdin.write(line.encode("utf-8"))
        await self.process.stdin.drain()

    async def read_stdout(self) -> None:
        if self.process.stdout is None:
            return
        while True:
            raw = await self.process.stdout.readline()
            if not raw:
                break
            append_bytes(self.turn_request.stdout_log_path, raw)
            try:
                payload = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue
            append_provider_event(self.turn_request.provider_events_log_path, payload)
            if (
                "id" in payload
                and ("result" in payload or "error" in payload)
                and "method" not in payload
            ):
                self.handle_response(payload)
            elif "id" in payload and "method" in payload:
                await self.handle_server_request(payload)
            elif "method" in payload:
                self.handle_notification(payload)
            else:
                self.append_provider_status(payload)

    def handle_response(self, payload: dict[str, Any]) -> None:
        request_id = payload.get("id")
        if not isinstance(request_id, int):
            return
        future = self.pending.pop(request_id, None)
        if future is None or future.done():
            return
        if "error" in payload:
            future.set_exception(AccError(json.dumps(payload["error"], ensure_ascii=False)))
        else:
            future.set_result(payload.get("result"))

    def append_provider_status(self, payload: dict[str, Any]) -> None:
        summary = summarize_provider_item(payload)
        if not summary:
            return
        append_agent_event(
            self.turn_request.events_log_path,
            "agent_status",
            session_id=self.turn_request.session_id,
            turn_id=self.turn_request.turn_id,
            run_id=self.turn_request.run_id,
            node_id=self.turn_request.node_id,
            payload={"status": "provider_event", "item": summary},
        )

    async def handle_server_request(self, payload: dict[str, Any]) -> None:
        method = str(payload.get("method") or "")
        request_id = payload.get("id")
        if method in APPROVAL_METHODS:
            params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
            append_agent_event(
                self.turn_request.events_log_path,
                "agent_approval_requested",
                session_id=self.turn_request.session_id,
                turn_id=self.turn_request.turn_id,
                run_id=self.turn_request.run_id,
                node_id=self.turn_request.node_id,
                payload={"method": method, "params": summarize_provider_item(params)},
            )
            decision = await self.request_approval(method, params)
            append_agent_event(
                self.turn_request.events_log_path,
                "agent_status",
                session_id=self.turn_request.session_id,
                turn_id=self.turn_request.turn_id,
                run_id=self.turn_request.run_id,
                node_id=self.turn_request.node_id,
                payload={
                    "status": "approval_decided",
                    "method": method,
                    "approved": decision.approved,
                    "reason": decision.reason,
                    "interaction_id": decision.interaction_id,
                },
            )
            if isinstance(request_id, int):
                response = decision.response or {"approved": decision.approved}
                await self.write({"jsonrpc": "2.0", "id": request_id, "result": response})
            return
        if isinstance(request_id, int):
            await self.write(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32601, "message": f"Unsupported request: {method}"},
                }
            )

    async def request_approval(
        self,
        method: str,
        params: dict[str, Any],
    ) -> AgentApprovalDecision:
        bridge = self.turn_request.approval_bridge
        if bridge is None:
            return AgentApprovalDecision(
                approved=False,
                response={"approved": False},
                reason="no approval bridge configured",
            )
        return await bridge.request_approval(
            run_id=self.turn_request.run_id,
            node_id=self.turn_request.node_id,
            session_id=self.turn_request.session_id,
            turn_id=self.turn_request.turn_id,
            provider_method=method,
            provider_params=params,
            timeout_seconds=min(self.turn_request.timeout_seconds, 300),
        )

    def handle_notification(self, payload: dict[str, Any]) -> None:
        method = str(payload.get("method") or "")
        params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
        if method == "turn/started":
            thread_id = string_from(params, "threadId") or string_from(params, "thread_id")
            if thread_id:
                self.thread_id = thread_id
            append_agent_event(
                self.turn_request.events_log_path,
                "agent_status",
                session_id=self.turn_request.session_id,
                turn_id=self.turn_request.turn_id,
                run_id=self.turn_request.run_id,
                node_id=self.turn_request.node_id,
                payload={"status": "running", "provider_session_id": self.thread_id},
            )
            return
        if method == "turn/completed":
            usage = params.get("usage") or params.get("tokenUsage")
            if isinstance(usage, dict):
                self.usage = usage
                append_agent_event(
                    self.turn_request.events_log_path,
                    "agent_usage",
                    session_id=self.turn_request.session_id,
                    turn_id=self.turn_request.turn_id,
                    run_id=self.turn_request.run_id,
                    node_id=self.turn_request.node_id,
                    payload=usage,
                )
            self.completed.set()
            return
        if method == "item/agentMessage/delta":
            self.handle_agent_message_delta(params)
            return
        if method in {"item/started", "item/completed"}:
            self.handle_item_event(method, params)
            return
        if method == "codex/event":
            self.handle_legacy_codex_event(params)

    def handle_agent_message_delta(self, params: dict[str, Any]) -> None:
        delta = params.get("delta")
        if not isinstance(delta, str) or not delta:
            return
        append_agent_event(
            self.turn_request.events_log_path,
            "agent_message_delta",
            session_id=self.turn_request.session_id,
            turn_id=self.turn_request.turn_id,
            run_id=self.turn_request.run_id,
            node_id=self.turn_request.node_id,
            payload={
                "content": delta,
                "delta": delta,
                "thread_id": string_from(params, "threadId") or string_from(params, "thread_id"),
                "turn_id": string_from(params, "turnId") or string_from(params, "turn_id"),
                "item_id": string_from(params, "itemId") or string_from(params, "item_id"),
                "source": "codex_app_server",
            },
        )

    def handle_item_event(self, method: str, params: dict[str, Any]) -> None:
        item = params.get("item") if isinstance(params.get("item"), dict) else params
        item_type = str(item.get("type") or "")
        if item_type == "commandExecution":
            if method == "item/started":
                append_agent_event(
                    self.turn_request.events_log_path,
                    "agent_tool_use",
                    session_id=self.turn_request.session_id,
                    turn_id=self.turn_request.turn_id,
                    run_id=self.turn_request.run_id,
                    node_id=self.turn_request.node_id,
                    payload={"tool": "exec_command", "input": summarize_provider_item(item)},
                )
            else:
                append_agent_event(
                    self.turn_request.events_log_path,
                    "agent_tool_result",
                    session_id=self.turn_request.session_id,
                    turn_id=self.turn_request.turn_id,
                    run_id=self.turn_request.run_id,
                    node_id=self.turn_request.node_id,
                    payload={"tool": "exec_command", "output": summarize_provider_item(item)},
                )
            return
        if item_type in {"fileChange", "applyPatch"}:
            append_agent_event(
                self.turn_request.events_log_path,
                "agent_tool_use" if method == "item/started" else "agent_tool_result",
                session_id=self.turn_request.session_id,
                turn_id=self.turn_request.turn_id,
                run_id=self.turn_request.run_id,
                node_id=self.turn_request.node_id,
                payload={
                    "tool": "file_change" if item_type == "fileChange" else "apply_patch",
                    "item": summarize_provider_item(item),
                },
            )
            return
        if item_type in {"mcpToolCall", "mcp_tool_call", "toolCall"}:
            append_agent_event(
                self.turn_request.events_log_path,
                "agent_tool_use" if method == "item/started" else "agent_tool_result",
                session_id=self.turn_request.session_id,
                turn_id=self.turn_request.turn_id,
                run_id=self.turn_request.run_id,
                node_id=self.turn_request.node_id,
                payload={"tool": "mcp", "item": summarize_provider_item(item)},
            )
            return
        if item_type == "agentMessage" and method == "item/completed":
            text = agent_message_text(item)
            if text:
                self.agent_messages.append(text)
                append_agent_event(
                    self.turn_request.events_log_path,
                    "agent_message",
                    session_id=self.turn_request.session_id,
                    turn_id=self.turn_request.turn_id,
                    run_id=self.turn_request.run_id,
                    node_id=self.turn_request.node_id,
                    payload={"content": text},
                )
            return
        append_agent_event(
            self.turn_request.events_log_path,
            "agent_status",
            session_id=self.turn_request.session_id,
            turn_id=self.turn_request.turn_id,
            run_id=self.turn_request.run_id,
            node_id=self.turn_request.node_id,
            payload={
                "status": "provider_item",
                "method": method,
                "item": summarize_provider_item(item),
            },
        )

    def handle_legacy_codex_event(self, params: dict[str, Any]) -> None:
        event = params.get("event") if isinstance(params.get("event"), dict) else params
        event_type = str(event.get("type") or "")
        if event_type == "agent_message":
            text = str(event.get("message") or event.get("text") or "")
            if text:
                self.agent_messages.append(text)
                append_agent_event(
                    self.turn_request.events_log_path,
                    "agent_message",
                    session_id=self.turn_request.session_id,
                    turn_id=self.turn_request.turn_id,
                    run_id=self.turn_request.run_id,
                    node_id=self.turn_request.node_id,
                    payload={"content": text},
                )
        elif event_type in {"task_complete", "turn_completed"}:
            self.completed.set()


def build_codex_app_server_command(request: StreamingAgentTurnRequest) -> list[str]:
    executable = shutil.which(request.command or "codex") or request.command or "codex"
    return [executable, "app-server", "--listen", "stdio://"]


def prepare_codex_app_server_home(request: StreamingAgentTurnRequest) -> Path:
    codex_home = request.run_dir / "codex_home"
    codex_home.mkdir(parents=True, exist_ok=True)
    source_home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    for file_name in ("auth.json", "config.toml", "AGENTS.md"):
        source = source_home / file_name
        if source.exists() and source.is_file():
            shutil.copy2(source, codex_home / file_name)
    return codex_home


def extract_thread_id(result: Any) -> str | None:
    if isinstance(result, str):
        return result
    if not isinstance(result, dict):
        return None
    for key in ("threadId", "thread_id", "id", "sessionId", "session_id"):
        value = result.get(key)
        if isinstance(value, str) and value:
            return value
    thread = result.get("thread")
    if isinstance(thread, dict):
        return extract_thread_id(thread)
    return None


def latest_json_object(messages: list[str]) -> dict[str, Any] | None:
    for text in reversed(messages):
        payload = extract_json_object(text)
        if payload is not None:
            return payload
    return None


def extract_json_object(text: str) -> dict[str, Any] | None:
    stripped = text.strip()
    candidates = [stripped]
    if "```" in stripped:
        parts = stripped.split("```")
        for index in range(1, len(parts), 2):
            block = parts[index].strip()
            if block.lower().startswith("json"):
                block = block[4:].strip()
            candidates.append(block)
    decoder = json.JSONDecoder()
    for candidate in candidates:
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict):
            return payload
        for offset, char in enumerate(candidate):
            if char != "{":
                continue
            try:
                payload, _end = decoder.raw_decode(candidate[offset:])
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                return payload
    return None


async def wait_for_cancel_marker(path: Path) -> None:
    while True:
        if path.exists():
            return
        await asyncio.sleep(0.2)


def summarize_provider_item(item: dict[str, Any]) -> dict[str, Any]:
    return {key: summarize_value(value) for key, value in item.items()}


def summarize_value(value: Any) -> Any:
    if isinstance(value, str):
        if len(value) > 1000:
            return {
                "truncated": True,
                "preview": value[:1000],
                "char_count": len(value),
            }
        return value
    if isinstance(value, list):
        if len(value) > 20:
            return {
                "truncated": True,
                "item_count": len(value),
                "preview": [summarize_value(item) for item in value[:20]],
            }
        return [summarize_value(item) for item in value]
    if isinstance(value, dict):
        return {key: summarize_value(entry) for key, entry in value.items()}
    return value


def agent_message_text(item: dict[str, Any]) -> str:
    for key in ("text", "message", "content"):
        value = item.get(key)
        if isinstance(value, str):
            return value
    content = item.get("content")
    if isinstance(content, list):
        parts: list[str] = []
        for entry in content:
            if isinstance(entry, dict) and isinstance(entry.get("text"), str):
                parts.append(entry["text"])
        return "\n".join(parts)
    return ""


def string_from(payload: dict[str, Any], key: str) -> str | None:
    value = payload.get(key)
    return value if isinstance(value, str) and value else None


def failed_result(
    request: StreamingAgentTurnRequest,
    error: str,
    provider_session_id: str | None = None,
) -> StreamingAgentTurnResult:
    write_text_atomic(request.stderr_log_path, error + "\n")
    append_agent_event(
        request.events_log_path,
        "agent_turn_failed",
        session_id=request.session_id,
        turn_id=request.turn_id,
        run_id=request.run_id,
        node_id=request.node_id,
        payload={"error": error},
    )
    return StreamingAgentTurnResult(
        status="failed",
        summary="Codex app-server adapter failed",
        output_json_path=None,
        event_log_path=request.events_log_path,
        provider_event_log_path=request.provider_events_log_path,
        provider_session_id=provider_session_id,
        error=error,
    )


async def capture_stream_text(stream: asyncio.StreamReader, path: Path) -> bytes:
    chunks: list[bytes] = []
    while True:
        chunk = await stream.read(4096)
        if not chunk:
            break
        chunks.append(chunk)
        append_bytes(path, chunk)
    return b"".join(chunks)


def append_bytes(path: Path, payload: bytes) -> None:
    append_bytes_locked(path, payload)


async def terminate_process_tree(process: asyncio.subprocess.Process) -> None:
    pid = getattr(process, "pid", None)
    if os.name == "nt" and isinstance(pid, int):
        try:
            killer = await asyncio.create_subprocess_exec(
                "taskkill",
                "/PID",
                str(pid),
                "/T",
                "/F",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await asyncio.wait_for(killer.wait(), timeout=5)
            return
        except (OSError, TimeoutError):
            pass
    try:
        process.kill()
        await asyncio.wait_for(process.wait(), timeout=5)
    except (ProcessLookupError, TimeoutError):
        return


async def gather_cancelled(*tasks: asyncio.Task[Any]) -> None:
    for task in tasks:
        with contextlib.suppress(asyncio.CancelledError):
            await task
