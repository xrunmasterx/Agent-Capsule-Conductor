from __future__ import annotations

from pathlib import Path

from acc.app import WorkflowAppService
from acc.debugger import artifact_diff, diff_runs, fork_run, replay_workflow_events
from acc.registry import CapsuleRegistry

DEMO_GRAPH = Path("examples/workflows/debugger_replay_demo.graph.json")
FORK_OVERRIDE = Path("examples/workflows/fork_override.json")


def run_workflow(graph_path: Path, run_dir: Path) -> dict:
    return WorkflowAppService().run_sync(graph_path, run_dir)


def test_replay_reconstructs_workflow_state(tmp_path: Path) -> None:
    run_dir = tmp_path / "debugger_demo"
    run_workflow(DEMO_GRAPH, run_dir)

    payload = replay_workflow_events(run_dir)

    assert payload["status"] == "success"
    assert payload["workflow_status"] == "success"
    assert payload["failed_node"] is None
    assert [node["node_id"] for node in payload["nodes"]] == ["demo_node_a", "demo_node_b"]
    assert payload["nodes"][0]["started_at"] is not None
    assert (run_dir / "replay_manifest.json").exists()


def test_replay_handles_missing_node_events_gracefully(tmp_path: Path) -> None:
    run_dir = tmp_path / "debugger_demo"
    run_workflow(DEMO_GRAPH, run_dir)
    (run_dir / "node_runs" / "demo_node_b" / "events.jsonl").unlink()

    payload = replay_workflow_events(run_dir, "demo_node_b")

    assert payload["status"] == "success"
    assert payload["nodes"][0]["node_id"] == "demo_node_b"
    assert payload["nodes"][0]["status"] == "success"
    assert payload["timeline"]


def test_artifact_diff_and_run_diff_detect_changes(tmp_path: Path) -> None:
    run_a = tmp_path / "run_a"
    run_b = tmp_path / "run_b"
    run_workflow(DEMO_GRAPH, run_a)
    fork_run(
        run_a,
        "demo_node_a",
        FORK_OVERRIDE,
        run_b,
        registry=CapsuleRegistry(),
    )

    artifact_payload = artifact_diff(
        run_a / "node_runs" / "demo_node_a" / "output.json",
        run_b / "node_runs" / "demo_node_a" / "output.json",
    )
    run_payload = diff_runs(run_a, run_b)

    assert artifact_payload["kind"] == "json"
    assert artifact_payload["same"] is False
    assert any(diff["path"].endswith(".summary") for diff in artifact_payload["diff"])
    assert "demo_node_a" in run_payload["changed_nodes"]
    assert "demo_node_b" in run_payload["changed_nodes"]


def test_artifact_diff_supports_text_and_existence_modes(tmp_path: Path) -> None:
    text_a = tmp_path / "a.md"
    text_b = tmp_path / "b.md"
    text_a.write_text("# A\nline one\n", encoding="utf-8")
    text_b.write_text("# A\nline two\n", encoding="utf-8")

    text_payload = artifact_diff(text_a, text_b)
    missing_payload = artifact_diff(text_a, tmp_path / "missing.md")

    assert text_payload["kind"] == "text"
    assert text_payload["same"] is False
    assert text_payload["diff"]
    assert missing_payload["kind"] == "existence"
    assert missing_payload["exists"] == {"a": True, "b": False}


def test_artifact_diff_directory_mode_hashes_without_read_bytes(
    tmp_path: Path,
    monkeypatch,
) -> None:
    dir_a = tmp_path / "a"
    dir_b = tmp_path / "b"
    dir_a.mkdir()
    dir_b.mkdir()
    (dir_a / "report.md").write_text("same\n", encoding="utf-8")
    (dir_b / "report.md").write_text("changed\n", encoding="utf-8")

    def fail_read_bytes(self: Path) -> bytes:
        raise AssertionError(f"read_bytes should not be used for directory diff: {self}")

    monkeypatch.setattr(Path, "read_bytes", fail_read_bytes)

    payload = artifact_diff(dir_a, dir_b)

    assert payload["kind"] == "directory"
    assert payload["same"] is False
    assert payload["diff"]["changed"] == ["report.md"]
