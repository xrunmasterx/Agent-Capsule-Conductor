from __future__ import annotations

import json
import os
import shutil
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

from typer.testing import CliRunner

from acc.cli import app
from acc.storage import claim_run, write_json_atomic
from acc.storage_gc import RetentionPolicy, StorageGCService, runtime_spec_dir_for_run


def test_gc_dry_run_selects_expired_success_without_deleting(tmp_path: Path) -> None:
    run_dir = _run(tmp_path, "run_old_success", "success", ended_days_ago=30)

    plan = StorageGCService(
        tmp_path,
        RetentionPolicy(success_after_days=7),
    ).create_plan(write=True)

    assert _action_refs(plan) == ["run:v1:run_old_success"]
    assert plan["actions"][0]["action"] == "trash"
    assert run_dir.exists()
    assert (tmp_path / ".acc" / "gc" / "plans" / plan["gc_plan_id"] / "gc_plan.json").exists()


def test_gc_protects_active_pinned_and_exported_runs(tmp_path: Path) -> None:
    _run(tmp_path, "run_active", "running", ended_days_ago=30)
    pinned = _run(tmp_path, "run_pinned", "success", ended_days_ago=30)
    exported = _run(tmp_path, "run_exported", "success", ended_days_ago=30)
    write_json_atomic(pinned / "retention.json", {"pinned": True})
    write_json_atomic(exported / "retention.json", {"exported": True})

    plan = StorageGCService(
        tmp_path,
        RetentionPolicy(success_after_days=0),
    ).create_plan(write=False)

    assert plan["actions"] == []
    reasons = {item["object_ref"]: item["reason"] for item in plan["protected"]}
    assert reasons["run:v1:run_active"] == "active_status:running"
    assert reasons["run:v1:run_pinned"] == "pinned"
    assert reasons["run:v1:run_exported"] == "exported"


def test_gc_apply_moves_run_to_trash_writes_tombstone_and_rebuilds_index(tmp_path: Path) -> None:
    run_dir = _run(tmp_path, "run_apply", "success", ended_days_ago=30)
    service = StorageGCService(tmp_path, RetentionPolicy(success_after_days=0))
    plan = service.create_plan(write=True)

    manifest = service.apply_plan(plan["gc_plan_id"], expected_digest=plan["plan_digest"])

    assert manifest["moved"][0]["object_ref"] == "run:v1:run_apply"
    assert not (run_dir / "run_summary.json").exists()
    tombstone = json.loads((run_dir / "tombstone.json").read_text(encoding="utf-8"))
    assert tombstone["object_ref"] == "run:v1:run_apply"
    assert tombstone["gc_plan_id"] == plan["gc_plan_id"]
    trash_entries = list((tmp_path / ".acc" / "trash").glob("*/trash_entry.json"))
    assert len(trash_entries) == 1
    index = json.loads((tmp_path / "runs" / "index.json").read_text(encoding="utf-8"))
    assert index["runs"] == []
    assert (tmp_path / ".acc" / "index.sqlite").exists()
    with sqlite3.connect(tmp_path / ".acc" / "index.sqlite") as conn:
        object_refs = [
            row[0] for row in conn.execute("SELECT object_ref FROM objects ORDER BY object_ref")
        ]
    assert "run:v1:run_apply" not in object_refs
    assert "tombstone:v1:run_v1_run_apply" in object_refs

    second_manifest = service.apply_plan(plan["gc_plan_id"], expected_digest=plan["plan_digest"])
    assert second_manifest == manifest


def test_run_deletion_group_includes_runtime_specs_and_bound_sessions_only(
    tmp_path: Path,
) -> None:
    run_dir = _run(tmp_path, "run_group", "success", ended_days_ago=30)
    spec_dir = runtime_spec_dir_for_run(tmp_path, run_dir)
    write_json_atomic(spec_dir / "manifest.json", {"run_dir": "runs/run_group"})
    bound_session_dir = tmp_path / "runs" / "_agent_sessions" / "run_group" / "node_a"
    write_json_atomic(
        bound_session_dir / "session.json",
        {"session_id": "session_bound", "bound_run_id": "run_group"},
    )
    task_session_dir = tmp_path / "runs" / "_agent_sessions" / "task_a" / "node_a"
    write_json_atomic(
        task_session_dir / "session.json",
        {
            "session_id": "session_task",
            "session_kind": "workbench_assistant",
            "task_id": "task_a",
        },
    )

    service = StorageGCService(tmp_path, RetentionPolicy(success_after_days=0))
    plan = service.create_plan(write=True)
    run_action = next(item for item in plan["actions"] if item["object_ref"] == "run:v1:run_group")

    assert str(spec_dir) in run_action["extra_paths"]
    assert str(bound_session_dir) in run_action["extra_paths"]
    protected_refs = {item["object_ref"] for item in plan["protected"]}
    assert "session:v1:session_task" in protected_refs

    service.apply_plan(plan["gc_plan_id"])

    assert not spec_dir.exists()
    assert not bound_session_dir.exists()
    assert task_session_dir.exists()


