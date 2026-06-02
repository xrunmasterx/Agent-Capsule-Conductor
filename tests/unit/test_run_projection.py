"""Unit tests for :mod:`acc.server.run_projection` (Phase 2 RunInspector).

These tests exercise ``RunProjection`` purely as a reader against a fake
``runs/<run_id>/`` tree built in ``tmp_path``. The tree is populated via
:class:`FilesystemResultStore` plus a hand-written ``runtime.json`` /
``run_manifest.json`` side-channel — exactly the on-disk shape produced
by ``acc.app.binding_runtime`` in the Phase 2 hot path.

Test cases (per task spec):

- ``test_projection_node_view_excludes_runtime_payload``
- ``test_projection_provenance_serialized``
- ``test_projection_workflow_output_lookup``
- ``test_projection_missing_node_returns_none``
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from acc.persistence.manifest import RunManifest, write_atomic
from acc.result_store import (
    ArtifactBundle,
    FilesystemResultStore,
    NodeId,
    NodeResult,
    PortId,
    RunId,
)
from acc.server.run_projection import (
    DEFAULT_RESULT_STORE_PORT_ID,
    TERMINAL_WORKFLOW_NODE_ID,
    NodeProjectionView,
    RunProjection,
)

RUN_ID = "run-projection-unit"


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _put_default_node_result(
    runs_root: Path,
    node_id: str,
    inline_payload: bytes,
    *,
    sha256: str = "a" * 64,
    bundle_id: str | None = None,
) -> None:
    """Drop a single inline NodeResult under (RUN_ID, node_id, "default")."""
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
            port_id=PortId(DEFAULT_RESULT_STORE_PORT_ID),
            bundle=bundle,
            inline_value=inline_payload,
            produced_at="2026-06-01T00:00:00Z",
        )
    )


def _build_projection(tmp_path: Path) -> tuple[RunProjection, Path]:
    runs_root = tmp_path / "runs"
    run_dir = runs_root / RUN_ID
    run_dir.mkdir(parents=True, exist_ok=True)
    return (
        RunProjection(
            result_store=FilesystemResultStore(runs_root),
            run_dir=run_dir,
        ),
        run_dir,
    )


def _write_runtime_json(run_dir: Path, node_id: str, payload: dict) -> None:
    node_dir = run_dir / "nodes" / node_id
    node_dir.mkdir(parents=True, exist_ok=True)
    (node_dir / "runtime.json").write_text(json.dumps(payload), encoding="utf-8")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_projection_node_view_excludes_runtime_payload(tmp_path: Path) -> None:
    """`binding_resolved` must surface only the Workbench-safe whitelist.

    Specifically: ``target_field``, ``source``, ``materialization_mode``.
    Hash fields (``inline_value_sha256`` / ``source_artifact_sha256``)
    and any unknown runtime-only keys must NOT leak into the projection
    or its JSON form.
    """
    projection, run_dir = _build_projection(tmp_path)
    _put_default_node_result(tmp_path / "runs", "node-X", b'{"x":1}')

    _write_runtime_json(
        run_dir,
        "node-X",
        {
            "binding_materializations": [
                {
                    "target_field": "topic",
                    "source": "(run-projection-unit, node-A, default)",
                    "inline_value_sha256": "f" * 64,
                    "source_artifact_sha256": None,
                    "materialization_mode": "inline",
                    # Runtime-only key that must NOT leak through:
                    "internal_runtime_metadata": {"frame_id": "frame-1"},
                    "secret_internal_key": "must-not-leak",
                }
            ]
        },
    )

    view = projection.get_node(RunId(RUN_ID), NodeId("node-X"))

    assert view is not None
    assert isinstance(view, NodeProjectionView)

    # Whitelist check on the dataclass field directly.
    assert view.binding_resolved == [
        {
            "target_field": "topic",
            "source": "(run-projection-unit, node-A, default)",
            "materialization_mode": "inline",
        }
    ]

    # Whitelist check on the JSON form too.
    payload = view.to_jsonable()
    assert payload["binding_resolved"] == [
        {
            "target_field": "topic",
            "source": "(run-projection-unit, node-A, default)",
            "materialization_mode": "inline",
        }
    ]
    flat = json.dumps(payload)
    assert "inline_value_sha256" not in flat
    assert "source_artifact_sha256" not in flat
    assert "internal_runtime_metadata" not in flat
    assert "secret_internal_key" not in flat
    assert "must-not-leak" not in flat


@pytest.mark.unit
def test_projection_provenance_serialized(tmp_path: Path) -> None:
    """A schema-valid runtime.json provenance round-trips into the view.

    The X-4 invariant (exactly one of ``inline_value_sha256`` /
    ``source_artifact_sha256`` non-None) must survive intact, the
    materialization_mode_resolved value must be preserved, and the
    serialized projection must be a flat JSON-friendly dict.
    """
    projection, run_dir = _build_projection(tmp_path)
    _put_default_node_result(tmp_path / "runs", "node-Y", b'{"y":2}')

    raw_provenance = {
        "producer_session_id": "sess-007",
        "bundle_id": "bundle_node-Y_default",
        "binding_applied": "selector",
        "call_depth": 0,
        "materialization_mode_resolved": "copy",
        "parent_frame_id": None,
        "invoking_workflow_call_id": None,
        "inline_value_sha256": "b" * 64,
        "source_artifact_sha256": None,
        "schema_version": 1,
    }
    _write_runtime_json(
        run_dir,
        "node-Y",
        {"provenance": raw_provenance, "binding_materializations": []},
    )

    view = projection.get_node(RunId(RUN_ID), NodeId("node-Y"))

    assert view is not None
    # Round-tripped through ProvenanceObject — every declared field is present.
    assert view.provenance == raw_provenance
    assert view.provenance["binding_applied"] == "selector"
    assert view.provenance["inline_value_sha256"] == "b" * 64
    assert view.provenance["source_artifact_sha256"] is None
    assert view.provenance["materialization_mode_resolved"] == "copy"
    assert view.provenance["schema_version"] == 1

    # The JSON form is a plain dict and matches the dataclass field.
    payload = view.to_jsonable()
    assert payload["provenance"] == raw_provenance
    # Sanity: it serialises without a TypeError.
    json.dumps(payload)


@pytest.mark.unit
def test_projection_workflow_output_lookup(tmp_path: Path) -> None:
    """``get_workflow_output`` reads the __workflow__ terminal record.

    The terminal NodeResult sits under ``result_store/__workflow__/<target>.*``
    and its provenance is sourced from ``RunManifest.workflow_outputs``.
    Verifies that:

    1. A declared target_field is found and returned with bundle_summary.
    2. The provenance dict matches the manifest row exactly.
    3. ``binding_resolved`` is empty (terminal records have no upstream
       per-binding materialization rows).
    4. An unknown target_field returns ``None``.
    """
    projection, run_dir = _build_projection(tmp_path)
    runs_root = tmp_path / "runs"

    # Source node so the terminal record has something it could point at.
    _put_default_node_result(runs_root, "node-A", b'{"answer":"42"}')

    terminal_store = FilesystemResultStore(runs_root)
    terminal_bundle = ArtifactBundle(
        bundle_id="bundle_node-A_default",
        relative_path=f"result_store/{TERMINAL_WORKFLOW_NODE_ID}/answer.bin",
        sha256="a" * 64,
        size_bytes=15,
        materialization_mode="inline",
    )
    terminal_store.put(
        NodeResult(
            run_id=RunId(RUN_ID),
            node_id=NodeId(TERMINAL_WORKFLOW_NODE_ID),
            port_id=PortId("answer"),
            bundle=terminal_bundle,
            inline_value=b'{"answer":"42"}',
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
                    "source_node_id": "node-A",
                    "source_port_id": "default",
                    "bundle_id": "bundle_node-A_default",
                    "sha256": "a" * 64,
                }
            ],
        ),
        run_dir,
    )

    view = projection.get_workflow_output(RunId(RUN_ID), "answer")

    assert view is not None
    assert view.node_id == TERMINAL_WORKFLOW_NODE_ID
    assert view.status == "produced"
    assert view.bundle_summary == {
        "bundle_id": "bundle_node-A_default",
        "sha256": "a" * 64,
        "size_bytes": 15,
        "materialization_mode": "inline",
    }
    assert view.provenance == {
        "source_node_id": "node-A",
        "source_port_id": "default",
        "bundle_id": "bundle_node-A_default",
        "sha256": "a" * 64,
    }
    assert view.binding_resolved == []

    # Unknown target_field — must return None, not raise.
    assert projection.get_workflow_output(RunId(RUN_ID), "missing-field") is None


@pytest.mark.unit
def test_projection_missing_node_returns_none(tmp_path: Path) -> None:
    """``get_node`` returns ``None`` when no ResultStore record exists.

    This is the sole "absent" path for per-node lookup — Workbench
    callers translate it into a 404 at the HTTP layer (covered by the
    integration tests). The reader itself must not raise.
    """
    projection, _run_dir = _build_projection(tmp_path)

    # Empty runs/<run_id>/ — no result_store/ subtree at all.
    assert projection.get_node(RunId(RUN_ID), NodeId("never-existed")) is None

    # Populate one node, then look up a different one.
    _put_default_node_result(tmp_path / "runs", "node-A", b'{"a":1}')
    assert projection.get_node(RunId(RUN_ID), NodeId("node-A")) is not None
    assert projection.get_node(RunId(RUN_ID), NodeId("node-B")) is None
