from __future__ import annotations

import pytest

from acc.app.workflow_normalization import normalize_workflow_payload_contracts
from acc.callable_registry import CallableAsset, CallableRegistry
from acc.models import AccError, AgentClassTemplate, PortContract


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


def test_main_to_main_data_edge_preserve_explicit_policy_keeps_edge() -> None:
    workflow = _workflow_with_main_data_edge()

    payload, summary = normalize_workflow_payload_contracts(
        workflow,
        main_data_edge_policy="preserve_explicit",
    )

    assert payload["data_edges"] == workflow["data_edges"]
    assert payload["control_edges"] == []
    assert "control" not in payload["nodes"][0]
    assert summary.removed_main_data_edges == 0
    assert summary.added_control_edges == 0
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


def test_normalization_warns_when_control_main_is_suppressed_by_data_edge() -> None:
    workflow = {
        "schema_version": "acc.core.v2",
        "id": "flow",
        "version": "0.1.0",
        "nodes": [
            {"id": "source", "callable_ref": {"kind": "agent_class", "id": "source.codex"}},
            {"id": "target", "callable_ref": {"kind": "agent_class", "id": "target.codex"}},
        ],
        "control_edges": [{"from": "source", "to": "target", "context": "none"}],
        "data_edges": [
            {
                "source": {"node": "source", "port": "detail"},
                "target": {"node": "target", "port": "detail"},
                "materialization": "copy",
            }
        ],
    }

    payload, summary = normalize_workflow_payload_contracts(workflow)

    assert payload["data_edges"] == workflow["data_edges"]
    assert "control" not in payload["nodes"][0]
    assert summary.warnings == [
        {
            "code": "control_main_suppressed_by_data_edge",
            "source": "source",
            "target": "target",
            "suppressed_port": "main",
            "message": (
                "Control edge will only order execution because the same source/target "
                "pair has an explicit data edge"
            ),
        }
    ]


def test_agent_template_output_schema_snapshots_schema_derived_ports() -> None:
    schema = {
        "type": "object",
        "properties": {
            "outputs": {
                "type": "object",
                "required": ["report"],
                "properties": {
                    "report": {
                        "type": "string",
                        "description": "Complete report.",
                    }
                },
            }
        },
    }
    template = AgentClassTemplate(
        id="report.codex",
        version="0.1.0",
        runtime="codex_cli",
        output_ports={
            "stale_report": PortContract(id="stale_report", direction="output"),
        },
        artifact_contract={"output_schema": schema},
    )
    registry = CallableRegistry(
        {
            ("agent_class", "report.codex"): CallableAsset(
                template=template,
                backend="native",
                source_id="report.codex",
            )
        }
    )
    workflow = {
        "schema_version": "acc.core.v2",
        "id": "flow",
        "version": "0.1.0",
        "nodes": [
            {
                "id": "report",
                "callable_ref": {"kind": "agent_class", "id": "report.codex"},
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }

    payload, summary = normalize_workflow_payload_contracts(
        workflow,
        callable_registry=registry,
    )
    node = payload["nodes"][0]

    assert node["output_schema"] == schema
    assert set(node["ports"]["outputs"]) == {"main", "report"}
    assert "stale_report" not in node["ports"]["outputs"]
    assert summary.snapshotted_output_schemas == 1
    assert summary.snapshotted_output_ports == 1
