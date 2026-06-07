from __future__ import annotations

from pathlib import Path

from mcp.server.fastmcp import FastMCP

from acc.mcp_server.tools import AccMcpTools


def create_mcp_server(project_root: Path | str | None = None) -> FastMCP:
    tools = AccMcpTools(Path(project_root or Path.cwd()).resolve())
    mcp = FastMCP("Agent Callable Conductor", json_response=True)

    mcp.tool()(tools.acc_list_callables)
    mcp.tool()(tools.acc_show_callable)
    mcp.tool()(tools.acc_list_workflows)
    mcp.tool()(tools.acc_show_workflow)
    mcp.tool()(tools.acc_get_canvas_snapshot)
    mcp.tool()(tools.acc_get_run_summary)
    mcp.tool()(tools.acc_get_run_events)
    mcp.tool()(tools.acc_read_artifact)
    mcp.tool()(tools.acc_create_authoring_session)
    mcp.tool()(tools.acc_send_authoring_message)
    mcp.tool()(tools.acc_validate_canvas_proposal)
    mcp.tool()(tools.acc_dry_run_canvas_proposal)
    mcp.tool()(tools.acc_create_graphops_proposal)
    mcp.tool()(tools.acc_validate_graphops_proposal)
    mcp.tool()(tools.acc_dry_run_graphops_proposal)
    mcp.tool()(tools.acc_list_temporary_resources)
    mcp.tool()(tools.acc_promote_temporary_resource_dry_run)
    return mcp


def run_stdio_server(project_root: Path | str | None = None) -> None:
    create_mcp_server(project_root).run(transport="stdio")
