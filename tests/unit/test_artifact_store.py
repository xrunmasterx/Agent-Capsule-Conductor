from pathlib import Path

import pytest

from acc.artifact_store import ArtifactStore
from acc.utils import AccError, load_json


def test_creates_expected_run_directory_files(tmp_path: Path) -> None:
    store = ArtifactStore(tmp_path / "run")

    store.prepare()

    assert store.artifacts_dir.is_dir()
    assert store.stdout_log_path.exists()
    assert store.stderr_log_path.exists()
    assert store.events_log_path.exists()


def test_writes_input_and_manifest(tmp_path: Path) -> None:
    store = ArtifactStore(tmp_path / "run")
    store.prepare()

    store.write_input({"message": "hello"})
    store.write_manifest({"status": "started"})

    assert load_json(store.input_path)["message"] == "hello"
    assert load_json(store.session_manifest_path)["status"] == "started"
    assert load_json(store.run_manifest_path)["status"] == "started"


def test_existing_non_acc_run_dir_fails(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "unrelated.txt").write_text("keep", encoding="utf-8")

    with pytest.raises(AccError, match="Refusing to reuse"):
        ArtifactStore(run_dir).prepare()
