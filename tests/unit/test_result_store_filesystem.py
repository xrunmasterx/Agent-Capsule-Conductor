"""Unit tests for ``acc.result_store.FilesystemResultStore``.

Covers TEST_PLAN.md cases:
- test_result_store_put_then_get_roundtrip
- test_result_store_get_missing_returns_none
- test_result_store_relative_path_required
"""

from __future__ import annotations

from pathlib import Path

import pytest

from acc.result_store import (
    ArtifactBundle,
    FilesystemResultStore,
    NodeId,
    NodeResult,
    PortId,
    RunId,
)


def _make_result(
    *,
    run_id: str = "run-1",
    node_id: str = "node-1",
    port_id: str = "port-1",
    relative_path: str = "result_store/node-1/port-1.bin",
    inline_value: bytes | None = b"hello-world",
    materialization_mode: str = "inline",
) -> NodeResult:
    bundle = ArtifactBundle(
        bundle_id="bundle-1",
        relative_path=relative_path,
        sha256="0" * 64,
        size_bytes=len(inline_value) if inline_value is not None else 0,
        materialization_mode=materialization_mode,
    )
    return NodeResult(
        run_id=RunId(run_id),
        node_id=NodeId(node_id),
        port_id=PortId(port_id),
        bundle=bundle,
        inline_value=inline_value,
        produced_at="2026-06-01T00:00:00Z",
    )


def test_result_store_put_then_get_roundtrip(tmp_path: Path) -> None:
    store = FilesystemResultStore(tmp_path)
    original = _make_result()

    store.put(original)
    loaded = store.get(original.run_id, original.node_id, original.port_id)

    assert loaded is not None
    assert loaded.run_id == original.run_id
    assert loaded.node_id == original.node_id
    assert loaded.port_id == original.port_id
    assert loaded.bundle == original.bundle
    assert loaded.inline_value == original.inline_value
    assert loaded.produced_at == original.produced_at
    assert store.exists(original.run_id, original.node_id, original.port_id) is True


def test_result_store_get_missing_returns_none(tmp_path: Path) -> None:
    store = FilesystemResultStore(tmp_path)

    assert store.get(RunId("missing-run"), NodeId("missing-node"), PortId("missing-port")) is None
    assert (
        store.exists(RunId("missing-run"), NodeId("missing-node"), PortId("missing-port"))
        is False
    )


def test_result_store_relative_path_required(tmp_path: Path) -> None:
    store = FilesystemResultStore(tmp_path)
    bad_result = _make_result(relative_path=str(tmp_path / "absolute" / "leak.bin"))

    with pytest.raises(ValueError, match="relative"):
        store.put(bad_result)
