from __future__ import annotations

import json
from pathlib import Path

import pytest

from acc.app import WorkflowAppService
from acc.app.workbench_boundary_transfer import (
    expand_boundary_transfer_bindings,
    normalize_boundary_transfer_metadata,
)
from acc.app.workbench_adapter import (
    canonicalize_workbench_workflow_payload,
    compile_workbench_workflow_bundle,
    merge_workbench_codex_execution_modes,
    merge_workbench_snapshot_projection,
    normalize_workbench_canvas_snapshot,
)
from acc.callable_registry import CallableRegistry
from acc.engine import parse_workflow_function_template
from acc.engine.workflow_validation import collect_callable_validation_issues
from acc.utils import AccError


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


def test_workbench_root_node_outputs_promote_to_workflow_outputs(tmp_path: Path) -> None:
    path = tmp_path / "stock_report_flow.accflow.json"
    draft = stock_workbench_draft()
    draft["metadata"]["root_workflow_id"] = "analyst"
    for node in draft["nodes"]:
        if node["id"] == "analyst":
            node["output_ports"] = [
                {"id": "main", "required": True},
                {"id": "action_items", "required": True},
            ]
            node["output_schema"] = {
                "type": "object",
                "additionalProperties": False,
                "required": ["status", "summary", "action_items"],
                "properties": {
                    "status": {"type": "string"},
                    "summary": {"type": "string"},
                    "action_items": {"type": "array", "items": {"type": "string"}},
                },
            }

    payload = canonicalize_workbench_workflow_payload(draft, source_path=path)

    assert payload["workflow_output_bindings"] == [
        {
            "source": {"node": "analyst", "port": "main"},
            "target_port": "main",
            "materialization": "copy",
            "required": True,
        },
        {
            "source": {"node": "analyst", "port": "action_items"},
            "target_port": "action_items",
            "materialization": "copy",
            "required": True,
        },
    ]
    assert payload["exposed_outputs"] == {
        "main": {"type": "artifact", "required": True, "cardinality": "one"},
        "action_items": {"type": "artifact", "required": True, "cardinality": "one"},
    }
    parse_workflow_function_template(payload, source_path=path)


def test_workbench_schema_derived_outputs_replace_stale_port_snapshot(
    tmp_path: Path,
) -> None:
    path = tmp_path / "schema_derived_outputs.accflow.json"
    draft = stock_workbench_draft()
    draft["metadata"]["root_workflow_id"] = "analyst"
    for node in draft["nodes"]:
        if node["id"] == "analyst":
            node["output_ports"] = [
                {"id": "main", "required": True},
                {"id": "stale_report", "required": True},
            ]
            node["output_schema"] = {
                "type": "object",
                "properties": {
                    "outputs": {
                        "type": "object",
                        "required": ["report"],
                        "properties": {
                            "report": {
                                "type": "string",
                                "description": "Complete investment report.",
                            }
                        },
                    }
                },
            }

    payload = canonicalize_workbench_workflow_payload(draft, source_path=path)
    analyst = next(node for node in payload["nodes"] if node["id"] == "analyst")

    assert set(analyst["ports"]["outputs"]) == {"main", "report"}
    assert "stale_report" not in analyst["ports"]["outputs"]
    assert payload["workflow_output_bindings"] == [
        {
            "source": {"node": "analyst", "port": "main"},
            "target_port": "main",
            "materialization": "copy",
            "required": True,
        },
        {
            "source": {"node": "analyst", "port": "report"},
            "target_port": "report",
            "materialization": "copy",
            "required": True,
        },
    ]
    parse_workflow_function_template(payload, source_path=path)


def test_workbench_preserves_stale_data_edge_for_validation_diagnostics(
    tmp_path: Path,
) -> None:
    path = tmp_path / "schema_rename_preserves_edge.accflow.json"
    draft = stock_workbench_draft()
    for node in draft["nodes"]:
        if node["id"] == "market_news":
            node["output_ports"] = [
                {"id": "main", "required": True},
                {"id": "valuation_conclusion", "required": True},
            ]
            node["output_schema"] = {
                "type": "object",
                "properties": {
                    "outputs": {
                        "type": "object",
                        "properties": {
                            "valuation_view": {"type": "string"},
                        },
                    }
                },
            }
        if node["id"] == "cleaner":
            node["input_ports"] = [
                {"id": "main", "required": False},
                {"id": "valuation_conclusion", "required": False},
            ]
    draft["data_edges"] = [
        {
            "id": "stale_valuation_edge",
            "from": {"node": "market_news", "port": "valuation_conclusion"},
            "to": {"node": "cleaner", "port": "valuation_conclusion"},
            "materialization": "copy",
        }
    ]

    payload = canonicalize_workbench_workflow_payload(
        draft,
        source_path=path,
        allow_repairable_port_issues=True,
    )
    source = next(node for node in payload["nodes"] if node["id"] == "market_news")
    template = parse_workflow_function_template(payload, source_path=path)

    assert set(source["ports"]["outputs"]) == {"main", "valuation_view"}
    assert payload["data_edges"] == [
        {
            "source": {"node": "market_news", "port": "valuation_conclusion"},
            "target": {"node": "cleaner", "port": "valuation_conclusion"},
            "materialization": "copy",
        }
    ]
    issue = next(
        issue
        for issue in collect_callable_validation_issues(template)
        if issue.code == "dangling_data_edge_source"
    )
    assert issue.metadata == {
        "edge_id": "market_news.valuation_conclusion->cleaner.valuation_conclusion",
        "source": {"node": "market_news", "port": "valuation_conclusion"},
        "target": {"node": "cleaner", "port": "valuation_conclusion"},
        "expected_schema_path": "/properties/outputs/properties/valuation_conclusion",
    }


