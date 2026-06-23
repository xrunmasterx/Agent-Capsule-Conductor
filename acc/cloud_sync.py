from __future__ import annotations

import hashlib
import json
import mimetypes
import secrets
from pathlib import Path, PureWindowsPath
from typing import Any
from uuid import uuid4

from acc.control_plane import SecretLikePathError, reject_secret_like_path
from acc.run_index import load_run_summary, load_run_summary_by_id
from acc.run_status import is_terminal_run_status
from acc.runner import (
    LocalRunnerService,
    RunnerCapabilityError,
    validate_alias,
    validate_job_id,
)
from acc.session import utc_now_iso
from acc.storage import claim_run, validate_run_id, write_text_atomic
from acc.store import load_json, write_json
from acc.utils import AccError

CLOUD_JOB_INTENT_SCHEMA_VERSION = "acc.cloud.job_intent.v1"
CLOUD_JOB_RECEIPT_SCHEMA_VERSION = "acc.cloud.job_receipt.v1"
CLOUD_LEASE_SCHEMA_VERSION = "acc.cloud.job_lease.v1"
CLOUD_EVENT_CURSOR_SCHEMA_VERSION = "acc.cloud.event_cursor.v1"
CLOUD_PROJECTION_DELTA_SCHEMA_VERSION = "acc.cloud.run_projection_delta.v1"
CLOUD_ARTIFACT_MANIFEST_SCHEMA_VERSION = "acc.cloud.artifact_manifest.v1"
CLOUD_RUNNER_REGISTRATION_SCHEMA_VERSION = "acc.cloud.runner_registration.v1"

UPLOAD_POLICIES = {"local_only", "preview", "on_demand", "always"}