def test_graphops_applying_is_protected_and_old_staging_is_quarantined(tmp_path: Path) -> None:
    applying_dir = tmp_path / "runs" / "_graphops_proposals" / "proposal_applying"
    write_json_atomic(
        applying_dir / "proposal.json",
        {"proposal_id": "proposal_applying", "status": "applying"},
    )
    write_json_atomic(applying_dir / "apply_staging" / "file.json", {"x": 1})
    stale_dir = tmp_path / "runs" / "_graphops_proposals" / "proposal_done"
    write_json_atomic(
        stale_dir / "proposal.json",
        {
            "proposal_id": "proposal_done",
            "status": "applied",
            "updated_at": _iso_days_ago(30),
        },
    )
    write_json_atomic(stale_dir / "dry_run_staging" / "file.json", {"x": 1})
    draft_dir = tmp_path / "runs" / "_graphops_proposals" / "proposal_draft"
    write_json_atomic(
        draft_dir / "proposal.json",
        {
            "proposal_id": "proposal_draft",
            "status": "drafted",
            "updated_at": _iso_days_ago(30),
        },
    )
    old_time = (datetime.now(UTC) - timedelta(hours=48)).timestamp()
    os.utime(stale_dir / "dry_run_staging", (old_time, old_time))

    plan = StorageGCService(
        tmp_path,
        RetentionPolicy(draft_proposal_after_days=7, staging_after_hours=1),
    ).create_plan(write=False)

    action_refs = _action_refs(plan)
    assert "staging_dir:v1:proposal_done_dry_run_staging" in action_refs
    assert "graphops_proposal:v1:proposal_draft" in action_refs
    protected_refs = {item["object_ref"] for item in plan["protected"]}
    assert "graphops_proposal:v1:proposal_applying" in protected_refs
    assert "staging_dir:v1:proposal_applying_apply_staging" in protected_refs


def test_storage_doctor_reports_marker_jsonl_and_legacy_store_issues(tmp_path: Path) -> None:
    bad_run = tmp_path / "runs" / "bad_run"
    bad_run.mkdir(parents=True)
    (bad_run / "run_summary.json").write_text("{bad", encoding="utf-8")
    (bad_run / "events.jsonl").write_text('{"ok": true}\n{bad\n', encoding="utf-8")
    (tmp_path / "runs" / "_authoring_sessions").mkdir()

    report = StorageGCService(tmp_path).doctor()

    codes = {issue["code"] for issue in report["issues"]}
    assert "missing_run_marker" in codes
    assert "malformed_json" in codes
    assert "malformed_jsonl" in codes
    assert "legacy_internal_store_present" in codes


