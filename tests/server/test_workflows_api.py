from __future__ import annotations

import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from acc.server.app import create_app
from acc.server.context import relative_project_path
from acc.utils import load_json


def test_list_workflows(client) -> None:
    response = client.get("/api/workflows")

    assert response.status_code == 200
    assert response.json()["workflows"][0]["workflow_id"] == "demo-workflow"


def test_get_workflow_by_id(client) -> None:
    response = client.get("/api/workflows/demo-workflow")

    assert response.status_code == 200
    assert response.json()["workflow"]["tasks"][0]["name"] == "server_node"


def test_missing_workflow_returns_404(client) -> None:
    response = client.get("/api/workflows/missing")

    assert response.status_code == 404


def test_list_workflows_uses_configured_workflows_dir(project_root, monkeypatch) -> None:
    shutil.copytree(project_root / "workflows", project_root / "example_workflows")
    shutil.rmtree(project_root / "workflows")
    monkeypatch.setenv("ACC_WORKFLOWS_DIR", "example_workflows")
    custom_client = TestClient(create_app(project_root))

    response = custom_client.get("/api/workflows")

    assert response.status_code == 200
    assert response.json()["workflows"][0]["workflow_id"] == "demo-workflow"


def simple_graph() -> dict:
    return {
        "id": "server_graph",
        "version": "0.1.0",
        "name": "Server Graph",
        "nodes": [
            {
                "id": "echo",
                "capsule_id": "echo-test.generic",
                "input": {"message": "hello graph"},
            }
        ],
        "edges": [],
    }


def test_post_workflow_saves_graph(client, project_root) -> None:
    response = client.post("/api/workflows", json={"graph": simple_graph(), "force": True})

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "saved"
    saved = load_json(project_root / "workflows" / "server_graph.graph.json")
    assert saved["control_edges"] == []
    assert saved["data_edges"] == []


def test_post_workflow_recovers_wrapped_capsule_node(client, project_root) -> None:
    graph = simple_graph()
    graph["id"] = "wrapped_capsule_graph"
    graph["nodes"] = [
        {
            "id": "research",
            "capsule_id": "fake-agent.generic",
            "kind": "workflow",
            "input": {"message": "hello graph"},
            "input_ports": [{"id": "main", "direction": "input"}],
            "output_ports": [{"id": "main", "direction": "output"}],
            "ui": {
                "internal_nodes": [
                    {
                        "id": "research_session",
                        "kind": "Agent",
                        "name": "research",
                        "runtime": "echo-test.generic",
                    }
                ]
            },
        }
    ]

    response = client.post("/api/workflows", json={"graph": graph, "force": True})

    assert response.status_code == 200, response.text
    saved = load_json(project_root / "workflows" / "wrapped_capsule_graph.graph.json")
    assert saved["nodes"][0]["kind"] == "agent_session"
    assert saved["nodes"][0]["capsule_id"] == "echo-test.generic"
    assert "ui" not in saved["nodes"][0]


