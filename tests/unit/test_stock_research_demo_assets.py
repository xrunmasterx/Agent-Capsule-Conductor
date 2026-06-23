from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

from acc.app.core_v2_loader import load_workflow_function_template
from acc.engine import compile_execution_plan

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEMO_PATH = PROJECT_ROOT / "web" / "src" / "workbench" / "model" / "workspaceDemoCanvas.data.json"
WORKFLOWS_DIR = PROJECT_ROOT / "workflows"

COMPACT_SOURCE_PORTS = {
    "evidence_pack",
    "blocking_gaps",
    "data_gaps",
    "quality_gate",
    "handoff_summary",
}
REGISTRY_PORTS = {
    "source_register",
    "metric_register",
    "claim_register",
    "data_gap_register",
    "conflict_register",
    "registry_bundle",
}


def test_workspace_demo_uses_evidence_pack_first_stock_research_backbone() -> None:
    canvas = json.loads(DEMO_PATH.read_text(encoding="utf-8"))

    workflow_ids = [workflow["id"] for workflow in canvas["workflows"]]
    assert workflow_ids == [
        "Research_Brief_Agent",
        "Source_Data_Workflow",
        "Coverage_Model_Workflow",
        "Fundamentals_Workflow",
        "Valuation_Workflow",
        "Risk_Catalyst_Workflow",
        "Report_Workflow",
        "Final_Review_Agent",
    ]
    assert "Market_Context_Agent" not in workflow_ids
    assert "Target_Profile_Agent" not in workflow_ids

    data_edges = canvas_data_edges(canvas)
    assert (
        "Source_Data_Workflow",
        "evidence_pack",
        "Coverage_Model_Workflow",
        "evidence_pack",
    ) in data_edges
    assert (
        "Source_Data_Workflow",
        "blocking_gaps",
        "Coverage_Model_Workflow",
        "blocking_gaps",
    ) in data_edges
    assert (
        "Coverage_Model_Workflow",
        "model_input_pack",
        "Fundamentals_Workflow",
        "model_input_pack",
    ) in data_edges
    assert (
        "Coverage_Model_Workflow",
        "coverage_scorecard",
        "Valuation_Workflow",
        "coverage_scorecard",
    ) in data_edges
    assert (
        "Coverage_Model_Workflow",
        "evidence_pack",
        "Risk_Catalyst_Workflow",
        "evidence_pack",
    ) in data_edges
    assert (
        "Valuation_Workflow",
        "price_guidance",
        "Report_Workflow",
        "price_guidance",
    ) in data_edges
    assert (
        "Report_Workflow",
        "claim_to_evidence_map",
        "Final_Review_Agent",
        "claim_to_evidence_map",
    ) in data_edges

    noisy_source_edges = [
        edge
        for edge in data_edges
        if edge[0] == "Source_Data_Workflow"
        and edge[1]
        in {
            "source_register",
            "metric_register",
            "claim_register",
            "data_gap_register",
            "conflict_register",
            "registry_bundle",
            "verified_data_pack",
        }
    ]
    assert noisy_source_edges == []


def test_source_and_coverage_layers_use_compact_high_quality_contract() -> None:
    canvas = json.loads(DEMO_PATH.read_text(encoding="utf-8"))
    workflows = {workflow["id"]: workflow for workflow in canvas["workflows"]}

    source_outputs = port_ids(workflows["Source_Data_Workflow"], "outputPorts")
    assert COMPACT_SOURCE_PORTS.issubset(source_outputs)
    assert REGISTRY_PORTS.isdisjoint(source_outputs)
    assert "verified_data_pack" not in source_outputs

    source_nodes = {
        node["id"]: node for node in workflows["Source_Data_Workflow"]["internalNodes"]
    }
    collector_ids = {
        "company_disclosure_agent",
        "market_data_agent",
        "news_policy_agent",
        "peer_competition_agent",
    }
    for node_id in collector_ids:
        node_outputs = port_ids(source_nodes[node_id], "outputPorts")
        assert COMPACT_SOURCE_PORTS.issubset(node_outputs), node_id
        assert REGISTRY_PORTS.isdisjoint(node_outputs), node_id

    coverage = workflows["Coverage_Model_Workflow"]
    assert {
        "coverage_scorecard",
        "model_input_pack",
        "blocking_gaps",
        "evidence_pack",
    }.issubset(port_ids(coverage, "outputPorts"))
    coverage_node_ids = {node["id"] for node in coverage["internalNodes"]}
    assert coverage_node_ids == {"coverage_gate_agent", "model_input_builder_agent"}


