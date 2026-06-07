from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from acc.app.local_directory_picker import LocalDirectorySelection
from acc.server.routes import workflows as workflow_routes


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
                "internal_edges": [
                    {
                        "id": "collect_news_workflow_output",
                        "kind": "data",
                        "from": {"node": "collect_news", "port": "main"},
                        "to": {"node": "New_Workflow__workflow_outputs", "port": "main"},
                        "materialization": "copy",
                    }
                ],
            },
        }
    ]
    return draft


def empty_workbench_container_draft() -> dict:
    draft = workbench_draft()
    draft["id"] = "empty_workbench_container_flow"
    draft["nodes"] = [
        {
            "id": "New_Workflow_2",
            "kind": "workflow",
            "label": "New Workflow #2",
            "callable_ref": {"kind": "workflow_function", "id": "New_Workflow_2"},
            "input": {"topic": "wrapper"},
            "input_ports": [{"id": "main"}],
            "output_ports": [{"id": "main"}],
            "ui": {
                "semantic_kind": "workflow_container",
                "internal_nodes": [],
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
    assert "output_schema" in saved["nodes"][0]
    assert payload["normalization"]["snapshotted_output_schemas"] == 1


def test_post_workflow_normalizes_main_data_edge_to_control_main_channel(
    client: TestClient,
    project_root: Path,
) -> None:
    draft = workbench_draft()
    draft["id"] = "main_data_edge_migration"
    draft["nodes"].append(
        {
            "id": "consume",
            "kind": "agent_session",
            "label": "Consume",
            "callable_ref": {"kind": "agent_class", "id": "echo-test.generic"},
            "input": {"prompt": "Consume facts."},
            "input_ports": [{"id": "main"}],
            "output_ports": [{"id": "main"}],
            "position": {"x": 400, "y": 100},
        }
    )
    draft["data_edges"] = [
        {
            "id": "collect-main-consume-main",
            "from": {"node": "collect", "port": "main"},
            "to": {"node": "consume", "port": "main"},
            "materialization": "copy",
        }
    ]

    response = client.post("/api/workflows", json={"graph": draft, "force": True})

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["normalization"]["removed_main_data_edges"] == 1
    saved = json.loads(
        (project_root / "workflows" / "main_data_edge_migration.accflow.json").read_text()
    )
    assert saved["data_edges"] == []
    assert saved["control_edges"] == [{"context": "none", "from": "collect", "to": "consume"}]


def test_post_workflow_rejects_non_main_output_port_missing_schema(
    client: TestClient,
    project_root: Path,
) -> None:
    draft = workbench_draft()
    draft["id"] = "schema_port_mismatch"
    draft["nodes"][0]["output_ports"] = [{"id": "main"}, {"id": "risk_table"}]
    draft["nodes"][0]["output_schema"] = {
        "type": "object",
        "properties": {"outputs": {"type": "object", "properties": {}}},
    }

    response = client.post("/api/workflows", json={"graph": draft, "force": True})

    assert response.status_code == 400
    assert "output_port_schema_missing" in response.text
    assert not (project_root / "workflows" / "schema_port_mismatch.accflow.json").exists()


def test_post_workflow_normalizes_output_schema_null_keywords(
    client: TestClient,
    project_root: Path,
) -> None:
    draft = workbench_draft()
    draft["id"] = "schema_keyword_normalization"
    draft["nodes"][0]["output_schema"] = {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "Short answer.",
                "items": None,
            },
            "artifacts": {
                "type": "array",
                "items": {"type": "string"},
            },
            "nullable_enum": {
                "enum": ["ready", None],
            },
        },
        "required": ["summary"],
    }

    response = client.post("/api/workflows", json={"graph": draft, "force": True})

    assert response.status_code == 200, response.text
    saved = json.loads(
        (project_root / "workflows" / "schema_keyword_normalization.accflow.json").read_text()
    )
    output_schema = saved["nodes"][0]["output_schema"]
    assert "items" not in output_schema["properties"]["summary"]
    assert output_schema["properties"]["artifacts"]["items"] == {"type": "string"}
    assert output_schema["properties"]["nullable_enum"]["enum"] == ["ready", None]
    assert output_schema["additionalProperties"] is False


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


def test_get_workflow_uses_filename_first_lookup(
    client: TestClient,
    project_root: Path,
) -> None:
    write_saved_workflow(project_root / "workflows" / "target.accflow.json", "target")
    (project_root / "workflows" / "broken.accflow.json").write_text("{", encoding="utf-8")

    response = client.get("/api/workflows/target")

    assert response.status_code == 200, response.text
    assert response.json()["workflow_id"] == "target"


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


def test_select_workflow_binding_directory_returns_selected_path(
    client: TestClient,
    project_root: Path,
    monkeypatch,
) -> None:
    workspace = project_root / "selected_workspace"
    workspace.mkdir()
    monkeypatch.setattr(
        workflow_routes,
        "select_local_directory",
        lambda initial_dir=None: LocalDirectorySelection(status="selected", path=str(workspace)),
    )

    response = client.post(
        "/api/workflows/workflow_picker/binding/select-directory",
        json={"initial_dir": str(project_root)},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["workflow_id"] == "workflow_picker"
    assert payload["status"] == "selected"
    assert payload["valid"] is True
    assert Path(payload["workspace_root"]) == workspace.resolve()
    assert not (project_root / "bindings" / "workflow_picker.binding.local.json").exists()


def test_select_workflow_binding_directory_cancelled_does_not_change_binding(
    client: TestClient,
    project_root: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        workflow_routes,
        "select_local_directory",
        lambda initial_dir=None: LocalDirectorySelection(status="cancelled"),
    )

    response = client.post(
        "/api/workflows/workflow_picker/binding/select-directory",
        json={"initial_dir": str(project_root)},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "cancelled"
    assert payload["valid"] is False
    assert payload["workspace_root"] is None
    assert not (project_root / "bindings" / "workflow_picker.binding.local.json").exists()


def test_select_workflow_binding_directory_unsupported(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        workflow_routes,
        "select_local_directory",
        lambda initial_dir=None: LocalDirectorySelection(
            status="unsupported",
            error="native directory picker disabled",
        ),
    )

    response = client.post(
        "/api/workflows/workflow_picker/binding/select-directory",
        json={},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "unsupported"
    assert payload["valid"] is False
    assert payload["error"] == "native directory picker disabled"


def test_select_workflow_binding_directory_invalid_selected_path(
    client: TestClient,
    project_root: Path,
    monkeypatch,
) -> None:
    missing = project_root / "missing_workspace"
    monkeypatch.setattr(
        workflow_routes,
        "select_local_directory",
        lambda initial_dir=None: LocalDirectorySelection(status="selected", path=str(missing)),
    )

    response = client.post(
        "/api/workflows/workflow_picker/binding/select-directory",
        json={},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "failed"
    assert payload["valid"] is False
    assert "Workspace directory not found" in payload["error"]
    assert Path(payload["workspace_root"]) == missing.resolve()


def test_select_workflow_binding_directory_reports_busy(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        workflow_routes,
        "select_local_directory",
        lambda initial_dir=None: LocalDirectorySelection(status="failed", error="picker_busy"),
    )

    response = client.post(
        "/api/workflows/workflow_picker/binding/select-directory",
        json={},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "failed"
    assert payload["error"] == "picker_busy"


def test_run_graph_uses_binding_workspace(
    client: TestClient,
    project_root: Path,
) -> None:
    workspace = project_root / "external_workspace"
    workspace.mkdir()
    binding_path = project_root / "bindings" / "bound_api.binding.local.json"
    binding_path.parent.mkdir(parents=True)
    binding_path.write_text(
        json.dumps(
            {
                "workflow_id": "bound_api",
                "binding_name": "bound_api.local",
                "state_mode": "stateful",
                "workspace_root": str(workspace),
                "behavior_policy": {"mode": "workspace_native"},
            }
        ),
        encoding="utf-8",
    )
    response = client.post(
        "/api/workflows/run-graph",
        json={
            "graph": {
                "schema_version": "acc.core.v2",
                "id": "bound_api",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "produce",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                    }
                ],
                "control_edges": [],
                "data_edges": [],
            },
            "run_dir": "runs/bound_api_run",
            "binding_path": "bindings/bound_api.binding.local.json",
        },
    )

    assert response.status_code == 200, response.text
    scope = json.loads((project_root / "runs" / "bound_api_run" / "scope_frame.json").read_text())
    output = json.loads(
        (project_root / "runs" / "bound_api_run" / "nodes" / "produce" / "output.json").read_text()
    )
    assert Path(scope["workspace_root"]) == workspace.resolve()
    assert Path(scope["binding_path"]) == binding_path.resolve()
    assert scope["ephemeral"] is False
    assert output["cwd"] == str(workspace.resolve())


def test_workbench_container_run_uses_container_binding(
    client: TestClient,
    project_root: Path,
) -> None:
    workspace = project_root / "container_workspace"
    workspace.mkdir()
    binding_path = project_root / "bindings" / "New_Workflow.binding.local.json"
    binding_path.parent.mkdir(parents=True)
    binding_path.write_text(
        json.dumps(
            {
                "workflow_id": "New_Workflow",
                "binding_name": "New_Workflow.local",
                "state_mode": "stateful",
                "workspace_root": str(workspace),
                "behavior_policy": {"mode": "workspace_native"},
            }
        ),
        encoding="utf-8",
    )
    draft = workbench_container_draft()
    draft["id"] = "container_bound_root"
    container = draft["nodes"][0]
    container["ui"]["binding_ref"] = "bindings/New_Workflow.binding.local.json"
    container["ui"]["internal_nodes"][0]["kind"] = "Tool"
    container["ui"]["internal_nodes"][0]["callableId"] = "fake_producer"

    response = client.post(
        "/api/workflows/run-graph",
        json={
            "graph": draft,
            "run_dir": "runs/container_bound_run",
        },
    )

    assert response.status_code == 200, response.text
    root_scope = json.loads(
        (project_root / "runs" / "container_bound_run" / "scope_frame.json").read_text()
    )
    child_scope = json.loads(
        (
            project_root
            / "runs"
            / "container_bound_run"
            / "nodes"
            / "New_Workflow"
            / "nested_workflow"
            / "scope_frame.json"
        ).read_text()
    )
    child_output = json.loads(
        (
            project_root
            / "runs"
            / "container_bound_run"
            / "nodes"
            / "New_Workflow"
            / "nested_workflow"
            / "nodes"
            / "collect_news"
            / "output.json"
        ).read_text()
    )
    compiled_root = json.loads(
        (
            project_root
            / "runs"
            / "_workflow_function_specs"
            / "container_bound_run"
            / "container_bound_root.accflow.json"
        ).read_text()
    )
    compiled_child = json.loads(
        (
            project_root
            / "runs"
            / "_workflow_function_specs"
            / "container_bound_run"
            / "container_bound_root__New_Workflow.accflow.json"
        ).read_text()
    )
    assert root_scope["binding_path"] is None
    assert Path(root_scope["workspace_root"]) == (
        project_root / "runs" / "container_bound_run"
    ).resolve()
    assert Path(child_scope["workspace_root"]) == workspace.resolve()
    assert Path(child_scope["binding_path"]) == binding_path.resolve()
    assert child_scope["ephemeral"] is False
    assert child_output["cwd"] == str(workspace.resolve())
    assert compiled_root["nodes"][0]["metadata"]["binding_ref"] == (
        "bindings/New_Workflow.binding.local.json"
    )
    assert compiled_child["metadata"]["binding_ref"] == "bindings/New_Workflow.binding.local.json"


def test_submit_empty_workbench_container_writes_noop_child_spec(
    client: TestClient,
    project_root: Path,
) -> None:
    response = client.post(
        "/api/workflows/run-graph/submit",
        json={
            "graph": empty_workbench_container_draft(),
            "run_dir": "runs/empty_container_submit",
            "task_id": "task_empty_container",
        },
    )

    assert response.status_code == 200, response.text
    spec_dir = project_root / "runs" / "_workflow_function_specs" / "empty_container_submit"
    child_path = spec_dir / "empty_workbench_container_flow__New_Workflow_2.accflow.json"
    assert child_path.exists()
    child = json.loads(child_path.read_text())
    assert child["nodes"] == []


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
