from __future__ import annotations

import json
from pathlib import Path

import pytest

from acc.graphops import GraphOpsService, validate_transaction
from acc.models import AccError


def valid_transaction() -> dict:
    return {
        "schema_version": "acc.graphops.transaction.v1",
        "proposal_id": "graphops_tx_create",
        "author": "authoring-agent.codex",
        "source": {"kind": "authoring_session", "id": "authoring_1"},
        "base": {
            "content_hashes": {
                "callables/agents/reviewer.codex.yaml": "absent",
                "workflows/research.accflow.json": "absent",
            }
        },
        "rationale": "Create a reviewer agent and workflow.",
        "targets": [
            {
                "target_type": "agent_class",
                "target_path": "callables/agents/reviewer.codex.yaml",
                "operation": "create_agent_class",
                "template": {
                    "id": "reviewer.codex",
                    "runtime": "codex_cli",
                    "default_prompt": "Review the input.",
                    "input_ports": {"main": {"type": "artifact", "required": False}},
                    "output_ports": {"main": {"type": "artifact", "required": True}},
                },
            },
            {
                "target_type": "workflow",
                "target_path": "workflows/research.accflow.json",
                "operation": "create_workflow",
                "template": {
                    "schema_version": "acc.core.v2",
                    "id": "research",
                    "version": "0.1.0",
                    "nodes": [
                        {
                            "id": "review",
                            "callable_ref": {
                                "kind": "agent_class",
                                "id": "reviewer.codex",
                            },
                            "input_bindings": [
                                {"target_port": "main", "static_value": "review this"}
                            ],
                        }
                    ],
                    "control_edges": [],
                    "data_edges": [],
                },
            },
        ],
    }


def test_graphops_v3_valid_create_transaction_dry_run_and_apply(tmp_path: Path) -> None:
    service = GraphOpsService(tmp_path)
    created = service.create_proposal(valid_transaction())

    assert created["status"] == "drafted"
    validation = service.validate("graphops_tx_create")
    assert validation["status"] == "valid"
    dry_run = service.dry_run("graphops_tx_create")
    assert dry_run["status"] == "dry_run_ready"
    assert dry_run["mutated"] is False
    assert not (tmp_path / "callables" / "agents" / "reviewer.codex.yaml").exists()

    with pytest.raises(AccError, match="approved"):
        GraphOpsService(tmp_path).apply("graphops_tx_create")

    approval = service.approve(
        "graphops_tx_create",
        {
            "proposal_id": "graphops_tx_create",
            "target_paths": dry_run["target_paths"],
            "base_hashes": {
                "callables/agents/reviewer.codex.yaml": "absent",
                "workflows/research.accflow.json": "absent",
            },
            "dry_run_digest": dry_run["dry_run_digest"],
            "approver": "tester",
        },
    )
    assert approval["status"] == "approved"
    assert approval["approval_nonce"].startswith("approval_")
    assert approval["runner_id"].startswith("runner_")
    assert approval["workspace_binding_fingerprint"].startswith("sha256:")
    manifest = service.apply("graphops_tx_create")
    assert manifest["status"] == "applied"
    assert manifest["audit"]["before"][0]["digest"] == "absent"
    assert manifest["audit"]["after"][0]["digest"].startswith("sha256:")
    assert manifest["targets"][0]["operation"] in {"create_agent_class", "create_workflow"}
    assert manifest["targets"][0]["created_hash"].startswith("sha256:")
    assert (tmp_path / "callables" / "agents" / "reviewer.codex.yaml").exists()
    audit_log = (tmp_path / ".acc" / "audit" / "events.jsonl").read_text(encoding="utf-8")
    assert "graphops.approve" in audit_log
    assert "graphops.apply" in audit_log
    saved_workflow = json.loads(
        (tmp_path / "workflows" / "research.accflow.json").read_text(encoding="utf-8")
    )
    assert saved_workflow["nodes"][0]["callable_ref"]["id"] == "reviewer.codex"


def test_graphops_v3_rejects_legacy_patch_shape(tmp_path: Path) -> None:
    errors = validate_transaction(
        tmp_path,
        {
            "patch_id": "legacy",
            "target_type": "workflow",
            "target_path": "workflows/demo.accflow.json",
            "operations": [{"op": "connect_nodes"}],
        },
    )

    assert {error["code"] for error in errors} >= {
        "schema_version_invalid",
        "proposal_id_invalid",
        "targets_missing",
    }