def test_storage_cli_gc_dry_run_outputs_plan(tmp_path: Path) -> None:
    _run(tmp_path, "run_cli", "success", ended_days_ago=30)
    runner = CliRunner()

    result = runner.invoke(
        app,
        [
            "storage",
            "gc",
            "--dry-run",
            "--project-root",
            str(tmp_path),
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["schema_version"] == "acc.gc.plan.v1"
    assert _action_refs(payload) == ["run:v1:run_cli"]


def test_storage_cli_migrate_sessions_dry_run_does_not_write(tmp_path: Path) -> None:
    legacy_dir = tmp_path / "runs" / "_authoring_sessions" / "authoring_old"
    write_json_atomic(
        legacy_dir / "session.json",
        {"session_id": "authoring_old", "task_id": "task_old", "status": "ready"},
    )
    runner = CliRunner()

    result = runner.invoke(
        app,
        [
            "storage",
            "migrate-sessions",
            "--dry-run",
            "--project-root",
            str(tmp_path),
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["schema_version"] == "acc.session_migration.plan.v1"
    assert payload["actions"][0]["destination"] == ".acc/sessions/authoring/authoring_old"
    assert not (tmp_path / ".acc" / "sessions" / "authoring" / "authoring_old").exists()


def test_storage_cli_migrate_sessions_apply_is_idempotent(tmp_path: Path) -> None:
    legacy_dir = tmp_path / "runs" / "_authoring_sessions" / "authoring_old"
    write_json_atomic(
        legacy_dir / "session.json",
        {"session_id": "authoring_old", "task_id": "task_old", "status": "ready"},
    )
    runner = CliRunner()

    first = runner.invoke(
        app,
        [
            "storage",
            "migrate-sessions",
            "--apply",
            "--project-root",
            str(tmp_path),
        ],
    )
    second = runner.invoke(
        app,
        [
            "storage",
            "migrate-sessions",
            "--apply",
            "--project-root",
            str(tmp_path),
        ],
    )

    assert first.exit_code == 0, first.output
    assert second.exit_code == 0, second.output
    first_payload = json.loads(first.output)
    second_payload = json.loads(second.output)
    target = tmp_path / ".acc" / "sessions" / "authoring" / "authoring_old"
    assert first_payload["actions"][0]["status"] == "migrated"
    assert second_payload["actions"][0]["status"] == "skipped_existing"
    state = json.loads((target / "session.json").read_text(encoding="utf-8"))
    assert state["session_ref"] == "session:v1:authoring_old"
    assert state["owner_ref"] == "task:v1:task_old"
    assert (target / "migration_manifest.json").exists()
    assert legacy_dir.exists()


def test_storage_rebuild_index_writes_sqlite_object_inventory(tmp_path: Path) -> None:
    _run(tmp_path, "run_indexed", "success", ended_days_ago=1)

    payload = StorageGCService(tmp_path).rebuild_index()

    assert payload["sqlite_index"]["object_count"] == 1
    with sqlite3.connect(tmp_path / ".acc" / "index.sqlite") as conn:
        rows = conn.execute(
            "SELECT object_ref, legacy_ref, object_kind FROM objects"
        ).fetchall()
    assert rows == [("run:v1:run_indexed", "run:run_indexed", "run")]


def test_storage_rebuild_index_includes_legacy_authoring_session(tmp_path: Path) -> None:
    write_json_atomic(
        tmp_path / "runs" / "_authoring_sessions" / "authoring_old" / "session.json",
        {"session_id": "authoring_old", "task_id": "task_old", "status": "ready"},
    )

    payload = StorageGCService(tmp_path).rebuild_index()

    assert payload["sqlite_index"]["objects_by_kind"]["session"] == 1
    with sqlite3.connect(tmp_path / ".acc" / "index.sqlite") as conn:
        rows = conn.execute(
            "SELECT object_ref, owner_ref, path FROM objects WHERE object_kind = 'session'"
        ).fetchall()
    assert rows == [
        (
            "session:v1:authoring_old",
            "task:v1:task_old",
            "runs/_authoring_sessions/authoring_old",
        )
    ]


def test_storage_doctor_reports_missing_and_stale_sqlite_rows(tmp_path: Path) -> None:
    _run(tmp_path, "run_indexed", "success", ended_days_ago=1)
    service = StorageGCService(tmp_path)
    service.rebuild_index()
    (tmp_path / ".acc" / "index.sqlite").unlink()

    missing_report = service.doctor()
    assert "missing_sqlite_index" in {issue["code"] for issue in missing_report["issues"]}

    service.rebuild_index()
    shutil.rmtree(tmp_path / "runs" / "run_indexed")
    stale_report = service.doctor()
    codes = {issue["code"] for issue in stale_report["issues"]}
    assert "stale_index_row" in codes


def test_storage_doctor_reports_tombstone_without_gc_manifest(tmp_path: Path) -> None:
    write_json_atomic(
        tmp_path / ".acc" / "tombstones" / "run_v1_missing",
        {"object_ref": "run:v1:missing", "gc_plan_id": "gc_missing"},
    )

    report = StorageGCService(tmp_path).doctor()

    assert "tombstone_missing_gc_manifest" in {issue["code"] for issue in report["issues"]}


def test_storage_gc_protects_acc_run_lease(tmp_path: Path) -> None:
    _run(tmp_path, "run_leased", "success", ended_days_ago=30)
    write_json_atomic(
        tmp_path / ".acc" / "leases" / "runs" / "run_leased.json",
        {"run_id": "run_leased", "lease_state": "active"},
    )

    plan = StorageGCService(tmp_path, RetentionPolicy(success_after_days=0)).create_plan(
        write=False
    )

    assert plan["actions"] == []
    assert plan["protected"][0]["reason"] == "active_lease"


def test_storage_purge_grace_expired_removes_trash_and_keeps_manifest(tmp_path: Path) -> None:
    run_dir = _run(tmp_path, "run_purge", "success", ended_days_ago=30)
    service = StorageGCService(tmp_path, RetentionPolicy(success_after_days=0, trash_grace_days=0))
    plan = service.create_plan(write=True)
    service.apply_plan(plan["gc_plan_id"])
    trash_root = tmp_path / ".acc" / "trash"
    assert list(trash_root.iterdir())

    manifest = service.purge_expired_trash()

    assert manifest["schema_version"] == "acc.gc.purge_manifest.v1"
    assert manifest["purged"][0]["object_ref"] == "run:v1:run_purge"
    assert list(trash_root.glob("*")) == []
    assert list((tmp_path / ".acc" / "gc" / "purge_manifests").glob("*.json"))
    assert not (run_dir / "run_summary.json").exists()


def _run(tmp_path: Path, run_id: str, status: str, *, ended_days_ago: int) -> Path:
    run_dir = claim_run(tmp_path, run_id=run_id).run_dir
    write_json_atomic(
        run_dir / "run_summary.json",
        {
            "run_id": run_id,
            "status": status,
            "started_at": _iso_days_ago(ended_days_ago + 1),
            "ended_at": _iso_days_ago(ended_days_ago),
            "run_dir": str(run_dir),
            "node_count": 0,
            "failed_nodes": [] if status == "success" else ["node"],
            "nodes": [],
        },
    )
    return run_dir


def _iso_days_ago(days: int) -> str:
    return (datetime.now(UTC) - timedelta(days=days)).isoformat().replace("+00:00", "Z")


def _action_refs(plan: dict) -> list[str]:
    return sorted(item["object_ref"] for item in plan["actions"])
