from __future__ import annotations

from pathlib import Path

from acc.run_index import NodeRunSummary, RunIndex, RunSummary
from acc.store import write_json


def test_decision_inbox_aggregates_failed_run_and_node(client, project_root: Path) -> None:
    failed_run_dir = project_root / "runs" / "failed_run"
    failed_run_dir.mkdir(parents=True)
    node = NodeRunSummary(
        node_id="broken_node",
        callable_id="echo-test.generic",
        status="failed",
        summary="boom",
        run_dir=str(failed_run_dir.resolve()),
        event_log=str((failed_run_dir / "nodes" / "broken_node" / "events.jsonl").resolve()),
    )
    summary = RunSummary(
        run_id="failed_run",
        workflow_id="demo-workflow",
        status="failed",
        run_dir=str(failed_run_dir.resolve()),
        node_count=1,
        failed_nodes=["broken_node"],
        nodes=[node],
    )
    write_json(failed_run_dir / "run_summary.json", summary.model_dump())
    index_path = project_root / "runs" / "index.json"
    current = RunIndex.model_validate(write_json_load(index_path))
    write_json(index_path, RunIndex(runs=[summary, *current.runs]).model_dump())

    response = client.get("/api/decisions")

    assert response.status_code == 200, response.text
    payload = response.json()
    kinds = [item["kind"] for item in payload["items"]]
    assert "run_failed" in kinds
    assert "node_failed" in kinds
    assert all(
        action["destructive"] is False
        for item in payload["items"]
        for action in item["actions"]
    )


def test_decision_inbox_aggregates_graphops_proposals(client, project_root: Path) -> None:
    graphops_dir = project_root / "examples" / "graphops"
    graphops_dir.mkdir(parents=True)
    write_json(
        graphops_dir / "proposal.json",
        {
            "patch_id": "proposal",
            "target_type": "workflow",
            "target_path": "workflows/demo-workflow.yaml",
            "rationale": "Add review gate.",
            "operations": [{"op": "add_node"}],
        },
    )

    response = client.get("/api/decisions?include_events=false")

    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["kind"] == "graphops_proposal"
    assert item["graphops"]["apply_requires_human_approval"] is True
    assert {action["kind"] for action in item["actions"]} == {"validate_patch", "dry_run_patch"}


def write_json_load(path: Path) -> dict:
    import json

    return json.loads(path.read_text(encoding="utf-8"))
