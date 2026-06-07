from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol

AgentTurnResponseMode = Literal[
    "structured_required",
    "chat_optional_output",
    "authoring_optional_proposal",
]


@dataclass(frozen=True)
class AgentApprovalDecision:
    approved: bool
    response: dict[str, Any] = field(default_factory=dict)
    reason: str | None = None
    interaction_id: str | None = None


class AgentApprovalBridge(Protocol):
    async def request_approval(
        self,
        *,
        run_id: str | None,
        node_id: str | None,
        session_id: str,
        turn_id: str,
        provider_method: str,
        provider_params: dict[str, Any],
        timeout_seconds: int,
    ) -> AgentApprovalDecision: ...


@dataclass(frozen=True)
class StreamingAgentTurnRequest:
    callable_id: str
    runtime: str
    run_dir: Path
    workspace_dir: Path
    prompt_path: Path
    input_payload: dict[str, Any]
    output_schema_path: Path
    output_json_path: Path
    events_log_path: Path
    provider_events_log_path: Path
    stdout_log_path: Path
    stderr_log_path: Path
    timeout_seconds: int
    command: str | None
    env: dict[str, str] = field(default_factory=dict)
    session_id: str = ""
    turn_id: str = ""
    run_id: str | None = None
    node_id: str | None = None
    provider_session_id: str | None = None
    cancel_path: Path | None = None
    model: str | None = None
    reasoning_effort: str | None = None
    response_mode: AgentTurnResponseMode = "structured_required"
    approval_bridge: AgentApprovalBridge | None = None


@dataclass(frozen=True)
class StreamingAgentTurnResult:
    status: str
    summary: str
    output_json_path: Path | None
    event_log_path: Path
    provider_event_log_path: Path
    provider_session_id: str | None = None
    usage: dict[str, Any] | None = None
    assistant_messages: tuple[str, ...] = ()
    exit_code: int | None = None
    error: str | None = None


class StreamingAgentAdapter(Protocol):
    async def run_turn(self, request: StreamingAgentTurnRequest) -> StreamingAgentTurnResult: ...