def test_post_workflow_materializes_inline_workflow_container(client, project_root) -> None:
    graph = simple_graph()
    graph["id"] = "inline_container_graph"
    graph["nodes"] = [
        {
            "id": "container",
            "capsule_id": "fake-agent.generic",
            "kind": "workflow",
            "input_ports": [{"id": "main", "direction": "input"}],
            "output_ports": [{"id": "main", "direction": "output"}],
            "ui": {
                "internal_nodes": [
                    {
                        "id": "inside_a",
                        "kind": "Agent",
                        "name": "Inside A",
                        "runtime": "echo-test.generic",
                        "input": {"message": "inside a"},
                    },
                    {
                        "id": "inside_b",
                        "kind": "Agent",
                        "name": "Inside B",
                        "runtime": "echo-test.generic",
                        "input": {"message": "inside b"},
                    },
                ],
                "internal_edges": [
                    {"id": "c_ab", "from": "inside_a", "to": "inside_b"}
                ],
            },
        }
    ]

    response = client.post("/api/workflows", json={"graph": graph, "force": True})

    assert response.status_code == 200, response.text
    saved = load_json(project_root / "workflows" / "inline_container_graph.graph.json")
    child = load_json(
        project_root / "workflows" / "inline_container_graph__container.accflow.json"
    )
    assert saved["nodes"][0]["kind"] == "workflow"
    assert saved["nodes"][0]["workflow_ref"] == "inline_container_graph__container.accflow.json"
    assert saved["nodes"][0]["ui"]["inline_workflow_ref"] == (
        "inline_container_graph__container.accflow.json"
    )
    assert [node["id"] for node in child["nodes"]] == ["inside_a", "inside_b"]
    assert child["workflow_input_bindings"][0]["target"]["node"] == "inside_a"
    assert child["control_edges"][0]["context"] == "upstream_output"


def test_post_workflow_materializes_inline_workflow_boundary_edges(client, project_root) -> None:
    graph = simple_graph()
    graph["id"] = "inline_boundary_graph"
    graph["nodes"] = [
        {
            "id": "container",
            "capsule_id": "fake-agent.generic",
            "kind": "workflow",
            "input_ports": [{"id": "main", "direction": "input"}],
            "output_ports": [{"id": "main", "direction": "output"}],
            "ui": {
                "internal_nodes": [
                    {
                        "id": "inside_a",
                        "kind": "Agent",
                        "name": "Inside A",
                        "runtime": "echo-test.generic",
                        "input": {"message": "inside a"},
                    },
                    {
                        "id": "inside_b",
                        "kind": "Agent",
                        "name": "Inside B",
                        "runtime": "echo-test.generic",
                        "input": {"message": "inside b"},
                    },
                ],
                "internal_edges": [
                    {
                        "id": "input_to_b",
                        "from": "container__workflow_inputs",
                        "to": "inside_b",
                    },
                    {
                        "id": "a_to_output",
                        "from": "inside_a",
                        "to": "container__workflow_outputs",
                    },
                    {"id": "c_ab", "from": "inside_a", "to": "inside_b"},
                ],
            },
        }
    ]

    response = client.post("/api/workflows", json={"graph": graph, "force": True})

    assert response.status_code == 200, response.text
    child = load_json(
        project_root / "workflows" / "inline_boundary_graph__container.accflow.json"
    )
    assert child["workflow_input_bindings"] == [
        {
            "source_port": "main",
            "target": {"node": "inside_b", "port": "main"},
            "required": False,
            "materialization": "copy",
        }
    ]
    assert child["workflow_output_bindings"][0]["source"]["node"] == "inside_a"
    assert child["control_edges"] == [
        {
            "id": "c_ab",
            "from": "inside_a",
            "to": "inside_b",
            "condition": None,
            "context": "upstream_output",
        }
    ]


def test_validate_graph_endpoint_catches_invalid_edges(client) -> None:
    graph = simple_graph()
    graph["edges"] = [{"id": "bad", "from": "missing", "to": "echo"}]
    create_response = client.post("/api/workflows", json={"graph": graph, "force": True})

    assert create_response.status_code == 400
    assert "missing node" in create_response.text


def test_validate_and_run_graph_endpoint(client, project_root) -> None:
    create_response = client.post("/api/workflows", json={"graph": simple_graph(), "force": True})
    assert create_response.status_code == 200, create_response.text

    validate_response = client.post("/api/workflows/server_graph/validate")
    assert validate_response.status_code == 200
    run_response = client.post(
        "/api/workflows/server_graph/run",
        json={"run_dir": "runs/server_graph_run"},
    )

    assert run_response.status_code == 200, run_response.text
    assert run_response.json()["status"] == "success"
    assert (project_root / "runs" / "server_graph_run" / "workflow_run.json").exists()


