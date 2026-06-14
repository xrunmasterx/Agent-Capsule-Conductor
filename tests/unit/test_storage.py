from __future__ import annotations

import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from acc.models import AccError
from acc.storage import (
    RUN_MARKER_FILENAME,
    append_jsonl_locked,
    claim_run,
    parse_legacy_run_dir,
    prepare_runtime_run_dir,
    validate_run_id,
    write_json_atomic,
)
from acc.storage_refs import (
    make_node_artifact_ref,
    make_run_ref,
    parse_artifact_ref,
    parse_object_ref,
)


@pytest.mark.parametrize(
    "run_id",
    ["", ".", "..", "_internal", "runs/_internal", "foo/bar", "foo\\bar", "C:foo"],
)
def test_validate_run_id_rejects_path_shaped_values(run_id: str) -> None:
    with pytest.raises(AccError):
        validate_run_id(run_id)


def test_parse_legacy_run_dir_accepts_only_runs_child() -> None:
    assert parse_legacy_run_dir("runs/safe_run") == "safe_run"

    for value in ("safe_run", "runs/a/b", "../runs/safe_run", "workflows/safe_run"):
        with pytest.raises(AccError):
            parse_legacy_run_dir(value)


def test_claim_run_writes_marker_and_rejects_duplicate(tmp_path: Path) -> None:
    handle = claim_run(tmp_path, run_id="run_claimed", workflow_id="wf", task_id="task")

    marker = json.loads((handle.run_dir / RUN_MARKER_FILENAME).read_text(encoding="utf-8"))
    assert marker["run_id"] == "run_claimed"
    assert marker["created_by"] == "acc"
    assert marker["workflow_id"] == "wf"
    assert marker["task_id"] == "task"

    with pytest.raises(AccError, match="Run already exists"):
        claim_run(tmp_path, run_id="run_claimed")

    with sqlite3.connect(tmp_path / ".acc" / "index.sqlite") as conn:
        rows = conn.execute("SELECT object_ref, owner_ref FROM objects").fetchall()
    assert rows == [("run:v1:run_claimed", "task:v1:task")]


def test_prepare_runtime_run_dir_refuses_unknown_non_empty_directory(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "old.txt").write_text("do not delete", encoding="utf-8")

    with pytest.raises(AccError):
        prepare_runtime_run_dir(run_dir)

    assert (run_dir / "old.txt").read_text(encoding="utf-8") == "do not delete"


def test_write_json_atomic_writes_complete_json(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "payload.json"

    write_json_atomic(path, {"b": 2, "a": 1})

    assert json.loads(path.read_text(encoding="utf-8")) == {"a": 1, "b": 2}
    assert list(path.parent.glob("*.tmp")) == []


def test_append_jsonl_locked_allocates_unique_monotonic_sequences(tmp_path: Path) -> None:
    path = tmp_path / "events.jsonl"

    def append(index: int) -> int:
        return append_jsonl_locked(path, {"type": "event", "index": index})["sequence"]

    with ThreadPoolExecutor(max_workers=8) as executor:
        sequences = list(executor.map(append, range(20)))

    assert sorted(sequences) == list(range(1, 21))
    persisted = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    assert sorted(event["sequence"] for event in persisted) == list(range(1, 21))


def test_versioned_object_refs_parse_with_legacy_compatibility() -> None:
    assert make_run_ref("run_ref") == "run:v1:run_ref"
    assert parse_object_ref("run:v1:run_ref") == ("run", "run_ref")
    assert parse_object_ref("run:run_ref") == ("run", "run_ref")


def test_versioned_artifact_ref_parser_supports_node_and_legacy_refs() -> None:
    parsed = parse_artifact_ref(make_node_artifact_ref("run_ref", "node_a", "report.md"))

    assert parsed.run_id == "run_ref"
    assert parsed.node_id == "node_a"
    assert parsed.relative_path == "report.md"
    assert parse_artifact_ref("run:run_ref:node:node_a:artifact:report.md") == parsed
