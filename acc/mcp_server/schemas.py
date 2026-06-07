from __future__ import annotations

from typing import Any, Literal, TypedDict

McpStatus = Literal["valid", "invalid", "dry_run", "submitted", "rejected", "requires_approval"]


class McpToolResult(TypedDict, total=False):
    status: McpStatus
    summary: str
    errors: list[dict[str, Any]]
    warnings: list[dict[str, Any]]
    proposal_id: str | None
    run_id: str | None
    links: list[dict[str, str]]
    data: dict[str, Any]


def tool_result(
    *,
    status: McpStatus,
    summary: str,
    errors: list[dict[str, Any]] | None = None,
    warnings: list[dict[str, Any]] | None = None,
    proposal_id: str | None = None,
    run_id: str | None = None,
    links: list[dict[str, str]] | None = None,
    data: dict[str, Any] | None = None,
) -> McpToolResult:
    return {
        "status": status,
        "summary": summary,
        "errors": errors or [],
        "warnings": warnings or [],
        "proposal_id": proposal_id,
        "run_id": run_id,
        "links": links or [],
        "data": data or {},
    }
