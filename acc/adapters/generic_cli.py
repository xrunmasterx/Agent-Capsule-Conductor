from __future__ import annotations

import asyncio
import json
import os
import sys

from acc.adapters.base import AgentRunRequest, AgentRunResult


class GenericCliAdapter:
    async def run(self, request: AgentRunRequest) -> AgentRunResult:
        if not request.command:
            return self._failed(request, "generic_cli runtime has no command")

        command = [resolve_command(request.command), *request.args_base]
        env = os.environ.copy()
        env.update(request.env)
        env.update(
            {
                "ACC_INPUT_PATH": str(request.run_dir / "input.json"),
                "ACC_RUN_DIR": str(request.run_dir),
                "ACC_OUTPUT_JSON": str(request.output_json_path),
                "ACC_OUTPUT_SCHEMA_PATH": str(request.output_schema_path),
                "ACC_ARTIFACT_DIR": str(request.artifacts_dir),
                "ACC_PROMPT_PATH": str(request.prompt_path),
                "ACC_EVENTS_JSONL": str(request.events_log_path),
            }
        )

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
            request.stderr_log_path.write_text("Adapter timed out\n", encoding="utf-8")
            write_event(request, {"event": "timeout", "command": command})
            return AgentRunResult(
                status="timeout",
                summary="Generic CLI adapter timed out",
                output_json_path=None,
                event_log_path=request.events_log_path,
                artifacts_dir=request.artifacts_dir,
                exit_code=None,
                error="timeout",
            )

        request.stdout_log_path.write_bytes(stdout)
        request.stderr_log_path.write_bytes(stderr)
        write_event(
            request,
            {"event": "process_exit", "command": command, "exit_code": process.returncode},
        )

        if process.returncode != 0:
            return AgentRunResult(
                status="failed",
                summary="Generic CLI adapter failed",
                output_json_path=None,
                event_log_path=request.events_log_path,
                artifacts_dir=request.artifacts_dir,
                exit_code=process.returncode,
                error=stderr.decode(errors="replace").strip() or "non-zero exit",
            )

        if not request.output_json_path.exists():
            maybe_write_json_stdout(stdout, request.output_json_path)

        if not request.output_json_path.exists():
            return self._failed(request, "Adapter did not produce output.json", process.returncode)

        return AgentRunResult(
            status="success",
            summary="Generic CLI adapter completed",
            output_json_path=request.output_json_path,
            event_log_path=request.events_log_path,
            artifacts_dir=request.artifacts_dir,
            exit_code=process.returncode,
        )

    @staticmethod
    def _failed(
        request: AgentRunRequest,
        error: str,
        exit_code: int | None = None,
    ) -> AgentRunResult:
        request.stderr_log_path.write_text(error + "\n", encoding="utf-8")
        write_event(request, {"event": "failed", "error": error})
        return AgentRunResult(
            status="failed",
            summary="Generic CLI adapter failed",
            output_json_path=None,
            event_log_path=request.events_log_path,
            artifacts_dir=request.artifacts_dir,
            exit_code=exit_code,
            error=error,
        )


def resolve_command(command: str) -> str:
    if command == "python":
        return sys.executable
    return command


def maybe_write_json_stdout(stdout: bytes, output_path) -> None:
    try:
        payload = json.loads(stdout.decode(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return
    if isinstance(payload, dict):
        output_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def write_event(request: AgentRunRequest, payload: dict) -> None:
    with request.events_log_path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(payload, sort_keys=True) + "\n")
