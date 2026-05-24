from __future__ import annotations


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

