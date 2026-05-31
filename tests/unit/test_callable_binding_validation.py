from __future__ import annotations

import json
from pathlib import Path

from acc.app import validate_clean_workflow_file
from acc.app.callable_refs import discover_known_callable_refs
from acc.domain import (
    CallableRef,
    ControlEdge,
    DataEdge,
    DataEndpoint,
    NodeInvocationSpec,
    PortContract,
    WorkflowFunctionTemplate,
)
from acc.engine.workflow_validation import (
    build_workflow_dry_run_report,
    collect_callable_validation_issues,
)
from acc.registry import CapsuleRegistry


def tool_node(node_id: str, *, capsule_id: str = "echo-test.generic") -> NodeInvocationSpec:
    return NodeInvocationSpec(
        id=node_id,
        callable_ref=CallableRef(kind="tool_class", id=capsule_id),
        output_ports={"main": PortContract(id="main", direction="output", type="artifact")},
    )


def agent_node(node_id: str) -> NodeInvocationSpec:
    return NodeInvocationSpec(
        id=node_id,
        callable_ref=CallableRef(kind="agent_class", id="fake-agent.generic"),
        input_ports={
            "main": PortContract(id="main", direction="input", required=True, type="artifact")
        },
        output_ports={"report": PortContract(id="report", direction="output", type="json")},
    )


def test_collect_unbound_required_input_port() -> None:
    template = WorkflowFunctionTemplate(
        id="unbound_demo",
        version="0.1.0",
        node_invocations={
            "produce": tool_node("produce"),
            "consume": agent_node("consume"),
        },
        control_edges=[ControlEdge(source="produce", target="consume")],
        data_edges=[],
    )
    issues = collect_callable_validation_issues(template)
    codes = {issue.code for issue in issues}
    assert "unbound_input_port" in codes


def test_dry_run_report_has_levels_without_run_dir(tmp_path: Path) -> None:
    template = WorkflowFunctionTemplate(
        id="dry_run_demo",
        version="0.1.0",
        node_invocations={
            "produce": tool_node("produce"),
            "consume": NodeInvocationSpec(
                id="consume",
                callable_ref=CallableRef(kind="agent_class", id="fake-agent.generic"),
                input_ports={
                    "main": PortContract(id="main", direction="input", required=True)
                },
            ),
        },
        control_edges=[ControlEdge(source="produce", target="consume")],
        data_edges=[
            DataEdge(
                source=DataEndpoint(node="produce", port="main"),
                target=DataEndpoint(node="consume", port="main"),
            )
        ],
    )
    registry = CapsuleRegistry(Path("capsules"))
    known_refs, known_workflow_ids = discover_known_callable_refs(registry, workflows_dir=tmp_path)
    report = build_workflow_dry_run_report(
        template,
        known_callable_refs=known_refs,
        known_workflow_ids=known_workflow_ids,
    )
    assert report["status"] == "dry_run"
    assert report["levels"] == [["produce"], ["consume"]]
    assert report["estimated_node_count"] == 2
    assert "materialization_plan" in report


def write_template(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def test_validate_clean_workflow_file_rejects_unknown_callable(tmp_path: Path) -> None:
    payload = {
        "id": "invalid_refs",
        "version": "0.1.0",
        "nodes": [
            {
                "id": "n1",
                "kind": "tool",
                "tool": "definitely_missing_tool_class",
                "ports": {"outputs": {"main": {"type": "artifact"}}},
            }
        ],
        "control_edges": [],
        "data_edges": [],
    }
    path = tmp_path / "invalid_refs.accflow.json"
    write_template(path, payload)
    registry = CapsuleRegistry(Path("capsules"))
    report = validate_clean_workflow_file(path, registry=registry)
    assert report["status"] == "invalid", report
    assert any(error["code"] == "unknown_callable_ref" for error in report["errors"])


def test_port_type_mismatch_warning_by_default() -> None:
    template = WorkflowFunctionTemplate(
        id="type_demo",
        version="0.1.0",
        node_invocations={
            "produce": NodeInvocationSpec(
                id="produce",
                callable_ref=CallableRef(kind="tool_class", id="echo-test.generic"),
                output_ports={
                    "main": PortContract(id="main", direction="output", type="string")
                },
            ),
            "consume": agent_node("consume"),
        },
        control_edges=[ControlEdge(source="produce", target="consume")],
        data_edges=[
            DataEdge(
                source=DataEndpoint(node="produce", port="main"),
                target=DataEndpoint(node="consume", port="main"),
            )
        ],
    )
    issues = collect_callable_validation_issues(template)
    assert any(issue.code == "port_type_mismatch" for issue in issues)
