from pathlib import Path

from acc.run_index import build_node_summary


def test_successful_node_summary_includes_standard_paths(tmp_path: Path) -> None:
    run_dir = tmp_path / "node"
    artifacts = run_dir / "artifacts"
    artifacts.mkdir(parents=True)
    for name in ["input.json", "resolved_prompt.md", "stdout.log", "stderr.log", "events.jsonl"]:
        (run_dir / name).write_text("", encoding="utf-8")

    summary = build_node_summary(
        run_dir,
        {
            "callable_id": "echo-test.generic",
            "session_id": "session_1",
            "input_path": str(run_dir / "input.json"),
            "prompt_path": str(run_dir / "resolved_prompt.md"),
            "artifact_dir": str(artifacts),
            "event_log_path": str(run_dir / "events.jsonl"),
        },
        {"status": "success", "summary": "ok", "output_path": str(run_dir / "output.json")},
    )

    assert summary.status == "success"
    assert summary.input_path
    assert summary.prompt_path
    assert summary.stdout_log
    assert summary.stderr_log
    assert summary.event_log


def test_failed_node_summary_records_error_class(tmp_path: Path) -> None:
    run_dir = tmp_path / "node"
    run_dir.mkdir()

    summary = build_node_summary(
        run_dir,
        {"callable_id": "fake-agent.generic"},
        {"status": "schema_error", "error": "JSON Schema validation failed"},
    )

    assert summary.status == "schema_error"
    assert summary.errors[0].error_class == "schema_error"


def test_node_summary_omits_environment_values(tmp_path: Path) -> None:
    run_dir = tmp_path / "node"
    run_dir.mkdir()

    summary = build_node_summary(
        run_dir,
        {"callable_id": "fake-agent.generic"},
        {"status": "adapter_error", "error": "process failed"},
    )

    payload = summary.model_dump()
    assert "env" not in payload
    assert "credentials" not in str(payload).lower()
