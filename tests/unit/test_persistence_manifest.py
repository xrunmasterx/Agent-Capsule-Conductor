"""Unit tests for ``acc.persistence.manifest`` (RunManifest checkpoint).

Covers TEST_PLAN.md cases:
- test_manifest_atomic_write_then_read
- test_manifest_corrupt_raises_typed_error
"""

from __future__ import annotations

from pathlib import Path

import pytest

from acc.persistence.manifest import (
    MANIFEST_FILENAME,
    ManifestCorruptError,
    RunManifest,
    read,
    write_atomic,
)


def test_manifest_atomic_write_then_read(tmp_path: Path) -> None:
    manifest = RunManifest(
        run_id="run-42",
        schema_version=1,
        completed_nodes=["node-a", "node-b"],
        binding_materializations=[
            {
                "node_id": "node-a",
                "port_id": "out",
                "materialization_mode_resolved": "copy",
                "finalized_at": "2026-06-01T00:00:00Z",
                "hash": "abc123",
            }
        ],
        started_at="2026-06-01T00:00:00Z",
        last_updated_at="2026-06-01T00:00:01Z",
    )

    write_atomic(manifest, tmp_path)

    # File on disk should match the canonical name.
    target = tmp_path / MANIFEST_FILENAME
    assert target.is_file()

    loaded = read(tmp_path)
    assert loaded is not None
    assert loaded == manifest


def test_manifest_corrupt_raises_typed_error(tmp_path: Path) -> None:
    target = tmp_path / MANIFEST_FILENAME
    target.write_text("{not valid json", encoding="utf-8")

    with pytest.raises(ManifestCorruptError):
        read(tmp_path)


def test_manifest_read_returns_none_when_missing(tmp_path: Path) -> None:
    assert read(tmp_path) is None
