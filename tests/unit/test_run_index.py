from pathlib import Path

from acc.run_index import (
    NodeRunSummary,
    build_node_summary,
    load_or_rebuild_run_index,
    load_run_summary_by_id,
    write_node_summary,
    write_run_summary,
)
from acc.utils import load_json


def test_empty_runs_directory_produces_empty_index(tmp_path: Path) -> None:
    index = load_or_rebuild_run_index(tmp_path / "runs")

    assert index.runs == []


def test_existing_run_directory_can_be_indexed(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "run_001"
    run_dir.mkdir(parents=True)
    node = NodeRunSummary(
        node_id="run_001",
        capsule_id="echo-test.generic",
        status="success",
        run_dir=str(run_dir),
        output_path=str(run_dir / "output.json"),
        artifact_dir=str(run_dir / "artifacts"),
    )
    write_run_summary(run_dir, node)

    index = load_or_rebuild_run_index(tmp_path / "runs")

    assert index.runs[0].run_id == "run_001"
    assert index.runs[0].status == "success"


def test_corrupt_run_directory_is_marked_invalid(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "bad"
    run_dir.mkdir(parents=True)
    (run_dir / "session_manifest.json").write_text("{bad json", encoding="utf-8")

    index = load_or_rebuild_run_index(tmp_path / "runs")

    assert index.runs[0].status == "invalid"
    assert index.runs[0].failed_nodes == ["bad"]


def test_run_index_serializes_and_loads(tmp_path: Path) -> None:
    runs_root = tmp_path / "runs"
    run_dir = runs_root / "run_001"
    run_dir.mkdir(parents=True)
    node = write_node_summary(
        run_dir,
        {"capsule_id": "fake-agent.generic", "session_id": "session_1"},
        {"status": "success", "summary": "ok"},
    )
    write_run_summary(run_dir, node)

    index = load_or_rebuild_run_index(runs_root)
    index_path = runs_root / "index.json"
    index_path.write_text(index.model_dump_json(), encoding="utf-8")

    loaded = load_or_rebuild_run_index(runs_root)

    assert loaded.runs[0].run_id == "run_001"


def test_missing_index_can_be_rebuilt_by_scanning(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "run_001"
    run_dir.mkdir(parents=True)
    (run_dir / "conductor_output.json").write_text(
        '{"status": "success", "summary": "ok"}',
        encoding="utf-8",
    )
    (run_dir / "session_manifest.json").write_text(
        '{"session_id": "session_1", "capsule_id": "echo-test.generic", "status": "success"}',
        encoding="utf-8",
    )

    summary = load_run_summary_by_id("run_001", tmp_path / "runs")

    assert summary.run_id == "run_001"


def test_node_summary_includes_debug_paths(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "stderr.log").write_text("error", encoding="utf-8")
    node = build_node_summary(
        run_dir,
        {"capsule_id": "fake-agent.generic"},
        {"status": "adapter_error", "error": "non-zero exit"},
    )

    assert node.errors[0].error_class == "adapter_error"
    assert "stderr" in node.errors[0].paths


def test_node_summary_file_is_written(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    run_dir.mkdir()

    write_node_summary(
        run_dir,
        {"capsule_id": "echo-test.generic"},
        {"status": "success", "summary": "ok"},
    )

    assert load_json(run_dir / "node_summary.json")["status"] == "success"
