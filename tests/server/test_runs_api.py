from __future__ import annotations


def test_list_runs(client) -> None:
    response = client.get("/api/runs")

    assert response.status_code == 200
    assert response.json()["runs"][0]["run_id"] == "server_run"


def test_get_run_summary(client) -> None:
    response = client.get("/api/runs/server_run")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "success"
    assert payload["output_path"]
    assert payload["artifact_dir"]


def test_missing_run_returns_404(client) -> None:
    response = client.get("/api/runs/missing")

    assert response.status_code == 404


def test_get_node_details(client) -> None:
    response = client.get("/api/runs/server_run/nodes/server_node")

    assert response.status_code == 200
    payload = response.json()
    assert payload["node_id"] == "server_node"
    assert payload["artifacts_url"] == "/api/runs/server_run/nodes/server_node/artifacts"


def test_get_node_artifacts(client) -> None:
    response = client.get("/api/runs/server_run/nodes/server_node/artifacts")

    assert response.status_code == 200
    artifacts = response.json()["artifacts"]
    assert [artifact["name"] for artifact in artifacts] == ["report.md"]