def test_run_graph_endpoint_routes_through_workflow_app_service(
    client,
    monkeypatch,
) -> None:
    create_response = client.post("/api/workflows", json={"graph": simple_graph(), "force": True})
    assert create_response.status_code == 200, create_response.text
    calls = []

    class FakeWorkflowAppService:
        def __init__(self, registry=None) -> None:
            self.registry = registry

        def run_sync(self, graph_path, run_dir, **kwargs):
            calls.append(
                (
                    graph_path.name,
                    run_dir.name,
                    self.registry is not None,
                    kwargs.get("workspace"),
                    kwargs.get("binding_path"),
                    kwargs.get("input_payload"),
                )
            )
            return {"status": "success", "workflow_id": "server_graph", "nodes": []}

    monkeypatch.setattr(
        "acc.server.routes.workflows.WorkflowAppService",
        FakeWorkflowAppService,
    )

    response = client.post(
        "/api/workflows/server_graph/run",
        json={"run_dir": "runs/server_graph_service_run"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "success"
    assert calls == [
        ("server_graph.graph.json", "server_graph_service_run", True, None, None, None)
    ]


def test_run_graph_endpoint_accepts_workflow_input(client, monkeypatch) -> None:
    create_response = client.post("/api/workflows", json={"graph": simple_graph(), "force": True})
    assert create_response.status_code == 200, create_response.text
    calls = []

    class FakeWorkflowAppService:
        def __init__(self, registry=None) -> None:
            self.registry = registry

        def run_sync(self, graph_path, run_dir, **kwargs):
            calls.append(kwargs.get("input_payload"))
            return {"status": "success", "workflow_id": "server_graph", "nodes": []}

    monkeypatch.setattr(
        "acc.server.routes.workflows.WorkflowAppService",
        FakeWorkflowAppService,
    )

    response = client.post(
        "/api/workflows/server_graph/run",
        json={
            "run_dir": "runs/server_graph_input_run",
            "input": {"main": {"topic": "rendering"}},
        },
    )

    assert response.status_code == 200, response.text
    assert calls == [{"main": {"topic": "rendering"}}]


def test_workflow_binding_validates_and_saves_real_workspace(client, project_root) -> None:
    create_response = client.post("/api/workflows", json={"graph": simple_graph(), "force": True})
    assert create_response.status_code == 200, create_response.text
    workspace = project_root / "real_workspace"
    workspace.mkdir()

    validate_response = client.post(
        "/api/workflows/server_graph/binding/validate",
        json={"workspace_root": str(workspace)},
    )
    assert validate_response.status_code == 200, validate_response.text
    assert validate_response.json()["valid"] is True

    save_response = client.put(
        "/api/workflows/server_graph/binding",
        json={"workspace_root": str(workspace)},
    )
    assert save_response.status_code == 200, save_response.text
    assert save_response.json()["binding_path"] == "bindings/server_graph.binding.local.json"
    binding = load_json(project_root / "bindings" / "server_graph.binding.local.json")
    assert Path(binding["workspace_root"]).resolve() == workspace.resolve()

    get_response = client.get("/api/workflows/server_graph/binding")
    assert get_response.status_code == 200
    assert get_response.json()["status"] == "valid"


def test_workflow_binding_can_be_created_before_graph_file_exists(client, project_root) -> None:
    workspace = project_root / "draft_workspace"
    workspace.mkdir()

    response = client.put(
        "/api/workflows/draft_visual_workflow/binding",
        json={"workspace_root": str(workspace)},
    )

    assert response.status_code == 200, response.text
    assert response.json()["binding_path"] == "bindings/draft_visual_workflow.binding.local.json"


def test_workflow_binding_rejects_missing_workspace(client) -> None:
    create_response = client.post("/api/workflows", json={"graph": simple_graph(), "force": True})
    assert create_response.status_code == 200, create_response.text

    response = client.put(
        "/api/workflows/server_graph/binding",
        json={"workspace_root": "Z:/definitely/missing/workspace"},
    )

    assert response.status_code == 400
    assert "Workspace directory not found" in response.text


def test_run_graph_endpoint_accepts_binding_path(client, project_root, monkeypatch) -> None:
    create_response = client.post("/api/workflows", json={"graph": simple_graph(), "force": True})
    assert create_response.status_code == 200, create_response.text
    workspace = project_root / "bound_workspace"
    workspace.mkdir()
    save_response = client.put(
        "/api/workflows/server_graph/binding",
        json={"workspace_root": str(workspace)},
    )
    assert save_response.status_code == 200, save_response.text
    calls = []

    class FakeWorkflowAppService:
        def __init__(self, registry=None) -> None:
            self.registry = registry

        def run_sync(self, graph_path, run_dir, **kwargs):
            calls.append((graph_path.name, run_dir.name, kwargs))
            return {"status": "success", "workflow_id": "server_graph", "nodes": []}

    monkeypatch.setattr(
        "acc.server.routes.workflows.WorkflowAppService",
        FakeWorkflowAppService,
    )

    response = client.post(
        "/api/workflows/server_graph/run",
        json={
            "run_dir": "runs/server_graph_bound_run",
            "binding_path": "bindings/server_graph.binding.local.json",
        },
    )

    assert response.status_code == 200, response.text
    assert calls[0][0:2] == ("server_graph.graph.json", "server_graph_bound_run")
    assert Path(calls[0][2]["binding_path"]).name == "server_graph.binding.local.json"


def test_workflow_binding_open_folder_only_opens_bindings_dir(
    client,
    project_root,
    monkeypatch,
) -> None:
    create_response = client.post("/api/workflows", json={"graph": simple_graph(), "force": True})
    assert create_response.status_code == 200, create_response.text
    opened = []
    monkeypatch.setattr(
        "acc.server.routes.workflows.open_local_folder",
        lambda path: opened.append(path) is None or True,
    )

    response = client.post("/api/workflows/server_graph/binding/open-folder")

    assert response.status_code == 200, response.text
    assert response.json()["path"] == "bindings"
    assert opened == [(project_root / "bindings").resolve()]


def test_run_graph_endpoint_accepts_temporary_workspace(client, project_root, monkeypatch) -> None:
    create_response = client.post("/api/workflows", json={"graph": simple_graph(), "force": True})
    assert create_response.status_code == 200, create_response.text
    workspace = project_root / "temporary_workspace"
    workspace.mkdir()
    calls = []

    class FakeWorkflowAppService:
        def __init__(self, registry=None) -> None:
            self.registry = registry

        def run_sync(self, graph_path, run_dir, **kwargs):
            calls.append(kwargs)
            return {"status": "success", "workflow_id": "server_graph", "nodes": []}

    monkeypatch.setattr(
        "acc.server.routes.workflows.WorkflowAppService",
        FakeWorkflowAppService,
    )

    response = client.post(
        "/api/workflows/server_graph/run",
        json={"run_dir": "runs/server_graph_workspace_run", "workspace": str(workspace)},
    )

    assert response.status_code == 200, response.text
    assert Path(calls[0]["workspace"]).resolve() == workspace.resolve()


def test_relative_project_path_survives_atomic_replace_race(tmp_path, monkeypatch) -> None:
    project_root = tmp_path.resolve()
    workflow_path = project_root / "workflows" / "ui_demo_graph.graph.json"
    deleted_path = project_root.parent / "$Extend" / "$Deleted" / "stale"
    original_resolve = Path.resolve

    def fake_resolve(self, *args, **kwargs):
        if self == workflow_path:
            return deleted_path
        return original_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", fake_resolve)

    assert relative_project_path(project_root, workflow_path) == (
        "workflows/ui_demo_graph.graph.json"
    )