class CloudSyncError(AccError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        field: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.field = field
        self.details = details or {}

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": str(self)}
        if self.field:
            payload["field"] = self.field
        if self.details:
            payload["details"] = self.details
        return payload


class LocalCloudSyncService:
    """Local side of the cloud-control-plane protocol.

    The service owns only local runner state: receipts, cursors, local validation,
    run evidence creation, and projection deltas. It never treats cloud state as
    authoritative execution evidence.
    """

    def __init__(self, project_root: Path | str) -> None:
        self.project_root = Path(project_root).resolve()
        self.runner = LocalRunnerService(self.project_root)
        self.runner_root = self.project_root / ".acc" / "runner"
        self.receipts_root = self.runner_root / "job_receipts"
        self.cursors_root = self.runner_root / "sync_cursors"

    def registration_payload(self) -> dict[str, Any]:
        capabilities = self.runner.capabilities(write=True)
        runner_id = capabilities["runner_id"]
        return {
            "schema_version": CLOUD_RUNNER_REGISTRATION_SCHEMA_VERSION,
            "runner_id": runner_id,
            "capabilities": {
                key: value
                for key, value in capabilities.items()
                if key not in {"provider_credentials", "local_path", "debug_path"}
            },
            "registered_at": utc_now_iso(),
        }

    def receive_intent(
        self,
        intent: dict[str, Any],
        *,
        lease_id: str | None = None,
        lease_epoch: int = 0,
        fencing_token: str | None = None,
    ) -> dict[str, Any]:
        normalized = normalize_job_intent(intent)
        job_id = normalized["job_id"]
        validate_job_id(job_id)
        intent_digest = digest_payload(normalized)
        receipt_path = self._receipt_path(job_id)
        if receipt_path.exists():
            receipt = _load_object(receipt_path)
            if (
                receipt.get("idempotency_key") == normalized["idempotency_key"]
                and receipt.get("intent_digest") == intent_digest
            ):
                return receipt
            if receipt.get("idempotency_key") == normalized["idempotency_key"]:
                raise CloudSyncError(
                    "idempotency_conflict",
                    "Same idempotency_key was reused with a different intent digest",
                    status_code=409,
                    field="idempotency_key",
                )
            raise CloudSyncError(
                "job_conflict",
                f"Job id already has a different receipt: {job_id}",
                status_code=409,
                field="job_id",
            )

        now = utc_now_iso()
        receipt = {
            "schema_version": CLOUD_JOB_RECEIPT_SCHEMA_VERSION,
            "job_id": job_id,
            "idempotency_key": normalized["idempotency_key"],
            "intent_digest": intent_digest,
            "run_id": None,
            "lease_id": lease_id,
            "lease_epoch": lease_epoch,
            "fencing_token": fencing_token,
            "status": "received",
            "created_at": now,
            "updated_at": now,
            "last_synced_at": None,
            "rejection": None,
        }
        self.receipts_root.mkdir(parents=True, exist_ok=True)
        write_json(receipt_path, receipt)

        try:
            self.validate_intent_before_run_creation(normalized)
        except CloudSyncError as exc:
            receipt["status"] = exc.code
            receipt["rejection"] = exc.to_payload()
            receipt["updated_at"] = utc_now_iso()
            write_json(receipt_path, receipt)
        return receipt

    def validate_intent_before_run_creation(self, intent: dict[str, Any]) -> None:
        runner_id = self.runner.ensure_runner_record()["runner_id"]
        target_runner = intent["target_runner"]
        requested_runner_id = target_runner.get("runner_id")
        if requested_runner_id and requested_runner_id != runner_id:
            raise CloudSyncError(
                "capability_mismatch",
                "Job intent targets a different runner",
                field="target_runner.runner_id",
            )
        self._validate_required_capabilities(target_runner.get("required_capabilities") or [])
        self._validate_permission_profile(intent.get("requested_permission_profile") or {})
        self._validate_workflow_template_ref(intent["workflow_template_ref"])
        self._validate_cloud_payload_has_no_local_paths(intent.get("input_manifest") or {})

    def claim_run_for_receipt(
        self,
        job_id: str,
        *,
        run_id: str | None = None,
        workflow_id: str | None = None,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        receipt = self.load_receipt(job_id)
        if receipt.get("rejection"):
            raise CloudSyncError(
                "validation_failed",
                f"Cannot create run evidence for rejected job: {job_id}",
                status_code=409,
                details={"rejection": receipt["rejection"]},
            )
        existing_run_id = receipt.get("run_id")
        if isinstance(existing_run_id, str) and existing_run_id:
            return receipt
        handle = claim_run(
            self.project_root,
            run_id=run_id,
            workflow_id=workflow_id,
            task_id=task_id,
        )
        receipt["run_id"] = handle.run_id
        receipt["status"] = "running"
        receipt["updated_at"] = utc_now_iso()
        write_json(self._receipt_path(job_id), receipt)
        return receipt

    def load_receipt(self, job_id: str) -> dict[str, Any]:
        validate_job_id(job_id)
        return _load_object(self._receipt_path(job_id))

    def mark_receipt_synced(self, job_id: str) -> dict[str, Any]:
        receipt = self.load_receipt(job_id)
        receipt["last_synced_at"] = utc_now_iso()
        receipt["updated_at"] = utc_now_iso()
        write_json(self._receipt_path(job_id), receipt)
        return receipt

    def acknowledge_cancel_intent(self, job_id: str) -> dict[str, Any]:
        receipt = self.load_receipt(job_id)
        run_id = receipt.get("run_id")
        cancel = dict(receipt.get("cancel") or {})
        cancel["state"] = "observed_by_runner"
        if isinstance(run_id, str) and run_id:
            run_dir = self.project_root / "runs" / validate_run_id(run_id)
            summary = load_run_summary(run_dir)
            if summary is not None and is_terminal_run_status(summary.status):
                cancel["state"] = "terminal_synced"
                receipt["status"] = summary.status
            else:
                write_text_atomic(run_dir / "cancel_requested", utc_now_iso())
                cancel["state"] = "local_marker_written"
                receipt["status"] = "cancel_requested"
        else:
            receipt["status"] = "cancel_requested"
        receipt["cancel"] = cancel
        receipt["updated_at"] = utc_now_iso()
        write_json(self._receipt_path(job_id), receipt)
        return receipt

    def build_projection_delta(
        self,
        *,
        job_id: str,
        run_id: str,
        cursor: dict[str, Any] | None = None,
        artifact_upload_policy: str = "local_only",
    ) -> dict[str, Any]:
        validate_job_id(job_id)
        validate_run_id(run_id)
        if artifact_upload_policy not in UPLOAD_POLICIES:
            raise CloudSyncError(
                "rejected_policy",
                f"Unsupported artifact upload policy: {artifact_upload_policy}",
                field="artifact_upload_policy",
            )
        receipt = self.load_receipt(job_id)
        runner_id = self.runner.ensure_runner_record()["runner_id"]
        run_dir = (self.project_root / "runs" / run_id).resolve()
        summary = load_run_summary_by_id(run_id, self.project_root / "runs")
        event_delta = read_projection_events(run_dir, cursor or empty_cursor())
        artifact_manifests = build_artifact_manifests(
            self.project_root,
            run_dir,
            artifact_upload_policy=artifact_upload_policy,
        )
        status = summary.status
        tombstones: list[dict[str, Any]] = []
        if event_delta["sync_gap_detected"]:
            status = "sync_gap_detected"
            tombstones.append(
                {
                    "kind": "event_cursor_gap",
                    "run_id": run_id,
                    "created_at": utc_now_iso(),
                }
            )
        return {
            "schema_version": CLOUD_PROJECTION_DELTA_SCHEMA_VERSION,
            "runner_id": runner_id,
            "run_id": run_id,
            "job_id": job_id,
            "lease_id": receipt.get("lease_id"),
            "lease_epoch": receipt.get("lease_epoch"),
            "summary": {
                "run_id": summary.run_id,
                "workflow_id": summary.workflow_id,
                "status": status,
                "started_at": summary.started_at,
                "ended_at": summary.ended_at,
                "node_count": summary.node_count,
                "failed_nodes": summary.failed_nodes,
            },
            "events": event_delta["events"],
            "event_cursor": event_delta["cursor"],
            "artifact_manifests": artifact_manifests,
            "tombstones": tombstones,
            "created_at": utc_now_iso(),
        }

    def load_cursor(self, run_id: str) -> dict[str, Any]:
        validate_run_id(run_id)
        path = self.cursors_root / f"{run_id}.json"
        if not path.exists():
            return empty_cursor()
        return _load_object(path)

    def save_cursor(self, run_id: str, cursor: dict[str, Any]) -> None:
        validate_run_id(run_id)
        self.cursors_root.mkdir(parents=True, exist_ok=True)
        write_json(self.cursors_root / f"{run_id}.json", cursor)

    def _validate_required_capabilities(self, required: list[Any]) -> None:
        provider_status = self.runner.provider_status()
        for item in required:
            if not isinstance(item, str) or not item:
                raise CloudSyncError(
                    "capability_mismatch",
                    "required_capabilities entries must be non-empty strings",
                    field="target_runner.required_capabilities",
                )
            if item.startswith("workspace:"):
                alias = item.removeprefix("workspace:")
                if _looks_like_local_path(alias):
                    raise CloudSyncError(
                        "workspace_unbound",
                        "Cloud job intent cannot force a local workspace path",
                        field="target_runner.required_capabilities",
                    )
                try:
                    self.runner.resolve_workspace_alias(validate_alias(alias))
                except RunnerCapabilityError as exc:
                    raise CloudSyncError(
                        "workspace_unbound",
                        str(exc),
                        field="target_runner.required_capabilities",
                    ) from exc
                continue
            if provider_status.get(item) != "available":
                raise CloudSyncError(
                    "capability_mismatch",
                    f"Runner capability is unavailable: {item}",
                    field="target_runner.required_capabilities",
                )

    def _validate_permission_profile(self, profile: dict[str, Any]) -> None:
        if profile.get("dangerous") is True:
            raise CloudSyncError(
                "rejected_policy",
                "Cloud job intent cannot silently request dangerous permission",
                field="requested_permission_profile.dangerous",
            )
        for key in ("network", "shell"):
            value = profile.get(key)
            if value not in {None, "ask", "deny"}:
                raise CloudSyncError(
                    "rejected_policy",
                    f"Unsupported permission policy for {key}: {value}",
                    field=f"requested_permission_profile.{key}",
                )

    def _validate_workflow_template_ref(self, template_ref: dict[str, Any]) -> None:
        kind = template_ref.get("kind")
        if kind == "inline_graph":
            graph = template_ref.get("graph")
            if not isinstance(graph, dict) or not graph:
                raise CloudSyncError(
                    "missing_bundle",
                    "inline_graph workflow_template_ref requires graph object",
                    field="workflow_template_ref.graph",
                )
            return
        if kind != "bundle_digest":
            raise CloudSyncError(
                "missing_bundle",
                f"Unsupported workflow_template_ref kind: {kind}",
                field="workflow_template_ref.kind",
            )
        digest = template_ref.get("digest")
        if not isinstance(digest, str) or not digest.startswith("sha256:"):
            raise CloudSyncError(
                "missing_bundle",
                "bundle_digest workflow_template_ref requires sha256 digest",
                field="workflow_template_ref.digest",
            )
        cache_path = self.runner_root / "bundles" / f"{digest.replace(':', '_')}.json"
        if not cache_path.exists():
            raise CloudSyncError(
                "missing_bundle",
                f"Workflow bundle is not cached locally: {digest}",
                field="workflow_template_ref.digest",
            )

    def _validate_cloud_payload_has_no_local_paths(self, payload: Any) -> None:
        if _contains_local_absolute_path(payload):
            raise CloudSyncError(
                "rejected_policy",
                "Cloud job intent cannot submit local absolute paths",
                field="input_manifest",
            )

    def _receipt_path(self, job_id: str) -> Path:
        validate_job_id(job_id)
        return self.receipts_root / f"{job_id}.json"


class FakeCloudControlPlaneService:
    """File-backed fake cloud for protocol tests.

    It intentionally stores only cloud-owned control-plane data: runner registry,
    job intents, leases, projected events, manifests, and cancel intents.
    """

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root).resolve()
        self.runner_registry_root = self.root / "runner_registry"
        self.job_intents_root = self.root / "job_intents"
        self.leases_root = self.root / "job_leases"
        self.projections_root = self.root / "run_projections"
        self.events_root = self.root / "run_event_projections"
        self.artifacts_root = self.root / "artifact_manifests"
        self.cancel_root = self.root / "cancel_intents"

    def pair_runner(self, registration: dict[str, Any]) -> dict[str, Any]:
        runner_id = _require_string(registration, "runner_id", "runner registration")
        payload = {
            "schema_version": CLOUD_RUNNER_REGISTRATION_SCHEMA_VERSION,
            "runner_id": runner_id,
            "state": "paired",
            "capabilities": registration.get("capabilities") or {},
            "paired_at": utc_now_iso(),
        }
        self.runner_registry_root.mkdir(parents=True, exist_ok=True)
        write_json(self.runner_registry_root / f"{runner_id}.json", payload)
        return payload

    def create_job_intent(self, intent: dict[str, Any]) -> dict[str, Any]:
        normalized = normalize_job_intent(intent)
        if _contains_local_absolute_path(normalized):
            raise CloudSyncError(
                "rejected_policy",
                "Cloud job intent cannot contain local absolute paths",
            )
        job_id = normalized["job_id"]
        path = self.job_intents_root / f"{job_id}.json"
        payload = {
            "intent": normalized,
            "intent_digest": digest_payload(normalized),
            "status": "queued",
            "created_at": utc_now_iso(),
            "updated_at": utc_now_iso(),
        }
        self.job_intents_root.mkdir(parents=True, exist_ok=True)
        write_json(path, payload)
        return payload

    def lease_next_job(self, runner_id: str) -> dict[str, Any]:
        for path in sorted(self.job_intents_root.glob("*.json")):
            payload = _load_object(path)
            if payload.get("status") not in {"queued", "lease_expired_unconfirmed"}:
                continue
            intent = payload.get("intent")
            if not isinstance(intent, dict):
                continue
            target = intent.get("target_runner")
            if isinstance(target, dict) and target.get("runner_id") not in {None, runner_id}:
                continue
            lease = self.reissue_lease(intent["job_id"])
            payload["status"] = "leased"
            payload["updated_at"] = utc_now_iso()
            write_json(path, payload)
            return {"intent": intent, "lease": lease}
        raise CloudSyncError("no_jobs", "No queued job intent is available", status_code=404)

    def reissue_lease(self, job_id: str) -> dict[str, Any]:
        validate_job_id(job_id)
        previous = self._latest_lease(job_id)
        lease_epoch = int(previous.get("lease_epoch", 0)) + 1 if previous else 1
        lease = {
            "schema_version": CLOUD_LEASE_SCHEMA_VERSION,
            "lease_id": f"lease_{uuid4().hex[:16]}",
            "job_id": job_id,
            "lease_epoch": lease_epoch,
            "fencing_token": secrets.token_urlsafe(24),
            "status": "active",
            "created_at": utc_now_iso(),
            "last_heartbeat_at": None,
        }
        self.leases_root.mkdir(parents=True, exist_ok=True)
        write_json(self.leases_root / f"{job_id}.json", lease)
        return lease

    def heartbeat(self, lease_id: str, lease_epoch: int, fencing_token: str) -> dict[str, Any]:
        lease = self._require_current_fence(lease_id, lease_epoch, fencing_token)
        lease["last_heartbeat_at"] = utc_now_iso()
        write_json(self.leases_root / f"{lease['job_id']}.json", lease)
        return {"status": "ok", "lease": lease}

    def ingest_projection_delta(
        self,
        delta: dict[str, Any],
        *,
        lease_id: str,
        lease_epoch: int,
        fencing_token: str,
    ) -> dict[str, Any]:
        lease = self._require_current_fence(lease_id, lease_epoch, fencing_token)
        run_id = _require_string(delta, "run_id", "projection delta")
        runner_id = _require_string(delta, "runner_id", "projection delta")
        job_id = _require_string(delta, "job_id", "projection delta")
        if job_id != lease["job_id"]:
            raise CloudSyncError("stale_lease", "Lease does not belong to projection job")

        projection_path = self.projections_root / f"{runner_id}__{run_id}.json"
        self.projections_root.mkdir(parents=True, exist_ok=True)
        summary = dict(delta.get("summary") or {})
        if delta.get("tombstones"):
            summary["status"] = "sync_gap_detected"
        write_json(
            projection_path,
            {
                "runner_id": runner_id,
                "run_id": run_id,
                "job_id": job_id,
                "summary": summary,
                "event_cursor": delta.get("event_cursor") or empty_cursor(),
                "updated_at": utc_now_iso(),
            },
        )

        event_count = self._upsert_projected_events(runner_id, run_id, delta.get("events") or [])
        manifest_count = self._store_artifact_manifests(
            runner_id,
            run_id,
            delta.get("artifact_manifests") or [],
        )
        return {
            "status": "ok",
            "upserted_events": event_count,
            "stored_artifact_manifests": manifest_count,
        }

    def request_cancel(self, job_id: str) -> dict[str, Any]:
        validate_job_id(job_id)
        payload = {
            "job_id": job_id,
            "state": "requested",
            "updated_at": utc_now_iso(),
        }
        self.cancel_root.mkdir(parents=True, exist_ok=True)
        write_json(self.cancel_root / f"{job_id}.json", payload)
        return payload

    def acknowledge_cancel(
        self,
        job_id: str,
        state: str,
        *,
        lease_id: str,
        lease_epoch: int,
        fencing_token: str,
    ) -> dict[str, Any]:
        lease = self._require_current_fence(lease_id, lease_epoch, fencing_token)
        if lease["job_id"] != job_id:
            raise CloudSyncError("stale_lease", "Lease does not belong to cancel job")
        payload = {
            "job_id": job_id,
            "state": state,
            "updated_at": utc_now_iso(),
        }
        self.cancel_root.mkdir(parents=True, exist_ok=True)
        write_json(self.cancel_root / f"{job_id}.json", payload)
        return payload

    def expire_lease_unconfirmed(self, job_id: str) -> dict[str, Any]:
        validate_job_id(job_id)
        intent = _load_object(self.job_intents_root / f"{job_id}.json")
        intent["status"] = "lease_expired_unconfirmed"
        intent["updated_at"] = utc_now_iso()
        write_json(self.job_intents_root / f"{job_id}.json", intent)
        return intent

    def load_projection(self, runner_id: str, run_id: str) -> dict[str, Any]:
        return _load_object(self.projections_root / f"{runner_id}__{run_id}.json")

    def _upsert_projected_events(
        self,
        runner_id: str,
        run_id: str,
        events: list[Any],
    ) -> int:
        path = self.events_root / f"{runner_id}__{run_id}.json"
        store = _load_object(path) if path.exists() else {"events": {}}
        indexed = store.get("events") if isinstance(store.get("events"), dict) else {}
        before = len(indexed)
        for event in events:
            if not isinstance(event, dict):
                continue
            source_id = str(event.get("source_id") or "")
            event_key = str(event.get("event_key") or "")
            if not source_id or not event_key:
                continue
            indexed[f"{source_id}::{event_key}"] = event
        store["events"] = indexed
        self.events_root.mkdir(parents=True, exist_ok=True)
        write_json(path, store)
        return len(indexed) - before

    def _store_artifact_manifests(
        self,
        runner_id: str,
        run_id: str,
        manifests: list[Any],
    ) -> int:
        path = self.artifacts_root / f"{runner_id}__{run_id}.json"
        clean_manifests = [item for item in manifests if isinstance(item, dict)]
        self.artifacts_root.mkdir(parents=True, exist_ok=True)
        write_json(
            path,
            {
                "schema_version": CLOUD_ARTIFACT_MANIFEST_SCHEMA_VERSION,
                "runner_id": runner_id,
                "run_id": run_id,
                "artifacts": clean_manifests,
                "updated_at": utc_now_iso(),
            },
        )
        return len(clean_manifests)

    def _require_current_fence(
        self,
        lease_id: str,
        lease_epoch: int,
        fencing_token: str,
    ) -> dict[str, Any]:
        for path in self.leases_root.glob("*.json"):
            lease = _load_object(path)
            if lease.get("lease_id") != lease_id:
                continue
            if (
                lease.get("lease_epoch") == lease_epoch
                and secrets.compare_digest(str(lease.get("fencing_token") or ""), fencing_token)
            ):
                return lease
            break
        raise CloudSyncError("stale_lease", "Lease fencing token is stale", status_code=409)

    def _latest_lease(self, job_id: str) -> dict[str, Any] | None:
        path = self.leases_root / f"{job_id}.json"
        if not path.exists():
            return None
        return _load_object(path)


def normalize_job_intent(intent: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(intent, dict):
        raise CloudSyncError("invalid_intent", "Job intent must be an object")
    if intent.get("schema_version") != CLOUD_JOB_INTENT_SCHEMA_VERSION:
        raise CloudSyncError(
            "invalid_intent",
            "Unsupported job intent schema_version",
            field="schema_version",
        )
    payload = dict(intent)
    payload["job_id"] = _require_string(payload, "job_id", "job intent")
    payload["idempotency_key"] = _require_string(payload, "idempotency_key", "job intent")
    target_runner = payload.get("target_runner")
    if not isinstance(target_runner, dict):
        raise CloudSyncError("invalid_intent", "target_runner must be an object")
    target_runner = dict(target_runner)
    required = target_runner.get("required_capabilities") or []
    if not isinstance(required, list):
        raise CloudSyncError(
            "invalid_intent",
            "target_runner.required_capabilities must be a list",
        )
    target_runner["required_capabilities"] = required
    payload["target_runner"] = target_runner
    template_ref = payload.get("workflow_template_ref")
    if not isinstance(template_ref, dict):
        raise CloudSyncError("invalid_intent", "workflow_template_ref must be an object")
    payload["workflow_template_ref"] = dict(template_ref)
    permission = payload.get("requested_permission_profile") or {}
    if not isinstance(permission, dict):
        raise CloudSyncError("invalid_intent", "requested_permission_profile must be an object")
    payload["requested_permission_profile"] = dict(permission)
    upload_policy = payload.get("artifact_upload_policy") or "local_only"
    if upload_policy not in UPLOAD_POLICIES:
        raise CloudSyncError(
            "rejected_policy",
            f"Unsupported artifact upload policy: {upload_policy}",
            field="artifact_upload_policy",
        )
    payload["artifact_upload_policy"] = upload_policy
    input_manifest = payload.get("input_manifest") or {}
    if not isinstance(input_manifest, dict):
        raise CloudSyncError("invalid_intent", "input_manifest must be an object")
    payload["input_manifest"] = input_manifest
    return payload


def read_projection_events(run_dir: Path, cursor: dict[str, Any]) -> dict[str, Any]:
    previous = _cursor_sources_by_id(cursor)
    events: list[dict[str, Any]] = []
    next_sources: list[dict[str, Any]] = []
    sync_gap_detected = False
    for source_kind, relative_path, source_id in iter_event_sources(run_dir):
        path = run_dir / relative_path
        source_cursor = previous.get(source_id) or {}
        delta = read_jsonl_projection_delta(
            path,
            source_kind=source_kind,
            source_id=source_id,
            relative_path=str(relative_path).replace("\\", "/"),
            cursor=source_cursor,
        )
        events.extend(delta["events"])
        next_sources.append(delta["cursor"])
        sync_gap_detected = sync_gap_detected or bool(delta["cursor"]["truncated_or_rotated"])
    return {
        "events": events,
        "cursor": {
            "schema_version": CLOUD_EVENT_CURSOR_SCHEMA_VERSION,
            "sources": next_sources,
        },
        "sync_gap_detected": sync_gap_detected,
    }


def iter_event_sources(run_dir: Path) -> list[tuple[str, Path, str]]:
    run_id = run_dir.name
    sources: list[tuple[str, Path, str]] = []
    run_events = run_dir / "events.jsonl"
    if run_events.exists():
        sources.append(("events", Path("events.jsonl"), f"run:{run_id}:events"))
    nodes_dir = run_dir / "nodes"
    if nodes_dir.exists():
        for node_dir in sorted(item for item in nodes_dir.iterdir() if item.is_dir()):
            relative = Path("nodes") / node_dir.name / "events.jsonl"
            if (run_dir / relative).exists():
                source_id = f"run:{run_id}:node:{node_dir.name}:events"
                sources.append(("node_events", relative, source_id))
    return sources


def read_jsonl_projection_delta(
    path: Path,
    *,
    source_kind: str,
    source_id: str,
    relative_path: str,
    cursor: dict[str, Any],
) -> dict[str, Any]:
    byte_offset = int(cursor.get("byte_offset") or 0)
    line_seq = int(cursor.get("line_seq") or 0)
    if not path.exists():
        return {
            "events": [],
            "cursor": _cursor_payload(
                source_kind,
                source_id,
                relative_path,
                byte_offset=0,
                line_seq=line_seq,
                truncated_or_rotated=byte_offset > 0,
            ),
        }
    file_size = path.stat().st_size
    if byte_offset > file_size:
        return {
            "events": [],
            "cursor": _cursor_payload(
                source_kind,
                source_id,
                relative_path,
                byte_offset=0,
                line_seq=0,
                truncated_or_rotated=True,
            ),
        }

    events: list[dict[str, Any]] = []
    last_event_id = cursor.get("last_event_id")
    last_digest = cursor.get("last_digest")
    with path.open("rb") as handle:
        handle.seek(byte_offset)
        while True:
            raw_line = handle.readline()
            if not raw_line:
                byte_offset = handle.tell()
                break
            line_seq += 1
            line_sha = hashlib.sha256(raw_line).hexdigest()
            text = raw_line.decode("utf-8", errors="replace").rstrip("\n")
            try:
                event = json.loads(text)
            except json.JSONDecodeError:
                event = {"type": "raw_log", "payload": {"text": text}}
            if not isinstance(event, dict):
                event = {"type": "raw_log", "payload": {"text": text}}
            event_id = event.get("event_id")
            event_key = str(event_id) if isinstance(event_id, str) and event_id else (
                f"{line_seq}:{line_sha}"
            )
            projected = redact_projection_event(event)
            projected.update(
                {
                    "source_kind": source_kind,
                    "source_id": source_id,
                    "event_key": event_key,
                    "line_seq": line_seq,
                    "line_sha256": f"sha256:{line_sha}",
                }
            )
            events.append(projected)
            last_event_id = event_id if isinstance(event_id, str) else last_event_id
            last_digest = f"sha256:{line_sha}"
    return {
        "events": events,
        "cursor": _cursor_payload(
            source_kind,
            source_id,
            relative_path,
            byte_offset=byte_offset,
            line_seq=line_seq,
            last_event_id=last_event_id if isinstance(last_event_id, str) else None,
            last_digest=last_digest if isinstance(last_digest, str) else None,
            truncated_or_rotated=False,
        ),
    }


def build_artifact_manifests(
    project_root: Path,
    run_dir: Path,
    *,
    artifact_upload_policy: str,
) -> list[dict[str, Any]]:
    manifests: list[dict[str, Any]] = []
    artifact_roots = [run_dir / "artifacts"]
    nodes_dir = run_dir / "nodes"
    if nodes_dir.exists():
        artifact_roots.extend(
            item / "artifacts" for item in sorted(nodes_dir.iterdir()) if item.is_dir()
        )
    for root in artifact_roots:
        if not root.exists() or not root.is_dir():
            continue
        for path in sorted(item for item in root.rglob("*") if item.is_file()):
            try:
                reject_secret_like_path(path)
            except SecretLikePathError:
                continue
            if not path.resolve().is_relative_to(project_root.resolve()):
                continue
            relative_path = str(
                path.resolve().relative_to(project_root.resolve())
            ).replace("\\", "/")
            manifests.append(
                {
                    "schema_version": CLOUD_ARTIFACT_MANIFEST_SCHEMA_VERSION,
                    "artifact_ref": f"run:{run_dir.name}:artifact:{sha256_text(relative_path)}",
                    "relative_path": relative_path,
                    "sha256": f"sha256:{sha256_file(path)}",
                    "size_bytes": path.stat().st_size,
                    "mime_type": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                    "sensitivity": "normal",
                    "availability": "available_on_runner",
                    "upload_policy": artifact_upload_policy,
                    "preview_ref": None if artifact_upload_policy == "local_only" else (
                        f"preview:{run_dir.name}:{sha256_text(relative_path)}"
                    ),
                }
            )
    return manifests


def redact_projection_event(event: dict[str, Any]) -> dict[str, Any]:
    redacted: dict[str, Any] = {}
    for key, value in event.items():
        if (
            key.endswith("_path") or key in {"path", "run_dir", "workspace_dir", "local_path"}
        ) and isinstance(value, str) and _looks_like_local_path(value):
            redacted[f"{key}_redacted"] = True
            continue
        redacted[key] = _redact_nested(value)
    return redacted


def empty_cursor() -> dict[str, Any]:
    return {"schema_version": CLOUD_EVENT_CURSOR_SCHEMA_VERSION, "sources": []}


def digest_payload(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _cursor_sources_by_id(cursor: dict[str, Any]) -> dict[str, dict[str, Any]]:
    sources = cursor.get("sources") if isinstance(cursor, dict) else []
    if not isinstance(sources, list):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for source in sources:
        if not isinstance(source, dict):
            continue
        source_id = source.get("stable_source_id")
        if isinstance(source_id, str) and source_id:
            result[source_id] = source
    return result


def _cursor_payload(
    source_kind: str,
    source_id: str,
    relative_path: str,
    *,
    byte_offset: int,
    line_seq: int,
    last_event_id: str | None = None,
    last_digest: str | None = None,
    truncated_or_rotated: bool,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "source_kind": source_kind,
        "stable_source_id": source_id,
        "relative_path": relative_path,
        "byte_offset": byte_offset,
        "line_seq": line_seq,
        "last_event_id": last_event_id,
        "last_digest": last_digest,
        "truncated_or_rotated": truncated_or_rotated,
    }
    return payload


def _contains_local_absolute_path(value: Any) -> bool:
    if isinstance(value, dict):
        return any(_contains_local_absolute_path(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_local_absolute_path(item) for item in value)
    return isinstance(value, str) and _looks_like_local_path(value)


def _looks_like_local_path(value: str) -> bool:
    if not value:
        return False
    path = Path(value)
    windows_path = PureWindowsPath(value)
    return path.is_absolute() or bool(windows_path.drive) or "\\" in value


def _redact_nested(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _redact_nested(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact_nested(item) for item in value]
    if isinstance(value, str) and _looks_like_local_path(value):
        return "[redacted-local-path]"
    return value


def _require_string(payload: dict[str, Any], key: str, context: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise CloudSyncError("invalid_intent", f"{context} requires string field {key}")
    return value


def _load_object(path: Path) -> dict[str, Any]:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise AccError(f"JSON payload must be an object: {path}")
    return payload
