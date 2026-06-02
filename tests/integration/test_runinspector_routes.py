"""Integration tests for the new RunInspector projection HTTP routes.

The Phase 2 backend exposes three additive read endpoints under
``/api/runs/{run_id}/projection/...`` (see ``acc/server/routes/runs.py``).
These tests drive them end-to-end through :class:`fastapi.testclient.TestClient`
backed by ``acc.server.app.create_app``, against a hermetic ``tmp_path``
project root.

Test cases (per task spec):

- ``test_route_get_run_nodes_returns_json``
- ``test_route_get_node_filters_runtime_only_fields``

This file is self-contained — it does NOT depend on
``tests/server/conftest.py`` (which is scoped to ``tests/server/``).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from acc.persistence.manifest import RunManifest, write_atomic
from acc.result_store import (
    ArtifactBundle,
    FilesystemResultStore,
    NodeId,
    NodeResult,
    PortId,
    RunId,
)
from acc.server.app import create_app

RUN_ID = "runinspector_route_run"


# ---------------------------------------------------------------------------
# Hermetic project-root fixture
# ---------------------------------------------------------------------------


@pytest.fixture()
def project_root(tmp_path: Path) -> Path:
    """Build a minimal project root with one run dir registered."""
    run_dir = tmp_path / "runs" / RUN_ID
    run_dir.mkdir(parents=True)
    # `resolve_run_dir_or_404` only requires the run directory to exist;
    # the projection routes don't read run_summary.json, so we deliberately
    # skip the full RunIndex setup that tests/server/conftest.py builds.
    return tmp_path


@pytest.fixture()
def client(project_root: Path) -> TestClient:
    return TestClient(create_app(project_root))


# ---------------------------------------------------------------------------
# Population helpers
# ---------------------------------------------------------------------------


def _put_default_node_result(
    runs_root: Path,
    node_id: str,
    inline_payload: bytes,
    *,
    sha256: str = "d" * 64,
    bundle_id: str | None = None,
) -> None:
    store = FilesystemResultStore(runs_root)
    bundle = ArtifactBundle(
        bundle_id=bundle_id or f"bundle_{node_id}_default",
        relative_path=f"result_store/{node_id}/default.bin",
        sha256=sha256,
        size_bytes=len(inline_payload),
        materialization_mode="inline",
    )
    store.put(
        NodeResult(
            run_id=RunId(RUN_ID),
            node_id=NodeId(node_id),
            port_id=PortId("default"),
            bundle=bundle,
            inline_value=inline_payload,
            produced_at="2026-06-01T00:00:00Z",
        )
    )


def _write_runtime_json(run_dir: Path, node_id: str, payload: dict) -> None:
    node_dir = run_dir / "nodes" / node_id
    node_dir.mkdir(parents=True, exist_ok=True)
    (node_dir / "runtime.json").write_text(json.dumps(payload), encoding="utf-8")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_route_get_run_nodes_returns_json(
    client: TestClient, project_root: Path
) -> None:
    """``GET /api/runs/{run_id}/projection/nodes`` returns one view per node.

    The terminal ``__workflow__`` synthetic record must be excluded from
    the listing (it is surfaced via ``projection/outputs/...`` instead).
    """
    runs_root = project_root / "runs"
    _put_default_node_result(runs_root, "alpha", b'{"alpha":1}')
    _put_default_node_result(runs_root, "beta", b'{"beta":2}')

    # Drop a terminal record so we can prove it is filtered out.
    terminal_store = FilesystemResultStore(runs_root)
    terminal_bundle = ArtifactBundle(
        bundle_id="bundle_terminal",
        relative_path="result_store/__workflow__/answer.bin",
        sha256="e" * 64,
        size_bytes=2,
        materialization_mode="inline",
    )
    terminal_store.put(
        NodeResult(
            run_id=RunId(RUN_ID),
            node_id=NodeId("__workflow__"),
            port_id=PortId("answer"),
            bundle=terminal_bundle,
            inline_value=b"{}",
            produced_at="2026-06-01T00:00:01Z",
        )
    )

    response = client.get(f"/api/runs/{RUN_ID}/projection/nodes")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["run_id"] == RUN_ID

    node_ids = [node["node_id"] for node in payload["nodes"]]
    assert node_ids == ["alpha", "beta"]
    assert "__workflow__" not in node_ids

    alpha = next(node for node in payload["nodes"] if node["node_id"] == "alpha")
    assert alpha["status"] == "produced"
    assert alpha["bundle_summary"] == {
        "bundle_id": "bundle_alpha_default",
        "sha256": "d" * 64,
        "size_bytes": len(b'{"alpha":1}'),
        "materialization_mode": "inline",
    }
    # Without runtime.json, provenance + binding_resolved are empty.
    assert alpha["provenance"] == {}
    assert alpha["binding_resolved"] == []


@pytest.mark.integration
def test_route_get_node_filters_runtime_only_fields(
    client: TestClient, project_root: Path
) -> None:
    """``GET /.../projection/nodes/{node_id}`` strips runtime-only keys.

    Asserts the Workbench-safe whitelist
    (``target_field`` / ``source`` / ``materialization_mode``) is the
    only thing that surfaces in ``binding_resolved``. Hash fields,
    runtime metadata, and unknown keys planted in ``runtime.json`` must
    NOT appear in the JSON response.
    """
    runs_root = project_root / "runs"
    run_dir = runs_root / RUN_ID

    _put_default_node_result(runs_root, "gamma", b'{"gamma":3}')
    _write_runtime_json(
        run_dir,
        "gamma",
        {
            "binding_materializations": [
                {
                    "target_field": "topic",
                    "source": "(runinspector_route_run, alpha, default)",
                    "inline_value_sha256": "f" * 64,
                    "source_artifact_sha256": None,
                    "materialization_mode": "inline",
                    # Runtime-only keys that must be filtered out:
                    "internal_runtime_metadata": {"frame_id": "frame-9"},
                    "secret_internal_key": "must-not-leak",
                }
            ],
            "provenance": {
                "producer_session_id": "sess-001",
                "bundle_id": "bundle_gamma_default",
                "binding_applied": "selector",
                "call_depth": 0,
                "materialization_mode_resolved": "copy",
                "parent_frame_id": None,
                "invoking_workflow_call_id": None,
                "inline_value_sha256": "f" * 64,
                "source_artifact_sha256": None,
                "schema_version": 1,
            },
        },
    )

    response = client.get(f"/api/runs/{RUN_ID}/projection/nodes/gamma")

    assert response.status_code == 200, response.text
    payload = response.json()

    assert payload["node_id"] == "gamma"
    assert payload["status"] == "produced"

    # Whitelist enforced: only the three safe keys appear in each row.
    assert payload["binding_resolved"] == [
        {
            "target_field": "topic",
            "source": "(runinspector_route_run, alpha, default)",
            "materialization_mode": "inline",
        }
    ]
    flat_response = response.text
    assert "inline_value_sha256" not in flat_response.split(
        '"provenance"'
    )[0]  # not in binding_resolved half
    assert "internal_runtime_metadata" not in flat_response
    assert "secret_internal_key" not in flat_response
    assert "must-not-leak" not in flat_response

    # Provenance round-trips intact (it IS allowed to expose its declared
    # fields — including the sha — because ProvenanceObject is the public
    # lineage record). Just sanity-check a couple of fields.
    assert payload["provenance"]["binding_applied"] == "selector"
    assert payload["provenance"]["materialization_mode_resolved"] == "copy"
    assert payload["provenance"]["schema_version"] == 1

    # 404 path on a node that has no ResultStore record.
    response_404 = client.get(f"/api/runs/{RUN_ID}/projection/nodes/never-existed")
    assert response_404.status_code == 404


@pytest.mark.integration
def test_route_workflow_output_lookup_returns_manifest_provenance(
    client: TestClient, project_root: Path
) -> None:
    """``GET /.../projection/outputs/{target_field}`` end-to-end smoke.

    Included alongside the two task-spec cases because the workflow
    output route is part of the same surface and otherwise has no
    integration coverage at this path. Verifies that the manifest row
    is plumbed through to the JSON response intact.
    """
    runs_root = project_root / "runs"
    run_dir = runs_root / RUN_ID

    terminal_store = FilesystemResultStore(runs_root)
    terminal_bundle = ArtifactBundle(
        bundle_id="bundle_terminal_answer",
        relative_path="result_store/__workflow__/answer.bin",
        sha256="d" * 64,
        size_bytes=2,
        materialization_mode="inline",
    )
    terminal_store.put(
        NodeResult(
            run_id=RunId(RUN_ID),
            node_id=NodeId("__workflow__"),
            port_id=PortId("answer"),
            bundle=terminal_bundle,
            inline_value=b"{}",
            produced_at="2026-06-01T00:00:02Z",
        )
    )
    write_atomic(
        RunManifest(
            run_id=RUN_ID,
            schema_version=1,
            workflow_outputs=[
                {
                    "target_field": "answer",
                    "source_node_id": "alpha",
                    "source_port_id": "default",
                    "bundle_id": "bundle_terminal_answer",
                    "sha256": "d" * 64,
                }
            ],
        ),
        run_dir,
    )

    response = client.get(f"/api/runs/{RUN_ID}/projection/outputs/answer")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["node_id"] == "__workflow__"
    assert payload["bundle_summary"]["bundle_id"] == "bundle_terminal_answer"
    assert payload["provenance"] == {
        "source_node_id": "alpha",
        "source_port_id": "default",
        "bundle_id": "bundle_terminal_answer",
        "sha256": "d" * 64,
    }

    # Unknown target_field => 404.
    response_404 = client.get(f"/api/runs/{RUN_ID}/projection/outputs/missing-field")
    assert response_404.status_code == 404
