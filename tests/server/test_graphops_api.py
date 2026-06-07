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


def test_graphops_v3_proposal_create_dry_run_approve_apply(client, project_root: Path) -> None:
    proposal = v3_transaction()
    create_response = client.post("/api/graphops/proposals", json={"proposal": proposal})
    assert create_response.status_code == 200, create_response.text
    assert create_response.json()["status"] == "drafted"
    assert (
        project_root / "runs" / "_graphops_proposals" / "graphops_tx_api" / "proposal.json"
    ).exists()

    validate_response = client.post("/api/graphops/proposals/graphops_tx_api/validate")
    assert validate_response.status_code == 200, validate_response.text
    assert validate_response.json()["status"] == "valid"

    dry_run_response = client.post("/api/graphops/proposals/graphops_tx_api/dry-run")
    assert dry_run_response.status_code == 200, dry_run_response.text
    dry_run = dry_run_response.json()
    assert dry_run["status"] == "dry_run_ready"
    assert dry_run["mutated"] is False
    assert not (project_root / "callables" / "agents" / "api-reviewer.codex.yaml").exists()

    apply_without_approval = client.post("/api/graphops/proposals/graphops_tx_api/apply")
    assert apply_without_approval.status_code == 400

    approve_response = client.post(
        "/api/graphops/proposals/graphops_tx_api/approve",
        json={
            "proposal_id": "graphops_tx_api",
            "target_paths": dry_run["target_paths"],
            "base_hashes": {
                "callables/agents/api-reviewer.codex.yaml": "absent",
                "workflows/api-research.accflow.json": "absent",
            },
            "dry_run_digest": dry_run["dry_run_digest"],
            "approver": "tester",
        },
    )
    assert approve_response.status_code == 200, approve_response.text
    assert approve_response.json()["status"] == "approved"

    apply_response = client.post("/api/graphops/proposals/graphops_tx_api/apply")
    assert apply_response.status_code == 200, apply_response.text
    assert apply_response.json()["status"] == "applied"
    assert apply_response.json()["targets"][0]["created_hash"].startswith("sha256:")
    assert (project_root / "callables" / "agents" / "api-reviewer.codex.yaml").exists()
    assert (project_root / "workflows" / "api-research.accflow.json").exists()


def test_graphops_v3_reject_blocks_apply(client) -> None:
    create_response = client.post("/api/graphops/proposals", json={"proposal": v3_transaction()})
    assert create_response.status_code == 200, create_response.text

    reject_response = client.post(
        "/api/graphops/proposals/graphops_tx_api/reject",
        json={"reason": "not needed"},
    )
    assert reject_response.status_code == 200, reject_response.text
    assert reject_response.json()["status"] == "rejected"

    apply_response = client.post("/api/graphops/proposals/graphops_tx_api/apply")
    assert apply_response.status_code == 400


def test_graphops_v3_create_rejects_invalid_transaction(client) -> None:
    proposal = v3_transaction()
    proposal["targets"][0]["operation"] = "create_workflow"

    response = client.post("/api/graphops/proposals", json={"proposal": proposal})

    assert response.status_code == 400
    assert "operation_target_mismatch" in response.json()["detail"]


def v3_transaction() -> dict:
    return {
        "schema_version": "acc.graphops.transaction.v1",
        "proposal_id": "graphops_tx_api",
        "author": "authoring-agent.codex",
        "source": {"kind": "authoring_session", "id": "authoring_api"},
        "base": {
            "content_hashes": {
                "callables/agents/api-reviewer.codex.yaml": "absent",
                "workflows/api-research.accflow.json": "absent",
            }
        },
        "rationale": "Create an API reviewer agent and workflow.",
        "targets": [
            {
                "target_type": "agent_class",
                "target_path": "callables/agents/api-reviewer.codex.yaml",
                "operation": "create_agent_class",
                "template": {
                    "id": "api-reviewer.codex",
                    "runtime": "codex_cli",
                    "default_prompt": "Review API output.",
                    "input_ports": {"main": {"type": "artifact", "required": False}},
                    "output_ports": {"main": {"type": "artifact", "required": True}},
                },
            },
            {
                "target_type": "workflow",
                "target_path": "workflows/api-research.accflow.json",
                "operation": "create_workflow",
                "template": {
                    "schema_version": "acc.core.v2",
                    "id": "api-research",
                    "version": "0.1.0",
                    "nodes": [
                        {
                            "id": "review",
                            "callable_ref": {
                                "kind": "agent_class",
                                "id": "api-reviewer.codex",
                            },
                            "input_bindings": [
                                {"target_port": "main", "static_value": "review"}
                            ],
                        }
                    ],
                    "control_edges": [],
                    "data_edges": [],
                },
            },
        ],
    }
