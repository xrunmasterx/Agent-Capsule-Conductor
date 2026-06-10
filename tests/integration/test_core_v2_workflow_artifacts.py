from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from acc.app.core_v2_runtime import run_core_v2_workflow_path
from acc.models import CORE_V2_SCHEMA_VERSION, AccError


def test_core_v2_artifact_and_payload_files_are_written(tmp_path: Path) -> None:
    workflow_path = tmp_path / "artifacts.accflow.json"
    workflow_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "artifacts",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "produce",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "ports": {"outputs": {"main": {}}},
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))
    node_dir = tmp_path / "run" / "nodes" / "produce"

    assert record.status == "success"
    assert (node_dir / "agent_payload.json").exists()
    assert (node_dir / "runtime_payload.json").exists()
    assert (node_dir / "binding_manifest.json").exists()
    assert (node_dir / "stdout.txt").exists()
    assert (node_dir / "stderr.txt").exists()
    assert (node_dir / "artifact_bundle.json").exists()
    assert (node_dir / "artifacts" / "payload.json").exists()
    assert (tmp_path / "run" / "result_store" / "produce" / "main.json").exists()


def test_core_v2_required_artifact_missing_fails_before_result_store_commit(
    tmp_path: Path,
) -> None:
    workflow_path = tmp_path / "missing_artifact.accflow.json"
    workflow_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "missing_artifact",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "produce",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "artifact_contract": {"required_paths": ["missing.txt"]},
                        "ports": {"outputs": {"main": {}}},
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    record = asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))
    failure = json.loads(
        (tmp_path / "run" / "failures" / "failure_run_produce.json").read_text(
            encoding="utf-8"
        )
    )

    assert record.status == "failed"
    assert "Required artifact missing" in failure["message"]
    assert not (tmp_path / "run" / "result_store" / "produce" / "main.json").exists()


def test_core_v2_artifact_path_escape_rejected_before_runtime(tmp_path: Path) -> None:
    workflow_path = tmp_path / "artifact_escape.accflow.json"
    workflow_path.write_text(
        json.dumps(
            {
                "schema_version": CORE_V2_SCHEMA_VERSION,
                "id": "artifact_escape",
                "version": "0.1.0",
                "nodes": [
                    {
                        "id": "produce",
                        "callable_ref": {"kind": "tool_class", "id": "fake_producer"},
                        "artifact_contract": {"optional_paths": ["../escape.txt"]},
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    with pytest.raises(AccError, match="unsafe artifact path"):
        asyncio.run(run_core_v2_workflow_path(workflow_path, tmp_path / "run"))
    assert not (tmp_path / "run").exists()
