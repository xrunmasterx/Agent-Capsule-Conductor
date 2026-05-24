from __future__ import annotations


def test_health_returns_ok(client) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_version_returns_package_version(client) -> None:
    response = client.get("/api/version")

    assert response.status_code == 200
    assert response.json()["version"]

