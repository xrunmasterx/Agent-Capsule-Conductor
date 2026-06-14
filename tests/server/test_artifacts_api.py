from __future__ import annotations


def test_read_markdown_artifact_inside_project_root(client) -> None:
    response = client.get(
        "/api/artifacts/read",
        params={"path": "run:server_run:node:server_node:artifact:report.md"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["type"] == "markdown"
    assert "hello" in payload["content"]


def test_raw_project_path_is_not_artifact_authority(client) -> None:
    response = client.get("/api/artifacts/read", params={"path": "runs/server_run/output.json"})

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "artifact_policy_denied"


def test_read_run_level_artifact_ref(client) -> None:
    response = client.get(
        "/api/artifacts/read",
        params={"path": "run:server_run:artifact:report.md"},
    )

    assert response.status_code == 200
    assert response.json()["type"] == "markdown"


def test_read_versioned_artifact_ref(client) -> None:
    response = client.get(
        "/api/artifacts/read",
        params={"path": "artifact:v1:server_run:node:server_node:report.md"},
    )

    assert response.status_code == 200
    assert response.json()["type"] == "markdown"


def test_path_traversal_is_rejected(client) -> None:
    response = client.get(
        "/api/artifacts/read",
        params={"path": "run:server_run:node:server_node:artifact:../outside.txt"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "artifact_policy_denied"


def test_missing_file_returns_404(client) -> None:
    response = client.get(
        "/api/artifacts/read",
        params={"path": "run:server_run:node:server_node:artifact:missing.md"},
    )

    assert response.status_code == 404


def test_secret_like_file_is_not_exposed(client) -> None:
    response = client.get(
        "/api/artifacts/read",
        params={"path": "run:server_run:node:server_node:artifact:secret-token.txt"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "artifact_policy_denied"
