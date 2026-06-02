from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient


def workbench_draft() -> dict:
    return {
        "id": "workbench_stock_flow",
        "version": "0.4.0",
        "name": "Workbench Stock Flow",
        "nodes": [
            {
                "id": "collect",
                "kind": "agent_session",
                "label": "Collect",
                "callable_ref": {"kind": "agent_class", "id": "echo-test.generic"},
                "input": {"topic": "today", "prompt": "Collect facts."},
                "input_mapping": {},
                "input_ports": [{"id": "main"}],
                "output_ports": [{"id": "main"}],
                "position": {"x": 100, "y": 100},
            }
        ],
        "control_edges": [],
        "data_edges": [],
        "workspace_policy": {"save_mode": "local_binding"},
    }


def workbench_container_draft() -> dict:
    draft = workbench_draft()
    draft["id"] = "workbench_container_flow"
    draft["nodes"] = [
        {
            "id": "New_Workflow",
            "kind": "workflow",
            "label": "New Workflow",
            "callable_ref": {"kind": "workflow_function", "id": "New_Workflow"},
            "input": {"topic": "wrapper"},
            "input_ports": [{"id": "main"}],
            "output_ports": [{"id": "main"}],
            "ui": {
                "semantic_kind": "workflow_container",
                "internal_nodes": [
                    {
                        "id": "collect_news",
                        "name": "Collect News",
                        "task": "Collect today's market news.",
                        "kind": "Agent",
                        "callableId": "echo-test.generic",
                        "input": {"prompt": "Collect today's market news."},
                        "inputPorts": [{"id": "main"}],
                        "outputPorts": [{"id": "main"}],
                    }
                ],
                "internal_edges": [],
            },
        }
    ]
    return draft


def test_post_workflow_canonicalizes_workbench_draft(
    client: TestClient,
    project_root: Path,
) -> None:
    response = client.post("/api/workflows", json={"graph": workbench_draft(), "force": True})

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "saved"
    canonical = payload["canonical_preview"]
    assert canonical["schema_version"] == "acc.core.v2"
    assert canonical["nodes"][0]["prompt_policy"]["user_prompt"] == "Collect facts."
    assert "input" not in canonical["nodes"][0]
    saved_path = project_root / "workflows" / "workbench_stock_flow.accflow.json"
    saved = json.loads(saved_path.read_text())
    assert saved["nodes"][0]["ports"]["inputs"]["main"]["type"] == "artifact"


def test_post_workflow_saves_compiled_child_for_workbench_container(
    client: TestClient,
    project_root: Path,
) -> None:
    response = client.post(
        "/api/workflows",
        json={"graph": workbench_container_draft(), "force": True},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    canonical = payload["canonical_preview"]
    assert "workbench_container_flow__New_Workflow.accflow.json" in canonical["children"]
    root_path = project_root / "workflows" / "workbench_container_flow.accflow.json"
    child_path = project_root / "workflows" / "workbench_container_flow__New_Workflow.accflow.json"
    assert root_path.exists()
    assert child_path.exists()
    root = json.loads(root_path.read_text())
    child = json.loads(child_path.read_text())
    assert root["nodes"][0]["callable_ref"]["id"] == child_path.name
    assert root["nodes"][0]["callable_ref"]["id"] != "New_Workflow"
    assert [node["id"] for node in child["nodes"]] == ["collect_news"]


def write_saved_workflow(path: Path, workflow_id: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": "acc.core.v2",
                "id": workflow_id,
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "collect",
                        "callable_ref": {"kind": "agent_class", "id": "echo-test.generic"},
                    }
                ],
                "control_edges": [],
                "data_edges": [],
            }
        ),
        encoding="utf-8",
    )


def test_post_workflow_can_reference_existing_saved_workflow_resource(
    client: TestClient,
    project_root: Path,
) -> None:
    child_path = project_root / "workflows" / "existing_child.accflow.json"
    write_saved_workflow(child_path, "existing_child")

    response = client.post(
        "/api/workflows",
        json={
            "graph": {
                "id": "parent_reusing_child",
                "version": "0.4.0",
                "name": "Parent Reusing Child",
                "nodes": [
                    {
                        "id": "child_call",
                        "kind": "workflow",
                        "label": "Existing Child",
                        "callable_ref": {
                            "kind": "workflow_function",
                            "id": "workflows/existing_child.accflow.json",
                        },
                        "input_ports": [{"id": "main"}],
                        "output_ports": [{"id": "main"}],
                    }
                ],
                "control_edges": [],
                "data_edges": [],
            },
            "force": True,
        },
    )

    assert response.status_code == 200, response.text
    saved = json.loads(
        (project_root / "workflows" / "parent_reusing_child.accflow.json").read_text()
    )
    assert saved["nodes"][0]["callable_ref"]["id"] == "existing_child.accflow.json"
    assert ":\\" not in saved["nodes"][0]["callable_ref"]["id"]
    assert response.json()["validation"]["status"] == "valid"


