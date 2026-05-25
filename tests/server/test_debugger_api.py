from __future__ import annotations

import json
from pathlib import Path


def test_debugger_replay_and_lineage_routes(client, project_root: Path) -> None:
    graph_path = project_root / "workflows" / "server_graph.graph.json"
    graph_path.write_text(
        json.dumps(
            {
                "id": "server_graph",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "echo_a",
                        "capsule_id": "echo-test.generic",
                        "input": {"message": "hello server"},
                    },
                    {
                        "id": "echo_b",
                        "capsule_id": "echo-test.generic",
                        "input_mapping": {"message": "{{ nodes.echo_a.output.summary }}"},
                    },
                ],
                "edges": [{"id": "edge_a_b", "from": "echo_a", "to": "echo_b"}],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    run_response = client.post(
        "/api/workflows/server_graph/run",
        json={"run_dir": "runs/server_graph_run"},
    )
    assert run_response.status_code == 200, run_response.text

    replay_response = client.post(
        "/api/debugger/runs/server_graph_run/replay",
        json={"node_id": "echo_a"},
    )
    assert replay_response.status_code == 200, replay_response.text
    replay_payload = replay_response.json()
    assert replay_payload["node_filter"] == "echo_a"
    assert replay_payload["nodes"][0]["node_id"] == "echo_a"

    # Simulate a legacy run created before workflow_graph.json snapshots existed.
    snapshot_path = project_root / "runs" / "server_graph_run" / "workflow_graph.json"
    snapshot_path.unlink(missing_ok=True)

    rerun_response = client.post(
        "/api/debugger/runs/server_graph_run/nodes/echo_a/rerun",
        json={"out_dir": "runs/server_graph_rerun_node"},
    )
    assert rerun_response.status_code == 200, rerun_response.text
    assert rerun_response.json()["run_dir"].endswith("server_graph_rerun_node")

    rerun_from_response = client.post(
        "/api/debugger/runs/server_graph_run/nodes/echo_a/rerun-from",
        json={"out_dir": "runs/server_graph_rerun_from"},
    )
    assert rerun_from_response.status_code == 200, rerun_from_response.text
    assert rerun_from_response.json()["run_dir"].endswith("server_graph_rerun_from")

    fork_response = client.post(
        "/api/debugger/runs/server_graph_run/nodes/echo_a/fork",
        json={
            "out_dir": "runs/server_graph_fork",
            "override": {"message": "forked from api"},
        },
    )
    assert fork_response.status_code == 200, fork_response.text
    assert (project_root / "runs" / "server_graph_fork" / "fork_manifest.json").exists()

    diff_response = client.post(
        "/api/debugger/diff",
        json={
            "run_a": "runs/server_graph_run",
            "run_b": "runs/server_graph_fork",
        },
    )
    assert diff_response.status_code == 200, diff_response.text
    diff_payload = diff_response.json()
    assert diff_payload["run_a"].endswith("server_graph_run")
    assert "changed_nodes" in diff_payload
