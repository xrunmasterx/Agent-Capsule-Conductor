from __future__ import annotations


def test_list_capsules(client) -> None:
    response = client.get("/api/capsules")

    assert response.status_code == 200
    assert response.json()["capsules"][0]["id"] == "echo-test.generic"


def test_get_capsule_metadata(client) -> None:
    response = client.get("/api/capsules/echo-test.generic")

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "echo-test.generic"
    assert payload["runtime"] == "generic_cli"


def test_missing_capsule_returns_404(client) -> None:
    response = client.get("/api/capsules/missing.generic")

    assert response.status_code == 404


def test_validate_capsule(client) -> None:
    response = client.post("/api/capsules/echo-test.generic/validate")

    assert response.status_code == 200
    assert response.json()["status"] == "valid"


def test_capsule_test_runs_hermetic_generic_capsule(client) -> None:
    response = client.post(
        "/api/capsules/echo-test.generic/test",
        json={
            "input": {"message": "hello server"},
            "run_dir": "runs/server_capsule_test",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "success"
    assert payload["summary"] == "hello server"

