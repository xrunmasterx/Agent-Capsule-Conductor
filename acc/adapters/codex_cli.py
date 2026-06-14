from __future__ import annotations

import asyncio
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
from acc.models import AccError, AgentCapabilities
from acc.storage import append_bytes_locked, write_bytes_atomic, write_text_atomic


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
        env = os.environ.copy()
        env.update(request.env)
        if "CODEX_HOME" not in request.env:
            env["CODEX_HOME"] = str(prepare_isolated_codex_home(request))
        env.update(build_shared_acc_env(request))
        prompt_bytes = request.prompt_path.read_bytes()

        try:
            process = await asyncio.create_subprocess_exec(
                *command,
                cwd=request.workspace_dir,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            if (
                getattr(process, "stdin", None) is None
                or getattr(process, "stdout", None) is None
                or getattr(process, "stderr", None) is None
            ):
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(input=prompt_bytes),
                    timeout=request.timeout_seconds,
                )
                write_bytes_atomic(request.stdout_log_path, stdout)
                write_bytes_atomic(request.stderr_log_path, stderr)
            else:
                stdout, stderr, cancelled = await asyncio.wait_for(
                    stream_process(process, prompt_bytes, request),
                    timeout=request.timeout_seconds,
                )
                if cancelled:
                    write_jsonl(
                        request.events_log_path,
                        {
                            "type": "adapter_event",
                            "runtime": "codex_cli",
                            "command": redact_command(command),
                            "exit_code": process.returncode,
                            "cancelled": True,
                        },
                    )
                    return AgentRunResult(
                        status="cancelled",
                        summary="Codex CLI cancelled",
                        output_json_path=None,
                        event_log_path=request.events_log_path,
                        artifacts_dir=request.artifacts_dir,
                        exit_code=process.returncode,
                        error="cancelled",
                    )
            write_jsonl(
                request.events_log_path,
                {
                    "type": "adapter_event",
                    "runtime": "codex_cli",
                    "command": redact_command(command),
                    "stdout_bytes": len(stdout),
                    "stderr_bytes": len(stderr),
                    "exit_code": process.returncode,
                },
            )
        except FileNotFoundError:
            return failed(request, "codex executable not found", None)
        except TimeoutError:
            await terminate_process_tree(process)
            timeout_message = b"Codex CLI timed out\n"
            append_bytes(request.stderr_log_path, timeout_message)
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
                    exit_code=process.returncode,
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

        if process.returncode != 0:
            return failed(
                request,
                codex_failure_message(stdout, stderr),
                process.returncode,
            )
        if not request.output_json_path.exists():
            return failed(request, "Codex CLI did not produce output.json", process.returncode)

        return AgentRunResult(
            status="success",
            summary="Codex CLI completed",
            output_json_path=request.output_json_path,
            event_log_path=request.events_log_path,
            artifacts_dir=request.artifacts_dir,
            exit_code=process.returncode,
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


async def stream_process(
    process,
    prompt_bytes: bytes,
    request: AgentRunRequest,
) -> tuple[bytes, bytes, bool]:
    process.stdin.write(prompt_bytes)
    await process.stdin.drain()
    process.stdin.close()

    stdout_task = asyncio.create_task(capture_stream(process.stdout, request.stdout_log_path))
    stderr_task = asyncio.create_task(capture_stream(process.stderr, request.stderr_log_path))
    cancelled = False
    while True:
        if request.cancel_path is not None and request.cancel_path.exists():
            cancelled = True
            append_bytes(request.stderr_log_path, b"Codex CLI cancellation requested\n")
            await terminate_process_tree(process)
            break
        try:
            await asyncio.wait_for(process.wait(), timeout=0.25)
            break
        except TimeoutError:
            continue
    stdout, stderr = await asyncio.gather(stdout_task, stderr_task)
    return stdout, stderr, cancelled


async def capture_stream(stream, primary_path) -> bytes:
    chunks: list[bytes] = []
    while True:
        chunk = await stream.read(4096)
        if not chunk:
            break
        chunks.append(chunk)
        append_bytes(primary_path, chunk)
    return b"".join(chunks)


def append_bytes(path, payload: bytes) -> None:
    append_bytes_locked(path, payload)


async def terminate_process_tree(process) -> None:
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
        except (OSError, TimeoutError):
            process.kill()
    else:
        process.kill()
    try:
        await asyncio.wait_for(process.wait(), timeout=5)
    except TimeoutError:
        return
