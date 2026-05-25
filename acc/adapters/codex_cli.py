from __future__ import annotations

import asyncio
import json
import os
import shutil

from acc.adapters.base import AgentRunRequest, AgentRunResult


class CodexCliAdapter:
    async def run(self, request: AgentRunRequest) -> AgentRunResult:
        if request.sandbox == "danger-full-access" and not request.allow_dangerous:
            return failed(request, "danger-full-access requires allow_dangerous=true")

        command = build_codex_command(request)
        env = os.environ.copy()
        env.update(request.env)
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
                request.stdout_log_path.write_bytes(stdout)
                request.stderr_log_path.write_bytes(stderr)
            else:
                stdout, stderr = await asyncio.wait_for(
                    stream_process(process, prompt_bytes, request),
                    timeout=request.timeout_seconds,
                )
            write_jsonl(
                request.events_log_path,
                {
                    "type": "adapter_event",
                    "runtime": "codex_cli",
                    "stdout_bytes": len(stdout),
                    "stderr_bytes": len(stderr),
                    "exit_code": process.returncode,
                },
            )
        except TimeoutError:
            process.kill()
            await process.wait()
            append_bytes(request.stderr_log_path, b"Codex CLI timed out\n")
            write_jsonl(request.events_log_path, {"type": "timeout", "command": command})
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
                stderr.decode(errors="replace").strip() or "Codex CLI returned non-zero exit",
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


def build_codex_command(request: AgentRunRequest) -> list[str]:
    command = resolve_executable(request.command or "codex")
    args = request.args_base or ["exec"]
    if args[:1] != ["exec"]:
        args = ["exec", *args]
    return [
        command,
        *args,
        "--cd",
        str(request.workspace_dir),
        "--sandbox",
        request.sandbox,
        "--json",
        "--output-schema",
        str(request.output_schema_path),
        "-o",
        str(request.output_json_path),
        "-",
    ]


def resolve_executable(command: str) -> str:
    return shutil.which(command) or command


def failed(
    request: AgentRunRequest,
    error: str,
    exit_code: int | None = None,
) -> AgentRunResult:
    request.stderr_log_path.write_text(error + "\n", encoding="utf-8")
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


def write_jsonl(path, payload: dict) -> None:
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(payload, sort_keys=True) + "\n")


async def stream_process(
    process,
    prompt_bytes: bytes,
    request: AgentRunRequest,
) -> tuple[bytes, bytes]:
    process.stdin.write(prompt_bytes)
    await process.stdin.drain()
    process.stdin.close()

    stdout_task = asyncio.create_task(capture_stream(process.stdout, request.stdout_log_path))
    stderr_task = asyncio.create_task(capture_stream(process.stderr, request.stderr_log_path))
    await process.wait()
    stdout, stderr = await asyncio.gather(stdout_task, stderr_task)
    return stdout, stderr


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
    with path.open("ab") as file:
        file.write(payload)
