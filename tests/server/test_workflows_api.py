from __future__ import annotations

import shutil

from fastapi.testclient import TestClient

from acc.server.app import create_app


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
    assert (project_root / "workflows" / "server_graph.graph.json").exists()


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
