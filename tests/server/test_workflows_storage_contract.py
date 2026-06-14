from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from acc.storage import RUN_MARKER_FILENAME


def _workbench_graph(graph_id: str = "storage_contract_flow") -> dict:
    return {
        "id": graph_id,
        "version": "0.4.0",
        "name": "Storage Contract Flow",
        "nodes": [
            {
                "id": "collect",
                "kind": "agent_session",
                "label": "Collect",
                "callable_ref": {"kind": "agent_class", "id": "echo-test.generic"},
                "input": {"prompt": "Collect facts."},
                "input_mapping": {},
                "input_ports": [{"id": "main"}],
                "output_ports": [{"id": "main"}],
                "position": {"x": 100, "y": 100},
            }
        ],
        "control_edges": [],
        "data_edges": [],
        "workspace_policy": {"save_mode": "local_binding"},
    }


def test_submit_accepts_run_id_and_writes_acc_marker(
    client: TestClient,
    project_root: Path,
) -> None:
    response = client.post(
        "/api/workflows/run-graph/submit",
        json={
            "graph": _workbench_graph(),
            "run_id": "safe_submit_run",
            "task_id": "task-storage",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["run_id"] == "safe_submit_run"
    marker_path = project_root / "runs" / "safe_submit_run" / RUN_MARKER_FILENAME
    marker = json.loads(marker_path.read_text(encoding="utf-8"))
    assert marker["run_id"] == "safe_submit_run"
    assert marker["created_by"] == "acc"
    assert marker["task_id"] == "task-storage"


def test_submit_rejects_legacy_run_dir_outside_runs_before_spec_write(
    client: TestClient,
    project_root: Path,
) -> None:
    response = client.post(
        "/api/workflows/run-graph/submit",
        json={
            "graph": _workbench_graph("reject_path_flow"),
            "run_dir": "workflows/evil",
        },
    )

    assert response.status_code == 400
    assert "runs/<run_id>" in response.text
    assert not (project_root / "workflows" / "evil").exists()
    assert not (project_root / "runs" / "_workflow_function_specs").exists()


def test_submit_duplicate_run_id_returns_conflict(
    client: TestClient,
    project_root: Path,
) -> None:
    run_dir = project_root / "runs" / "duplicate_submit"
    run_dir.mkdir(parents=True)
    (run_dir / RUN_MARKER_FILENAME).write_text(
        json.dumps({"schema_version": 1, "run_id": "duplicate_submit", "created_by": "acc"}),
        encoding="utf-8",
    )

    response = client.post(
        "/api/workflows/run-graph/submit",
        json={
            "graph": _workbench_graph("duplicate_flow"),
            "run_id": "duplicate_submit",
        },
    )

    assert response.status_code == 409
    assert "Run already exists" in response.text


def test_submit_legacy_run_dir_accepts_exact_runs_child(
    client: TestClient,
    project_root: Path,
) -> None:
    response = client.post(
        "/api/workflows/run-graph/submit",
        json={
            "graph": _workbench_graph("legacy_ok_flow"),
            "run_dir": "runs/legacy_ok",
        },
    )

    assert response.status_code == 200, response.text
    marker_path = project_root / "runs" / "legacy_ok" / RUN_MARKER_FILENAME
    assert json.loads(marker_path.read_text(encoding="utf-8"))["run_id"] == "legacy_ok"