def test_domain_workflows_use_evidence_model_and_price_guidance_ports() -> None:
    canvas = json.loads(DEMO_PATH.read_text(encoding="utf-8"))
    workflows = {workflow["id"]: workflow for workflow in canvas["workflows"]}

    assert {"evidence_pack", "model_input_pack", "coverage_scorecard"}.issubset(
        port_ids(workflows["Fundamentals_Workflow"], "inputPorts")
    )
    assert {
        "financial_quality_scorecard",
        "segment_economics_table",
        "competitive_position_matrix",
    }.issubset(port_ids(workflows["Fundamentals_Workflow"], "outputPorts"))

    valuation_nodes = {
        node["id"] for node in workflows["Valuation_Workflow"]["internalNodes"]
    }
    assert valuation_nodes == {
        "operating_forecast_agent",
        "comparable_valuation_agent",
        "dcf_sotp_valuation_agent",
        "scenario_sensitivity_agent",
        "valuation_synthesis_agent",
    }
    assert {"valuation_model", "fair_value_range", "price_guidance"}.issubset(
        port_ids(workflows["Valuation_Workflow"], "outputPorts")
    )

    assert {
        "risk_matrix",
        "catalyst_calendar",
        "monitoring_triggers",
        "watchlist_verified",
        "watchlist_unverified",
    }.issubset(port_ids(workflows["Risk_Catalyst_Workflow"], "outputPorts"))
    assert {
        "investment_thesis",
        "report",
        "decision_summary",
        "appendix",
        "claim_to_evidence_map",
    }.issubset(port_ids(workflows["Report_Workflow"], "outputPorts"))


def test_canonical_workflows_compile_and_expose_evidence_pack_first_outputs() -> None:
    root = load_workflow_function_template(
        WORKFLOWS_DIR / "core_v2_stock_research_canvas.accflow.json"
    )
    compile_execution_plan(root)

    assert set(root.node_invocations) == {
        "Research_Brief_Agent",
        "Source_Data_Workflow",
        "Coverage_Model_Workflow",
        "Fundamentals_Workflow",
        "Valuation_Workflow",
        "Risk_Catalyst_Workflow",
        "Report_Workflow",
        "Final_Review_Agent",
    }
    assert {
        "evidence_pack",
        "model_input_pack",
        "coverage_scorecard",
        "price_guidance",
        "claim_to_evidence_map",
    }.issubset(set(root.exposed_outputs))

    root_edges = template_data_edges(root)
    assert (
        "Source_Data_Workflow",
        "evidence_pack",
        "Coverage_Model_Workflow",
        "evidence_pack",
    ) in root_edges
    assert (
        "Source_Data_Workflow",
        "registry_bundle",
        "Coverage_Model_Workflow",
        "registry_bundle",
    ) not in root_edges
    assert (
        "Valuation_Workflow",
        "price_guidance",
        "Report_Workflow",
        "price_guidance",
    ) in root_edges

    for path in sorted(WORKFLOWS_DIR.glob("core_v2_stock_research_canvas*.accflow.json")):
        template = load_workflow_function_template(path)
        compile_execution_plan(template)


