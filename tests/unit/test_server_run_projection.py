"""Unit tests for :mod:`acc.server.run_projection`.

Phase 2 RunInspector projection coverage. The tests build a fake run
directory in ``tmp_path``, populate ``runs/<run_id>/result_store/`` via
:class:`FilesystemResultStore` directly, and (where applicable) drop a
``runtime.json`` / ``run_manifest.json`` side-channel — exactly the
shape produced by :mod:`acc.app.binding_runtime`. Then the projection
is exercised purely as a reader.
"""

from __future__ import annotations

import json
from pathlib import Path

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

RUN_ID = "run-projection-1"


def _put_default_node_result(
    runs_root: Path,
    node_id: str,
    inline_payload: bytes,
    *,
    sha256: str = "a" * 64,
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


def test_get_node_returns_view_with_bundle_summary(tmp_path: Path) -> None:
    projection, _run_dir = _build_projection(tmp_path)
    _put_default_node_result(tmp_path / "runs", "node-A", b'{"x":1}', sha256="c" * 64)

    view = projection.get_node(RunId(RUN_ID), NodeId("node-A"))

    assert isinstance(view, NodeProjectionView)
    assert view.node_id == "node-A"
    assert view.status == "produced"
    assert view.bundle_summary == {
        "bundle_id": "bundle_node-A_default",
        "sha256": "c" * 64,
        "size_bytes": len(b'{"x":1}'),
        "materialization_mode": "inline",
    }
    assert view.provenance == {}
    assert view.binding_resolved == []


def test_get_node_returns_none_when_absent(tmp_path: Path) -> None:
    projection, _ = _build_projection(tmp_path)
    assert projection.get_node(RunId(RUN_ID), NodeId("missing")) is None


def test_get_node_includes_provenance_and_bindings_from_runtime_json(
    tmp_path: Path,
) -> None:
    projection, run_dir = _build_projection(tmp_path)
    _put_default_node_result(tmp_path / "runs", "node-B", b'{"y":2}')
    runtime = {
        "binding_materializations": [
            {
                "target_field": "topic",
                "source": "(run-projection-1, node-A, default)",
                "inline_value_sha256": "a" * 64,
                "source_artifact_sha256": None,
                "materialization_mode": "inline",
            }
        ],
        "provenance": {
            "producer_session_id": "",
            "bundle_id": "node-B",
            "binding_applied": "selector",
            "call_depth": 0,
            "materialization_mode_resolved": "copy",
            "parent_frame_id": None,
            "invoking_workflow_call_id": None,
            "inline_value_sha256": "b" * 64,
            "source_artifact_sha256": None,
            "schema_version": 1,
        },
    }
    node_dir = run_dir / "nodes" / "node-B"
    node_dir.mkdir(parents=True)
    (node_dir / "runtime.json").write_text(json.dumps(runtime), encoding="utf-8")

    view = projection.get_node(RunId(RUN_ID), NodeId("node-B"))

    assert view is not None
    assert view.provenance["binding_applied"] == "selector"
    assert view.provenance["inline_value_sha256"] == "b" * 64
    # binding_resolved is filtered to safe-for-Workbench fields only.
    assert view.binding_resolved == [
        {
            "target_field": "topic",
            "source": "(run-projection-1, node-A, default)",
            "materialization_mode": "inline",
        }
    ]


def test_get_node_drops_invalid_provenance_silently(tmp_path: Path) -> None:
    projection, run_dir = _build_projection(tmp_path)
    _put_default_node_result(tmp_path / "runs", "node-C", b"{}")
    node_dir = run_dir / "nodes" / "node-C"
    node_dir.mkdir(parents=True)
    # Both sha fields None -> violates X-4, must be filtered out.
    (node_dir / "runtime.json").write_text(
        json.dumps(
            {
                "provenance": {
                    "producer_session_id": "",
                    "bundle_id": "node-C",
                    "binding_applied": "selector",
                    "call_depth": 0,
                    "materialization_mode_resolved": "copy",
                    "parent_frame_id": None,
                    "invoking_workflow_call_id": None,
                    "inline_value_sha256": None,
                    "source_artifact_sha256": None,
                }
            }
        ),
        encoding="utf-8",
    )

    view = projection.get_node(RunId(RUN_ID), NodeId("node-C"))
    assert view is not None
    assert view.provenance == {}


def test_list_nodes_excludes_terminal_workflow_node(tmp_path: Path) -> None:
    projection, _ = _build_projection(tmp_path)
    runs_root = tmp_path / "runs"
    _put_default_node_result(runs_root, "node-A", b'{"a":1}')
    _put_default_node_result(runs_root, "node-B", b'{"b":2}')

    # Manually drop a terminal workflow record.
    terminal_store = FilesystemResultStore(runs_root)
    terminal_bundle = ArtifactBundle(
        bundle_id="bundle_node-A_default",
        relative_path=f"result_store/{TERMINAL_WORKFLOW_NODE_ID}/answer.bin",
        sha256="a" * 64,
        size_bytes=8,
        materialization_mode="inline",
    )
    terminal_store.put(
        NodeResult(
            run_id=RunId(RUN_ID),
            node_id=NodeId(TERMINAL_WORKFLOW_NODE_ID),
            port_id=PortId("answer"),
            bundle=terminal_bundle,
            inline_value=b'{"a":1}\n',
            produced_at="2026-06-01T00:00:01Z",
        )
    )

    views = projection.list_nodes(RunId(RUN_ID))
    node_ids = [v.node_id for v in views]
    assert node_ids == ["node-A", "node-B"]
    assert TERMINAL_WORKFLOW_NODE_ID not in node_ids


def test_list_nodes_empty_when_result_store_missing(tmp_path: Path) -> None:
    projection, _ = _build_projection(tmp_path)
    assert projection.list_nodes(RunId(RUN_ID)) == []


def test_get_workflow_output_reads_terminal_record(tmp_path: Path) -> None:
    projection, run_dir = _build_projection(tmp_path)
    runs_root = tmp_path / "runs"
    # Source node + terminal record under __workflow__
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
    assert view.bundle_summary["bundle_id"] == "bundle_node-A_default"
    assert view.provenance == {
        "source_node_id": "node-A",
        "source_port_id": "default",
        "bundle_id": "bundle_node-A_default",
        "sha256": "a" * 64,
    }
    assert view.binding_resolved == []


def test_get_workflow_output_returns_none_when_absent(tmp_path: Path) -> None:
    projection, _ = _build_projection(tmp_path)
    assert projection.get_workflow_output(RunId(RUN_ID), "missing") is None


def test_node_projection_view_to_jsonable_excludes_runtime_only_keys(
    tmp_path: Path,
) -> None:
    projection, run_dir = _build_projection(tmp_path)
    _put_default_node_result(tmp_path / "runs", "node-D", b'{"d":4}')
    node_dir = run_dir / "nodes" / "node-D"
    node_dir.mkdir(parents=True)
    # Inject a runtime payload that contains an EXTRA secret key the
    # projection layer must NOT surface (only target_field/source/mode
    # are kept).
    (node_dir / "runtime.json").write_text(
        json.dumps(
            {
                "binding_materializations": [
                    {
                        "target_field": "field-x",
                        "source": "(run-projection-1, node-A, default)",
                        "inline_value_sha256": "f" * 64,
                        "source_artifact_sha256": None,
                        "materialization_mode": "inline",
                        "secret_internal_key": "must-not-leak",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    view = projection.get_node(RunId(RUN_ID), NodeId("node-D"))

    assert view is not None
    payload = view.to_jsonable()
    assert payload["binding_resolved"] == [
        {
            "target_field": "field-x",
            "source": "(run-projection-1, node-A, default)",
            "materialization_mode": "inline",
        }
    ]
    flat = json.dumps(payload)
    assert "secret_internal_key" not in flat
    assert "must-not-leak" not in flat
