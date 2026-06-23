from __future__ import annotations

import asyncio
import os
from pathlib import Path

from acc.storage import append_bytes_locked


async def capture_stream_bytes(stream: asyncio.StreamReader, path: Path) -> bytes:
    chunks: list[bytes] = []
    while True:
        chunk = await stream.read(4096)
        if not chunk:
            break
        chunks.append(chunk)
        append_bytes(path, chunk)
    return b"".join(chunks)


def append_bytes(path: Path, payload: bytes) -> None:
    append_bytes_locked(path, payload)


async def terminate_process_tree(process: asyncio.subprocess.Process) -> None:
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
            try:
                await asyncio.wait_for(process.wait(), timeout=5)
            except TimeoutError:
                return
            return
        except (OSError, TimeoutError):
            pass
    try:
        process.kill()
        await asyncio.wait_for(process.wait(), timeout=5)
    except (ProcessLookupError, TimeoutError):
        return
