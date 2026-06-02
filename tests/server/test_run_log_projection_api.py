from __future__ import annotations


def test_node_log_delta_reads_by_offset(client, project_root) -> None:
    node_dir = project_root / "runs" / "server_run" / "nodes" / "server_node"
    node_dir.mkdir(parents=True)
    (node_dir / "stdout.log").write_bytes(b"alpha\nbeta\n")
    (node_dir / "stderr.log").write_bytes(b"err\n")

    response = client.get("/api/runs/server_run/nodes/server_node/logs/stdout?offset=6")

    assert response.status_code == 200
    payload = response.json()
    assert payload["type"] == "node_log_delta"
    assert payload["run_id"] == "server_run"
    assert payload["node_id"] == "server_node"
    assert payload["stream"] == "stdout"
    assert payload["offset"] == 6
    assert payload["next_offset"] == 11
    assert payload["text"] == "beta\n"


def test_node_log_delta_rejects_path_traversal(client) -> None:
    response = client.get("/api/runs/server_run/nodes/../logs/stdout")

    assert response.status_code in {400, 404}


def test_node_log_delta_rejects_invalid_stream(client) -> None:
    response = client.get("/api/runs/server_run/nodes/server_node/logs/runtime")

    assert response.status_code == 400
