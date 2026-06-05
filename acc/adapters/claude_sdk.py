from __future__ import annotations

import importlib.util
import json
from collections.abc import AsyncIterable, Callable
from typing import Any

from acc.adapters.base import AgentRunRequest, AgentRunResult, ResumeRequest, write_jsonl
from acc.adapters.capabilities import default_adapter_capabilities
from acc.domain import AccError, AgentCapabilities

MessageStreamFactory = Callable[[AgentRunRequest], AsyncIterable[dict[str, Any]]]


class ClaudeSdkAdapter:
    def __init__(self, message_stream_factory: MessageStreamFactory | None = None) -> None:
        self.message_stream_factory = message_stream_factory

    def capabilities(self) -> AgentCapabilities:
        return default_adapter_capabilities("claude_sdk")

    async def run(self, request: AgentRunRequest) -> AgentRunResult:
        if self.message_stream_factory is None:
            if importlib.util.find_spec("claude_agent_sdk") is None:
                error = "claude-agent-sdk is unavailable"
                request.stderr_log_path.write_text(error + "\n", encoding="utf-8")
                write_jsonl(request.events_log_path, {"event": "unavailable", "error": error})
                return AgentRunResult(
                    status="unavailable",
                    summary="Claude SDK adapter unavailable",
                    output_json_path=None,
                    event_log_path=request.events_log_path,
                    artifacts_dir=request.artifacts_dir,
                    error=error,
                )
            error = "Claude SDK execution is not implemented in MVP"
            request.stderr_log_path.write_text(error + "\n", encoding="utf-8")
            write_jsonl(request.events_log_path, {"event": "unavailable", "error": error})
            return AgentRunResult(
                status="unavailable",
                summary="Claude SDK adapter unavailable",
                output_json_path=None,
                event_log_path=request.events_log_path,
                artifacts_dir=request.artifacts_dir,
                error=error,
            )

        output_payload: dict[str, Any] | None = None
        async for message in self.message_stream_factory(request):
            write_jsonl(request.events_log_path, message)
            if isinstance(message.get("output"), dict):
                output_payload = message["output"]

        if output_payload is not None:
            request.output_json_path.write_text(
                json.dumps(output_payload, indent=2, sort_keys=True),
                encoding="utf-8",
            )

        if not request.output_json_path.exists():
            return AgentRunResult(
                status="failed",
                summary="Claude SDK adapter failed",
                output_json_path=None,
                event_log_path=request.events_log_path,
                artifacts_dir=request.artifacts_dir,
                error="fake SDK stream did not produce output",
            )

        return AgentRunResult(
            status="success",
            summary="Claude SDK adapter completed",
            output_json_path=request.output_json_path,
            event_log_path=request.events_log_path,
            artifacts_dir=request.artifacts_dir,
            exit_code=0,
        )

    async def resume(self, request: ResumeRequest) -> AgentRunResult:
        raise AccError("claude_sdk adapter does not support resume")
