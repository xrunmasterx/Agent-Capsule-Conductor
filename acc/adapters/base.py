from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from acc.domain import AgentCapabilities


@dataclass(frozen=True)
class AgentRunRequest:
    callable_id: str
    run_dir: Path
    workspace_dir: Path
    prompt_path: Path
    input_payload: dict[str, Any]
    output_schema_path: Path
    timeout_seconds: int
    command: str | None
    args_base: list[str]
    env: dict[str, str] = field(default_factory=dict)
    sandbox: str = "read-only"
    allow_dangerous: bool = False
    bypass_approvals_and_sandbox: bool = False
    enable_search: bool = False
    session_id: str = "session_test"
    inbox_dir: Path | None = None
    outbox_dir: Path | None = None
    environment_id: str | None = None
    node_id: str | None = None
    resume_session_id: str | None = None
    requested_capabilities: tuple[str, ...] = ()
    run_id: str | None = None
    cancel_path: Path | None = None

    @property
    def stdout_log_path(self) -> Path:
        return self.run_dir / "stdout.log"

    @property
    def stderr_log_path(self) -> Path:
        return self.run_dir / "stderr.log"

    @property
    def events_log_path(self) -> Path:
        return self.run_dir / "events.jsonl"

    @property
    def output_json_path(self) -> Path:
        return self.run_dir / "output.json"

    @property
    def artifacts_dir(self) -> Path:
        return self.run_dir / "artifacts"


@dataclass(frozen=True)
class AgentRunResult:
    status: str
    summary: str
    output_json_path: Path | None
    event_log_path: Path
    artifacts_dir: Path
    exit_code: int | None = None
    error: str | None = None
    external_session_id: str | None = None
    capabilities_effective: tuple[str, ...] = ()
    requested_capabilities: tuple[str, ...] = ()
    capability_degraded: bool = False


@dataclass(frozen=True)
class ResumeRequest:
    callable_id: str
    run_dir: Path
    workspace_dir: Path
    external_session_id: str
    timeout_seconds: int
    env: dict[str, str] = field(default_factory=dict)


class AgentAdapter(Protocol):
    def capabilities(self) -> AgentCapabilities: ...

    async def run(self, request: AgentRunRequest) -> AgentRunResult: ...

    async def resume(self, request: ResumeRequest) -> AgentRunResult: ...


def build_shared_acc_env(request: AgentRunRequest) -> dict[str, str]:
    env = {"ACC_RUN_DIR": str(request.run_dir)}
    if request.inbox_dir is not None:
        env["ACC_INBOX_DIR"] = str(request.inbox_dir)
    if request.outbox_dir is not None:
        env["ACC_OUTBOX_DIR"] = str(request.outbox_dir)
    if request.environment_id is not None:
        env["ACC_ENVIRONMENT_ID"] = request.environment_id
    if request.node_id is not None:
        env["ACC_NODE_ID"] = request.node_id
    if request.run_id is not None:
        env["ACC_RUN_ID"] = request.run_id
    return env


def write_jsonl(path: Path, payload: dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(payload, sort_keys=True) + "\n")