def test_workbench_root_output_promotion_preserves_explicit_bindings(tmp_path: Path) -> None:
    path = tmp_path / "stock_report_flow.accflow.json"
    draft = stock_workbench_draft()
    draft["metadata"]["root_workflow_id"] = "analyst"
    draft["exposed_outputs"] = [{"id": "cleaned", "required": True}]
    draft["workflow_output_bindings"] = [
        {
            "source": {"node": "cleaner", "port": "main"},
            "target_port": "cleaned",
            "materialization": "copy",
            "required": True,
        }
    ]

    payload = canonicalize_workbench_workflow_payload(draft, source_path=path)

    assert payload["workflow_output_bindings"] == draft["workflow_output_bindings"]
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
                        {
                            "id": "workflow_input_market_news",
                            "kind": "data",
                            "from": {"node": "New_Workflow__workflow_inputs", "port": "main"},
                            "to": {"node": "market_news", "port": "main"},
                            "materialization": "copy",
                        },
                        {"id": "news_sentiment", "from": "market_news", "to": "market_sentiment"},
                        {
                            "id": "market_sentiment_workflow_output",
                            "kind": "data",
                            "from": {"node": "market_sentiment", "port": "main"},
                            "to": {"node": "New_Workflow__workflow_outputs", "port": "main"},
                            "materialization": "copy",
                        },
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
    assert child["policies"] == {"failure_mode": "fail_fast", "max_concurrency": 8}
    assert [node["id"] for node in child["nodes"]] == ["market_news", "market_sentiment"]
    assert child["control_edges"][0]["context"] == "none"
    assert child.get("data_edges", []) == []
    assert child["workflow_input_bindings"] == [
        {
            "source_port": "main",
            "target": {"node": "market_news", "port": "main"},
            "materialization": "copy",
            "required": False,
        }
    ]
    assert child["workflow_output_bindings"] == [
        {
            "source": {"node": "market_sentiment", "port": "main"},
            "target_port": "main",
            "materialization": "copy",
            "required": True,
        }
    ]
    parse_workflow_function_template(bundle.root, source_path=path)
    parse_workflow_function_template(
        child,
        source_path=path.parent / "stock_info_collection__New_Workflow.accflow.json",
    )


