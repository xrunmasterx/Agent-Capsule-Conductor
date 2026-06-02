"""HTTP smoke tests for the new ResultStore projection routes.

Reuses the ``project_root`` / ``client`` fixtures from
``tests/server/conftest.py``: those fixtures already build a fake run
under ``runs/server_run/`` complete with ``run_summary.json``. We
augment that run dir with a ``result_store/`` subtree so the new
routes have something to surface, and exercise them end-to-end via
:class:`fastapi.testclient.TestClient`.

These tests verify that the new routes do NOT change any existing
route's behavior (the existing legacy ``/api/runs/{run_id}/nodes/{node_id}``
route is still reachable and returns its original payload shape).
"""

from __future__ import annotations

from pathlib import Path

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

RUN_ID = "server_run"


def _populate_result_store(project_root: Path) -> None:
    runs_root = project_root / "runs"
    store = FilesystemResultStore(runs_root)
    bundle = ArtifactBundle(
        bundle_id="bundle_server_node_default",
        relative_path="result_store/server_node/default.bin",
        sha256="d" * 64,
        size_bytes=2,
        materialization_mode="inline",
    )
    store.put(
        NodeResult(
            run_id=RunId(RUN_ID),
            node_id=NodeId("server_node"),
            port_id=PortId("default"),
            bundle=bundle,
            inline_value=b"{}",
            produced_at="2026-06-01T00:00:00Z",
        )
    )


def test_list_projection_nodes_returns_node_views(
    client: TestClient, project_root: Path
) -> None:
    _populate_result_store(project_root)

    response = client.get(f"/api/runs/{RUN_ID}/projection/nodes")

    assert response.status_code == 200
    payload = response.json()
    assert payload["run_id"] == RUN_ID
    assert len(payload["nodes"]) == 1
    node = payload["nodes"][0]
    assert node["node_id"] == "server_node"
    assert node["status"] == "produced"
    assert node["bundle_summary"]["bundle_id"] == "bundle_server_node_default"


def test_get_projection_node_404_when_absent(
    client: TestClient, project_root: Path
) -> None:
    response = client.get(f"/api/runs/{RUN_ID}/projection/nodes/server_node")
    assert response.status_code == 404


def test_get_projection_workflow_output(
    client: TestClient, project_root: Path
) -> None:
    _populate_result_store(project_root)
    runs_root = project_root / "runs"
    run_dir = runs_root / RUN_ID
    terminal_store = FilesystemResultStore(runs_root)
    terminal_bundle = ArtifactBundle(
        bundle_id="bundle_server_node_default",
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
            produced_at="2026-06-01T00:00:01Z",
        )
    )
    write_atomic(
        RunManifest(
            run_id=RUN_ID,
            schema_version=1,
            workflow_outputs=[
                {
                    "target_field": "answer",
                    "source_node_id": "server_node",
                    "source_port_id": "default",
                    "bundle_id": "bundle_server_node_default",
                    "sha256": "d" * 64,
                }
            ],
        ),
        run_dir,
    )

    response = client.get(f"/api/runs/{RUN_ID}/projection/outputs/answer")

    assert response.status_code == 200
    payload = response.json()
    assert payload["node_id"] == "__workflow__"
    assert payload["bundle_summary"]["bundle_id"] == "bundle_server_node_default"
    assert payload["provenance"]["source_node_id"] == "server_node"


def test_existing_node_route_unchanged_by_projection_addition(
    client: TestClient,
) -> None:
    # Sanity check: the pre-existing /nodes/{node_id} route still serves
    # its original (non-projection) shape after the new routes were added.
    response = client.get(f"/api/runs/{RUN_ID}/nodes/server_node")
    assert response.status_code == 200
    payload = response.json()
    # The legacy projection from acc.app.run_projection includes these keys:
    assert payload["node_id"] == "server_node"
    assert "artifacts_url" in payload
    assert payload["artifacts_url"] == f"/api/runs/{RUN_ID}/nodes/server_node/artifacts"
    # And specifically does NOT include the new projection's keys:
    assert "bundle_summary" not in payload
    assert "binding_resolved" not in payload
