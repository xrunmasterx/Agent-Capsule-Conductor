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
        callable_id="echo-test.generic",
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
        {"callable_id": "fake-agent.generic", "session_id": "session_1"},
        {"status": "success", "summary": "ok"},
    )
    write_run_summary(run_dir, node)

    index = load_or_rebuild_run_index(runs_root)
    index_path = runs_root / "index.json"
    index_path.write_text(index.model_dump_json(), encoding="utf-8")

    loaded = load_or_rebuild_run_index(runs_root)

    assert loaded.runs[0].run_id == "run_001"


def test_legacy_run_index_missing_callable_id_loads_as_unknown(tmp_path: Path) -> None:
    runs_root = tmp_path / "runs"
    runs_root.mkdir()
    (runs_root / "index.json").write_text(
        """
{
  "version": "2.0",
  "runs": [
    {
      "run_id": "legacy_run",
      "status": "success",
      "run_dir": "runs/legacy_run",
      "node_count": 1,
      "nodes": [
        {
          "node_id": "legacy_node",
          "status": "success",
          "run_dir": "runs/legacy_run/nodes/legacy_node"
        }
      ]
    }
  ]
}
""".strip(),
        encoding="utf-8",
    )

    loaded = load_or_rebuild_run_index(runs_root)

    assert loaded.runs[0].nodes[0].callable_id == "unknown"


def test_load_cached_run_index_does_not_write_on_read_path(
    tmp_path: Path,
    monkeypatch,
) -> None:
    runs_root = tmp_path / "runs"
    runs_root.mkdir()
    (runs_root / "index.json").write_text(
        """
{
  "version": "2.0",
  "runs": [
    {
      "run_id": "legacy_run",
      "status": "success",
      "run_dir": "runs/legacy_run",
      "node_count": 0,
      "failed_nodes": [],
      "nodes": []
    }
  ]
}
""".strip(),
        encoding="utf-8",
    )

    def fail_write(*args, **kwargs) -> None:
        raise AssertionError("load_or_rebuild_run_index must not write cached index")

    monkeypatch.setattr("acc.run_index.write_json", fail_write)

    loaded = load_or_rebuild_run_index(runs_root)

    assert loaded.runs[0].run_id == "legacy_run"


def test_invalid_cached_index_rebuilds_from_run_directories(tmp_path: Path) -> None:
    runs_root = tmp_path / "runs"
    run_dir = runs_root / "run_001"
    run_dir.mkdir(parents=True)
    (runs_root / "index.json").write_text(
        """
{
  "version": "2.0",
  "runs": [
    {
      "run_id": "bad_cached_entry",
      "status": "success",
      "run_dir": "runs/bad_cached_entry",
      "node_count": 1,
      "nodes": [
        {
          "node_id": "bad_node",
          "callable_id": "bad.cached",
          "status": 12,
          "run_dir": "runs/bad_cached_entry/nodes/bad_node",
          "errors": "not-a-list"
        }
      ]
    }
  ]
}
""".strip(),
        encoding="utf-8",
    )
    node = NodeRunSummary(
        node_id="run_001",
        callable_id="echo-test.generic",
        status="success",
        run_dir=str(run_dir),
    )
    write_run_summary(run_dir, node)

    loaded = load_or_rebuild_run_index(runs_root)

    assert [run.run_id for run in loaded.runs] == ["run_001"]


def test_invalid_run_summary_is_quarantined_as_invalid_run(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "bad_run"
    run_dir.mkdir(parents=True)
    (run_dir / "run_summary.json").write_text(
        """
{
  "run_id": "bad_run",
  "status": "success",
  "run_dir": "runs/bad_run",
  "node_count": 1,
  "nodes": [
    {
      "node_id": "bad_node",
      "callable_id": "bad.cached",
      "status": "success",
      "run_dir": "runs/bad_run/nodes/bad_node",
      "errors": "not-a-list"
    }
  ]
}
""".strip(),
        encoding="utf-8",
    )

    loaded = load_or_rebuild_run_index(tmp_path / "runs")

    assert loaded.runs[0].run_id == "bad_run"
    assert loaded.runs[0].status == "invalid"
    assert loaded.runs[0].nodes[0].summary == "Invalid run_summary.json"


def test_missing_index_can_be_rebuilt_by_scanning(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "run_001"
    run_dir.mkdir(parents=True)
    (run_dir / "conductor_output.json").write_text(
        '{"status": "success", "summary": "ok"}',
        encoding="utf-8",
    )
    (run_dir / "session_manifest.json").write_text(
        '{"session_id": "session_1", "callable_id": "echo-test.generic", "status": "success"}',
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
        {"callable_id": "fake-agent.generic"},
        {"status": "adapter_error", "error": "non-zero exit"},
    )

    assert node.errors[0].error_class == "adapter_error"
    assert "stderr" in node.errors[0].paths


def test_node_summary_file_is_written(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    run_dir.mkdir()

    write_node_summary(
        run_dir,
        {"callable_id": "echo-test.generic"},
        {"status": "success", "summary": "ok"},
    )

    assert load_json(run_dir / "node_summary.json")["status"] == "success"