def test_post_workflow_validates_overlay_and_existing_workflow_refs_together(
    client: TestClient,
    project_root: Path,
) -> None:
    write_saved_workflow(
        project_root / "workflows" / "existing_child.accflow.json",
        "existing_child",
    )
    draft = workbench_container_draft()
    draft["id"] = "parent_with_overlay_and_existing"
    draft["nodes"].append(
        {
            "id": "saved_child",
            "kind": "workflow",
            "label": "Saved Child",
            "callable_ref": {
                "kind": "workflow_function",
                "id": "workflows/existing_child.accflow.json",
            },
            "input_ports": [{"id": "main"}],
            "output_ports": [{"id": "main"}],
        }
    )

    response = client.post("/api/workflows", json={"graph": draft, "force": True})

    assert response.status_code == 200, response.text
    root = json.loads(
        (project_root / "workflows" / "parent_with_overlay_and_existing.accflow.json").read_text()
    )
    refs = {node["callable_ref"]["id"] for node in root["nodes"]}
    assert "parent_with_overlay_and_existing__New_Workflow.accflow.json" in refs
    assert "existing_child.accflow.json" in refs


def test_submit_rejects_legacy_graph_without_creating_run(
    client: TestClient,
    project_root: Path,
) -> None:
    response = client.post(
        "/api/workflows/run-graph/submit",
        json={
            "graph": {"id": "legacy", "tasks": [{"name": "old"}]},
            "run_dir": "runs/legacy_rejected",
            "task_id": "task_legacy",
        },
    )

    assert response.status_code == 400
    assert "Legacy workflow graph payloads" in response.text
    assert not (project_root / "runs" / "legacy_rejected" / "run_summary.json").exists()


def test_post_workflow_rejects_missing_workflow_function_ref(
    client: TestClient,
    project_root: Path,
) -> None:
    response = client.post(
        "/api/workflows",
        json={
            "graph": {
                "schema_version": "acc.core.v2",
                "id": "missing_child_parent",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "missing_child",
                        "callable_ref": {
                            "kind": "workflow_function",
                            "id": "New_Workflow",
                        },
                    }
                ],
                "control_edges": [],
                "data_edges": [],
            },
            "force": True,
        },
    )

    assert response.status_code == 400
    assert "Workflow function not found" in response.text
    assert not (project_root / "workflows" / "missing_child_parent.accflow.json").exists()


def test_submit_workbench_container_writes_run_local_child_specs(
    client: TestClient,
    project_root: Path,
) -> None:
    response = client.post(
        "/api/workflows/run-graph/submit",
        json={
            "graph": workbench_container_draft(),
            "run_dir": "runs/container_submit",
            "task_id": "task_container",
        },
    )

    assert response.status_code == 200, response.text
    spec_dir = project_root / "runs" / "_workflow_function_specs" / "container_submit"
    assert (spec_dir / "workbench_container_flow.accflow.json").exists()
    assert (spec_dir / "workbench_container_flow__New_Workflow.accflow.json").exists()


def test_agent_callable_authoring_round_trip(client: TestClient, project_root: Path) -> None:
    response = client.post(
        "/api/callables/agents",
        json={
            "id": "stock-ui-created.codex",
            "runtime": "codex_cli",
            "name": "Stock UI Created",
            "description": "Created through API.",
            "default_prompt": "Use a fixed market research methodology.",
            "input_ports": {"main": {"type": "artifact", "required": False}},
            "output_ports": {"main": {"type": "artifact", "required": True}},
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["callable"]["default_prompt"].startswith("Use a fixed")
    list_response = client.get("/api/callables")
    assert list_response.status_code == 200
    ids = {item["id"] for item in list_response.json()["callables"]}
    assert "stock-ui-created.codex" in ids
    assert (project_root / "callables" / "agents" / "stock-ui-created.codex.yaml").exists()


def test_agent_callable_authoring_rejects_path_traversal(client: TestClient) -> None:
    response = client.post(
        "/api/callables/agents",
        json={"id": "../escape", "runtime": "codex_cli"},
    )

    assert response.status_code == 400
