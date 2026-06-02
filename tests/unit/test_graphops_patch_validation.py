from pathlib import Path

import pytest

from acc.graphops import dry_run_patch, validate_patch
from acc.utils import AccError, load_json


def valid_patch() -> dict:
    return {
        "patch_id": "patch_add_review_node",
        "author": "workflow-editor.codex",
        "target_type": "workflow",
        "target_path": "examples/workflows/control_plane_demo.accflow.json",
        "rationale": "Add a reviewer node before final synthesis.",
        "operations": [
            {
                "op": "add_node",
                "node": {
                    "id": "critical_review",
                    "callable_ref": {
                        "kind": "agent_class",
                        "id": "generic_fake_agent",
                    },
                },
            },
            {
                "op": "add_control_edge",
                "edge": {
                    "from": "control_echo",
                    "to": "critical_review",
                },
            },
        ],
    }


def test_valid_add_node_patch_passes() -> None:
    validate_patch(valid_patch())


def test_valid_example_patch_passes() -> None:
    patch = load_json(Path("examples/graphops/add-review-node.patch.json"))

    validate_patch(patch)


def test_forbidden_operation_fails() -> None:
    patch = valid_patch()
    patch["operations"] = [{"op": "remove_human_gate"}]

    with pytest.raises(AccError, match="Forbidden GraphOps operation"):
        validate_patch(patch)


def test_danger_full_access_fails() -> None:
    patch = valid_patch()
    patch["operations"] = [
        {
            "op": "add_node",
            "node": {
                "id": "dangerous",
                "callable_ref": {"kind": "agent_class", "id": "generic_fake_agent"},
                "runtime_policy": {"permission_profile": {"sandbox": "danger-full-access"}},
            },
        }
    ]

    with pytest.raises(AccError, match="danger-full-access"):
        validate_patch(patch)


def test_path_traversal_fails() -> None:
    patch = valid_patch()
    patch["target_path"] = "../workflow.yaml"

    with pytest.raises(AccError, match="escapes repository"):
        validate_patch(patch)


def test_dry_run_reports_target_and_operations() -> None:
    preview = dry_run_patch(valid_patch())

    assert preview["status"] == "dry_run"
    assert preview["mutated"] is False
    assert preview["target_path"] == "examples/workflows/control_plane_demo.accflow.json"
    assert len(preview["operations"]) == 2


def test_output_schema_mutation_is_disabled_by_default() -> None:
    patch = valid_patch()
    patch["target_type"] = "schema"
    patch["target_path"] = "callables/agents/echo-test.generic.output_schema.json"
    patch["operations"] = [{"op": "replace_schema", "schema": {"type": "object"}}]

    with pytest.raises(AccError, match="schema mutations are disabled by default"):
        validate_patch(patch)


def test_workflow_patch_rejects_legacy_graph_target() -> None:
    patch = valid_patch()
    patch["target_path"] = "tests/fixtures/legacy/demo_level_parallel.graph.json"

    with pytest.raises(AccError, match="canonical .accflow.json"):
        validate_patch(patch)


def test_workflow_patch_rejects_legacy_node_fields() -> None:
    patch = valid_patch()
    patch["operations"] = [
        {
            "op": "add_node",
            "node": {
                "id": "legacy_review",
                "capsule_id": "fake-agent.generic",
            },
        }
    ]

    with pytest.raises(AccError, match="legacy field"):
        validate_patch(patch)
