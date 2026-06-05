from __future__ import annotations

import pytest

from acc.app.workflow_normalization import normalize_workflow_payload_contracts
from acc.domain import AccError


def _workflow_with_main_data_edge() -> dict:
    return {
        "schema_version": "acc.core.v2",
        "id": "flow",
        "version": "0.1.0",
        "nodes": [
            {"id": "source", "callable_ref": {"kind": "agent_class", "id": "source.codex"}},
            {"id": "target", "callable_ref": {"kind": "agent_class", "id": "target.codex"}},
        ],
        "control_edges": [],
        "data_edges": [
            {
                "source": {"node": "source", "port": "main"},
                "target": {"node": "target", "port": "main"},
                "materialization": "copy",
            }
        ],
    }


def test_main_to_main_data_edge_normalization_removes_edge_and_adds_control() -> None:
    payload, summary = normalize_workflow_payload_contracts(_workflow_with_main_data_edge())

    assert payload["data_edges"] == []
    assert payload["control_edges"] == [{"from": "source", "to": "target", "context": "none"}]
    assert payload["nodes"][0]["control"]["forward_main_output_on_control"] is True
    assert summary.removed_main_data_edges == 1
    assert summary.added_control_edges == 1
    assert summary.conflicts == []


def test_main_data_edge_normalization_detects_mixed_fanout_without_force() -> None:
    workflow = _workflow_with_main_data_edge()
    workflow["control_edges"] = [
        {"from": "source", "to": "target", "context": "none"},
        {"from": "source", "to": "other", "context": "none"},
    ]
    workflow["nodes"].append(
        {"id": "other", "callable_ref": {"kind": "agent_class", "id": "other.codex"}}
    )

    with pytest.raises(AccError, match="normalization has conflicts"):
        normalize_workflow_payload_contracts(workflow)


def test_main_data_edge_normalization_force_accepts_mixed_fanout() -> None:
    workflow = _workflow_with_main_data_edge()
    workflow["control_edges"] = [
        {"from": "source", "to": "target", "context": "none"},
        {"from": "source", "to": "other", "context": "none"},
    ]
    workflow["nodes"].append(
        {"id": "other", "callable_ref": {"kind": "agent_class", "id": "other.codex"}}
    )

    payload, summary = normalize_workflow_payload_contracts(workflow, force=True)

    assert payload["data_edges"] == []
    assert payload["nodes"][0]["control"]["forward_main_output_on_control"] is True
    assert summary.conflicts[0]["code"] == "main_forwarding_broadened_risk"
