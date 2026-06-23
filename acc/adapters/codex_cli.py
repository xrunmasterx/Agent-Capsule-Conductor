from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any

from acc.adapters.base import (
    AgentRunRequest,
    AgentRunResult,
    ResumeRequest,
    build_shared_acc_env,
    write_jsonl,
)
from acc.adapters.capabilities import default_adapter_capabilities
from acc.adapters.process_harness import AdapterProcessHarness, AdapterProcessSpec
from acc.adapters.process_utils import append_bytes
from acc.models import AccError, AgentCapabilities
from acc.storage import write_text_atomic


class CodexCliAdapter:
    def capabilities(self) -> AgentCapabilities:
        return default_adapter_capabilities("codex_cli")

    async def run(self, request: AgentRunRequest) -> AgentRunResult:
        if (
            (request.sandbox == "danger-full-access" or request.bypass_approvals_and_sandbox)
            and not request.allow_dangerous
        ):
            return failed(request, "danger-full-access requires allow_dangerous=true")

        command = build_codex_command(request)
        env = dict(request.env)
        if "CODEX_HOME" not in request.env:
            env["CODEX_HOME"] = str(prepare_isolated_codex_home(request))
        env.update(build_shared_acc_env(request))

        try:
            outcome = await AdapterProcessHarness().run(
                AdapterProcessSpec(
                    command=command,
                    cwd=request.workspace_dir,
                    stdin=request.prompt_path.read_bytes(),
                    env=env,
                    timeout_seconds=request.timeout_seconds,
                    stdout_log_path=request.stdout_log_path,
                    stderr_log_path=request.stderr_log_path,
                    cancel_path=request.cancel_path,
                    stream_output=True,
                )
            )
        except FileNotFoundError:
            return failed(request, "codex executable not found", None)

        if outcome.cancelled:
            write_jsonl(
                request.events_log_path,
                {
                    "type": "adapter_event",
                    "runtime": "codex_cli",
                    "command": redact_command(command),
                    "exit_code": outcome.returncode,
                    "cancelled": True,
                },
            )
            return AgentRunResult(
                status="cancelled",
                summary="Codex CLI cancelled",
                output_json_path=None,
                event_log_path=request.events_log_path,
                artifacts_dir=request.artifacts_dir,
                exit_code=outcome.returncode,
                error="cancelled",
            )

        if outcome.timed_out:
            append_bytes(request.stderr_log_path, b"Codex CLI timed out\n")
            timeout_event = {"type": "timeout", "command": command}
            salvage_summary = timeout_salvage_output(request)
            if salvage_summary is not None:
                timeout_event.update(salvage_summary)
                write_jsonl(request.events_log_path, timeout_event)
                return AgentRunResult(
                    status="success",
                    summary=salvage_summary["summary"],
                    output_json_path=request.output_json_path,
                    event_log_path=request.events_log_path,
                    artifacts_dir=request.artifacts_dir,
                    exit_code=outcome.returncode,
                )
            write_jsonl(request.events_log_path, timeout_event)
            return AgentRunResult(
                status="timeout",
                summary="Codex CLI timed out",
                output_json_path=None,
                event_log_path=request.events_log_path,
                artifacts_dir=request.artifacts_dir,
                error="timeout",
            )

        write_jsonl(
            request.events_log_path,
            {
                "type": "adapter_event",
                "runtime": "codex_cli",
                "command": redact_command(command),
                "stdout_bytes": len(outcome.stdout),
                "stderr_bytes": len(outcome.stderr),
                "exit_code": outcome.returncode,
            },
        )

        if outcome.returncode != 0:
            return failed(
                request,
                codex_failure_message(outcome.stdout, outcome.stderr),
                outcome.returncode,
            )
        if not request.output_json_path.exists():
            return failed(request, "Codex CLI did not produce output.json", outcome.returncode)

        return AgentRunResult(
            status="success",
            summary="Codex CLI completed",
            output_json_path=request.output_json_path,
            event_log_path=request.events_log_path,
            artifacts_dir=request.artifacts_dir,
            exit_code=outcome.returncode,
        )

    async def resume(self, request: ResumeRequest) -> AgentRunResult:
        raise AccError(
            f"codex_cli resume is not implemented for session {request.external_session_id!r}"
        )


