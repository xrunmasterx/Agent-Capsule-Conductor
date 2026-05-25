from __future__ import annotations

import json
import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from acc.server.app import create_app
from acc.utils import load_json


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
    assert payload["prompt_template"] == "prompt_template.md"


def test_get_workflow_capsule_metadata_without_prompt(client, project_root: Path) -> None:
    capsule_dir = project_root / "capsules" / "nested-flow.generic"
    capsule_dir.mkdir(parents=True)
    (capsule_dir / "workflow.graph.json").write_text(
        json.dumps(
            {
                "id": "nested_flow_graph",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "echo",
                        "capsule_id": "echo-test.generic",
                        "input": {"message": "nested hello"},
                    }
                ],
                "edges": [],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (capsule_dir / "input_schema.json").write_text(
        json.dumps({"type": "object", "properties": {}, "additionalProperties": True}, indent=2),
        encoding="utf-8",
    )
    (capsule_dir / "output_schema.json").write_text(
        json.dumps({"type": "object", "properties": {}, "additionalProperties": True}, indent=2),
        encoding="utf-8",
    )
    (capsule_dir / "artifact_manifest.yaml").write_text(
        "version: '2.0'\nrequired: []\n",
        encoding="utf-8",
    )
    (capsule_dir / "capsule.yaml").write_text(
        "\n".join(
            [
                "id: nested-flow.generic",
                "version: '0.1.0'",
                "name: Nested Flow",
                "description: Workflow capsule without prompt template.",
                "kind: acc_workflow",
                "runtime:",
                "  type: acc_workflow",
                "workflow:",
                "  type: acc_graph",
                "  path: workflow.graph.json",
                "workspace:",
                "  mode: existing_dir",
                "permissions:",
                "  sandbox: read-only",
                "  network: false",
                "  write_files: true",
                "  timeout_seconds: 30",
                "  allow_dangerous: false",
                "schema:",
                "  input: input_schema.json",
                "  output: output_schema.json",
                "artifacts:",
                "  manifest: artifact_manifest.yaml",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    response = client.get("/api/capsules/nested-flow.generic")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["id"] == "nested-flow.generic"
    assert payload["kind"] == "acc_workflow"
    assert payload["prompt_template"] is None
    assert payload["workflow"] == {"type": "acc_graph", "path": "workflow.graph.json"}


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


def test_list_capsules_uses_configured_capsules_dir(project_root, monkeypatch) -> None:
    shutil.copytree(project_root / "capsules", project_root / "example_capsules")
    shutil.rmtree(project_root / "capsules")
    monkeypatch.setenv("ACC_CAPSULES_DIR", "example_capsules")
    custom_client = TestClient(create_app(project_root))

    response = custom_client.get("/api/capsules")

    assert response.status_code == 200
    assert response.json()["capsules"][0]["id"] == "echo-test.generic"


def test_capsule_scaffold_endpoint_creates_capsule(client, project_root) -> None:
    blueprint = load_json(Path("examples/blueprints/simple_research_capsule.json"))

    response = client.post(
        "/api/capsules/scaffold",
        json={"blueprint": blueprint, "force": True},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "scaffolded"
    assert (project_root / "capsules" / "demo-research.generic" / "capsule.yaml").exists()
    assert not (project_root / ".acc_scaffold_blueprint.tmp.json").exists()


def test_capsule_scaffold_endpoint_rejects_ambiguous_blueprint_source(client) -> None:
    blueprint = load_json(Path("examples/blueprints/simple_research_capsule.json"))

    response = client.post(
        "/api/capsules/scaffold",
        json={
            "blueprint": blueprint,
            "blueprint_path": "examples/blueprints/simple_research_capsule.json",
        },
    )

    assert response.status_code == 400
    assert "blueprint or blueprint_path" in response.json()["detail"]


def test_capsule_file_read_and_write(client) -> None:
    read_response = client.get("/api/capsules/echo-test.generic/files/prompt_template.md")

    assert read_response.status_code == 200
    content = read_response.json()["content"] + "\n# edited\n"
    write_response = client.put(
        "/api/capsules/echo-test.generic/files/prompt_template.md",
        json={"content": content},
    )

    assert write_response.status_code == 200
    assert write_response.json()["status"] == "saved"
    reread_response = client.get("/api/capsules/echo-test.generic/files/prompt_template.md")
    assert "# edited" in reread_response.json()["content"]


def test_capsule_file_path_traversal_is_rejected(client) -> None:
    response = client.get("/api/capsules/echo-test.generic/files/%2E%2E/capsule.yaml")

    assert response.status_code == 400


def test_delete_capsule_removes_capsule_directory(client, project_root) -> None:
    response = client.delete("/api/capsules/echo-test.generic")

    assert response.status_code == 200
    assert response.json()["status"] == "deleted"
    assert not (project_root / "capsules" / "echo-test.generic").exists()


def test_delete_capsule_rejects_workflow_references_by_default(client, project_root) -> None:
    workflow_path = project_root / "workflows" / "referenced.graph.json"
    workflow_path.write_text(
        json.dumps(
            {
                "id": "referenced",
                "version": "3",
                "nodes": [{"id": "server_node", "capsule_id": "echo-test.generic"}],
                "edges": [],
            }
        ),
        encoding="utf-8",
    )

    response = client.delete("/api/capsules/echo-test.generic")

    assert response.status_code == 409
    assert (project_root / "capsules" / "echo-test.generic").exists()
    detail = response.json()["detail"]
    assert detail["capsule_id"] == "echo-test.generic"
    assert detail["references"][0]["node_id"] == "server_node"


def test_delete_capsule_force_allows_workflow_references(client, project_root) -> None:
    workflow_path = project_root / "workflows" / "referenced.graph.json"
    workflow_path.write_text(
        json.dumps(
            {
                "id": "referenced",
                "version": "3",
                "nodes": [{"id": "server_node", "capsule_id": "echo-test.generic"}],
                "edges": [],
            }
        ),
        encoding="utf-8",
    )

    response = client.delete("/api/capsules/echo-test.generic?force=true")

    assert response.status_code == 200
    assert response.json()["references"][0]["path"] == "workflows/referenced.graph.json"
    assert not (project_root / "capsules" / "echo-test.generic").exists()
