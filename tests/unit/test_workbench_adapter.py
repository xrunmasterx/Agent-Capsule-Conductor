from __future__ import annotations

import json
from pathlib import Path

from acc.app import WorkflowAppService
from acc.app.workbench_adapter import (
    canonicalize_workbench_workflow_payload,
    compile_workbench_workflow_bundle,
)
from acc.callable_registry import CallableRegistry
from acc.engine import parse_workflow_function_template


def stock_workbench_draft() -> dict:
    nodes = [
        _agent_node("market_news", "stock-market-research.codex", "Collect today's market news."),
        _agent_node(
            "market_sentiment",
            "stock-market-research.codex",
            "Collect today's sentiment.",
        ),
        _agent_node("cleaner", "stock-info-cleaner.codex", "Clean and verify sources."),
        _agent_node("analyst", "stock-market-analyst.codex", "Write the final report."),
    ]
    return {
        "id": "stock_report_flow",
        "version": "0.4.0",
        "name": "Stock Report Flow",
        "nodes": nodes,
        "control_edges": [
            {
                "id": "market_news-cleaner",
                "from": "market_news",
                "to": "cleaner",
                "context": "upstream_output",
            },
            {
                "id": "market_sentiment-cleaner",
                "from": "market_sentiment",
                "to": "cleaner",
                "context": "upstream_output",
            },
            {
                "id": "cleaner-analyst",
                "from": "cleaner",
                "to": "analyst",
                "context": "upstream_output",
            },
        ],
        "data_edges": [
            {
                "id": "market_news-main-cleaner-main",
                "from": {"node": "market_news", "port": "main"},
                "to": {"node": "cleaner", "port": "main"},
                "materialization": "symlink",
            }
        ],
        "workspace_policy": {"save_mode": "local_binding"},
        "metadata": {"layout": "workspace-canvas", "root_workflow_id": "stock_report_flow"},
    }


def _agent_node(node_id: str, callable_id: str, prompt: str) -> dict:
    return {
        "id": node_id,
        "kind": "agent_session",
        "label": node_id,
        "callable_ref": {"kind": "agent_class", "id": callable_id},
        "input": {"topic": prompt, "prompt": prompt},
        "input_mapping": {},
        "cwd_policy": "inherit_environment",
        "input_ports": [{"id": "main", "required": False}],
        "output_ports": [{"id": "main", "required": True}],
        "position": {"x": 120, "y": 180},
        "ui": {"collapsed": False},
    }


def test_workbench_draft_canonicalizes_to_core_v2_payload(tmp_path: Path) -> None:
    path = tmp_path / "stock_report_flow.accflow.json"

    payload = canonicalize_workbench_workflow_payload(stock_workbench_draft(), source_path=path)

    assert payload["schema_version"] == "acc.core.v2"
    assert len(payload["nodes"]) == 4
    assert payload["control_edges"][0]["context"] == "none"
    assert payload["data_edges"][0]["materialization"] == "copy"
    forbidden = {"kind", "label", "input", "input_mapping", "position", "ui", "cwd_policy"}
    for node in payload["nodes"]:
        assert forbidden.isdisjoint(node)
        assert "ports" in node
        assert node["prompt_policy"]["user_prompt"]
        assert "prompt" not in node["overrides"]["static_input"]
        assert "topic" not in node["overrides"]["static_input"]
        assert node["metadata"]["ui_label"] == node["metadata"]["label"]

    parse_workflow_function_template(payload, source_path=path)