def test_graphops_v3_rejects_path_escape_and_forbidden_permissions(tmp_path: Path) -> None:
    proposal = valid_transaction()
    proposal["proposal_id"] = "graphops_tx_bad"
    proposal["targets"][0]["target_path"] = "../callables/agents/reviewer.codex.yaml"
    proposal["targets"][0]["template"]["default_permissions"] = {
        "network": True,
        "dangerous": True,
    }

    errors = validate_transaction(tmp_path, proposal)

    codes = {error["code"] for error in errors}
    assert "path_escape" in codes
    assert "permission_forbidden" in codes


def test_graphops_v3_rejects_operation_target_mismatch_and_extra_fields(
    tmp_path: Path,
) -> None:
    proposal = valid_transaction()
    proposal["extra"] = "not allowed"
    proposal["base"]["content_hashes"]["callables/tools/extra.yaml"] = "absent"
    proposal["targets"][0]["operation"] = "create_workflow"
    proposal["targets"][0]["unexpected"] = True

    errors = validate_transaction(tmp_path, proposal)

    codes = {error["code"] for error in errors}
    assert "unexpected_field" in codes
    assert "base_hash_extra" in codes
    assert "operation_target_mismatch" in codes


def test_graphops_v3_create_rejects_invalid_or_stale_proposal(tmp_path: Path) -> None:
    stale_path = tmp_path / "callables" / "agents" / "reviewer.codex.yaml"
    stale_path.parent.mkdir(parents=True)
    stale_path.write_text("id: reviewer.codex\nruntime: codex_cli\n", encoding="utf-8")

    with pytest.raises(AccError, match="stale_base"):
        GraphOpsService(tmp_path).create_proposal(valid_transaction())

    assert not (tmp_path / "runs" / "_graphops_proposals" / "graphops_tx_create").exists()


def test_graphops_v3_stale_target_blocks_apply_without_mutating(tmp_path: Path) -> None:
    service = GraphOpsService(tmp_path)
    service.create_proposal(valid_transaction())
    dry_run = service.dry_run("graphops_tx_create")
    service.approve(
        "graphops_tx_create",
        {
            "proposal_id": "graphops_tx_create",
            "target_paths": dry_run["target_paths"],
            "base_hashes": {
                "callables/agents/reviewer.codex.yaml": "absent",
                "workflows/research.accflow.json": "absent",
            },
            "dry_run_digest": dry_run["dry_run_digest"],
            "approver": "tester",
        },
    )
    stale_path = tmp_path / "callables" / "agents" / "reviewer.codex.yaml"
    stale_path.parent.mkdir(parents=True)
    stale_path.write_text("id: reviewer.codex\nruntime: codex_cli\n", encoding="utf-8")

    with pytest.raises(AccError, match="already exists"):
        service.apply("graphops_tx_create")

    assert not (tmp_path / "workflows" / "research.accflow.json").exists()


def test_graphops_v3_apply_rejects_tampered_approval_nonce(tmp_path: Path) -> None:
    service = GraphOpsService(tmp_path)
    service.create_proposal(valid_transaction())
    dry_run = service.dry_run("graphops_tx_create")
    service.approve(
        "graphops_tx_create",
        {
            "proposal_id": "graphops_tx_create",
            "target_paths": dry_run["target_paths"],
            "base_hashes": {
                "callables/agents/reviewer.codex.yaml": "absent",
                "workflows/research.accflow.json": "absent",
            },
            "dry_run_digest": dry_run["dry_run_digest"],
            "approver": "tester",
        },
    )
    approval_path = (
        tmp_path / "runs" / "_graphops_proposals" / "graphops_tx_create" / "approval.json"
    )
    approval = json.loads(approval_path.read_text(encoding="utf-8"))
    approval.pop("approval_nonce")
    approval_path.write_text(json.dumps(approval), encoding="utf-8")

    with pytest.raises(AccError, match="nonce"):
        service.apply("graphops_tx_create")

    assert not (tmp_path / "callables" / "agents" / "reviewer.codex.yaml").exists()
