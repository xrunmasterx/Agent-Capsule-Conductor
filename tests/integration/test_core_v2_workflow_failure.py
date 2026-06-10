from __future__ import annotations

import asyncio
import json
from pathlib import Path

from acc.app.core_v2_runtime import run_core_v2_workflow_path
from acc.models import CORE_V2_SCHEMA_VERSION


def test_core_v2_node_failure_marks_run_failed(tmp_path: Path) -> None:
    workflow_path = tmp_path / "failure.accflow.json"
    workflow_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "failure",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "fail",
                        "callable_ref": {"kind": "tool_class", "id": "fail"},
                    },
                    {
                        "id": "after",
                        "callable_ref": {
                            "kind": "agent_class",
                            "id": "generic_fake_agent",
                        },
                    },
                ],
                "control_edges": [{"from": "fail", "to": "after"}],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))
    events = (tmp_path / "run" / "events.jsonl").read_text(encoding="utf-8")
    session = json.loads(
        (
            tmp_path
            / "run"
            / "nodes"
            / "fail"
            / "session_instance_manifest.json"
        ).read_text(encoding="utf-8")
    )
    failure_path = tmp_path / "run" / "failures" / "failure_run_fail.json"
    failure = json.loads(failure_path.read_text(encoding="utf-8"))

    assert record.status == "failed"
    assert "workflow_failed" in events
    assert "node_failed" in events
    assert session["status"] == "failed"
    assert "failed by configuration" in session["error"]
    assert failure["layer"] == "adapter"
    assert failure["node_id"] == "fail"
    assert (tmp_path / "run" / "nodes" / "fail" / "stdout.txt").exists()
    assert "failed by configuration" in (
        tmp_path / "run" / "nodes" / "fail" / "stderr.txt"
    ).read_text(encoding="utf-8")
    assert not (tmp_path / "run" / "nodes" / "after" / "output.json").exists()