def test_workbench_draft_saved_payload_validates_with_registry(tmp_path: Path) -> None:
    agents_dir = tmp_path / "callables" / "agents"
    agents_dir.mkdir(parents=True)
    for callable_id in (
        "stock-market-research.codex",
        "stock-info-cleaner.codex",
        "stock-market-analyst.codex",
    ):
        (agents_dir / f"{callable_id}.yaml").write_text(
            f"""
id: {callable_id}
version: 0.1.0
runtime: codex_cli
input_ports:
  main:
    type: artifact
output_ports:
  main:
    type: artifact
""".strip(),
            encoding="utf-8",
        )
    workflows_dir = tmp_path / "workflows"
    workflows_dir.mkdir()
    path = workflows_dir / "stock_report_flow.accflow.json"
    payload = canonicalize_workbench_workflow_payload(stock_workbench_draft(), source_path=path)
    path.write_text(json.dumps(payload), encoding="utf-8")

    result = WorkflowAppService(
        callable_registry=CallableRegistry.from_project_root(tmp_path)
    ).validate(path, workflows_dir=workflows_dir)

    assert result["status"] == "valid"


def test_core_v2_workflow_ref_rewrites_for_runtime_spec_path(tmp_path: Path) -> None:
    project_workflow = tmp_path / "workflows" / "child.accflow.json"
    project_workflow.parent.mkdir()
    project_workflow.write_text("{}", encoding="utf-8")
    runtime_spec = tmp_path / "runs" / "_workflow_function_specs" / "run-1" / "parent.accflow.json"
    payload = {
        "schema_version": "acc.core.v2",
        "id": "parent",
        "version": "0.1.0",
        "nodes": [
            {
                "id": "child_call",
                "callable_ref": {
                    "kind": "workflow_function",
                    "id": str(project_workflow),
                },
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }

    canonical = canonicalize_workbench_workflow_payload(payload, source_path=runtime_spec)

    assert canonical["nodes"][0]["callable_ref"]["id"] == str(project_workflow.resolve())


def test_workbench_container_compiles_to_child_workflow_bundle(tmp_path: Path) -> None:
    path = tmp_path / "workflows" / "stock_info_collection.accflow.json"
    path.parent.mkdir()
    draft = {
        "id": "stock_info_collection",
        "version": "0.4.0",
        "name": "Stock Info Collection",
        "nodes": [
            {
                "id": "New_Workflow",
                "kind": "workflow",
                "label": "New Workflow",
                "callable_ref": {"kind": "workflow_function", "id": "New_Workflow"},
                "input": {"topic": "wrapper"},
                "input_ports": [{"id": "main"}],
                "output_ports": [{"id": "main"}],
                "ui": {
                    "semantic_kind": "workflow_container",
                    "internal_nodes": [
                        {
                            "id": "market_news",
                            "name": "Market News",
                            "task": "Collect today's market news.",
                            "kind": "Agent",
                            "callableId": "stock-market-research.codex",
                            "input": {"prompt": "Collect today's market news."},
                            "inputPorts": [{"id": "main"}],
                            "outputPorts": [{"id": "main"}],
                        },
                        {
                            "id": "market_sentiment",
                            "name": "Market Sentiment",
                            "task": "Collect today's market sentiment.",
                            "kind": "Agent",
                            "callableId": "stock-market-research.codex",
                            "input": {"prompt": "Collect today's market sentiment."},
                            "inputPorts": [{"id": "main"}],
                            "outputPorts": [{"id": "main"}],
                        },
                    ],
                    "internal_edges": [
                        {"id": "news_sentiment", "from": "market_news", "to": "market_sentiment"}
                    ],
                },
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }

    bundle = compile_workbench_workflow_bundle(draft, source_path=path)

    assert set(bundle.children) == {"stock_info_collection__New_Workflow.accflow.json"}
    root_node = bundle.root["nodes"][0]
    assert root_node["callable_ref"] == {
        "kind": "workflow_function",
        "id": "stock_info_collection__New_Workflow.accflow.json",
    }
    assert "ui" not in root_node
    child = bundle.children["stock_info_collection__New_Workflow.accflow.json"]
    assert [node["id"] for node in child["nodes"]] == ["market_news", "market_sentiment"]
    assert child["control_edges"][0]["context"] == "none"
    parse_workflow_function_template(bundle.root, source_path=path)
    parse_workflow_function_template(
        child,
        source_path=path.parent / "stock_info_collection__New_Workflow.accflow.json",
    )
