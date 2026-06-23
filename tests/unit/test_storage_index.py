from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

from acc.storage_index import StorageIndex, rebuild_storage_index
from acc.storage_refs import make_run_ref
from acc.utils import safe_path_size_bytes


def test_safe_path_size_bytes_skips_disappearing_directory(
    tmp_path: Path,
    monkeypatch,
) -> None:
    root = tmp_path / "root"
    keep = root / "keep"
    gone = root / "gone"
    keep.mkdir(parents=True)
    gone.mkdir()
    (keep / "file.txt").write_text("keep", encoding="utf-8")
    (gone / "file.txt").write_text("gone", encoding="utf-8")
    original_scandir = os.scandir

    def flaky_scandir(path):
        if Path(path).name == "gone":
            raise FileNotFoundError(path)
        return original_scandir(path)

    monkeypatch.setattr("acc.utils.os.scandir", flaky_scandir)

    assert safe_path_size_bytes(root) >= 4


def test_safe_path_size_bytes_excludes_volatile_subtree(tmp_path: Path) -> None:
    root = tmp_path / "run"
    keep = root / "codex_home"
    volatile = keep / ".tmp"
    volatile.mkdir(parents=True)
    (keep / "keep.txt").write_text("abc", encoding="utf-8")
    (volatile / "cache.bin").write_text("x" * 100, encoding="utf-8")

    assert safe_path_size_bytes(root, exclude_relative_parts=("codex_home/.tmp",)) == 3


def test_safe_path_size_bytes_does_not_recurse_symlink_targets(tmp_path: Path) -> None:
    target = tmp_path / "target"
    root = tmp_path / "root"
    target.mkdir()
    root.mkdir()
    (target / "target.txt").write_text("x" * 100, encoding="utf-8")
    link = root / "link"
    try:
        link.symlink_to(target, target_is_directory=True)
    except OSError:
        return

    assert safe_path_size_bytes(root) < 100


def test_rebuild_storage_index_skips_bad_run_row(
    tmp_path: Path,
    monkeypatch,
) -> None:
    good_run = tmp_path / "runs" / "good_run"
    bad_run = tmp_path / "runs" / "bad_run"
    good_run.mkdir(parents=True)
    bad_run.mkdir()

    def flaky_size(path: Path, *, exclude_relative_parts=()):
        if path.name == "bad_run":
            raise FileNotFoundError(path)
        return 1

    monkeypatch.setattr("acc.storage_index.safe_path_size_bytes", flaky_size)

    result = rebuild_storage_index(tmp_path)

    assert result["object_count"] == 1
    with sqlite3.connect(tmp_path / ".acc" / "index.sqlite") as conn:
        object_refs = [
            row[0] for row in conn.execute("SELECT object_ref FROM objects ORDER BY object_ref")
        ]
    assert object_refs == ["run:v1:good_run"]


def test_storage_index_consistency_issues_tolerates_bad_run_row(
    tmp_path: Path,
    monkeypatch,
) -> None:
    (tmp_path / "runs" / "bad_run").mkdir(parents=True)

    def flaky_size(path: Path, *, exclude_relative_parts=()):
        raise FileNotFoundError(path)

    monkeypatch.setattr("acc.storage_index.safe_path_size_bytes", flaky_size)

    issues = StorageIndex(tmp_path).consistency_issues()

    assert issues == []


def test_storage_index_upserts_single_run_without_rebuild_inventory(
    tmp_path: Path,
    monkeypatch,
) -> None:
    run_dir = tmp_path / "runs" / "run_a"
    run_dir.mkdir(parents=True)
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": "run_a",
                "status": "success",
                "run_dir": str(run_dir.resolve()),
                "node_count": 0,
                "nodes": [],
            }
        ),
        encoding="utf-8",
    )
    index = StorageIndex(tmp_path)
    calls: list[Path] = []

    def forbidden_inventory(root: Path):
        calls.append(root)
        raise AssertionError("full inventory rebuild should not run")

    monkeypatch.setattr("acc.storage_index.build_inventory_rows", forbidden_inventory)

    assert index.upsert_object(make_run_ref("run_a")) is True
    assert calls == []
    with sqlite3.connect(tmp_path / ".acc" / "index.sqlite") as conn:
        row = conn.execute("SELECT object_ref, object_kind FROM objects").fetchone()
    assert row == ("run:v1:run_a", "run")


def test_storage_index_deletes_single_object_without_inventory(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "run_a"
    run_dir.mkdir(parents=True)
    rebuild_storage_index(tmp_path)

    assert StorageIndex(tmp_path).delete_object(make_run_ref("run_a")) is True
    with sqlite3.connect(tmp_path / ".acc" / "index.sqlite") as conn:
        rows = conn.execute("SELECT object_ref FROM objects").fetchall()
    assert rows == []
