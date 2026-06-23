from __future__ import annotations


def test_workbench_canvas_snapshot_publish_and_get(client, project_root) -> None:
    response = client.post(
        "/api/workbench/canvas-snapshots",
        json={
            "task_id": "task_canvas_default",
            "canvas_hash": "canvas_hash_v1:abc123",
            "canvas_snapshot": {
                "id": "canvas",
                "name": "Canvas",
                "workflows": [{"id": "node_1", "runtime": {"status": "running"}}],
                "edges": [],
            },
            "selection": {"type": "task_canvas"},
            "temporary_resources": {
                "tmp_agent_test": {
                    "draft_id": "tmp_agent_test",
                    "kind": "agent_template",
                    "status": "draft",
                    "agent_draft": {"id": "tmp_agent_test", "runtime": "codex_cli"},
                    "referenced_by": ["tmp_agent_test"],
                }
            },
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["canvas_hash"] == "canvas_hash_v1:abc123"
    assert payload["canvas_snapshot"]["workflows"][0].get("runtime") is None
    assert (
        project_root / ".acc" / "tasks" / "task_canvas_default" / "canvas_snapshot.json"
    ).exists()

    get_response = client.get("/api/workbench/canvas-snapshots/task_canvas_default")

    assert get_response.status_code == 200, get_response.text
    assert (
        get_response.json()["temporary_resources"]["tmp_agent_test"]["draft_id"] == "tmp_agent_test"
    )


def test_workbench_canvas_snapshot_rejects_extra_fields_and_bad_task_id(client) -> None:
    extra_response = client.post(
        "/api/workbench/canvas-snapshots",
        json={
            "task_id": "task_canvas_default",
            "canvas_hash": "canvas_hash_v1:abc123",
            "canvas_snapshot": {"id": "canvas", "workflows": [], "edges": []},
            "unexpected": True,
        },
    )
    assert extra_response.status_code == 422

    bad_id_response = client.post(
        "/api/workbench/canvas-snapshots",
        json={
            "task_id": "../bad",
            "canvas_hash": "canvas_hash_v1:abc123",
            "canvas_snapshot": {"id": "canvas", "workflows": [], "edges": []},
        },
    )
    assert bad_id_response.status_code == 400


def test_workbench_task_create_update_delete_tombstones(client, project_root) -> None:
    created = client.post(
        "/api/workbench/tasks",
        json={"task_id": "task_product", "title": "Product task"},
    )
    assert created.status_code == 200, created.text
    assert created.json()["retention"] == {"pinned": False, "retention_class": "normal"}

    updated = client.put(
        "/api/workbench/tasks/task_product",
        json={"title": "Updated task", "latest_run_id": "run_product"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["title"] == "Updated task"
    assert updated.json()["latest_run_id"] == "run_product"

    deleted = client.delete("/api/workbench/tasks/task_product")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["task"]["deleted_at"]
    assert (project_root / ".acc" / "tasks" / "task_product" / "task.json").exists()

    listed = client.get("/api/workbench/tasks")
    assert listed.status_code == 200
    assert all(task["task_id"] != "task_product" for task in listed.json()["tasks"])


def test_task_canvas_put_strips_runtime_state_and_checks_base_hash(client, project_root) -> None:
    first = client.put(
        "/api/workbench/tasks/task_canvas_default/canvas",
        json={
            "canvas_hash": "hash_a",
            "canvas_snapshot": {
                "id": "task_canvas_default",
                "name": "Canvas",
                "status": "running",
                "provider_session_id": "provider_secret",
                "workflows": [
                    {
                        "id": "workflow",
                        "ui": {
                            "internal_nodes": [{"id": "hidden"}],
                            "safe": {"messages": ["drop me"]},
                        },
                        "runtime": {"status": "running"},
                    }
                ],
                "edges": [],
            },
        },
    )
    assert first.status_code == 200, first.text
    first_payload = first.json()
    assert first_payload["task_id"] == "task_canvas_default"
    assert first_payload["canvas_hash"] == "hash_a"
    assert first_payload["saved_at"]
    assert "canvas_snapshot" not in first_payload
    assert "selection" not in first_payload
    assert "temporary_resources" not in first_payload

    get_response = client.get("/api/workbench/tasks/task_canvas_default/canvas")
    assert get_response.status_code == 200, get_response.text
    canvas = get_response.json()["canvas_snapshot"]
    assert "status" not in canvas
    assert "provider_session_id" not in canvas
    assert "runtime" not in canvas["workflows"][0]
    assert canvas["workflows"][0]["ui"]["internal_nodes"] == [{"id": "hidden"}]
    assert "messages" not in canvas["workflows"][0]["ui"]["safe"]

    stale = client.put(
        "/api/workbench/tasks/task_canvas_default/canvas",
        json={
            "canvas_hash": "hash_b",
            "base_canvas_hash": "hash_old",
            "canvas_snapshot": {
                "id": "task_canvas_default",
                "name": "Canvas",
                "workflows": [],
                "edges": [],
            },
        },
    )
    assert stale.status_code == 409

    next_response = client.put(
        "/api/workbench/tasks/task_canvas_default/canvas",
        headers={"If-Match": '"hash_a"'},
        json={
            "canvas_hash": "hash_b",
            "canvas_snapshot": {
                "id": "task_canvas_default",
                "name": "Canvas",
                "workflows": [],
                "edges": [],
            },
        },
    )
    assert next_response.status_code == 200, next_response.text
    assert "canvas_snapshot" not in next_response.json()

    full_response = client.put(
        "/api/workbench/tasks/task_canvas_default/canvas",
        headers={"If-Match": '"hash_b"'},
        params={"include_snapshot": "1"},
        json={
            "canvas_hash": "hash_c",
            "canvas_snapshot": {
                "id": "task_canvas_default",
                "name": "Canvas",
                "status": "running",
                "workflows": [{"id": "workflow", "runtime": {"status": "running"}}],
                "edges": [],
            },
        },
    )
    assert full_response.status_code == 200, full_response.text
    full_payload = full_response.json()
    assert full_payload["canvas_hash"] == "hash_c"
    assert "canvas_snapshot" in full_payload
    assert "status" not in full_payload["canvas_snapshot"]
    assert "runtime" not in full_payload["canvas_snapshot"]["workflows"][0]


def test_boundary_transfer_preview_expands_container_control_edge(client) -> None:
    response = client.post(
        "/api/workbench/boundary-transfer/preview",
        json={
            "edge_id": "control_input_business_model",
            "canvas_snapshot": {
                "canonical_graph": {
                    "id": "stock_flow",
                    "nodes": [
                        {
                            "id": "Fundamentals_Workflow",
                            "input_ports": [{"id": "target"}, {"id": "context"}],
                            "output_ports": [{"id": "main"}],
                            "ui": {
                                "semantic_kind": "workflow_container",
                                "internal_nodes": [
                                    {
                                        "id": "business_model_agent",
                                        "inputPorts": [{"id": "target"}, {"id": "context"}],
                                        "outputPorts": [{"id": "main"}],
                                    }
                                ],
                                "internal_edges": [
                                    {
                                        "id": "control_input_business_model",
                                        "kind": "control",
                                        "from": "Fundamentals_Workflow__workflow_inputs",
                                        "to": "business_model_agent",
                                    }
                                ],
                            },
                        }
                    ],
                }
            },
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "valid"
    assert payload["canonical_preview"]["runtime_control_edge"] is False
    assert payload["bindings"]["workflow_input_bindings"] == [
        {
            "source_port": "target",
            "target": {"node": "business_model_agent", "port": "target"},
            "materialization": "copy",
            "required": False,
        },
        {
            "source_port": "context",
            "target": {"node": "business_model_agent", "port": "context"},
            "materialization": "copy",
            "required": False,
        },
    ]


def test_boundary_transfer_preview_reports_ambiguous_output(client) -> None:
    response = client.post(
        "/api/workbench/boundary-transfer/preview",
        json={
            "edge_id": "control_writer_output",
            "canvas_snapshot": {
                "canonical_graph": {
                    "id": "stock_flow",
                    "nodes": [
                        {
                            "id": "Fundamentals_Workflow",
                            "input_ports": [{"id": "main"}],
                            "output_ports": [{"id": "report"}, {"id": "evidence_pack"}],
                            "ui": {
                                "semantic_kind": "workflow_container",
                                "internal_nodes": [
                                    {
                                        "id": "writer",
                                        "inputPorts": [{"id": "main"}],
                                        "outputPorts": [{"id": "main"}],
                                    }
                                ],
                                "internal_edges": [
                                    {
                                        "id": "control_writer_output",
                                        "kind": "control",
                                        "from": "writer",
                                        "to": "Fundamentals_Workflow__workflow_outputs",
                                    }
                                ],
                            },
                        }
                    ],
                }
            },
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "invalid"
    assert payload["diagnostics"][0]["code"] == "ambiguous_workflow_output_boundary_control"
    assert payload["bindings"]["workflow_output_bindings"] == []


def test_boundary_transfer_preview_expands_workflow_focus_edges(client) -> None:
    response = client.post(
        "/api/workbench/boundary-transfer/preview",
        json={
            "edge_id": "focus_input_to_agent",
            "canvas_snapshot": {
                "canonical_graph": {
                    "id": "Fundamentals_Workflow",
                    "exposed_inputs": [{"id": "target"}, {"id": "context"}],
                    "exposed_outputs": [{"id": "main"}],
                    "nodes": [
                        {
                            "id": "business_model_agent",
                            "input_ports": [{"id": "target"}, {"id": "context"}],
                            "output_ports": [{"id": "main"}],
                        }
                    ],
                    "metadata": {
                        "layout": "workflow-focus",
                        "workflow_port_edges": [
                            {
                                "id": "focus_input_to_agent",
                                "kind": "control",
                                "from": "Fundamentals_Workflow__workflow_inputs",
                                "to": "business_model_agent",
                            }
                        ],
                    },
                }
            },
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "valid"
    assert [item["source_port"] for item in payload["bindings"]["workflow_input_bindings"]] == [
        "target",
        "context",
    ]
