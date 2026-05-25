from __future__ import annotations

import json


def test_list_runs(client) -> None:
    response = client.get("/api/runs")

    assert response.status_code == 200
    assert response.json()["runs"][0]["run_id"] == "server_run"


def test_get_run_summary(client) -> None:
    response = client.get("/api/runs/server_run")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "success"
    assert payload["output_path"]
    assert payload["artifact_dir"]


def test_missing_run_returns_404(client) -> None:
    response = client.get("/api/runs/missing")

    assert response.status_code == 404


def test_get_node_details(client) -> None:
    response = client.get("/api/runs/server_run/nodes/server_node")

    assert response.status_code == 200
    payload = response.json()
    assert payload["node_id"] == "server_node"
    assert payload["artifacts_url"] == "/api/runs/server_run/nodes/server_node/artifacts"


def test_get_node_artifacts(client) -> None:
    response = client.get("/api/runs/server_run/nodes/server_node/artifacts")

    assert response.status_code == 200
    artifacts = response.json()["artifacts"]
    assert [artifact["name"] for artifact in artifacts] == ["report.md"]


def test_get_run_events(client, project_root) -> None:
    event_log = project_root / "runs" / "server_run" / "workflow_events.jsonl"
    event_log.write_text(
        '{"type":"workflow_started","status":"running"}\n'
        '{"type":"node_started","node_id":"server_node","status":"running"}\n',
        encoding="utf-8",
    )

    response = client.get("/api/runs/server_run/events")

    assert response.status_code == 200
    payload = response.json()
    assert payload["events"][0]["type"] == "workflow_started"
    assert payload["events"][1]["node_id"] == "server_node"


def test_get_run_events_returns_tail_limit(client, project_root) -> None:
    event_log = project_root / "runs" / "server_run" / "workflow_events.jsonl"
    event_log.write_text(
        "\n".join(f'{{"type":"event","index":{index}}}' for index in range(5)) + "\n",
        encoding="utf-8",
    )

    response = client.get("/api/runs/server_run/events?limit=2")

    assert response.status_code == 200
    assert [event["index"] for event in response.json()["events"]] == [3, 4]


def test_get_node_events_tolerates_raw_log_lines(client, project_root) -> None:
    node_dir = project_root / "runs" / "server_run" / "node_runs" / "server_node"
    node_dir.mkdir(parents=True)
    (node_dir / "events.jsonl").write_text(
        '{"type":"session_started","status":"created"}\nnot json\n',
        encoding="utf-8",
    )

    response = client.get("/api/runs/server_run/nodes/server_node/events")

    assert response.status_code == 200
    events = response.json()["events"]
    assert events[0]["type"] == "session_started"
    assert events[1]["type"] == "raw_log"


def test_run_events_reject_path_traversal(client) -> None:
    response = client.get("/api/runs/%2E%2E/events")

    assert response.status_code in {400, 404}


def test_node_events_reject_path_traversal(client) -> None:
    response = client.get("/api/runs/server_run/nodes/%2E%2E/events")

    assert response.status_code in {400, 404}


def test_list_runs_deduplicates_duplicate_run_ids(client, project_root) -> None:
    index_path = project_root / "runs" / "index.json"
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    payload["runs"].append(payload["runs"][0])
    index_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    response = client.get("/api/runs")

    assert response.status_code == 200
    runs = response.json()["runs"]
    assert len(runs) == 1
    assert runs[0]["run_id"] == "server_run"
