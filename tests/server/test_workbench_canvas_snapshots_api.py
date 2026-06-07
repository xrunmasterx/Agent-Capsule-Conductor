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
        project_root
        / "runs"
        / "_workbench_canvas_snapshots"
        / "task_canvas_default"
        / "snapshot.json"
    ).exists()

    get_response = client.get("/api/workbench/canvas-snapshots/task_canvas_default")

    assert get_response.status_code == 200, get_response.text
    assert (
        get_response.json()["temporary_resources"]["tmp_agent_test"]["draft_id"]
        == "tmp_agent_test"
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
