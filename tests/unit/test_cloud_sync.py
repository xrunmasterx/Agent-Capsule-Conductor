from __future__ import annotations

import json
from pathlib import Path

import pytest

from acc.cloud_sync import (
    CLOUD_JOB_INTENT_SCHEMA_VERSION,
    CloudSyncError,
    FakeCloudControlPlaneService,
    LocalCloudSyncService,
)
from acc.run_index import RunSummary
from acc.storage import claim_run, write_json_atomic


def test_duplicate_job_delivery_is_idempotent_and_does_not_duplicate_run(
    tmp_path: Path,
) -> None:
    local = LocalCloudSyncService(tmp_path)
    intent = _intent("job_duplicate", idempotency_key="idem-1")

    receipt = local.receive_intent(intent)
    claimed = local.claim_run_for_receipt(receipt["job_id"], run_id="cloud_run_once")
    duplicate = local.receive_intent(intent)

    assert duplicate["run_id"] == claimed["run_id"]
    assert [path.name for path in (tmp_path / "runs").iterdir()] == ["cloud_run_once"]
    assert (tmp_path / ".acc" / "runner" / "job_receipts" / "job_duplicate.json").exists()


def test_duplicate_job_delivery_without_created_at_still_has_stable_digest(
    tmp_path: Path,
) -> None:
    local = LocalCloudSyncService(tmp_path)
    intent = _intent("job_duplicate_without_time")
    intent.pop("created_at")

    first = local.receive_intent(intent)
    duplicate = local.receive_intent(intent)

    assert duplicate["intent_digest"] == first["intent_digest"]
    assert duplicate["status"] == "received"


def test_same_idempotency_key_with_different_digest_conflicts(tmp_path: Path) -> None:
    local = LocalCloudSyncService(tmp_path)
    local.receive_intent(_intent("job_conflict", idempotency_key="idem-conflict"))
    changed = _intent("job_conflict", idempotency_key="idem-conflict")
    changed["input_manifest"] = {"prompt": "changed"}

    with pytest.raises(CloudSyncError) as exc_info:
        local.receive_intent(changed)

    assert exc_info.value.code == "idempotency_conflict"
    assert exc_info.value.status_code == 409


def test_validation_failure_creates_receipt_but_no_run_directory(tmp_path: Path) -> None:
    local = LocalCloudSyncService(tmp_path)
    intent = _intent(
        "job_missing_workspace",
        required_capabilities=["workspace:missing"],
    )

    receipt = local.receive_intent(intent)

    assert receipt["status"] == "workspace_unbound"
    assert receipt["run_id"] is None
    assert not (tmp_path / "runs").exists()
    with pytest.raises(CloudSyncError):
        local.claim_run_for_receipt("job_missing_workspace", run_id="should_not_exist")
    assert not (tmp_path / "runs" / "should_not_exist").exists()


def test_cloud_rejects_local_absolute_workspace_path(tmp_path: Path) -> None:
    cloud = FakeCloudControlPlaneService(tmp_path / "cloud")
    intent = _intent(
        "job_bad_path",
        required_capabilities=["workspace:C:\\Users\\owner\\repo"],
    )

    with pytest.raises(CloudSyncError) as exc_info:
        cloud.create_job_intent(intent)

    assert exc_info.value.code == "rejected_policy"


def test_lease_fencing_rejects_stale_heartbeat_upload_and_cancel_ack(
    tmp_path: Path,
) -> None:
    cloud = FakeCloudControlPlaneService(tmp_path / "cloud")
    cloud.create_job_intent(_intent("job_lease"))
    leased = cloud.lease_next_job("runner_any")
    old_lease = leased["lease"]
    new_lease = cloud.reissue_lease("job_lease")

    with pytest.raises(CloudSyncError) as heartbeat_error:
        cloud.heartbeat(
            old_lease["lease_id"],
            old_lease["lease_epoch"],
            old_lease["fencing_token"],
        )
    with pytest.raises(CloudSyncError) as upload_error:
        cloud.ingest_projection_delta(
            {
                "runner_id": "runner_any",
                "run_id": "run_lease",
                "job_id": "job_lease",
                "summary": {},
                "events": [],
                "artifact_manifests": [],
            },
            lease_id=old_lease["lease_id"],
            lease_epoch=old_lease["lease_epoch"],
            fencing_token=old_lease["fencing_token"],
        )
    with pytest.raises(CloudSyncError) as cancel_error:
        cloud.acknowledge_cancel(
            "job_lease",
            "observed_by_runner",
            lease_id=old_lease["lease_id"],
            lease_epoch=old_lease["lease_epoch"],
            fencing_token=old_lease["fencing_token"],
        )

    assert heartbeat_error.value.code == "stale_lease"
    assert upload_error.value.code == "stale_lease"
    assert cancel_error.value.code == "stale_lease"
    assert cloud.heartbeat(
        new_lease["lease_id"],
        new_lease["lease_epoch"],
        new_lease["fencing_token"],
    )["status"] == "ok"


