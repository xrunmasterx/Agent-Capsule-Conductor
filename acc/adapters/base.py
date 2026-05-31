from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from acc.domain import AgentCapabilities


@dataclass(frozen=True)
class AgentRunRequest:
    capsule_id: str
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
    session_id: str = "session_test"
    inbox_dir: Path | None = None
    outbox_dir: Path | None = None
    environment_id: str | None = None
    node_id: str | None = None
    resume_session_id: str | None = None
    requested_capabilities: tuple[str, ...] = ()

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
    capsule_id: str
    run_dir: Path
    workspace_dir: Path
    external_session_id: str
    timeout_seconds: int
    env: dict[str, str] = field(default_factory=dict)


class AgentAdapter(Protocol):
    def capabilities(self) -> AgentCapabilities: ...

    async def run(self, request: AgentRunRequest) -> AgentRunResult: ...

    async def resume(self, request: ResumeRequest) -> AgentRunResult: ...
