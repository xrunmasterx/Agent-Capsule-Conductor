from __future__ import annotations


def test_read_markdown_artifact_inside_project_root(client) -> None:
    response = client.get(
        "/api/artifacts/read",
        params={"path": "runs/server_run/artifacts/report.md"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["type"] == "markdown"
    assert "hello" in payload["content"]


def test_read_json_artifact_inside_project_root(client) -> None:
    response = client.get("/api/artifacts/read", params={"path": "runs/server_run/output.json"})

    assert response.status_code == 200
    assert response.json()["type"] == "json"


def test_path_traversal_is_rejected(client) -> None:
    response = client.get("/api/artifacts/read", params={"path": "../outside.txt"})

    assert response.status_code == 400


def test_missing_file_returns_404(client) -> None:
    response = client.get("/api/artifacts/read", params={"path": "runs/server_run/missing.md"})

    assert response.status_code == 404


def test_secret_like_file_is_not_exposed(client) -> None:
    response = client.get("/api/artifacts/read", params={"path": ".env"})

    assert response.status_code == 403
