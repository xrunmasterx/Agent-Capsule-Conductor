from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app


def test_workflow_inspect_includes_callable_runtime_evidence(tmp_path: Path) -> None:
    run_dir = tmp_path / "inspect_callable"
    run_result = CliRunner().invoke(
        app,
        [
            "workflow",
            "run",
            "examples/workflows/callable_nested_function_demo.accflow.json",
            "--run-dir",
            str(run_dir),
            "--emit-json",
        ],
    )
    assert run_result.exit_code == 0, run_result.output

    inspect_result = CliRunner().invoke(
        app,
        ["workflow", "inspect", str(run_dir), "--json"],
    )

    assert inspect_result.exit_code == 0, inspect_result.output
    payload = json.loads(inspect_result.stdout)
    assert payload["function_invocation"]["workflow_function_id"] == (
        "callable_nested_function_demo"
    )
    assert payload["scope_frame"]["call_depth"] == 0
    assert {session["node_id"] for session in payload["node_sessions"]} == {
        "producer",
        "final_merge",
    }
    assert payload["workflow_calls"][0]["node_id"] == "subflow"
    assert payload["call_stack"][0]["workflow_function_id"] == "callable_nested_function_demo"
    assert payload["call_stack"][1]["child_workflow_id"] == "callable_child_function"
    assert any(
        item.get("source_node_id") == "subflow"
        and item.get("target_node_id") == "final_merge"
        for item in payload["lineage"]["inboxes"]
    )
    assert any(
        item.get("child_workflow_output") == "report"
        for item in payload["lineage"]["outboxes"]
    )