def test_projection_replay_is_idempotent_and_cursor_resumes(tmp_path: Path) -> None:
    local = LocalCloudSyncService(tmp_path)
    cloud = FakeCloudControlPlaneService(tmp_path / "cloud")
    runner_id = local.runner.ensure_runner_record()["runner_id"]
    cloud.create_job_intent(_intent("job_projection", runner_id=runner_id))
    leased = cloud.lease_next_job(runner_id)
    receipt = local.receive_intent(
        leased["intent"],
        lease_id=leased["lease"]["lease_id"],
        lease_epoch=leased["lease"]["lease_epoch"],
        fencing_token=leased["lease"]["fencing_token"],
    )
    local.claim_run_for_receipt(receipt["job_id"], run_id="projection_run")
    _write_run_summary(tmp_path, "projection_run", status="running")
    events_path = tmp_path / "runs" / "projection_run" / "events.jsonl"
    events_path.write_text(
        json.dumps({"event_id": "evt_1", "type": "started"}) + "\n"
        + json.dumps({"type": "step", "message": "first"}) + "\n",
        encoding="utf-8",
    )

    delta = local.build_projection_delta(job_id="job_projection", run_id="projection_run")
    first_ingest = cloud.ingest_projection_delta(
        delta,
        lease_id=leased["lease"]["lease_id"],
        lease_epoch=leased["lease"]["lease_epoch"],
        fencing_token=leased["lease"]["fencing_token"],
    )
    replay_ingest = cloud.ingest_projection_delta(
        delta,
        lease_id=leased["lease"]["lease_id"],
        lease_epoch=leased["lease"]["lease_epoch"],
        fencing_token=leased["lease"]["fencing_token"],
    )
    with events_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"event_id": "evt_2", "type": "finished"}) + "\n")
    resumed = local.build_projection_delta(
        job_id="job_projection",
        run_id="projection_run",
        cursor=delta["event_cursor"],
    )

    assert first_ingest["upserted_events"] == 2
    assert replay_ingest["upserted_events"] == 0
    assert [event["event_key"] for event in resumed["events"]] == ["evt_2"]


def test_cursor_gap_reports_sync_gap_detected(tmp_path: Path) -> None:
    local = LocalCloudSyncService(tmp_path)
    local.receive_intent(_intent("job_gap"))
    local.claim_run_for_receipt("job_gap", run_id="gap_run")
    _write_run_summary(tmp_path, "gap_run")
    events_path = tmp_path / "runs" / "gap_run" / "events.jsonl"
    events_path.write_text(json.dumps({"event_id": "evt_1"}) + "\n", encoding="utf-8")
    first = local.build_projection_delta(job_id="job_gap", run_id="gap_run")
    events_path.write_text("", encoding="utf-8")

    next_delta = local.build_projection_delta(
        job_id="job_gap",
        run_id="gap_run",
        cursor=first["event_cursor"],
    )

    assert next_delta["summary"]["status"] == "sync_gap_detected"
    assert next_delta["tombstones"][0]["kind"] == "event_cursor_gap"


def test_artifact_manifest_does_not_upload_content_or_secret_like_names(
    tmp_path: Path,
) -> None:
    local = LocalCloudSyncService(tmp_path)
    local.receive_intent(_intent("job_artifacts"))
    local.claim_run_for_receipt("job_artifacts", run_id="artifact_run")
    run_dir = _write_run_summary(tmp_path, "artifact_run")
    artifact_dir = run_dir / "artifacts"
    artifact_dir.mkdir()
    (artifact_dir / "report.md").write_text("# Report\nhello\n", encoding="utf-8")
    (artifact_dir / "secret-token.txt").write_text("hidden", encoding="utf-8")

    delta = local.build_projection_delta(
        job_id="job_artifacts",
        run_id="artifact_run",
        artifact_upload_policy="local_only",
    )
    encoded = json.dumps(delta, ensure_ascii=False)

    assert len(delta["artifact_manifests"]) == 1
    assert delta["artifact_manifests"][0]["relative_path"].endswith("artifacts/report.md")
    assert delta["artifact_manifests"][0]["availability"] == "available_on_runner"
    assert delta["artifact_manifests"][0]["upload_policy"] == "local_only"
    assert "content" not in delta["artifact_manifests"][0]
    assert "secret-token" not in encoded
    assert str(tmp_path) not in encoded


def test_cloud_lease_timeout_is_unconfirmed_not_local_failed(tmp_path: Path) -> None:
    cloud = FakeCloudControlPlaneService(tmp_path / "cloud")
    cloud.create_job_intent(_intent("job_timeout"))
    cloud.lease_next_job("runner_any")

    payload = cloud.expire_lease_unconfirmed("job_timeout")

    assert payload["status"] == "lease_expired_unconfirmed"


def _intent(
    job_id: str,
    *,
    idempotency_key: str | None = None,
    runner_id: str | None = None,
    required_capabilities: list[str] | None = None,
) -> dict:
    return {
        "schema_version": CLOUD_JOB_INTENT_SCHEMA_VERSION,
        "job_id": job_id,
        "idempotency_key": idempotency_key or f"idem-{job_id}",
        "target_runner": {
            "runner_id": runner_id,
            "required_capabilities": required_capabilities or ["generic_cli", "workspace:default"],
        },
        "workflow_template_ref": {
            "kind": "inline_graph",
            "graph": {"id": "cloud_flow", "nodes": [], "control_edges": [], "data_edges": []},
        },
        "input_manifest": {},
        "requested_permission_profile": {
            "network": "ask",
            "shell": "ask",
            "dangerous": False,
        },
        "artifact_upload_policy": "local_only",
        "created_at": "2026-06-13T00:00:00Z",
    }


def _write_run_summary(tmp_path: Path, run_id: str, *, status: str = "success") -> Path:
    run_dir = tmp_path / "runs" / run_id
    if not run_dir.exists():
        claim_run(tmp_path, run_id=run_id)
    summary = RunSummary(
        run_id=run_id,
        workflow_id="cloud_flow",
        status=status,
        started_at="2026-06-13T00:00:00Z",
        ended_at="2026-06-13T00:00:01Z" if status in {"success", "failed"} else None,
        run_dir=str(run_dir.resolve()),
        node_count=0,
        failed_nodes=[],
        nodes=[],
    )
    write_json_atomic(run_dir / "run_summary.json", summary.model_dump())
    return run_dir
