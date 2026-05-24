import asyncio
from pathlib import Path

from acc.runner import CapsuleRunner
from acc.session import SessionManifest, new_session_id, utc_now_iso
from acc.utils import load_json


def test_session_ids_are_unique() -> None:
    assert new_session_id() != new_session_id()


def test_valid_session_manifest_loads(tmp_path: Path) -> None:
    now = utc_now_iso()
    manifest = SessionManifest.model_validate(
        {
            "session_id": "session_123",
            "capsule_id": "echo-test.generic",
            "capsule_version": "0.1.0",
            "status": "created",
            "created_at": now,
            "updated_at": now,
            "run_dir": str(tmp_path),
            "artifact_dir": str(tmp_path / "artifacts"),
            "event_log_path": str(tmp_path / "events.jsonl"),
            "conductor_output_path": str(tmp_path / "conductor_output.json"),
        }
    )

    assert manifest.session_id == "session_123"
    assert manifest.capsule_id == "echo-test.generic"


def test_two_sessions_from_same_template_are_isolated(tmp_path: Path) -> None:
    runner = CapsuleRunner()
    payload = {"message": "hello"}

    first = asyncio.run(runner.run("echo-test.generic", payload, tmp_path / "run_a"))
    second = asyncio.run(runner.run("echo-test.generic", payload, tmp_path / "run_b"))

    first_manifest = load_json(tmp_path / "run_a" / "session_manifest.json")
    second_manifest = load_json(tmp_path / "run_b" / "session_manifest.json")
    assert first["status"] == "success"
    assert second["status"] == "success"
    assert first_manifest["session_id"] != second_manifest["session_id"]
    assert first_manifest["run_dir"] != second_manifest["run_dir"]
    assert Path(first["output_path"]) != Path(second["output_path"])


def test_session_artifacts_do_not_overwrite_each_other(tmp_path: Path) -> None:
    runner = CapsuleRunner()

    first = asyncio.run(
        runner.run("fake-agent.generic", {"topic": "alpha"}, tmp_path / "run_a")
    )
    second = asyncio.run(
        runner.run("fake-agent.generic", {"topic": "beta"}, tmp_path / "run_b")
    )

    first_report = Path(first["artifact_dir"]) / "report.md"
    second_report = Path(second["artifact_dir"]) / "report.md"
    assert first["status"] == "success"
    assert second["status"] == "success"
    assert first_report != second_report
    assert "alpha" in first_report.read_text(encoding="utf-8")
    assert "beta" in second_report.read_text(encoding="utf-8")
