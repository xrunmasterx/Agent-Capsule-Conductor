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
            stdout, stderr = await asyncio.wait_for(
                process.communicate(input=prompt_bytes),
                timeout=request.timeout_seconds,
            )
        except TimeoutError:
            process.kill()
            await process.wait()
            request.stderr_log_path.write_text("Codex CLI timed out\n", encoding="utf-8")
            write_jsonl(request.events_log_path, {"event": "timeout", "command": command})
            return AgentRunResult(
                status="timeout",
                summary="Codex CLI timed out",
                output_json_path=None,
                event_log_path=request.events_log_path,
                artifacts_dir=request.artifacts_dir,
                error="timeout",
            )

        request.events_log_path.write_bytes(stdout)
        request.stderr_log_path.write_bytes(stderr)
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
    write_jsonl(request.events_log_path, {"event": "failed", "error": error})
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
