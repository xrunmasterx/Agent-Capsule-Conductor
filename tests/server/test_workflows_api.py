from __future__ import annotations

import asyncio
import json
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


def test_post_workflow_inline_capsule_input_respects_strict_schema(
    client,
    project_root,
) -> None:
    create_strict_report_capsule(project_root)
    graph = simple_graph()
    graph["id"] = "inline_strict_schema_graph"
    graph["nodes"] = [
        {
            "id": "container",
            "capsule_id": "fake-agent.generic",
            "kind": "workflow",
            "input_ports": [{"id": "main", "direction": "input"}],
            "output_ports": [{"id": "main", "direction": "output"}],
            "ui": {
                "semantic_kind": "workflow_container",
                "internal_nodes": [
                    {
                        "id": "strict_a",
                        "kind": "Agent",
                        "name": "Strict A",
                        "runtime": "strict-report.generic",
                        "input": {"topic": "must be removed"},
                    },
                    {
                        "id": "strict_b",
                        "kind": "Agent",
                        "name": "Strict B",
                        "runtime": "strict-report.generic",
                        "input": {"topic": "must be removed"},
                    },
                ],
                "internal_edges": [
                    {"id": "strict_ab", "from": "strict_a", "to": "strict_b"}
                ],
            },
        }
    ]

    response = client.post("/api/workflows", json={"graph": graph, "force": True})

    assert response.status_code == 200, response.text
    child = load_json(
        project_root / "workflows" / "inline_strict_schema_graph__container.accflow.json"
    )
    for node in child["nodes"]:
        assert "topic" not in node["input"]
        assert "upstream_context" not in node["input"]
        assert node["acc_receive_upstream_context"] is False
        assert node["input"]["task"] == "must be removed"
        assert node["input"]["required_report"] == "must be removed"
        assert node["acc_upstream_context_fields"] == ["required_report"]


def test_post_workflow_top_level_capsule_input_respects_strict_schema(
    client,
    project_root,
) -> None:
    create_strict_report_capsule(project_root)
    graph = simple_graph()
    graph["id"] = "top_level_strict_schema_graph"
    graph["nodes"] = [
        {
            "id": "strict_root",
            "capsule_id": "strict-report.generic",
            "kind": "agent_session",
            "input": {"topic": "must be removed"},
        }
    ]

    response = client.post("/api/workflows", json={"graph": graph, "force": True})

    assert response.status_code == 200, response.text
    saved = load_json(project_root / "workflows" / "top_level_strict_schema_graph.graph.json")
    node = saved["nodes"][0]
    assert "topic" not in node["input"]
    assert "upstream_context" not in node["input"]
    assert node["acc_receive_upstream_context"] is False
    assert node["input"]["task"] == "must be removed"
    assert node["input"]["required_report"] == "must be removed"
    assert node["acc_upstream_context_fields"] == ["required_report"]


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
    saved = load_json(project_root / "workflows" / "inline_boundary_graph.graph.json")
    saved_container = saved["nodes"][0]
    assert saved_container["workflow_call_output_bindings"] == [
        {
            "workflow_output": "main",
            "parent_port": "main",
            "required": False,
            "materialization": "copy",
        }
    ]
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


