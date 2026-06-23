from __future__ import annotations

import json
from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from acc.app.workbench_tasks import WorkbenchTaskService
from acc.runner import artifact_id_for_project_path
from acc.server.app import create_app
from acc.storage import RUN_MARKER_FILENAME


def _runner_graph(graph_id: str = "runner_flow", callable_id: str = "echo-test.generic") -> dict:
    return {
        "id": graph_id,
        "version": "0.4.0",
        "name": "Runner Flow",
        "nodes": [
            {
                "id": "collect",
                "kind": "agent_session",
                "label": "Collect",
                "callable_ref": {"kind": "agent_class", "id": callable_id},
                "input": {"prompt": "Collect facts."},
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


def test_runner_capabilities_and_workspaces_hide_local_paths(
    client: TestClient,
    project_root: Path,
) -> None:
    capabilities = client.get("/api/runner/capabilities")
    assert capabilities.status_code == 200, capabilities.text
    payload = capabilities.json()
    assert payload["schema_version"] == "acc.runner.capabilities.v1"
    assert payload["runner_id"].startswith("runner_")
    assert "generic_cli" in payload["available_runtimes"]
    assert "default" in payload["workspace_aliases"]
    assert payload["permission_policy"] == {
        "network": "allow",
        "shell": "allow",
        "dangerous": "allow",
        "workspace_write": "allow",
    }

    workspaces = client.get("/api/runner/workspaces")
    assert workspaces.status_code == 200, workspaces.text
    assert "local_path" not in workspaces.text
    assert str(project_root) not in workspaces.text


def test_runner_token_and_origin_gate_for_mutating_api(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("ACC_LOCAL_RUNNER_REQUIRE_TOKEN", "1")
    monkeypatch.setenv("ACC_LOCAL_RUNNER_TOKEN", "secret-token")
    client = TestClient(create_app(tmp_path))

    denied = client.post(
        "/api/runner/workspaces",
        json={"alias": "extra", "local_path": str(tmp_path), "display_name": "Extra"},
    )
    assert denied.status_code == 401
    assert denied.json()["detail"]["code"] == "auth_missing"

    bad_origin = client.post(
        "/api/runner/workspaces",
        headers={"x-acc-local-token": "secret-token", "origin": "https://evil.example"},
        json={"alias": "extra", "local_path": str(tmp_path), "display_name": "Extra"},
    )
    assert bad_origin.status_code == 403
    assert bad_origin.json()["detail"]["code"] == "origin_denied"

    allowed = client.post(
        "/api/runner/workspaces",
        headers={"x-acc-local-token": "secret-token", "origin": "http://127.0.0.1:5173"},
        json={"alias": "extra", "local_path": str(tmp_path), "display_name": "Extra"},
    )
    assert allowed.status_code == 200, allowed.text
    assert [item["alias"] for item in allowed.json()["aliases"]] == ["default", "extra"]


def test_product_security_mode_requires_token_by_default(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ACC_SECURITY_MODE", "product_local_exe")
    monkeypatch.delenv("ACC_LOCAL_RUNNER_REQUIRE_TOKEN", raising=False)
    monkeypatch.delenv("ACC_LOCAL_RUNNER_TOKEN", raising=False)
    client = TestClient(create_app(tmp_path))

    response = client.post(
        "/api/runner/workspaces",
        json={"alias": "extra", "local_path": str(tmp_path), "display_name": "Extra"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "auth_missing"


def test_new_pairing_file_does_not_store_plaintext_local_token(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("ACC_LOCAL_RUNNER_TOKEN", "bootstrap-token")
    client = TestClient(create_app(tmp_path))

    response = client.get("/api/runner/health")

    assert response.status_code == 200, response.text
    pairing = json.loads(
        (tmp_path / ".acc" / "runner" / "pairing.json").read_text(encoding="utf-8")
    )
    assert pairing["state"] == "unpaired"
    assert "local_token_hash" in pairing
    assert "local_token" not in pairing


def test_runner_submit_rejects_unsupported_provider_before_run_evidence(
    client: TestClient,
    project_root: Path,
) -> None:
    write_yaml(
        project_root / "callables" / "agents" / "future-agent.yaml",
        {"id": "future-agent", "version": "0.1.0", "runtime": "future_provider"},
    )

    response = client.post(
        "/api/runner/jobs",
        json={
            "graph": _runner_graph("future_provider_flow", "future-agent"),
            "run_id": "unsupported_provider_run",
        },
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "unsupported_provider"
    assert detail["job"]["status"] == "rejected"
    assert detail["job"]["run_id"] is None
    assert not (project_root / "runs" / "unsupported_provider_run").exists()


def test_product_runner_submit_requires_local_approval_for_shell_permission(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("ACC_SECURITY_MODE", "product_local_exe")
    monkeypatch.setenv("ACC_LOCAL_RUNNER_TOKEN", "secret-token")
    client = TestClient(create_app(tmp_path))
    write_yaml(
        tmp_path / "callables" / "agents" / "shell-agent.yaml",
        {
            "id": "shell-agent",
            "version": "0.1.0",
            "runtime": "generic_cli",
            "default_permissions": {"workspace_access": "read_only", "shell": True},
        },
    )

    response = client.post(
        "/api/runner/jobs",
        headers={"x-acc-local-token": "secret-token"},
        json={
            "graph": _runner_graph("shell_flow", "shell-agent"),
            "run_id": "shell_run",
        },
    )

    assert response.status_code == 400, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "permission_requires_local_approval"
    assert detail["job"]["status"] == "rejected"
    assert not (tmp_path / "runs" / "shell_run").exists()
    audit_log = (tmp_path / ".acc" / "audit" / "events.jsonl").read_text(encoding="utf-8")
    assert "permission.denied" in audit_log


def test_product_runner_submit_checks_node_invocation_permission_override(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("ACC_SECURITY_MODE", "product_local_exe")
    monkeypatch.setenv("ACC_LOCAL_RUNNER_TOKEN", "secret-token")
    client = TestClient(create_app(tmp_path))
    write_yaml(
        tmp_path / "callables" / "agents" / "safe-agent.yaml",
        {
            "id": "safe-agent",
            "version": "0.1.0",
            "runtime": "generic_cli",
            "default_permissions": {"workspace_access": "read_only"},
        },
    )
    graph = _runner_graph("override_flow", "safe-agent")
    graph["nodes"][0]["invocation_policy"] = {
        "permission_profile": {
            "workspace_access": "writes_workspace",
            "network": True,
            "shell": True,
            "dangerous": True,
        }
    }

    response = client.post(
        "/api/runner/jobs",
        headers={"x-acc-local-token": "secret-token"},
        json={"graph": graph, "run_id": "override_run"},
    )

    assert response.status_code == 400, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "permission_denied"
    assert detail["job"]["status"] == "rejected"
    assert not (tmp_path / "runs" / "override_run").exists()
    assert detail["details"]["decision"]["reasons"] == [
        "dangerous",
        "shell",
        "network",
        "writes_workspace",
    ]


def test_dev_runner_submit_allows_full_local_callable_permissions(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.delenv("ACC_SECURITY_MODE", raising=False)
    monkeypatch.delenv("ACC_LOCAL_RUNNER_REQUIRE_TOKEN", raising=False)
    monkeypatch.delenv("ACC_LOCAL_RUNNER_TOKEN", raising=False)
    client = TestClient(create_app(tmp_path))
    write_yaml(
        tmp_path / "callables" / "agents" / "full-local-agent.yaml",
        {
            "id": "full-local-agent",
            "version": "0.1.0",
            "runtime": "generic_cli",
            "default_permissions": {
                "workspace_access": "writes_workspace",
                "network": True,
                "shell": True,
                "dangerous": True,
            },
        },
    )

    response = client.post(
        "/api/runner/jobs",
        json={
            "graph": _runner_graph("full_local_flow", "full-local-agent"),
            "run_id": "full_local_run",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] in {"queued", "running", "success"}
    assert (tmp_path / "runs" / "full_local_run" / RUN_MARKER_FILENAME).exists()


def test_runner_submit_returns_job_without_run_dir(
    client: TestClient,
    project_root: Path,
) -> None:
    response = client.post(
        "/api/runner/jobs",
        json={
            "graph": _runner_graph("runner_submit_flow"),
            "job_id": "job_runner_submit",
            "run_id": "runner_submit_run",
            "task_id": "task-runner",
            "workspace_alias": "default",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["job_id"] == "job_runner_submit"
    assert payload["run_id"] == "runner_submit_run"
    assert payload["task_id"] == "task-runner"
    assert payload["workflow_id"] == "runner_submit_flow"
    assert payload["workspace_alias"] == "default"
    assert payload["schema_version"] == "acc.runner.job.v1"
    assert payload["status"] in {"queued", "running", "success"}
    assert payload["rejection"] is None
    assert payload["stream_url"] == "/api/runner/runs/runner_submit_run/stream"
    assert "run_dir" not in payload
    assert str(project_root) not in response.text
    assert (project_root / "runs" / "runner_submit_run" / RUN_MARKER_FILENAME).exists()

    persisted = client.get("/api/runner/jobs/job_runner_submit")
    assert persisted.status_code == 200, persisted.text
    assert persisted.json() == payload


def test_runner_submit_updates_existing_workbench_task_run_index(
    client: TestClient,
    project_root: Path,
) -> None:
    WorkbenchTaskService(project_root).create({"task_id": "task_runner_canvas", "title": "Task"})

    response = client.post(
        "/api/runner/jobs",
        json={
            "graph": _runner_graph("runner_submit_flow"),
            "job_id": "job_runner_task_submit",
            "run_id": "runner_task_submit_run",
            "task_id": "task_runner_canvas",
            "workspace_alias": "default",
        },
    )

    assert response.status_code == 200, response.text
    task = client.get("/api/workbench/tasks/task_runner_canvas")
    assert task.status_code == 200, task.text
    assert task.json()["active_run_id"] is None
    assert task.json()["latest_run_id"] == "runner_task_submit_run"


def test_runner_projection_does_not_expose_absolute_paths(
    client: TestClient,
    project_root: Path,
) -> None:
    response = client.get("/api/runner/runs/server_run/projection")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["schema_version"] == "acc.runner.run_projection.v1"
    assert payload["run_id"] == "server_run"
    assert payload["nodes"][0]["artifact_ref"] == "artifact:v1:server_run:node:server_node:."
    assert payload["nodes"][0]["legacy_artifact_ref"] == "run:server_run:node:server_node:artifacts"
    assert "run_dir" not in response.text
    assert str(project_root) not in response.text


def test_runner_artifact_preview_requires_registered_artifact_ref(
    client: TestClient,
    project_root: Path,
) -> None:
    artifact_id = artifact_id_for_project_path("run:server_run:artifact:report.md")

    response = client.get(f"/api/runner/artifacts/{artifact_id}/preview")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["artifact_ref"] == "run:server_run:artifact:report.md"
    assert payload["name"] == "report.md"
    assert str(project_root) not in response.text


def test_runner_artifact_preview_accepts_versioned_artifact_ref(
    client: TestClient,
    project_root: Path,
) -> None:
    artifact_id = artifact_id_for_project_path("artifact:v1:server_run:run:report.md")

    response = client.get(f"/api/runner/artifacts/{artifact_id}/preview")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["artifact_ref"] == "artifact:v1:server_run:run:report.md"
    assert payload["name"] == "report.md"
    assert str(project_root) not in response.text
    audit_log = (project_root / ".acc" / "audit" / "events.jsonl").read_text(encoding="utf-8")
    assert "artifact.preview" in audit_log


def test_runner_artifact_preview_rejects_raw_project_path(client: TestClient) -> None:
    artifact_id = artifact_id_for_project_path("runs/server_run/artifacts/report.md")

    response = client.get(f"/api/runner/artifacts/{artifact_id}/preview")

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "artifact_policy_denied"


def test_legacy_submit_workspace_alias_rejects_before_run_evidence(
    client: TestClient,
    project_root: Path,
) -> None:
    response = client.post(
        "/api/workflows/run-graph/submit",
        json={
            "graph": _runner_graph("missing_workspace_alias_flow"),
            "run_id": "missing_workspace_alias_run",
            "workspace_alias": "missing",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "workspace_unbound"
    assert not (project_root / "runs" / "missing_workspace_alias_run").exists()


def write_yaml(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")
