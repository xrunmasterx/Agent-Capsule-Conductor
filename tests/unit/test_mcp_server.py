from __future__ import annotations

import json
from pathlib import Path

import yaml

from acc.app.workbench_snapshots import WorkbenchCanvasSnapshotService
from acc.mcp_server.server import create_mcp_server
from acc.mcp_server.tools import AccMcpTools


def test_mcp_read_tools_and_artifact_secret_rejection(tmp_path: Path) -> None:
    create_callable(tmp_path)
    create_workflow(tmp_path)
    create_run(tmp_path)
    tools = AccMcpTools(tmp_path)

    callables = tools.acc_list_callables()
    workflow = tools.acc_show_workflow("demo")
    artifact = tools.acc_read_artifact("runs/server_run/artifacts/report.md")
    secret = tools.acc_read_artifact("runs/server_run/artifacts/secret-token.txt")

    assert callables["status"] == "valid"
    assert callables["data"]["callables"][0]["id"] == "echo-test.generic"
    assert workflow["status"] == "valid"
    assert workflow["data"]["workflow_id"] == "demo"
    assert artifact["status"] == "valid"
    assert secret["status"] == "invalid"
    assert "Secret-like" in secret["summary"]


def test_mcp_canvas_snapshot_missing_stale_and_validation(tmp_path: Path) -> None:
    create_callable(tmp_path)
    tools = AccMcpTools(tmp_path)

    missing = tools.acc_get_canvas_snapshot("task_canvas")
    assert missing["status"] == "invalid"

    WorkbenchCanvasSnapshotService(tmp_path).publish(canvas_snapshot_payload())
    stale = tools.acc_validate_canvas_proposal(
        proposal={
            "proposal_id": "canvas_proposal_1",
            "base_task_id": "task_canvas",
            "base_canvas_hash": "canvas_hash_v1:old",
            "target": {"kind": "task_canvas", "task_id": "task_canvas"},
            "rationale": "stale",
            "operations": [],
        },
        task_id="task_canvas",
        canvas_hash="canvas_hash_v1:old",
    )
    assert stale["status"] == "invalid"
    assert stale["errors"][0]["code"] == "AccError"

    valid = tools.acc_validate_canvas_proposal(
        proposal={
            "proposal_id": "canvas_proposal_2",
            "base_task_id": "task_canvas",
            "base_canvas_hash": "canvas_hash_v1:abc",
            "target": {"kind": "task_canvas", "task_id": "task_canvas"},
            "rationale": "add node",
            "operations": [
                {
                    "op": "add_existing_callable_node",
                    "scope_workflow_id": None,
                    "node_id": "echo",
                    "callable_id": "echo-test.generic",
                    "callable_kind": "agent_class",
                }
            ],
        },
        task_id="task_canvas",
    )
    assert valid["status"] == "valid"


def test_mcp_graphops_create_validate_dry_run_and_decision_requester(tmp_path: Path) -> None:
    create_callable(tmp_path)
    tools = AccMcpTools(tmp_path)
    proposal = graphops_transaction("graphops_tx_mcp")
    proposal.pop("source")

    created = tools.acc_create_graphops_proposal(proposal)
    validation = tools.acc_validate_graphops_proposal("graphops_tx_mcp")
    dry_run = tools.acc_dry_run_graphops_proposal("graphops_tx_mcp")

    assert created["status"] == "valid"
    assert validation["status"] == "valid"
    assert dry_run["status"] == "dry_run"
    saved = json.loads(
        (
            tmp_path
            / "runs"
            / "_graphops_proposals"
            / "graphops_tx_mcp"
            / "proposal.json"
        ).read_text(encoding="utf-8")
    )
    assert saved["proposal"]["source"]["kind"] == "mcp_tool"
    assert not (tmp_path / "callables" / "agents" / "mcp-reviewer.codex.yaml").exists()