def build_codex_command(request: AgentRunRequest) -> list[str]:
    command = resolve_executable(request.command or "codex")
    args = request.args_base or ["exec"]
    if args[:1] != ["exec"]:
        args = ["exec", *args]
    workspace_dir = request.workspace_dir.resolve()
    output_schema_path = request.output_schema_path.resolve()
    output_json_path = request.output_json_path.resolve()
    command_args = [command]
    if request.enable_search:
        command_args.append("--search")
    command_args.extend(
        [
            *args,
            "--cd",
            str(workspace_dir),
        ]
    )
    if request.bypass_approvals_and_sandbox:
        command_args.append("--dangerously-bypass-approvals-and-sandbox")
    else:
        command_args.extend(["--sandbox", request.sandbox])
    command_args.extend(
        [
            "--json",
            "--output-schema",
            str(output_schema_path),
            "-o",
            str(output_json_path),
            "-",
        ]
    )
    return command_args


def redact_command(command: list[str]) -> list[str]:
    return list(command)


def codex_failure_message(stdout: bytes, stderr: bytes) -> str:
    stdout_text = stdout.decode(errors="replace")
    for line in reversed(stdout_text.splitlines()):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        if event.get("type") == "error" and isinstance(event.get("message"), str):
            return event["message"].strip()
        error = event.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"].strip()
    stderr_text = stderr.decode(errors="replace").strip()
    return stderr_text or "Codex CLI returned non-zero exit"


def resolve_executable(command: str) -> str:
    return shutil.which(command) or command


def prepare_isolated_codex_home(request: AgentRunRequest) -> Path:
    codex_home = request.run_dir / "codex_home"
    codex_home.mkdir(parents=True, exist_ok=True)
    source_home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    if is_authoring_run(request):
        auth_source = source_home / "auth.json"
        if auth_source.exists() and auth_source.is_file():
            shutil.copy2(auth_source, codex_home / "auth.json")
        write_authoring_codex_config(source_home / "config.toml", codex_home / "config.toml")
        return codex_home
    for file_name in ("auth.json", "config.toml", "AGENTS.md"):
        source = source_home / file_name
        if source.exists() and source.is_file():
            shutil.copy2(source, codex_home / file_name)
    return codex_home


AUTHORING_CONFIG_KEYS = frozenset(
    {
        "model",
        "model_reasoning_effort",
        "model_verbosity",
        "service_tier",
    }
)


def is_authoring_run(request: AgentRunRequest) -> bool:
    return (
        request.input_payload.get("schema_version") == "acc.authoring.request.v1"
        or request.node_id == "authoring_request"
    )


def write_authoring_codex_config(source_config: Path, target_config: Path) -> None:
    lines = ["# Generated by ACC for isolated authoring runs."]
    if source_config.exists() and source_config.is_file():
        for line in source_config.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if stripped.startswith("["):
                break
            key = stripped.split("=", 1)[0].strip()
            if key in AUTHORING_CONFIG_KEYS and "=" in stripped:
                lines.append(stripped)
    write_text_atomic(target_config, "\n".join(lines) + "\n")


def timeout_salvage_output(request: AgentRunRequest) -> dict[str, Any] | None:
    if request.output_json_path.exists():
        return {
            "output_json_path": str(request.output_json_path),
            "output_salvaged": True,
            "summary": "Codex CLI timed out after producing output.json",
        }
    payload = latest_agent_message_json_from_stdout(request.stdout_log_path)
    if payload is None:
        return None
    write_text_atomic(
        request.output_json_path,
        json.dumps(payload, ensure_ascii=False, sort_keys=True),
    )
    return {
        "output_json_path": str(request.output_json_path),
        "output_salvaged": True,
        "stdout_output_salvaged": True,
        "summary": "Codex CLI timed out after producing structured stdout output",
    }


def latest_agent_message_json_from_stdout(stdout_path: Path) -> dict[str, Any] | None:
    if not stdout_path.exists():
        return None
    latest: dict[str, Any] | None = None
    for line in stdout_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict) or event.get("type") != "item.completed":
            continue
        item = event.get("item")
        if not isinstance(item, dict) or item.get("type") != "agent_message":
            continue
        text = item.get("text")
        if not isinstance(text, str):
            continue
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            latest = payload
    return latest


def failed(
    request: AgentRunRequest,
    error: str,
    exit_code: int | None = None,
) -> AgentRunResult:
    write_text_atomic(request.stderr_log_path, error + "\n")
    write_jsonl(request.events_log_path, {"type": "failed", "error": error})
    return AgentRunResult(
        status="failed",
        summary="Codex CLI adapter failed",
        output_json_path=None,
        event_log_path=request.events_log_path,
        artifacts_dir=request.artifacts_dir,
        exit_code=exit_code,
        error=error,
    )
