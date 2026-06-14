from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from acc.run_index import NodeRunSummary, RunIndex, RunSummary
from acc.server.app import create_app
from acc.storage import RunHandle, write_run_marker


@pytest.fixture()
def project_root(tmp_path: Path) -> Path:
    create_callable(tmp_path)
    create_run(tmp_path)
    create_workflow(tmp_path)
    (tmp_path / ".env").write_text("TOKEN=secret\n", encoding="utf-8")
    return tmp_path


@pytest.fixture()
def client(project_root: Path) -> TestClient:
    return TestClient(create_app(project_root))


def create_callable(root: Path) -> None:
    callable_dir = root / "callables" / "agents"
    callable_dir.mkdir(parents=True)
    write_yaml(
        callable_dir / "echo-test.generic.yaml",
        {
            "id": "echo-test.generic",
            "version": "0.1.0",
            "runtime": "generic_cli",
            "metadata": {
                "name": "Echo Test",
                "description": "Hermetic echo callable for server tests.",
            },
        },
    )


def create_run(root: Path) -> None:
    run_dir = root / "runs" / "server_run"
    artifact_dir = run_dir / "artifacts"
    artifact_dir.mkdir(parents=True)
    write_run_marker(
        RunHandle(
            run_id="server_run",
            run_dir=run_dir,
            marker_path=run_dir / ".acc-run-marker.json",
        ),
        root,
    )
    (artifact_dir / "report.md").write_text("# Report\n\nhello\n", encoding="utf-8")
    (artifact_dir / "secret-token.txt").write_text("hidden\n", encoding="utf-8")
    (run_dir / "output.json").write_text(
        json.dumps({"status": "success", "summary": "ok"}),
        encoding="utf-8",
    )
    node = NodeRunSummary(
        node_id="server_node",
        callable_id="echo-test.generic",
        session_id="session_test",
        status="success",
        summary="ok",
        run_dir=str(run_dir.resolve()),
        output_path=str((run_dir / "output.json").resolve()),
        artifact_dir=str(artifact_dir.resolve()),
        event_log=str((run_dir / "events.jsonl").resolve()),
        stderr_log=str((run_dir / "stderr.log").resolve()),
    )
    summary = RunSummary(
        run_id="server_run",
        status="success",
        run_dir=str(run_dir.resolve()),
        node_count=1,
        output_path=node.output_path,
        artifact_dir=node.artifact_dir,
        nodes=[node],
    )
    write_json(run_dir / "node_summary.json", node.model_dump())
    write_json(run_dir / "run_summary.json", summary.model_dump())
    write_json(root / "runs" / "index.json", RunIndex(runs=[summary]).model_dump())


def create_workflow(root: Path) -> None:
    workflows_dir = root / "workflows"
    workflows_dir.mkdir()
    write_yaml(
        workflows_dir / "demo-workflow.yaml",
        {
            "name": "demo-workflow",
            "description": "Read-only test workflow.",
            "version": "0.1.0",
            "tasks": [{"name": "server_node", "type": "script"}],
        },
    )


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def write_yaml(path: Path, payload: Any) -> None:
    path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")