def test_inline_workflow_output_binding_uses_parent_output_port_id(
    client,
    project_root,
) -> None:
    graph = simple_graph()
    graph["id"] = "inline_parent_output_port_graph"
    graph["nodes"] = [
        {
            "id": "container",
            "capsule_id": "fake-agent.generic",
            "kind": "workflow",
            "input_ports": [{"id": "in_main", "direction": "input"}],
            "output_ports": [{"id": "out_main", "direction": "output"}],
            "ui": {
                "semantic_kind": "workflow_container",
                "internal_nodes": [
                    {
                        "id": "inside",
                        "kind": "Agent",
                        "name": "Inside",
                        "runtime": "echo-test.generic",
                        "input": {"message": "inside"},
                    }
                ],
                "internal_edges": [],
            },
        }
    ]

    response = client.post("/api/workflows", json={"graph": graph, "force": True})

    assert response.status_code == 200, response.text
    saved = load_json(project_root / "workflows" / "inline_parent_output_port_graph.graph.json")
    saved_container = saved["nodes"][0]
    assert saved_container["workflow_call_output_bindings"] == [
        {
            "workflow_output": "main",
            "parent_port": "out_main",
            "required": False,
            "materialization": "copy",
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


def test_run_graph_payload_does_not_persist_workflow_template(client, project_root) -> None:
    graph = simple_graph()
    graph["id"] = "runtime_only_graph"

    response = client.post(
        "/api/workflows/run-graph",
        json={"graph": graph, "run_dir": "runs/runtime_only_graph_run"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "success"
    assert not (project_root / "workflows" / "runtime_only_graph.graph.json").exists()
    assert (
        project_root
        / "runs"
        / "_workflow_graph_specs"
        / "runtime_only_graph_run"
        / "runtime_only_graph.graph.json"
    ).exists()


def test_run_graph_response_includes_inline_nested_node_statuses(client) -> None:
    graph = simple_graph()
    graph["id"] = "runtime_inline_status"
    graph["nodes"] = [
        {
            "id": "container",
            "kind": "workflow",
            "capsule_id": "fake-agent.generic",
            "label": "Inline Workflow",
            "input_ports": [{"id": "main", "direction": "input"}],
            "output_ports": [{"id": "main", "direction": "output"}],
            "ui": {
                "semantic_kind": "workflow_container",
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
                "internal_edges": [{"id": "c_ab", "from": "inside_a", "to": "inside_b"}],
            },
        }
    ]
    graph["control_edges"] = []
    graph["data_edges"] = []

    response = client.post(
        "/api/workflows/run-graph",
        json={"graph": graph, "run_dir": "runs/runtime_inline_status_run"},
    )

    assert response.status_code == 200, response.text
    nodes = response.json()["nodes"]
    status_by_ui_id = {
        node.get("ui_node_id", node["node_id"]): node["status"]
        for node in nodes
    }
    assert status_by_ui_id["container"] == "success"
    assert status_by_ui_id["container__internal__inside_a"] == "success"
    assert status_by_ui_id["container__internal__inside_b"] == "success"


def test_run_graph_inline_workflow_timeout_covers_child_capsules(
    project_root,
    monkeypatch,
) -> None:
    capsule_path = project_root / "capsules" / "echo-test.generic" / "capsule.yaml"
    capsule_path.write_text(
        capsule_path.read_text(encoding="utf-8").replace(
            "timeout_seconds: 30",
            "timeout_seconds: 600",
        ),
        encoding="utf-8",
    )
    client = TestClient(create_app(project_root))
    graph = {
        "id": "runtime_inline_timeout",
        "version": "0.4.0",
        "name": "Runtime Inline Timeout",
        "nodes": [
            {
                "id": "inline_workflow",
                "kind": "workflow",
                "capsule_id": "fake-agent.generic",
                "label": "Inline Workflow",
                "input_ports": [{"id": "main", "direction": "input"}],
                "output_ports": [{"id": "main", "direction": "output"}],
                "ui": {
                    "semantic_kind": "workflow_container",
                    "internal_nodes": [
                        {
                            "id": "collector",
                            "kind": "Agent",
                            "capsuleId": "echo-test.generic",
                            "runtime": "echo-test.generic",
                            "input": {"message": "hello"},
                        }
                    ],
                    "internal_edges": [],
                },
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }
    captured = {}

    class FakeWorkflowAppService:
        def __init__(self, registry=None) -> None:
            self.registry = registry

        def validate(self, graph_path):
            payload = load_json(graph_path)
            if "__inline_workflow" in Path(graph_path).name:
                captured["child_graph"] = payload
            return {"status": "valid", "workflow_id": Path(graph_path).stem}

        def run_sync(self, graph_path, run_dir, **kwargs):
            captured["graph"] = load_json(graph_path)
            return {"status": "success", "workflow_id": "runtime_inline_timeout", "nodes": []}

    monkeypatch.setattr(
        "acc.server.routes.workflows.WorkflowAppService",
        FakeWorkflowAppService,
    )

    response = client.post(
        "/api/workflows/run-graph",
        json={"graph": graph, "run_dir": "runs/runtime_inline_timeout_run"},
    )

    assert response.status_code == 200, response.text
    assert captured["graph"]["nodes"][0]["timeout_seconds"] >= 600
    assert captured["child_graph"]["nodes"][0]["timeout_seconds"] == 600


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


def test_submit_run_graph_endpoint_creates_async_run_summary(
    project_root,
    monkeypatch,
) -> None:
    calls = []

    class FakeWorkflowAppService:
        def __init__(self, registry=None) -> None:
            self.registry = registry

        def validate(self, graph_path):
            return {"status": "valid", "workflow_id": Path(graph_path).stem}

        async def run(self, graph_path, run_dir, **kwargs):
            calls.append((Path(graph_path).name, Path(run_dir).name, kwargs.get("input_payload")))
            await asyncio.sleep(0.01)
            return {
                "status": "success",
                "workflow_id": "async_graph",
                "run_id": Path(run_dir).name,
                "run_dir": str(Path(run_dir).resolve()),
                "nodes": [],
                "errors": [],
            }

    monkeypatch.setattr(
        "acc.server.routes.workflows.WorkflowAppService",
        FakeWorkflowAppService,
    )
    custom_client = TestClient(create_app(project_root))
    graph = simple_graph()
    graph["id"] = "async_graph"

    response = custom_client.post(
        "/api/workflows/run-graph/submit",
        json={
            "graph": graph,
            "run_dir": "runs/async_graph_run",
            "task_id": "task_a",
            "input": {"message": "async input"},
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["run_id"] == "async_graph_run"
    assert response.json()["status"] in {"queued", "running"}
    summary_response = custom_client.get("/api/runs/async_graph_run")
    assert summary_response.status_code == 200, summary_response.text
    assert summary_response.json()["status"] in {"queued", "running", "success"}
    assert calls == [("async_graph.graph.json", "async_graph_run", {"message": "async input"})]


def test_submit_run_graph_respects_run_limit_and_cancels_queued_run(
    project_root,
    monkeypatch,
) -> None:
    monkeypatch.setenv("ACC_WORKBENCH_MAX_ACTIVE_RUNS", "1")

    class SlowWorkflowAppService:
        def __init__(self, registry=None) -> None:
            self.registry = registry

        def validate(self, graph_path):
            return {"status": "valid", "workflow_id": Path(graph_path).stem}

        async def run(self, graph_path, run_dir, **kwargs):
            await asyncio.sleep(0.2)
            return {
                "status": "success",
                "workflow_id": Path(graph_path).stem,
                "run_id": Path(run_dir).name,
                "run_dir": str(Path(run_dir).resolve()),
                "nodes": [],
                "errors": [],
            }

    monkeypatch.setattr(
        "acc.server.routes.workflows.WorkflowAppService",
        SlowWorkflowAppService,
    )
    graph = simple_graph()
    graph["id"] = "limited_graph"

    with TestClient(create_app(project_root)) as custom_client:
        first = custom_client.post(
            "/api/workflows/run-graph/submit",
            json={"graph": graph, "run_dir": "runs/limited_graph_run_a"},
        )
        second = custom_client.post(
            "/api/workflows/run-graph/submit",
            json={"graph": graph, "run_dir": "runs/limited_graph_run_b"},
        )
        cancel = custom_client.post("/api/runs/limited_graph_run_b/cancel", json={})

        assert first.status_code == 200, first.text
        assert first.json()["status"] == "running"
        assert second.status_code == 200, second.text
        assert second.json()["status"] == "queued"
        assert cancel.status_code == 200, cancel.text
        assert cancel.json()["status"] == "cancelled"
        summary = custom_client.get("/api/runs/limited_graph_run_b")
        assert summary.status_code == 200, summary.text
        assert summary.json()["status"] == "cancelled"


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


def create_strict_report_capsule(project_root: Path) -> None:
    capsule_dir = project_root / "capsules" / "strict-report.generic"
    capsule_dir.mkdir(parents=True)
    (capsule_dir / "capsule.yaml").write_text(
        "\n".join(
            [
                "id: strict-report.generic",
                "version: 0.1.0",
                "name: Strict Report",
                "description: Strict schema capsule for inline workflow tests.",
                "runtime:",
                "  type: generic_cli",
                "  command: python",
                "  args_base:",
                "    - -c",
                "    - >-",
                "      import json, os, pathlib;",
                "      data=json.load(open(os.environ['ACC_INPUT_PATH'], encoding='utf-8'));",
                "      pathlib.Path(os.environ['ACC_OUTPUT_JSON']).write_text(",
                "      json.dumps({'status':'success',",
                "      'summary':data['required_report']}), encoding='utf-8')",
                "workspace:",
                "  mode: existing_dir",
                "permissions:",
                "  sandbox: read-only",
                "  network: false",
                "  write_files: false",
                "  timeout_seconds: 30",
                "  allow_dangerous: false",
                "prompt:",
                "  template: prompt_template.md",
                "schema:",
                "  input: input_schema.json",
                "  output: output_schema.json",
                "artifacts:",
                "  manifest: artifact_manifest.yaml",
            ]
        ),
        encoding="utf-8",
    )
    (capsule_dir / "prompt_template.md").write_text(
        "Task: {{ input.task }}\nReport: {{ input.required_report }}\n",
        encoding="utf-8",
    )
    (capsule_dir / "input_schema.json").write_text(
        json.dumps(
            {
                "type": "object",
                "required": ["task", "required_report"],
                "properties": {
                    "task": {"type": "string"},
                    "required_report": {"type": "string"},
                },
                "additionalProperties": False,
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    (capsule_dir / "output_schema.json").write_text(
        json.dumps(
            {
                "type": "object",
                "required": ["status", "summary"],
                "properties": {
                    "status": {"type": "string"},
                    "summary": {"type": "string"},
                },
                "additionalProperties": False,
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    (capsule_dir / "artifact_manifest.yaml").write_text(
        "version: '2.0'\nrequired: []\n",
        encoding="utf-8",
    )
