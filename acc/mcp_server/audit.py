from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

from acc.session import utc_now_iso
from acc.store import write_json

MCP_TOOL_CALL_ROOT = Path("runs") / "_mcp_tool_calls"


def new_request_id() -> str:
    return f"mcp_{uuid4().hex[:12]}"


def write_mcp_audit(
    project_root: Path,
    *,
    request_id: str,
    tool_name: str,
    status: str,
    client_id: str | None = None,
    proposal_id: str | None = None,
    session_id: str | None = None,
    run_id: str | None = None,
    task_id: str | None = None,
    target_paths: list[str] | None = None,
    errors: list[dict[str, Any]] | None = None,
) -> None:
    root = project_root.resolve() / MCP_TOOL_CALL_ROOT
    root.mkdir(parents=True, exist_ok=True)
    write_json(
        root / f"{request_id}.json",
        {
            "schema_version": "acc.mcp.tool_call.v1",
            "request_id": request_id,
            "tool_name": tool_name,
            "client_id": client_id,
            "status": status,
            "proposal_id": proposal_id,
            "session_id": session_id,
            "run_id": run_id,
            "task_id": task_id,
            "target_paths": target_paths or [],
            "errors": errors or [],
            "timestamp": utc_now_iso(),
        },
    )
