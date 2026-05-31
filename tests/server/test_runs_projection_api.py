from __future__ import annotations

import json


def test_get_node_includes_projection_fields(client, project_root) -> None:
    run_dir = project_root / "runs" / "projection_fixture_run"
    node_dir = run_dir / "node_runs" / "echo"
    node_dir.mkdir(parents=True, exist_ok=True)
    (node_dir / "stdout.log").write_text("hello stdout\nsecond line\n", encoding="utf-8")
    (node_dir / "output.json").write_text(
        json.dumps({"summary": "done", "value": "ok"}),
        encoding="utf-8",
    )
    (node_dir / "events.jsonl").write_text(
        json.dumps(
            {
                "event_id": "evt_1",
                "type": "session_started",
                "timestamp": "2026-05-29T00:00:00Z",
                "status": "running",
                "payload": {"summary": "started"},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": "projection_fixture_run",
                "status": "success",
                "run_dir": str(run_dir.resolve()),
                "node_count": 1,
                "nodes": [
                    {
                        "node_id": "echo",
                        "capsule_id": "echo-test.generic",
                        "status": "success",
                        "summary": "done",
                        "run_dir": str(node_dir.resolve()),
                        "output_path": str((node_dir / "output.json").resolve()),
                        "stdout_log": str((node_dir / "stdout.log").resolve()),
                        "event_log": str((node_dir / "events.jsonl").resolve()),
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    response = client.get("/api/runs/projection_fixture_run/nodes/echo")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["output_preview"]["summary"] == "done"
    assert payload["steps"]
    assert payload["log_excerpt"]
    assert payload["log_ref"]
