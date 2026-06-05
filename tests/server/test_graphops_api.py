from __future__ import annotations

import json
from pathlib import Path


def test_graphops_example_validate_and_dry_run(client, project_root: Path) -> None:
    graph_path = project_root / "workflows" / "control_plane_demo.accflow.json"
    graph_path.write_text(
        json.dumps(
            {
                "schema_version": "acc.core.v2",
                "id": "control_plane_demo",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "start",
                        "callable_ref": {"kind": "agent_class", "id": "generic_fake_agent"},
                        "input_bindings": [
                            {"target_port": "message", "static_value": "hello graphops"}
                        ],
                    }
                ],
                "control_edges": [],
                "data_edges": [],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    patch_dir = project_root / "examples" / "graphops"
    patch_dir.mkdir(parents=True)
    patch_path = patch_dir / "add-review-node.patch.json"
    patch_path.write_text(
        json.dumps(
            {
                "patch_id": "patch_add_review_node",
                "author": "browser_e2e",
                "target_type": "workflow",
                "target_path": "workflows/control_plane_demo.accflow.json",
                "rationale": "Add a review node after start.",
                "operations": [
                    {
                        "op": "add_node",
                        "node": {
                            "id": "review",
                            "callable_ref": {
                                "kind": "agent_class",
                                "id": "generic_fake_agent",
                            },
                            "input_bindings": [
                                {"target_port": "message", "static_value": "review"}
                            ],
                        },
                    },
                    {
                        "op": "add_control_edge",
                        "edge": {"from": "start", "to": "review"},
                    },
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    list_response = client.get("/api/graphops/examples")
    assert list_response.status_code == 200
    assert (
        list_response.json()["patches"][0]["path"]
        == "examples/graphops/add-review-node.patch.json"
    )

    validate_response = client.post(
        "/api/graphops/validate",
        json={"patch_path": "examples/graphops/add-review-node.patch.json", "semantic": True},
    )
    assert validate_response.status_code == 200, validate_response.text
    validate_payload = validate_response.json()
    assert validate_payload["status"] == "valid"
    assert validate_payload["apply_requires_human_approval"] is True
    assert validate_payload["apply_status"] == "not_implemented"
    assert validate_payload["dry_run_only"] is True

    dry_run_response = client.post(
        "/api/graphops/dry-run",
        json={"patch_path": "examples/graphops/add-review-node.patch.json", "semantic": True},
    )
    assert dry_run_response.status_code == 200, dry_run_response.text
    dry_run_payload = dry_run_response.json()
    assert dry_run_payload["status"] == "dry_run"
    assert dry_run_payload["mutated"] is False
    assert dry_run_payload["apply_status"] == "not_implemented"

    apply_response = client.post(
        "/api/graphops/apply",
        json={
            "patch_path": "examples/graphops/add-review-node.patch.json",
            "apply": True,
            "human_approved": True,
        },
    )
    assert apply_response.status_code == 400
    assert "not implemented in Option A" in apply_response.json()["detail"]