def test_workbench_snapshot_codex_mode_backfills_inline_internal_node() -> None:
    submitted_graph = {
        "id": "task_canvas",
        "version": "0.4.0",
        "name": "Task",
        "nodes": [
            {
                "id": "research_flow",
                "kind": "workflow",
                "callable_ref": {"kind": "workflow_function", "id": "research_flow"},
                "input_ports": [{"id": "main"}],
                "output_ports": [{"id": "main"}],
                "ui": {
                    "semantic_kind": "workflow_container",
                    "internal_nodes": [
                        {
                            "id": "research",
                            "kind": "Agent",
                            "callableId": "untitled-agent.codex",
                            "input": {"user_prompt": "research"},
                            "inputPorts": [{"id": "main"}],
                            "outputPorts": [{"id": "main"}],
                        }
                    ],
                    "internal_edges": [],
                },
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }
    canvas_snapshot = {
        "canonical_graph": {
            "nodes": [
                {
                    "id": "research_flow",
                    "ui": {
                        "internal_nodes": [
                            {
                                "id": "research",
                                "codexExecutionMode": "local_readonly_no_sandbox",
                            }
                        ]
                    },
                }
            ]
        }
    }

    merged = merge_workbench_codex_execution_modes(submitted_graph, canvas_snapshot)
    internal_node = merged["nodes"][0]["ui"]["internal_nodes"][0]

    assert internal_node["codexExecutionMode"] == "local_readonly_no_sandbox"
    assert "codexExecutionMode" not in submitted_graph["nodes"][0]["ui"]["internal_nodes"][0]


def test_workbench_snapshot_normalizer_hydrates_inline_container_projection(
    tmp_path: Path,
) -> None:
    submitted_graph = {
        "id": "task_canvas",
        "version": "0.4.0",
        "name": "Task",
        "nodes": [
            {
                "id": "research_flow",
                "kind": "workflow",
                "label": "Research Flow",
                "callable_ref": {"kind": "workflow_function", "id": "research_flow"},
                "input_ports": [{"id": "main"}],
                "output_ports": [{"id": "main"}],
                "ui": {"semantic_kind": "workflow_container"},
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }
    canvas_snapshot = {
        "canonical_graph": submitted_graph,
        "workflows": [
            {
                "id": "research_flow",
                "internalNodes": [
                    {
                        "id": "writer",
                        "kind": "Agent",
                        "callableId": "stock-report-writer.codex",
                        "input": {"prompt": "Write the report."},
                        "inputPorts": [{"id": "main"}],
                        "outputPorts": [{"id": "main"}],
                    }
                ],
                "internalEdges": [
                    {
                        "id": "workflow_input_writer",
                        "kind": "control",
                        "source": {"workflowId": "research_flow__workflow_inputs"},
                        "target": {"workflowId": "writer"},
                    }
                ],
            }
        ],
    }

    normalized = normalize_workbench_canvas_snapshot(canvas_snapshot)
    normalized_graph = normalized["canonical_graph"]
    container_ui = normalized_graph["nodes"][0]["ui"]

    assert container_ui["internal_nodes"][0]["id"] == "writer"
    assert container_ui["internal_edges"] == [
        {
            "id": "workflow_input_writer",
            "from": "research_flow__workflow_inputs",
            "to": "writer",
            "label": "control",
            "context": "none",
            "mapping": {},
        }
    ]

    bundle = compile_workbench_workflow_bundle(
        normalized_graph,
        source_path=tmp_path / "task_canvas.accflow.json",
    )
    child = bundle.children["task_canvas__research_flow.accflow.json"]

    assert [node["id"] for node in child["nodes"]] == ["writer"]
    assert child["workflow_input_bindings"] == [
        {
            "source_port": "main",
            "target": {"node": "writer", "port": "main"},
            "materialization": "copy",
            "required": False,
        }
    ]
    assert child["control_edges"] == []
    assert child["data_edges"] == []


def test_workbench_snapshot_normalizer_merges_partial_inline_projection(
    tmp_path: Path,
) -> None:
    collector = {
        "id": "collector",
        "kind": "Agent",
        "callableId": "stock-market-research.codex",
        "inputPorts": [{"id": "main"}],
        "outputPorts": [{"id": "main"}],
    }
    writer = {
        "id": "writer",
        "kind": "Agent",
        "callableId": "stock-report-writer.codex",
        "input": {"prompt": "Write the report."},
        "inputPorts": [{"id": "main"}],
        "outputPorts": [{"id": "main"}],
    }
    canvas_snapshot = {
        "canonical_graph": {
            "id": "task_canvas",
            "version": "0.4.0",
            "name": "Task",
            "nodes": [
                {
                    "id": "research_flow",
                    "kind": "workflow",
                    "label": "Research Flow",
                    "callable_ref": {"kind": "workflow_function", "id": "research_flow"},
                    "input_ports": [{"id": "main"}],
                    "output_ports": [{"id": "main"}],
                    "ui": {
                        "semantic_kind": "workflow_container",
                        "internal_nodes": [collector],
                        "internal_edges": [
                            {
                                "id": "collector_to_writer",
                                "from": "collector",
                                "to": "writer",
                                "label": "control",
                                "context": "none",
                                "mapping": {},
                            }
                        ],
                    },
                }
            ],
            "control_edges": [],
            "data_edges": [],
        },
        "workflows": [
            {
                "id": "research_flow",
                "internalNodes": [collector, writer],
                "internalEdges": [
                    {
                        "id": "collector_to_writer",
                        "kind": "control",
                        "source": {"workflowId": "collector"},
                        "target": {"workflowId": "writer"},
                    },
                    {
                        "id": "workflow_input_writer",
                        "kind": "control",
                        "source": {"workflowId": "research_flow__workflow_inputs"},
                        "target": {"workflowId": "writer"},
                    },
                ],
            }
        ],
    }

    normalized = normalize_workbench_canvas_snapshot(canvas_snapshot)
    container_ui = normalized["canonical_graph"]["nodes"][0]["ui"]

    assert [node["id"] for node in container_ui["internal_nodes"]] == [
        "collector",
        "writer",
    ]
    assert [edge["id"] for edge in container_ui["internal_edges"]] == [
        "collector_to_writer",
        "workflow_input_writer",
    ]

    bundle = compile_workbench_workflow_bundle(
        normalized["canonical_graph"],
        source_path=tmp_path / "task_canvas.accflow.json",
    )
    child = bundle.children["task_canvas__research_flow.accflow.json"]

    assert [node["id"] for node in child["nodes"]] == ["collector", "writer"]
    assert child["control_edges"] == [
        {"from": "collector", "to": "writer", "context": "none"}
    ]
    assert child["workflow_input_bindings"] == [
        {
            "source_port": "main",
            "target": {"node": "writer", "port": "main"},
            "materialization": "copy",
            "required": False,
        }
    ]
    assert child["data_edges"] == []


def test_workbench_snapshot_normalizer_canonicalizes_existing_raw_internal_edges(
    tmp_path: Path,
) -> None:
    writer = {
        "id": "writer",
        "kind": "Agent",
        "callableId": "stock-report-writer.codex",
        "input": {"prompt": "Write the report."},
        "inputPorts": [{"id": "main"}],
        "outputPorts": [{"id": "main"}],
    }
    raw_boundary_edge = {
        "id": "workflow_input_writer",
        "kind": "control",
        "source": {"workflowId": "research_flow__workflow_inputs"},
        "target": {"workflowId": "writer"},
    }
    canvas_snapshot = {
        "canonical_graph": {
            "id": "task_canvas",
            "version": "0.4.0",
            "name": "Task",
            "nodes": [
                {
                    "id": "research_flow",
                    "kind": "workflow",
                    "label": "Research Flow",
                    "callable_ref": {"kind": "workflow_function", "id": "research_flow"},
                    "input_ports": [{"id": "main"}],
                    "output_ports": [{"id": "main"}],
                    "ui": {
                        "semantic_kind": "workflow_container",
                        "internal_nodes": [writer],
                        "internal_edges": [raw_boundary_edge],
                    },
                }
            ],
            "control_edges": [],
            "data_edges": [],
        },
        "workflows": [
            {
                "id": "research_flow",
                "internalNodes": [writer],
                "internalEdges": [raw_boundary_edge],
            }
        ],
    }

    normalized = normalize_workbench_canvas_snapshot(canvas_snapshot)
    container_ui = normalized["canonical_graph"]["nodes"][0]["ui"]

    assert container_ui["internal_edges"] == [
        {
            "id": "workflow_input_writer",
            "from": "research_flow__workflow_inputs",
            "to": "writer",
            "label": "control",
            "context": "none",
            "mapping": {},
        }
    ]

    bundle = compile_workbench_workflow_bundle(
        normalized["canonical_graph"],
        source_path=tmp_path / "task_canvas.accflow.json",
    )
    child = bundle.children["task_canvas__research_flow.accflow.json"]

    assert child["workflow_input_bindings"] == [
        {
            "source_port": "main",
            "target": {"node": "writer", "port": "main"},
            "materialization": "copy",
            "required": False,
        }
    ]
    assert child["control_edges"] == []
    assert child["data_edges"] == []


def test_workbench_snapshot_normalizer_does_not_promote_root_agent_workflow_projection(
    tmp_path: Path,
) -> None:
    canvas_snapshot = {
        "canonical_graph": {
            "id": "task_canvas",
            "version": "0.4.0",
            "name": "Task",
            "nodes": [
                {
                    "id": "collector",
                    "kind": "agent_session",
                    "callable_ref": {"kind": "agent_class", "id": "stock-data-collector.codex"},
                    "input": {"user_prompt": "Collect public stock data."},
                    "input_ports": [{"id": "main"}],
                    "output_ports": [{"id": "main"}],
                    "ui": {"semantic_kind": "workflow_container"},
                }
            ],
            "control_edges": [],
            "data_edges": [],
        },
        "workflows": [
            {
                "id": "collector",
                "internalNodes": [],
                "internalEdges": [],
            }
        ],
    }

    normalized = normalize_workbench_canvas_snapshot(canvas_snapshot)
    collector = normalized["canonical_graph"]["nodes"][0]

    assert collector["callable_ref"] == {
        "kind": "agent_class",
        "id": "stock-data-collector.codex",
    }
    assert "ui" not in collector

    bundle = compile_workbench_workflow_bundle(
        normalized["canonical_graph"],
        source_path=tmp_path / "task_canvas.accflow.json",
    )

    assert bundle.children == {}
    assert bundle.root["nodes"][0]["callable_ref"] == {
        "kind": "agent_class",
        "id": "stock-data-collector.codex",
    }


def test_workbench_snapshot_projection_merge_repairs_submitted_graph_for_runtime(
    tmp_path: Path,
) -> None:
    submitted_graph = {
        "id": "task_canvas",
        "version": "0.4.0",
        "name": "Task",
        "nodes": [
            {
                "id": "research_flow",
                "kind": "workflow",
                "label": "Research Flow",
                "callable_ref": {"kind": "workflow_function", "id": "research_flow"},
                "input_ports": [{"id": "main"}],
                "output_ports": [{"id": "main"}],
                "ui": {"semantic_kind": "workflow_container", "internal_edges": []},
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }
    canvas_snapshot = {
        "canonical_graph": submitted_graph,
        "workflows": [
            {
                "id": "research_flow",
                "internalNodes": [
                    {
                        "id": "writer",
                        "kind": "Agent",
                        "callableId": "stock-report-writer.codex",
                        "inputPorts": [{"id": "main"}],
                        "outputPorts": [{"id": "main"}],
                        "codexExecutionMode": "local_readonly_no_sandbox",
                    }
                ],
                "internalEdges": [
                    {
                        "id": "legacy_workflow_input_writer",
                        "kind": "data",
                        "source": {
                            "workflowId": "research_flow__workflow_inputs",
                            "portId": "main",
                        },
                        "target": {"workflowId": "writer", "portId": "main"},
                        "materialization": "copy",
                    },
                    {
                        "id": "control_workflow_input_writer",
                        "kind": "control",
                        "source": {"workflowId": "research_flow__workflow_inputs"},
                        "target": {"workflowId": "writer"},
                    },
                ],
            }
        ],
    }

    merged = merge_workbench_snapshot_projection(submitted_graph, canvas_snapshot)

    internal_node = merged["nodes"][0]["ui"]["internal_nodes"][0]
    assert internal_node["codexExecutionMode"] == "local_readonly_no_sandbox"

    bundle = compile_workbench_workflow_bundle(
        merged,
        source_path=tmp_path / "task_canvas.accflow.json",
    )
    child = bundle.children["task_canvas__research_flow.accflow.json"]

    assert child["workflow_input_bindings"] == [
        {
            "source_port": "main",
            "target": {"node": "writer", "port": "main"},
            "materialization": "copy",
            "required": False,
        }
    ]
    assert all("__workflow_inputs" not in edge.get("from", "") for edge in child["control_edges"])
    assert all(
        "__workflow_inputs" not in edge.get("from", {}).get("node", "")
        for edge in child["data_edges"]
    )


def test_workbench_container_preserves_root_caller_and_child_boundary_bindings(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workflows" / "root_with_container.accflow.json"
    path.parent.mkdir()
    draft = {
        "id": "root_with_container",
        "version": "0.4.0",
        "name": "Root With Container",
        "nodes": [
            _agent_node("external_agent", "stock-market-research.codex", "Seed workflow."),
            {
                "id": "New_Workflow",
                "kind": "workflow",
                "label": "New Workflow",
                "callable_ref": {"kind": "workflow_function", "id": "New_Workflow"},
                "input_ports": [{"id": "main"}],
                "output_ports": [{"id": "main"}],
                "ui": {
                    "semantic_kind": "workflow_container",
                    "internal_nodes": [
                        {
                            "id": "agent2",
                            "name": "Agent 2",
                            "task": "Use workflow input.",
                            "kind": "Agent",
                            "callableId": "stock-market-research.codex",
                            "inputPorts": [{"id": "main"}],
                            "outputPorts": [{"id": "main"}],
                        },
                        {
                            "id": "agent1",
                            "name": "Agent 1",
                            "task": "Use agent 2 output.",
                            "kind": "Agent",
                            "callableId": "stock-market-research.codex",
                            "inputPorts": [{"id": "main"}],
                            "outputPorts": [{"id": "main"}],
                        },
                    ],
                    "internal_edges": [
                        {
                            "id": "workflow_input_agent2",
                            "kind": "data",
                            "from": {"node": "New_Workflow__workflow_inputs", "port": "main"},
                            "to": {"node": "agent2", "port": "main"},
                            "materialization": "copy",
                        },
                        {"id": "agent2_agent1", "from": "agent2", "to": "agent1"},
                        {
                            "id": "agent1_workflow_output",
                            "kind": "data",
                            "from": {"node": "agent1", "port": "main"},
                            "to": {"node": "New_Workflow__workflow_outputs", "port": "main"},
                            "materialization": "copy",
                        },
                    ],
                },
            },
        ],
        "control_edges": [
            {"id": "external_workflow", "from": "external_agent", "to": "New_Workflow"}
        ],
        "data_edges": [],
    }

    bundle = compile_workbench_workflow_bundle(draft, source_path=path)

    assert [node["id"] for node in bundle.root["nodes"]] == ["external_agent", "New_Workflow"]
    assert bundle.root["control_edges"] == [
        {"context": "none", "from": "external_agent", "to": "New_Workflow"}
    ]
    child = bundle.children["root_with_container__New_Workflow.accflow.json"]
    assert child["workflow_input_bindings"] == [
        {
            "source_port": "main",
            "target": {"node": "agent2", "port": "main"},
            "materialization": "copy",
            "required": False,
        }
    ]
    assert child["control_edges"] == [
        {"context": "none", "from": "agent2", "to": "agent1"}
    ]
    assert child["workflow_output_bindings"] == [
        {
            "source": {"node": "agent1", "port": "main"},
            "target_port": "main",
            "materialization": "copy",
            "required": True,
        }
    ]


def test_workbench_container_compiles_boundary_control_edges_to_child_bindings(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workflows" / "boundary_control_container.accflow.json"
    path.parent.mkdir()
    draft = {
        "id": "boundary_control_container",
        "version": "0.4.0",
        "name": "Boundary Control Container",
        "nodes": [
            {
                "id": "New_Workflow",
                "kind": "workflow",
                "label": "New Workflow",
                "callable_ref": {"kind": "workflow_function", "id": "New_Workflow"},
                "input_ports": [{"id": "main"}],
                "output_ports": [{"id": "main"}],
                "ui": {
                    "semantic_kind": "workflow_container",
                    "internal_nodes": [
                        {
                            "id": "agent1",
                            "name": "Agent 1",
                            "task": "Use workflow input.",
                            "kind": "Agent",
                            "callableId": "stock-market-research.codex",
                            "inputPorts": [{"id": "main"}],
                            "outputPorts": [{"id": "main"}],
                        }
                    ],
                    "internal_edges": [
                        {
                            "id": "legacy_workflow_input_agent1",
                            "kind": "data",
                            "from": {"node": "New_Workflow__workflow_inputs", "port": "main"},
                            "to": {"node": "agent1", "port": "main"},
                            "materialization": "copy",
                        },
                        {
                            "id": "control_workflow_input_agent1",
                            "kind": "control",
                            "from": "New_Workflow__workflow_inputs",
                            "to": "agent1",
                        },
                        {
                            "id": "legacy_agent1_workflow_output",
                            "kind": "data",
                            "from": {"node": "agent1", "port": "main"},
                            "to": {"node": "New_Workflow__workflow_outputs", "port": "main"},
                            "materialization": "copy",
                        },
                        {
                            "id": "control_agent1_workflow_output",
                            "kind": "control",
                            "from": "agent1",
                            "to": "New_Workflow__workflow_outputs",
                        },
                    ],
                },
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }

    bundle = compile_workbench_workflow_bundle(draft, source_path=path)

    child = bundle.children["boundary_control_container__New_Workflow.accflow.json"]
    assert child["workflow_input_bindings"] == [
        {
            "source_port": "main",
            "target": {"node": "agent1", "port": "main"},
            "materialization": "copy",
            "required": False,
        }
    ]
    assert child["workflow_output_bindings"] == [
        {
            "source": {"node": "agent1", "port": "main"},
            "target_port": "main",
            "materialization": "copy",
            "required": True,
        }
    ]
    assert child["control_edges"] == []
    assert child["data_edges"] == []
    parse_workflow_function_template(
        child,
        source_path=path.parent / "boundary_control_container__New_Workflow.accflow.json",
    )


def test_workbench_container_expands_boundary_input_control_by_matching_ports(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workflows" / "boundary_input_ports.accflow.json"
    path.parent.mkdir()
    draft = {
        "id": "boundary_input_ports",
        "version": "0.4.0",
        "name": "Boundary Input Ports",
        "nodes": [
            {
                "id": "Research_Workflow",
                "kind": "workflow",
                "label": "Research Workflow",
                "callable_ref": {"kind": "workflow_function", "id": "Research_Workflow"},
                "input_ports": [{"id": "target"}, {"id": "verified_data"}],
                "output_ports": [{"id": "main"}],
                "ui": {
                    "semantic_kind": "workflow_container",
                    "internal_nodes": [
                        {
                            "id": "business_model_agent",
                            "name": "Business Model",
                            "kind": "Agent",
                            "callableId": "stock-market-research.codex",
                            "inputPorts": [{"id": "target"}, {"id": "verified_data"}],
                            "outputPorts": [{"id": "main"}],
                        }
                    ],
                    "internal_edges": [
                        {
                            "id": "control_workflow_input_business_model",
                            "kind": "control",
                            "from": "Research_Workflow__workflow_inputs",
                            "to": "business_model_agent",
                        }
                    ],
                },
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }

    bundle = compile_workbench_workflow_bundle(draft, source_path=path)

    child = bundle.children["boundary_input_ports__Research_Workflow.accflow.json"]
    assert child["workflow_input_bindings"] == [
        {
            "source_port": "target",
            "target": {"node": "business_model_agent", "port": "target"},
            "materialization": "copy",
            "required": False,
        },
        {
            "source_port": "verified_data",
            "target": {"node": "business_model_agent", "port": "verified_data"},
            "materialization": "copy",
            "required": False,
        },
    ]
    assert child["control_edges"] == []
    parse_workflow_function_template(
        child,
        source_path=path.parent / "boundary_input_ports__Research_Workflow.accflow.json",
    )


def test_workbench_container_uses_explicit_boundary_output_control_mapping(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workflows" / "boundary_output_mapping.accflow.json"
    path.parent.mkdir()
    draft = {
        "id": "boundary_output_mapping",
        "version": "0.4.0",
        "name": "Boundary Output Mapping",
        "nodes": [
            {
                "id": "Research_Workflow",
                "kind": "workflow",
                "label": "Research Workflow",
                "callable_ref": {"kind": "workflow_function", "id": "Research_Workflow"},
                "input_ports": [{"id": "main"}],
                "output_ports": [{"id": "main"}, {"id": "evidence_pack"}],
                "ui": {
                    "semantic_kind": "workflow_container",
                    "internal_nodes": [
                        {
                            "id": "evidence_agent",
                            "name": "Evidence",
                            "kind": "Agent",
                            "callableId": "stock-market-research.codex",
                            "inputPorts": [{"id": "main"}],
                            "outputPorts": [{"id": "main"}],
                        }
                    ],
                    "internal_edges": [
                        {
                            "id": "control_evidence_workflow_output",
                            "kind": "control",
                            "from": "evidence_agent",
                            "to": "Research_Workflow__workflow_outputs",
                            "boundary_transfer": {
                                "direction": "workflow_output",
                                "materialization": "copy",
                                "inference": "explicit",
                                "mappings": [
                                    {"source_port": "main", "target_port": "evidence_pack"}
                                ],
                            },
                        }
                    ],
                },
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }

    bundle = compile_workbench_workflow_bundle(draft, source_path=path)

    child = bundle.children["boundary_output_mapping__Research_Workflow.accflow.json"]
    assert child["workflow_output_bindings"] == [
        {
            "source": {"node": "evidence_agent", "port": "main"},
            "target_port": "evidence_pack",
            "materialization": "copy",
            "required": True,
        }
    ]
    assert child["control_edges"] == []


def test_workbench_container_rejects_ambiguous_boundary_output_control(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workflows" / "ambiguous_boundary_output.accflow.json"
    path.parent.mkdir()
    draft = {
        "id": "ambiguous_boundary_output",
        "version": "0.4.0",
        "name": "Ambiguous Boundary Output",
        "nodes": [
            {
                "id": "Research_Workflow",
                "kind": "workflow",
                "label": "Research Workflow",
                "callable_ref": {"kind": "workflow_function", "id": "Research_Workflow"},
                "input_ports": [{"id": "main"}],
                "output_ports": [{"id": "report"}, {"id": "evidence_pack"}],
                "ui": {
                    "semantic_kind": "workflow_container",
                    "internal_nodes": [
                        {
                            "id": "writer",
                            "name": "Writer",
                            "kind": "Agent",
                            "callableId": "stock-market-research.codex",
                            "inputPorts": [{"id": "main"}],
                            "outputPorts": [{"id": "main"}],
                        }
                    ],
                    "internal_edges": [
                        {
                            "id": "control_writer_workflow_output",
                            "kind": "control",
                            "from": "writer",
                            "to": "Research_Workflow__workflow_outputs",
                        }
                    ],
                },
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }

    with pytest.raises(AccError, match="ambiguous_workflow_output_boundary_control"):
        compile_workbench_workflow_bundle(draft, source_path=path)


def test_boundary_control_data_edge_priority_skips_duplicate_control_binding() -> None:
    result = expand_boundary_transfer_bindings(
        workflow_id="Research_Workflow",
        exposed_inputs=[{"id": "target"}, {"id": "context"}],
        exposed_outputs=[{"id": "main"}],
        internal_nodes=[
            {
                "id": "business_model_agent",
                "inputPorts": [{"id": "target"}, {"id": "context"}],
                "outputPorts": [{"id": "main"}],
            }
        ],
        edges=[
            {
                "id": "explicit_target",
                "kind": "data",
                "from": {"node": "Research_Workflow__workflow_inputs", "port": "target"},
                "to": {"node": "business_model_agent", "port": "target"},
                "materialization": "copy",
            },
            {
                "id": "control_input",
                "kind": "control",
                "from": "Research_Workflow__workflow_inputs",
                "to": "business_model_agent",
            },
        ],
    )

    assert result["status"] == "valid"
    assert result["bindings"]["workflow_input_bindings"] == [
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


def test_boundary_control_reports_ambiguous_input_diagnostic() -> None:
    result = expand_boundary_transfer_bindings(
        workflow_id="Research_Workflow",
        exposed_inputs=[{"id": "target"}, {"id": "context"}],
        exposed_outputs=[{"id": "main"}],
        internal_nodes=[
            {
                "id": "agent",
                "inputPorts": [{"id": "ticker"}, {"id": "evidence"}],
                "outputPorts": [{"id": "main"}],
            }
        ],
        edges=[
            {
                "id": "control_input",
                "kind": "control",
                "from": "Research_Workflow__workflow_inputs",
                "to": "agent",
            }
        ],
    )

    assert result["status"] == "invalid"
    assert result["diagnostics"][0]["code"] == "ambiguous_workflow_input_boundary_control"
    assert result["bindings"]["workflow_input_bindings"] == []


def test_boundary_control_reports_unknown_explicit_mapping_port() -> None:
    result = expand_boundary_transfer_bindings(
        workflow_id="Research_Workflow",
        exposed_inputs=[{"id": "main"}],
        exposed_outputs=[{"id": "main"}],
        internal_nodes=[
            {
                "id": "writer",
                "inputPorts": [{"id": "main"}],
                "outputPorts": [{"id": "main"}],
            }
        ],
        edges=[
            {
                "id": "bad_output_mapping",
                "kind": "control",
                "from": "writer",
                "to": "Research_Workflow__workflow_outputs",
                "boundary_transfer": {
                    "direction": "workflow_output",
                    "mappings": [{"source_port": "missing", "target_port": "main"}],
                },
            }
        ],
    )

    assert result["status"] == "invalid"
    assert result["diagnostics"][0]["code"] == "unknown_boundary_transfer_port"
    assert result["bindings"]["workflow_output_bindings"] == []


def test_boundary_control_reports_duplicate_explicit_mapping() -> None:
    result = expand_boundary_transfer_bindings(
        workflow_id="Research_Workflow",
        exposed_inputs=[{"id": "main"}],
        exposed_outputs=[{"id": "main"}],
        internal_nodes=[
            {
                "id": "writer",
                "inputPorts": [{"id": "main"}],
                "outputPorts": [{"id": "main"}],
            }
        ],
        edges=[
            {
                "id": "duplicate_output_mapping",
                "kind": "control",
                "from": "writer",
                "to": "Research_Workflow__workflow_outputs",
                "boundary_transfer": {
                    "direction": "workflow_output",
                    "mappings": [
                        {"source_port": "main", "target_port": "main"},
                        {"source_port": "main", "target_port": "main"},
                    ],
                },
            }
        ],
    )

    assert result["status"] == "invalid"
    assert result["diagnostics"][0]["code"] == "duplicate_boundary_transfer_mapping"


def test_boundary_transfer_golden_fixtures() -> None:
    fixture_path = Path("tests/fixtures/boundary_transfer_cases.json")
    fixtures = json.loads(fixture_path.read_text(encoding="utf-8"))

    for case in fixtures["expansion_cases"]:
        result = expand_boundary_transfer_bindings(
            workflow_id=case["workflow_id"],
            exposed_inputs=case["exposed_inputs"],
            exposed_outputs=case["exposed_outputs"],
            internal_nodes=case["internal_nodes"],
            edges=case["edges"],
        )

        assert result["status"] == case["expected_status"], case["name"]
        assert (
            result["bindings"]["workflow_input_bindings"]
            == case["expected_input_bindings"]
        ), case["name"]
        assert (
            result["bindings"]["workflow_output_bindings"]
            == case["expected_output_bindings"]
        ), case["name"]
        assert [item["code"] for item in result["diagnostics"]] == case[
            "expected_diagnostic_codes"
        ], case["name"]


def test_boundary_transfer_metadata_normalizes_to_snake_case_v1() -> None:
    metadata = normalize_boundary_transfer_metadata(
        {
            "boundaryTransfer": {
                "direction": "workflow_output",
                "materialization": "copy",
                "inference": "same_name",
                "mappings": [{"sourcePort": "main", "targetPort": "evidence_pack"}],
            }
        }
    )

    assert metadata == {
        "schema": "acc.workbench.boundary_transfer.v1",
        "direction": "workflow_output",
        "materialization": "copy",
        "inference": "explicit",
        "mappings": [{"source_port": "main", "target_port": "evidence_pack"}],
    }


def test_empty_workbench_container_compiles_to_noop_child_workflow(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workflows" / "root_with_empty_container.accflow.json"
    path.parent.mkdir()
    draft = {
        "id": "root_with_empty_container",
        "version": "0.4.0",
        "name": "Root With Empty Container",
        "nodes": [
            {
                "id": "New_Workflow_2",
                "kind": "workflow",
                "label": "New Workflow #2",
                "callable_ref": {"kind": "workflow_function", "id": "New_Workflow_2"},
                "input_ports": [{"id": "main"}],
                "output_ports": [{"id": "main"}],
                "ui": {
                    "semantic_kind": "workflow_container",
                    "internal_nodes": [],
                    "internal_edges": [],
                },
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }

    bundle = compile_workbench_workflow_bundle(draft, source_path=path)

    child_name = "root_with_empty_container__New_Workflow_2.accflow.json"
    assert set(bundle.children) == {child_name}
    root_node = bundle.root["nodes"][0]
    assert root_node["callable_ref"] == {
        "kind": "workflow_function",
        "id": child_name,
    }
    assert root_node["workflow_call_output_bindings"] == [
        {"workflow_output": "main", "parent_port": "main", "required": False}
    ]
    child = bundle.children[child_name]
    assert child["nodes"] == []
    assert child["control_edges"] == []
    assert child["data_edges"] == []
    assert child["workflow_input_bindings"] == []
    assert child["workflow_output_bindings"] == []
    parse_workflow_function_template(child, source_path=path.parent / child_name)


def test_workbench_container_preserves_explicit_main_to_main_data_edge(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workflows" / "main_to_main_container.accflow.json"
    path.parent.mkdir()
    draft = {
        "id": "main_to_main_container",
        "version": "0.4.0",
        "nodes": [
            {
                "id": "Review_Workflow",
                "kind": "workflow",
                "label": "Review Workflow",
                "callable_ref": {"kind": "workflow_function", "id": "Review_Workflow"},
                "input_ports": [{"id": "main"}],
                "output_ports": [{"id": "main"}],
                "ui": {
                    "semantic_kind": "workflow_container",
                    "internal_nodes": [
                        {
                            "id": "producer",
                            "name": "Producer",
                            "task": "Produce output.",
                            "kind": "Agent",
                            "callableId": "stock-market-research.codex",
                            "inputPorts": [{"id": "main"}],
                            "outputPorts": [{"id": "main"}],
                        },
                        {
                            "id": "consumer",
                            "name": "Consumer",
                            "task": "Consume output.",
                            "kind": "Agent",
                            "callableId": "stock-market-research.codex",
                            "inputPorts": [{"id": "main", "required": True}],
                            "outputPorts": [{"id": "main"}],
                        },
                    ],
                    "internal_edges": [
                        {
                            "id": "control_producer_consumer",
                            "kind": "control",
                            "source": {"workflowId": "producer"},
                            "target": {"workflowId": "consumer"},
                        },
                        {
                            "id": "data_producer_main_consumer_main",
                            "kind": "data",
                            "source": {"workflowId": "producer", "portId": "main"},
                            "target": {"workflowId": "consumer", "portId": "main"},
                            "materialization": "copy",
                        },
                    ],
                },
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }

    bundle = compile_workbench_workflow_bundle(
        draft,
        source_path=path,
        main_data_edge_policy="preserve_explicit",
    )
    child = bundle.children["main_to_main_container__Review_Workflow.accflow.json"]

    assert child["data_edges"] == [
        {
            "source": {"node": "producer", "port": "main"},
            "target": {"node": "consumer", "port": "main"},
            "materialization": "copy",
        }
    ]
    assert bundle.normalization["removed_main_data_edges"] == 0
    assert any(
        warning["code"] == "control_main_suppressed_by_data_edge"
        and warning["source"] == "producer"
        and warning["target"] == "consumer"
        for warning in bundle.normalization["warnings"]
    )
    issues = collect_callable_validation_issues(
        parse_workflow_function_template(child, source_path=path.parent / "child.accflow.json")
    )
    assert not [issue for issue in issues if issue.severity == "error"]


def test_workbench_container_deduplicates_identical_boundary_output_edges(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workflows" / "dedupe_container.accflow.json"
    path.parent.mkdir()
    output_edge = {
        "id": "agent_workflow_output",
        "kind": "data",
        "from": {"node": "agent1", "port": "main"},
        "to": {"node": "New_Workflow__workflow_outputs", "port": "main"},
        "materialization": "copy",
    }
    draft = {
        "id": "dedupe_container",
        "version": "0.4.0",
        "nodes": [
            {
                "id": "New_Workflow",
                "kind": "workflow",
                "label": "New Workflow",
                "callable_ref": {"kind": "workflow_function", "id": "New_Workflow"},
                "input_ports": [{"id": "main"}],
                "output_ports": [{"id": "main"}],
                "ui": {
                    "semantic_kind": "workflow_container",
                    "internal_nodes": [
                        {
                            "id": "agent1",
                            "name": "Agent 1",
                            "task": "Return output.",
                            "kind": "Agent",
                            "callableId": "stock-market-research.codex",
                            "inputPorts": [{"id": "main"}],
                            "outputPorts": [{"id": "main"}],
                        }
                    ],
                    "internal_edges": [
                        output_edge,
                        {**output_edge, "id": "agent_workflow_output_2"},
                    ],
                },
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }

    bundle = compile_workbench_workflow_bundle(draft, source_path=path)
    child = bundle.children["dedupe_container__New_Workflow.accflow.json"]

    assert child["workflow_output_bindings"] == [
        {
            "source": {"node": "agent1", "port": "main"},
            "target_port": "main",
            "materialization": "copy",
            "required": True,
        }
    ]


def test_workbench_container_does_not_expose_internal_schema_ports_without_boundary_edge(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workflows" / "schema_internal_boundary.accflow.json"
    path.parent.mkdir()
    draft = {
        "id": "schema_internal_boundary",
        "version": "0.4.0",
        "nodes": [
            {
                "id": "Research_Workflow",
                "kind": "workflow",
                "label": "Research Workflow",
                "callable_ref": {"kind": "workflow_function", "id": "Research_Workflow"},
                "input_ports": [{"id": "main"}],
                "output_ports": [{"id": "main"}],
                "ui": {
                    "semantic_kind": "workflow_container",
                    "internal_nodes": [
                        {
                            "id": "analyst",
                            "name": "Analyst",
                            "task": "Produce structured report.",
                            "kind": "Agent",
                            "callableId": "stock-market-research.codex",
                            "inputPorts": [{"id": "main"}],
                            "outputPorts": [
                                {"id": "main"},
                                {"id": "report"},
                            ],
                            "outputSchema": {
                                "type": "object",
                                "properties": {
                                    "outputs": {
                                        "type": "object",
                                        "properties": {
                                            "report": {"type": "string"},
                                        },
                                    }
                                },
                            },
                        }
                    ],
                    "internal_edges": [
                        {
                            "id": "analyst_main_workflow_output",
                            "kind": "data",
                            "from": {"node": "analyst", "port": "main"},
                            "to": {"node": "Research_Workflow__workflow_outputs", "port": "main"},
                            "materialization": "copy",
                        }
                    ],
                },
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }

    bundle = compile_workbench_workflow_bundle(draft, source_path=path)
    root_node = bundle.root["nodes"][0]
    child = bundle.children["schema_internal_boundary__Research_Workflow.accflow.json"]
    analyst = child["nodes"][0]

    assert set(analyst["ports"]["outputs"]) == {"main", "report"}
    assert root_node["ports"]["outputs"] == {
        "main": {"type": "artifact", "required": False, "cardinality": "one"}
    }
    assert root_node["workflow_call_output_bindings"] == [
        {"workflow_output": "main", "parent_port": "main", "required": False}
    ]
    assert child["workflow_output_bindings"] == [
        {
            "source": {"node": "analyst", "port": "main"},
            "target_port": "main",
            "materialization": "copy",
            "required": True,
        }
    ]


def test_workbench_container_rejects_duplicate_internal_node_ids(
    tmp_path: Path,
) -> None:
    path = tmp_path / "workflows" / "duplicate_internal.accflow.json"
    path.parent.mkdir()
    draft = {
        "id": "duplicate_internal",
        "version": "0.4.0",
        "nodes": [
            {
                "id": "New_Workflow",
                "kind": "workflow",
                "label": "New Workflow",
                "callable_ref": {"kind": "workflow_function", "id": "New_Workflow"},
                "input_ports": [{"id": "main"}],
                "output_ports": [{"id": "main"}],
                "ui": {
                    "semantic_kind": "workflow_container",
                    "internal_nodes": [
                        {
                            "id": "agent1",
                            "name": "Agent 1",
                            "kind": "Agent",
                            "callableId": "stock-market-research.codex",
                            "inputPorts": [{"id": "main"}],
                            "outputPorts": [{"id": "main"}],
                        },
                        {
                            "id": "agent1",
                            "name": "Agent 1 Duplicate",
                            "kind": "Agent",
                            "callableId": "stock-market-research.codex",
                            "inputPorts": [{"id": "main"}],
                            "outputPorts": [{"id": "main"}],
                        },
                    ],
                    "internal_edges": [],
                },
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }

    with pytest.raises(AccError, match="duplicate_workflow_internal_node_id.*New_Workflow.*agent1"):
        compile_workbench_workflow_bundle(draft, source_path=path)
