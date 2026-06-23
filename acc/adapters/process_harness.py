from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from pathlib import Path

from acc.adapters.process_utils import append_bytes, capture_stream_bytes, terminate_process_tree
from acc.storage import write_bytes_atomic


@dataclass(frozen=True)
class AdapterProcessOutcome:
    stdout: bytes
    stderr: bytes
    returncode: int | None
    timed_out: bool = False
    cancelled: bool = False


@dataclass(frozen=True)
class AdapterProcessSpec:
    command: list[str]
    cwd: Path
    stdin: bytes
    env: dict[str, str] = field(default_factory=dict)
    timeout_seconds: float = 60
    stdout_log_path: Path | None = None
    stderr_log_path: Path | None = None
    cancel_path: Path | None = None
    stream_output: bool = False


class AdapterProcessHarness:
    """Shared one-shot subprocess lifecycle for CLI adapters."""

    async def run(self, spec: AdapterProcessSpec) -> AdapterProcessOutcome:
        env = os.environ.copy()
        env.update(spec.env)
        process = await asyncio.create_subprocess_exec(
            *spec.command,
            cwd=spec.cwd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        try:
            if spec.stream_output and pipes_available(process):
                stdout, stderr, cancelled = await asyncio.wait_for(
                    stream_process(process, spec),
                    timeout=spec.timeout_seconds,
                )
                return AdapterProcessOutcome(
                    stdout=stdout,
                    stderr=stderr,
                    returncode=process.returncode,
                    cancelled=cancelled,
                )
            stdout, stderr = await asyncio.wait_for(
                process.communicate(input=spec.stdin),
                timeout=spec.timeout_seconds,
            )
            write_logs(spec, stdout, stderr)
            return AdapterProcessOutcome(
                stdout=stdout,
                stderr=stderr,
                returncode=process.returncode,
            )
        except TimeoutError:
            await terminate_process_tree(process)
            return AdapterProcessOutcome(
                stdout=read_existing_bytes(spec.stdout_log_path),
                stderr=read_existing_bytes(spec.stderr_log_path),
                returncode=process.returncode,
                timed_out=True,
            )


def pipes_available(process: asyncio.subprocess.Process) -> bool:
    return (
        getattr(process, "stdin", None) is not None
        and getattr(process, "stdout", None) is not None
        and getattr(process, "stderr", None) is not None
    )


async def stream_process(
    process: asyncio.subprocess.Process,
    spec: AdapterProcessSpec,
) -> tuple[bytes, bytes, bool]:
    assert process.stdin is not None
    assert process.stdout is not None
    assert process.stderr is not None
    process.stdin.write(spec.stdin)
    await process.stdin.drain()
    process.stdin.close()

    stdout_task = asyncio.create_task(
        capture_stream_bytes(process.stdout, require_log_path(spec.stdout_log_path, "stdout"))
    )
    stderr_task = asyncio.create_task(
        capture_stream_bytes(process.stderr, require_log_path(spec.stderr_log_path, "stderr"))
    )
    cancelled = False
    while True:
        if spec.cancel_path is not None and spec.cancel_path.exists():
            cancelled = True
            append_bytes(
                require_log_path(spec.stderr_log_path, "stderr"),
                b"Adapter cancellation requested\n",
            )
            await terminate_process_tree(process)
            break
        try:
            await asyncio.wait_for(process.wait(), timeout=0.25)
            break
        except TimeoutError:
            continue
    stdout, stderr = await asyncio.gather(stdout_task, stderr_task)
    return stdout, stderr, cancelled


def require_log_path(path: Path | None, label: str) -> Path:
    if path is None:
        raise ValueError(f"{label} log path is required for streaming process capture")
    return path


def write_logs(spec: AdapterProcessSpec, stdout: bytes, stderr: bytes) -> None:
    if spec.stdout_log_path is not None:
        write_bytes_atomic(spec.stdout_log_path, stdout)
    if spec.stderr_log_path is not None:
        write_bytes_atomic(spec.stderr_log_path, stderr)


def read_existing_bytes(path: Path | None) -> bytes:
    if path is None or not path.exists():
        return b""
    return path.read_bytes()