def test_stock_demo_and_canonical_workflows_have_no_dangling_ports() -> None:
    canvas = json.loads(DEMO_PATH.read_text(encoding="utf-8"))
    assert_canvas_edges_have_declared_ports(canvas)

    for path in sorted(WORKFLOWS_DIR.glob("core_v2_stock_research_canvas*.accflow.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert_canonical_edges_have_declared_ports(payload, path.name)


def test_stock_callables_contract_outputs_compact_traceable_evidence_pack() -> None:
    callable_ids = [
        "stock-data-collector.codex",
        "stock-research-analyst.codex",
        "stock-research-synthesis.codex",
        "stock-report-writer.codex",
        "stock-publication-reviewer.codex",
    ]

    for callable_id in callable_ids:
        payload = yaml.safe_load(
            (PROJECT_ROOT / "callables" / "agents" / f"{callable_id}.yaml").read_text(
                encoding="utf-8"
            )
        )
        schema = payload["artifact_contract"]["output_schema"]
        properties = schema["properties"]
        output_properties = properties["outputs"]["properties"]

        assert "partial" in properties["status"]["enum"], callable_id
        assert {"data_gaps", "quality", "quality_gate", "outputs"}.issubset(
            set(schema["required"])
        ), callable_id
        assert "outputs.<port_name>" in payload["default_prompt"], callable_id
        assert "source_id" in payload["default_prompt"], callable_id
        assert "metric_id" in payload["default_prompt"], callable_id
        assert "claim_id" in payload["default_prompt"], callable_id
        assert "evidence_pack" in payload["default_prompt"], callable_id
        assert "blocking_gaps" in output_properties, callable_id
        assert "evidence_pack" in output_properties, callable_id

        assert schema_evidence_pack_requires_bound_items(schema), callable_id
        assert output_properties, callable_id


def test_stock_demo_evidence_pack_schema_rejects_unbound_claims() -> None:
    canvas = json.loads(DEMO_PATH.read_text(encoding="utf-8"))
    source_workflow = next(
        workflow for workflow in canvas["workflows"] if workflow["id"] == "Source_Data_Workflow"
    )
    collector = next(
        node
        for node in source_workflow["internalNodes"]
        if node["id"] == "company_disclosure_agent"
    )
    schema = collector["outputSchema"]

    invalid_payload = stock_schema_payload(claim={"claim_id": "clm:company:revenue:1"})
    valid_payload = stock_schema_payload(
        claim={
            "claim_id": "clm:company:revenue:1",
            "statement": "Revenue grew in FY2025.",
            "source_ids": ["src:company:annual_report_2025"],
            "metric_ids": ["met:company:revenue:2025"],
        }
    )

    validator = Draft202012Validator(schema)
    assert list(validator.iter_errors(valid_payload)) == []
    assert any(
        "source_ids" in error.message or "metric_ids" in error.message
        for error in validator.iter_errors(invalid_payload)
    )


def canvas_data_edges(canvas: dict[str, Any]) -> set[tuple[str, str, str, str]]:
    return {
        (
            edge["source"]["workflowId"],
            edge["source"]["portId"],
            edge["target"]["workflowId"],
            edge["target"]["portId"],
        )
        for edge in canvas["edges"]
        if edge["kind"] == "data"
    }


def template_data_edges(template: Any) -> set[tuple[str, str, str, str]]:
    return {
        (edge.source.node, edge.source.port, edge.target.node, edge.target.port)
        for edge in template.data_edges
    }


def port_ids(owner: dict[str, Any], key: str) -> set[str]:
    return {port["id"] for port in owner[key]}


def schema_evidence_pack_requires_bound_items(schema: dict[str, Any]) -> bool:
    evidence_pack = schema["properties"].get("evidence_pack")
    if not isinstance(evidence_pack, dict):
        return False
    properties = evidence_pack.get("properties")
    if not isinstance(properties, dict):
        return False
    claims = properties.get("claims")
    metrics = properties.get("metrics")
    sources = properties.get("sources")
    if not all(isinstance(value, dict) for value in (claims, metrics, sources)):
        return False
    claim_required = claims["items"].get("required", [])
    metric_required = metrics["items"].get("required", [])
    source_required = sources["items"].get("required", [])
    return (
        {"claim_id", "statement", "source_ids", "metric_ids"}.issubset(claim_required)
        and {"metric_id", "name", "period", "value", "unit", "source_ids"}.issubset(
            metric_required
        )
        and {"source_id", "title", "url", "source_type"}.issubset(source_required)
    )


def stock_schema_payload(
    *,
    claim: dict,
) -> dict[str, Any]:
    evidence_pack = {
        "sources": [
            {
                "source_id": "src:company:annual_report_2025",
                "title": "Annual report",
                "url": "https://example.com/annual-report.pdf",
                "source_type": "company_filing",
            }
        ],
        "metrics": [
            {
                "metric_id": "met:company:revenue:2025",
                "name": "Revenue",
                "period": "FY2025",
                "value": 100,
                "unit": "million",
                "currency": "HKD",
                "source_ids": ["src:company:annual_report_2025"],
            }
        ],
        "claims": [claim],
    }
    outputs = {
        "handoff_summary": {},
        "evidence_pack": evidence_pack,
        "blocking_gaps": [],
        "data_gaps": [],
        "quality_gate": {},
    }
    return {
        "status": "success",
        "summary": "summary",
        "as_of_date": "2026-06-21",
        "handoff_summary": {},
        "evidence_pack": evidence_pack,
        "blocking_gaps": [],
        "data_gaps": [],
        "quality_gate": {},
        "quality": {},
        "outputs": outputs,
    }


def assert_canvas_edges_have_declared_ports(canvas: dict[str, Any]) -> None:
    workflows = {workflow["id"]: workflow for workflow in canvas["workflows"]}
    for edge in canvas["edges"]:
        if edge["kind"] != "data":
            continue
        source = edge["source"]
        target = edge["target"]
        assert source["workflowId"] in workflows
        assert target["workflowId"] in workflows
        assert source["portId"] in port_ids(workflows[source["workflowId"]], "outputPorts")
        assert target["portId"] in port_ids(workflows[target["workflowId"]], "inputPorts")

    for workflow in canvas["workflows"]:
        node_by_id = {node["id"]: node for node in workflow.get("internalNodes", [])}
        input_boundary = f"{workflow['id']}__workflow_inputs"
        output_boundary = f"{workflow['id']}__workflow_outputs"
        workflow_inputs = port_ids(workflow, "inputPorts")
        workflow_outputs = port_ids(workflow, "outputPorts")
        for edge in workflow.get("internalEdges", []):
            if edge["kind"] != "data":
                continue
            source = edge["source"]
            target = edge["target"]
            if source["workflowId"] == input_boundary:
                assert source["portId"] in workflow_inputs
            else:
                assert source["portId"] in port_ids(node_by_id[source["workflowId"]], "outputPorts")
            if target["workflowId"] == output_boundary:
                assert target["portId"] in workflow_outputs
            else:
                assert target["portId"] in port_ids(node_by_id[target["workflowId"]], "inputPorts")


def assert_canonical_edges_have_declared_ports(payload: dict[str, Any], name: str) -> None:
    nodes = {node["id"]: node for node in payload["nodes"]}
    workflow_inputs = set(payload.get("exposed_inputs") or {})
    workflow_outputs = set(payload.get("exposed_outputs") or {})

    for edge in payload.get("data_edges", []):
        assert edge["source"]["node"] in nodes, f"{name}: {edge}"
        assert edge["target"]["node"] in nodes, f"{name}: {edge}"
        assert edge["source"]["port"] in nodes[edge["source"]["node"]]["ports"]["outputs"], (
            name,
            edge,
        )
        assert edge["target"]["port"] in nodes[edge["target"]["node"]]["ports"]["inputs"], (
            name,
            edge,
        )

    for binding in payload.get("workflow_input_bindings", []):
        assert binding["source_port"] in workflow_inputs, (name, binding)
        target = binding["target"]
        assert target["node"] in nodes, (name, binding)
        assert target["port"] in nodes[target["node"]]["ports"]["inputs"], (name, binding)

    for binding in payload.get("workflow_output_bindings", []):
        assert binding["target_port"] in workflow_outputs, (name, binding)
        source = binding["source"]
        assert source["node"] in nodes, (name, binding)
        assert source["port"] in nodes[source["node"]]["ports"]["outputs"], (name, binding)

    for node_value in nodes.values():
        for binding in node_value.get("workflow_call_output_bindings", []):
            assert binding["workflow_output"], (name, node_value["id"], binding)
            assert binding["parent_port"] in node_value["ports"]["outputs"], (
                name,
                node_value["id"],
                binding,
            )