def test_mcp_temporary_resource_promotion_uses_graphops_without_clearing_snapshot(
    tmp_path: Path,
) -> None:
    WorkbenchCanvasSnapshotService(tmp_path).publish(
        {
            **canvas_snapshot_payload(),
            "temporary_resources": {
                "tmp_agent_test": {
                    "draft_id": "tmp_agent_test",
                    "kind": "agent_template",
                    "status": "draft",
                    "agent_draft": {
                        "id": "tmp_agent_test",
                        "runtime": "codex_cli",
                        "default_prompt": "Draft reporter",
                        "input_ports": {"main": {"type": "artifact", "required": False}},
                        "output_ports": {"main": {"type": "artifact", "required": True}},
                    },
                    "referenced_by": ["tmp_agent_test"],
                }
            },
        }
    )
    tools = AccMcpTools(tmp_path)

    result = tools.acc_promote_temporary_resource_dry_run(
        "task_canvas",
        "tmp_agent_test",
        "mcp-reporter.codex",
    )

    assert result["status"] == "dry_run"
    assert result["proposal_id"]
    proposal = result["data"]["proposal"]
    assert proposal["targets"][0]["target_path"] == "callables/agents/mcp-reporter.codex.yaml"
    assert proposal["targets"][0]["template"]["id"] == "mcp-reporter.codex"
    assert not (tmp_path / "callables" / "agents" / "mcp-reporter.codex.yaml").exists()
    snapshot = WorkbenchCanvasSnapshotService(tmp_path).get("task_canvas")
    assert "tmp_agent_test" in snapshot["temporary_resources"]


def test_mcp_server_exposes_read_and_proposal_tools_only(tmp_path: Path) -> None:
    server = create_mcp_server(tmp_path)
    tool_names = set(server._tool_manager._tools)  # noqa: SLF001 - assert registered MCP surface.

    assert "acc_list_callables" in tool_names
    assert "acc_create_graphops_proposal" in tool_names
    assert "acc_promote_temporary_resource_dry_run" in tool_names
    assert "acc_submit_ephemeral_run" not in tool_names
    assert "acc_cancel_run" not in tool_names
    assert "acc_request_human_approval" not in tool_names
    assert "acc_apply_approved_graphops_proposal" not in tool_names


def create_callable(root: Path) -> None:
    path = root / "callables" / "agents" / "echo-test.generic.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(
            {
                "id": "echo-test.generic",
                "version": "0.1.0",
                "runtime": "generic_cli",
                "input_ports": {"main": {"type": "artifact", "required": False}},
                "output_ports": {"main": {"type": "artifact", "required": True}},
            }
        ),
        encoding="utf-8",
    )


def create_workflow(root: Path) -> None:
    path = root / "workflows" / "demo.accflow.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": "acc.core.v2",
                "id": "demo",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "echo",
                        "callable_ref": {"kind": "agent_class", "id": "echo-test.generic"},
                    }
                ],
                "control_edges": [],
                "data_edges": [],
            }
        ),
        encoding="utf-8",
    )


def create_run(root: Path) -> None:
    run_dir = root / "runs" / "server_run"
    artifact_dir = run_dir / "artifacts"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "report.md").write_text("# Report\n", encoding="utf-8")
    (artifact_dir / "secret-token.txt").write_text("secret\n", encoding="utf-8")
    (run_dir / "events.jsonl").write_text('{"type":"started"}\n', encoding="utf-8")
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": "server_run",
                "status": "success",
                "run_dir": str(run_dir.resolve()),
                "node_count": 0,
                "failed_nodes": [],
                "nodes": [],
            }
        ),
        encoding="utf-8",
    )


def canvas_snapshot_payload() -> dict:
    return {
        "task_id": "task_canvas",
        "canvas_hash": "canvas_hash_v1:abc",
        "canvas_snapshot": {
            "task_id": "task_canvas",
            "id": "canvas",
            "workflows": [],
            "edges": [],
        },
        "selection": {"type": "task_canvas"},
        "temporary_resources": {},
    }


def graphops_transaction(proposal_id: str) -> dict:
    return {
        "schema_version": "acc.graphops.transaction.v1",
        "proposal_id": proposal_id,
        "author": "mcp_agent",
        "source": {"kind": "mcp_tool", "id": "mcp_test"},
        "base": {
            "content_hashes": {"callables/agents/mcp-reviewer.codex.yaml": "absent"}
        },
        "rationale": "Create MCP reviewer.",
        "targets": [
            {
                "target_type": "agent_class",
                "target_path": "callables/agents/mcp-reviewer.codex.yaml",
                "operation": "create_agent_class",
                "template": {
                    "id": "mcp-reviewer.codex",
                    "runtime": "codex_cli",
                    "default_prompt": "Review.",
                    "input_ports": {"main": {"type": "artifact", "required": False}},
                    "output_ports": {"main": {"type": "artifact", "required": True}},
                },
            }
        ],
    }
