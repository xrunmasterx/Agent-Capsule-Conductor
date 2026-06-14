from __future__ import annotations

import hashlib
import json
import shutil
import zipfile
from contextlib import suppress
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from acc.audit import write_audit_event
from acc.models import AccError
from acc.run_index import (
    RunSummary,
    load_or_rebuild_run_index,
    load_run_summary,
    rebuild_run_index,
)
from acc.session import utc_now_iso
from acc.storage import RUN_MARKER_FILENAME, validate_run_id, write_json_atomic
from acc.storage_index import StorageIndex, rebuild_storage_index
from acc.storage_refs import make_legacy_object_ref, make_run_ref, make_task_ref, parse_object_ref
from acc.utils import iter_paths_no_symlink_targets, load_json, safe_path_size_bytes

GC_PLAN_SCHEMA_VERSION = "acc.gc.plan.v1"
GC_MANIFEST_SCHEMA_VERSION = "acc.gc.manifest.v1"
RETENTION_SCHEMA_VERSION = "acc.retention.v1"
TOMBSTONE_SCHEMA_VERSION = "acc.tombstone.v1"
TRASH_ENTRY_SCHEMA_VERSION = "acc.trash.entry.v1"

ACTIVE_RUN_STATUSES = {
    "queued",
    "running",
    "waiting_interaction",
    "resuming",
    "cancel_requested",
}
TERMINAL_RUN_STATUSES = {"success", "failed", "cancelled", "crashed", "timeout"}
PROTECTED_GRAPHOPS_STATUSES = {
    "drafted",
    "validated",
    "awaiting_human_approval",
    "approved",
    "applying",
}
LEGACY_INTERNAL_STORES = (
    "_agent_sessions",
    "_authoring_sessions",
    "_workflow_function_specs",
    "_graphops_proposals",
    "_workbench_canvas_snapshots",
)


@dataclass(frozen=True)
class RetentionPolicy:
    success_after_days: int = 14
    failed_after_days: int = 30
    cancelled_after_days: int = 14
    draft_proposal_after_days: int = 7
    staging_after_hours: int = 24
    trash_grace_days: int = 7
    max_total_bytes: int | None = None


class StorageGCService:
    def __init__(self, project_root: Path, policy: RetentionPolicy | None = None) -> None:
        self.project_root = project_root.resolve()
        self.runs_root = self.project_root / "runs"
        self.acc_root = self.project_root / ".acc"
        self.policy = policy or RetentionPolicy()

    def doctor(self) -> dict[str, Any]:
        issues: list[dict[str, Any]] = []
        for run_dir in self._iter_run_dirs():
            marker_path = run_dir / RUN_MARKER_FILENAME
            if not marker_path.exists():
                issues.append(
                    self._issue(
                        "missing_run_marker",
                        "Run directory is not claimed by ACC storage",
                        run_dir,
                    )
                )
            else:
                self._append_json_issue(issues, marker_path)
            for path in run_dir.rglob("*.json"):
                self._append_json_issue(issues, path)
            for path in run_dir.rglob("*.jsonl"):
                self._append_jsonl_issues(issues, path)

        for name in LEGACY_INTERNAL_STORES:
            path = self.runs_root / name
            if path.exists():
                issues.append(
                    self._issue(
                        "legacy_internal_store_present",
                        f"Compatibility folder exists: runs/{name}",
                        path,
                    )
                )

        for proposal_dir in self._iter_graphops_proposal_dirs():
            for staging_name in ("dry_run_staging", "apply_staging"):
                staging_dir = proposal_dir / staging_name
                if staging_dir.exists():
                    issues.append(
                        self._issue(
                            "residual_graphops_staging",
                            f"Residual GraphOps staging directory: {staging_name}",
                            staging_dir,
                        )
                    )

        self._append_trash_tombstone_issues(issues)
        issues.extend(StorageIndex(self.project_root).consistency_issues())

        return {
            "schema_version": "acc.storage.doctor.v1",
            "project_root": str(self.project_root),
            "checked_at": utc_now_iso(),
            "issues": issues,
        }

    def rebuild_index(self) -> dict[str, Any]:
        index = rebuild_run_index(self.runs_root)
        self.runs_root.mkdir(parents=True, exist_ok=True)
        write_json_atomic(self.runs_root / "index.json", index.model_dump())
        sqlite_index = rebuild_storage_index(self.project_root)
        return {
            "schema_version": "acc.storage.rebuild_index.v1",
            "rebuilt_at": utc_now_iso(),
            "runs_root": str(self.runs_root),
            "run_count": len(index.runs),
            "sqlite_index": sqlite_index,
            "index": index.model_dump(),
        }

    def create_plan(self, *, write: bool = True) -> dict[str, Any]:
        plan_id = f"gc_{uuid4().hex[:16]}"
        actions: list[dict[str, Any]] = []
        protected: list[dict[str, Any]] = []
        now = datetime.now(UTC)
        run_actions_by_id: dict[str, dict[str, Any]] = {}

        index = load_or_rebuild_run_index(self.runs_root)
        summaries_by_run_id = {summary.run_id: summary for summary in index.runs}
        total_run_bytes = 0
        eligible_success: list[tuple[datetime, dict[str, Any]]] = []

        for run_dir in self._iter_run_dirs():
            run_id = run_dir.name
            summary = summaries_by_run_id.get(run_id) or load_run_summary(run_dir)
            retention = self._run_retention(run_dir, summary)
            size_bytes = safe_path_size_bytes(run_dir)
            total_run_bytes += size_bytes
            candidate = self._run_candidate(run_dir, summary, retention, size_bytes)
            decision = self._run_gc_decision(candidate, retention, now)
            if decision["selected"]:
                action = self._action(candidate, decision["action"], decision["reason"])
                actions.append(action)
                run_actions_by_id[run_id] = action
            else:
                protected.append(self._protected(candidate, decision["reason"]))
                if (
                    candidate["state"] == "success"
                    and not retention.get("pinned")
                    and not retention.get("exported")
                ):
                    eligible_success.append(
                        (parse_timestamp(candidate.get("ended_at")) or now, candidate)
                    )

        if (
            self.policy.max_total_bytes is not None
            and total_run_bytes > self.policy.max_total_bytes
        ):
            for _ended_at, candidate in sorted(eligible_success, key=lambda item: item[0]):
                if candidate["object_id"] in run_actions_by_id:
                    continue
                action = self._action(candidate, "trash", "max_total_bytes")
                actions.append(action)
                run_actions_by_id[candidate["object_id"]] = action
                total_run_bytes -= int(candidate.get("size_bytes") or 0)
                if total_run_bytes <= self.policy.max_total_bytes:
                    break

        self._append_graphops_actions(actions, protected, now)
        self._append_runtime_spec_actions(actions, protected, run_actions_by_id)
        self._append_legacy_agent_session_actions(actions, protected, run_actions_by_id)

        plan: dict[str, Any] = {
            "schema_version": GC_PLAN_SCHEMA_VERSION,
            "gc_plan_id": plan_id,
            "created_at": utc_now_iso(),
            "project_root": str(self.project_root),
            "policy": asdict(self.policy),
            "actions": sorted(actions, key=lambda item: item["object_ref"]),
            "protected": sorted(protected, key=lambda item: item["object_ref"]),
        }
        plan["plan_digest"] = digest_payload(
            {
                "schema_version": plan["schema_version"],
                "project_root": plan["project_root"],
                "policy": plan["policy"],
                "actions": plan["actions"],
            }
        )
        if write:
            plan_dir = self._plan_dir(plan_id)
            write_json_atomic(plan_dir / "gc_plan.json", plan)
        return plan

    def apply_plan(self, plan_id: str, *, expected_digest: str | None = None) -> dict[str, Any]:
        plan = self._load_plan(plan_id)
        digest = str(plan.get("plan_digest") or "")
        if expected_digest and expected_digest != digest:
            raise AccError("GC plan digest does not match")
        manifest_path = self._plan_dir(plan_id) / "gc_manifest.json"
        if manifest_path.exists():
            manifest = load_json(manifest_path)
            if isinstance(manifest, dict):
                return manifest

        moved: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        for action in plan.get("actions") or []:
            if not isinstance(action, dict):
                continue
            result = self._apply_action(plan, action)
            if result.get("status") == "moved":
                moved.append(result)
            else:
                skipped.append(result)

        manifest = {
            "schema_version": GC_MANIFEST_SCHEMA_VERSION,
            "gc_plan_id": plan_id,
            "plan_digest": digest,
            "applied_at": utc_now_iso(),
            "moved": moved,
            "skipped": skipped,
        }
        write_json_atomic(manifest_path, manifest)
        write_audit_event(
            self.project_root,
            "gc.apply",
            {
                "gc_plan_id": plan_id,
                "plan_digest": digest,
                "moved": [
                    {"object_ref": item.get("object_ref"), "trash_id": item.get("trash_id")}
                    for item in moved
                ],
                "skipped": [
                    {"object_ref": item.get("object_ref"), "reason": item.get("reason")}
                    for item in skipped
                ],
            },
        )
        self.rebuild_index()
        return manifest

    def purge_expired_trash(self) -> dict[str, Any]:
        purged: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        now = datetime.now(UTC)
        trash_root = self.acc_root / "trash"
        if not trash_root.exists():
            return self._write_purge_manifest(purged, skipped)

        for entry_path in sorted(trash_root.glob("*/trash_entry.json")):
            trash_dir = entry_path.parent
            entry = self._load_optional_json(entry_path)
            if not isinstance(entry, dict):
                skipped.append(
                    {
                        "trash_id": trash_dir.name,
                        "reason": "malformed_trash_entry",
                        "path": str(entry_path),
                    }
                )
                continue
            purge_after = parse_timestamp(entry.get("purge_after"))
            if purge_after is None or purge_after > now:
                skipped.append(
                    {
                        "trash_id": str(entry.get("trash_id") or trash_dir.name),
                        "object_ref": entry.get("object_ref"),
                        "reason": "grace_period_active",
                        "purge_after": entry.get("purge_after"),
                    }
                )
                continue
            blocker = self._trash_entry_purge_blocker(trash_dir, entry)
            if blocker:
                skipped.append(
                    {
                        "trash_id": str(entry.get("trash_id") or trash_dir.name),
                        "object_ref": entry.get("object_ref"),
                        "reason": blocker,
                        "path": str(trash_dir),
                    }
                )
                continue
            self._assert_owned_trash_path(trash_dir)
            purged.append(
                {
                    "trash_id": str(entry.get("trash_id") or trash_dir.name),
                    "object_ref": entry.get("object_ref"),
                    "path": str(trash_dir),
                    "purged_at": utc_now_iso(),
                    "trash_entry": entry,
                }
            )
            shutil.rmtree(trash_dir)

        manifest = self._write_purge_manifest(purged, skipped)
        write_audit_event(
            self.project_root,
            "gc.purge",
            {
                "purge_id": manifest.get("purge_id"),
                "purged": [
                    {"object_ref": item.get("object_ref"), "trash_id": item.get("trash_id")}
                    for item in purged
                ],
                "skipped": [
                    {"object_ref": item.get("object_ref"), "reason": item.get("reason")}
                    for item in skipped
                ],
            },
        )
        self.rebuild_index()
        return manifest

    def set_pinned(self, object_ref: str, pinned: bool) -> dict[str, Any]:
        kind, object_id = parse_object_ref(object_ref)
        if kind == "run":
            path = self._run_retention_path(validate_run_id(object_id))
            payload = self._load_retention(path)
            payload.update({"kind": "run", "object_id": object_id, "pinned": pinned})
            write_json_atomic(path, retention_payload(payload))
            return {"object_ref": object_ref, "retention": retention_payload(payload)}
        if kind == "task":
            task_dir = self.acc_root / "tasks" / object_id
            path = task_dir / "retention.json"
            if not task_dir.exists():
                raise AccError(f"Task not found: {object_id}")
            payload = self._load_retention(path)
            payload.update({"kind": "task", "object_id": object_id, "pinned": pinned})
            write_json_atomic(path, retention_payload(payload))
            task_path = task_dir / "task.json"
            if task_path.exists():
                task = load_json(task_path)
                if isinstance(task, dict):
                    task["retention"] = {
                        "pinned": pinned,
                        "retention_class": payload.get("retention_class", "normal"),
                    }
                    write_json_atomic(task_path, task)
            return {"object_ref": object_ref, "retention": retention_payload(payload)}
        if kind == "session":
            session_dir = self._find_session_dir(object_id)
            if session_dir is None:
                raise AccError(f"Session not found: {object_id}")
            path = session_dir / "retention.json"
            payload = self._load_retention(path)
            payload.update({"kind": "session", "object_id": object_id, "pinned": pinned})
            write_json_atomic(path, retention_payload(payload))
            return {"object_ref": object_ref, "retention": retention_payload(payload)}
        raise AccError(f"Unsupported pinnable object kind: {kind}")

    def export_run(self, run_id: str, output_path: Path) -> dict[str, Any]:
        safe_run_id = validate_run_id(run_id)
        run_dir = self.runs_root / safe_run_id
        if not run_dir.exists():
            raise AccError(f"Run not found: {safe_run_id}")
        output_path = output_path.resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in iter_paths_no_symlink_targets(run_dir):
                if path.is_dir():
                    continue
                archive.write(path, path.relative_to(self.project_root).as_posix())
            spec_dir = runtime_spec_dir_for_run(self.project_root, run_dir)
            if spec_dir.exists():
                for path in iter_paths_no_symlink_targets(spec_dir):
                    if path.is_dir():
                        continue
                    archive.write(path, path.relative_to(self.project_root).as_posix())
        path = self._run_retention_path(safe_run_id)
        payload = self._load_retention(path)
        payload.update({"kind": "run", "object_id": safe_run_id, "exported": True})
        write_json_atomic(path, retention_payload(payload))
        return {
            "status": "exported",
            "object_ref": make_run_ref(safe_run_id),
            "legacy_object_ref": make_legacy_object_ref("run", safe_run_id),
            "archive": str(output_path),
            "retention": retention_payload(payload),
        }

    def _run_gc_decision(
        self,
        candidate: dict[str, Any],
        retention: dict[str, Any],
        now: datetime,
    ) -> dict[str, Any]:
        state = str(candidate.get("state") or "unknown")
        if retention.get("pinned"):
            return {"selected": False, "reason": "pinned"}
        if retention.get("exported"):
            return {"selected": False, "reason": "exported"}
        if self._has_active_run_lease(str(candidate["object_id"]), Path(candidate["path"])):
            return {"selected": False, "reason": "active_lease"}
        if state in ACTIVE_RUN_STATUSES:
            return {"selected": False, "reason": f"active_status:{state}"}
        if state not in TERMINAL_RUN_STATUSES:
            return {"selected": True, "action": "quarantine", "reason": f"unknown_state:{state}"}
        if state == "success":
            days = self.policy.success_after_days
        elif state in {"failed", "crashed", "timeout"}:
            days = self.policy.failed_after_days
        else:
            days = self.policy.cancelled_after_days
        ended_at = parse_timestamp(candidate.get("ended_at")) or parse_timestamp(
            candidate.get("created_at")
        )
        if ended_at is None:
            return {"selected": True, "action": "quarantine", "reason": "missing_timestamp"}
        if ended_at + timedelta(days=days) > now:
            return {"selected": False, "reason": f"retention_window:{state}"}
        return {"selected": True, "action": "trash", "reason": f"retention_expired:{state}"}

    def _run_candidate(
        self,
        run_dir: Path,
        summary: RunSummary | None,
        retention: dict[str, Any],
        size_bytes: int,
    ) -> dict[str, Any]:
        marker = self._load_optional_json(run_dir / RUN_MARKER_FILENAME)
        state = summary.status if summary is not None else "unknown"
        created_at = marker.get("created_at") if isinstance(marker, dict) else None
        ended_at = summary.ended_at if summary is not None else None
        owner_ref = None
        if isinstance(marker, dict) and marker.get("task_id"):
            owner_ref = make_task_ref(str(marker["task_id"]))
        return {
            "object_ref": make_run_ref(run_dir.name),
            "legacy_object_ref": make_legacy_object_ref("run", run_dir.name),
            "object_kind": "run",
            "object_id": run_dir.name,
            "path": str(run_dir),
            "state": state,
            "created_at": created_at,
            "ended_at": ended_at,
            "owner_ref": owner_ref,
            "size_bytes": size_bytes,
            "pinned": bool(retention.get("pinned")),
            "exported": bool(retention.get("exported")),
            "retention_class": retention.get("retention_class", "normal"),
            "digest": digest_path(run_dir),
        }

    def _action(
        self,
        candidate: dict[str, Any],
        action: str,
        reason: str,
    ) -> dict[str, Any]:
        return {
            "object_ref": candidate["object_ref"],
            "object_kind": candidate["object_kind"],
            "object_id": candidate["object_id"],
            "action": action,
            "reason": reason,
            "path": candidate["path"],
            "extra_paths": [],
            "size_bytes": candidate.get("size_bytes", 0),
            "digest": candidate.get("digest"),
            "state": candidate.get("state"),
        }

    def _protected(self, candidate: dict[str, Any], reason: str) -> dict[str, Any]:
        return {
            "object_ref": candidate["object_ref"],
            "object_kind": candidate["object_kind"],
            "object_id": candidate["object_id"],
            "reason": reason,
            "path": candidate["path"],
            "state": candidate.get("state"),
            "size_bytes": candidate.get("size_bytes", 0),
        }

    def _append_runtime_spec_actions(
        self,
        actions: list[dict[str, Any]],
        protected: list[dict[str, Any]],
        run_actions_by_id: dict[str, dict[str, Any]],
    ) -> None:
        specs_root = self.runs_root / "_workflow_function_specs"
        if not specs_root.exists():
            return
        handled_paths: set[Path] = set()
        for run_id, run_action in run_actions_by_id.items():
            spec_dir = runtime_spec_dir_for_run(self.project_root, self.runs_root / run_id)
            if spec_dir.exists():
                run_action["extra_paths"].append(str(spec_dir))
                handled_paths.add(spec_dir.resolve())
        for spec_dir in sorted(path for path in specs_root.iterdir() if path.is_dir()):
            if spec_dir.resolve() in handled_paths or spec_dir.name == "_preflight":
                continue
            protected.append(
                {
                    "object_ref": f"runtime_workflow_spec:v1:{spec_dir.name}",
                    "legacy_object_ref": f"runtime_workflow_spec:{spec_dir.name}",
                    "object_kind": "runtime_workflow_spec",
                    "object_id": spec_dir.name,
                    "reason": "orphan_runtime_spec_requires_quarantine_review",
                    "path": str(spec_dir),
                    "state": "orphan",
                    "size_bytes": safe_path_size_bytes(spec_dir),
                }
            )

    def _append_legacy_agent_session_actions(
        self,
        actions: list[dict[str, Any]],
        protected: list[dict[str, Any]],
        run_actions_by_id: dict[str, dict[str, Any]],
    ) -> None:
        root = self.runs_root / "_agent_sessions"
        if not root.exists():
            return
        for session_path in sorted(root.glob("*/*/session.json")):
            session_dir = session_path.parent
            payload = self._load_optional_json(session_path)
            if not isinstance(payload, dict):
                protected.append(
                    {
                        "object_ref": f"legacy_agent_session:v1:{session_dir.name}",
                        "legacy_object_ref": f"legacy_agent_session:{session_dir.name}",
                        "object_kind": "session",
                        "object_id": session_dir.name,
                        "reason": "malformed_session_requires_quarantine_review",
                        "path": str(session_dir),
                        "state": "invalid",
                        "size_bytes": safe_path_size_bytes(session_dir),
                    }
                )
                continue
            bound_run_id = payload.get("bound_run_id")
            if isinstance(bound_run_id, str) and bound_run_id in run_actions_by_id:
                run_actions_by_id[bound_run_id]["extra_paths"].append(str(session_dir))
                continue
            protected.append(
                {
                    "object_ref": f"session:v1:{payload.get('session_id') or session_dir.name}",
                    "legacy_object_ref": f"session:{payload.get('session_id') or session_dir.name}",
                    "object_kind": "session",
                    "object_id": str(payload.get("session_id") or session_dir.name),
                    "reason": "session_retention_independent_from_run",
                    "path": str(session_dir),
                    "state": payload.get("status"),
                    "size_bytes": safe_path_size_bytes(session_dir),
                }
            )

    def _append_graphops_actions(
        self,
        actions: list[dict[str, Any]],
        protected: list[dict[str, Any]],
        now: datetime,
    ) -> None:
        for proposal_dir in self._iter_graphops_proposal_dirs():
            payload = self._load_optional_json(proposal_dir / "proposal.json")
            proposal_id = proposal_dir.name
            status = str(payload.get("status") if isinstance(payload, dict) else "invalid")
            for staging_name in ("dry_run_staging", "apply_staging"):
                staging_dir = proposal_dir / staging_name
                if not staging_dir.exists():
                    continue
                if status == "applying":
                    protected.append(
                        self._protected_path(
                            f"staging_dir:v1:{proposal_id}_{staging_name}",
                            "staging_dir",
                            proposal_id,
                            staging_dir,
                            "graphops_applying",
                            status,
                        )
                    )
                    continue
                if self._path_mtime(staging_dir) + timedelta(
                    hours=self.policy.staging_after_hours
                ) <= now:
                    actions.append(
                        self._path_action(
                            f"staging_dir:v1:{proposal_id}_{staging_name}",
                            "staging_dir",
                            proposal_id,
                            staging_dir,
                            "quarantine",
                            "staging_expired",
                            status,
                        )
                    )
            updated_at = (
                parse_timestamp(payload.get("updated_at") or payload.get("created_at"))
                if isinstance(payload, dict)
                else None
            )
            if status == "drafted" and updated_at is not None:
                if updated_at + timedelta(days=self.policy.draft_proposal_after_days) <= now:
                    actions.append(
                        self._path_action(
                            f"graphops_proposal:v1:{proposal_id}",
                            "graphops_proposal",
                            proposal_id,
                            proposal_dir,
                            "quarantine",
                            "abandoned_draft_expired",
                            status,
                        )
                    )
                    continue
                protected.append(
                    self._protected_path(
                        f"graphops_proposal:v1:{proposal_id}",
                        "graphops_proposal",
                        proposal_id,
                        proposal_dir,
                        "draft_retention_window",
                        status,
                    )
                )
                continue
            if status in PROTECTED_GRAPHOPS_STATUSES:
                protected.append(
                    self._protected_path(
                        f"graphops_proposal:v1:{proposal_id}",
                        "graphops_proposal",
                        proposal_id,
                        proposal_dir,
                        f"graphops_status:{status}",
                        status,
                    )
                )
                continue
            if status == "invalid" or updated_at is None:
                actions.append(
                    self._path_action(
                        f"graphops_proposal:v1:{proposal_id}",
                        "graphops_proposal",
                        proposal_id,
                        proposal_dir,
                        "quarantine",
                        "malformed_graphops_proposal",
                        status,
                    )
                )
                continue

    def _path_action(
        self,
        object_ref: str,
        object_kind: str,
        object_id: str,
        path: Path,
        action: str,
        reason: str,
        state: str | None,
    ) -> dict[str, Any]:
        return {
            "object_ref": object_ref,
            "object_kind": object_kind,
            "object_id": object_id,
            "action": action,
            "reason": reason,
            "path": str(path),
            "extra_paths": [],
            "size_bytes": safe_path_size_bytes(path),
            "digest": digest_path(path),
            "state": state,
        }

    def _protected_path(
        self,
        object_ref: str,
        object_kind: str,
        object_id: str,
        path: Path,
        reason: str,
        state: str | None,
    ) -> dict[str, Any]:
        return {
            "object_ref": object_ref,
            "object_kind": object_kind,
            "object_id": object_id,
            "reason": reason,
            "path": str(path),
            "state": state,
            "size_bytes": safe_path_size_bytes(path),
        }

    def _apply_action(self, plan: dict[str, Any], action: dict[str, Any]) -> dict[str, Any]:
        object_ref = str(action["object_ref"])
        if self._is_already_tombstoned(action, str(plan["gc_plan_id"])):
            return {"status": "skipped", "object_ref": object_ref, "reason": "already_tombstoned"}
        trash_id = safe_trash_id(str(plan["gc_plan_id"]), object_ref)
        trash_dir = self.acc_root / "trash" / trash_id
        trash_dir.mkdir(parents=True, exist_ok=True)
        moved_paths = []
        all_paths = [Path(str(action["path"]))] + [
            Path(str(path)) for path in action.get("extra_paths") or []
        ]
        for source in all_paths:
            if not source.exists() and not source.is_symlink():
                continue
            self._assert_owned_cleanup_path(source)
            destination = trash_dir / source.relative_to(self.project_root.resolve())
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                continue
            shutil.move(str(source), str(destination))
            moved_paths.append({"from": str(source), "to": str(destination)})

        tombstone = {
            "schema_version": TOMBSTONE_SCHEMA_VERSION,
            "object_ref": object_ref,
            "object_kind": action.get("object_kind"),
            "deleted_at": utc_now_iso(),
            "deleted_by": "local_user",
            "reason": action.get("reason"),
            "gc_plan_id": plan["gc_plan_id"],
            "content_digest_before_delete": action.get("digest"),
        }
        tombstone_path = self._tombstone_path_for_action(action)
        write_json_atomic(tombstone_path, tombstone)
        trash_entry = {
            "schema_version": TRASH_ENTRY_SCHEMA_VERSION,
            "trash_id": trash_id,
            "object_ref": object_ref,
            "original_path": action.get("path"),
            "moved_paths": moved_paths,
            "digest": action.get("digest"),
            "size_bytes": action.get("size_bytes"),
            "moved_at": utc_now_iso(),
            "purge_after": (
                datetime.now(UTC) + timedelta(days=self.policy.trash_grace_days)
            ).isoformat().replace("+00:00", "Z"),
        }
        write_json_atomic(trash_dir / "trash_entry.json", trash_entry)
        return {
            "status": "moved",
            "object_ref": object_ref,
            "trash_id": trash_id,
            "tombstone": str(tombstone_path),
            "trash_entry": str(trash_dir / "trash_entry.json"),
            "moved_paths": moved_paths,
        }

    def _is_already_tombstoned(self, action: dict[str, Any], plan_id: str) -> bool:
        path = self._tombstone_path_for_action(action)
        if not path.exists():
            return False
        payload = self._load_optional_json(path)
        return isinstance(payload, dict) and payload.get("gc_plan_id") == plan_id

    def _tombstone_path_for_action(self, action: dict[str, Any]) -> Path:
        kind = str(action.get("object_kind") or "")
        object_id = str(action.get("object_id") or "")
        if kind == "run":
            return self.runs_root / validate_run_id(object_id) / "tombstone.json"
        return self.acc_root / "tombstones" / safe_ref_filename(str(action["object_ref"]))

    def _assert_owned_cleanup_path(self, path: Path) -> None:
        resolved = path.resolve() if not path.is_symlink() else path.parent.resolve() / path.name
        allowed_roots = [self.runs_root.resolve(), self.acc_root.resolve()]
        if not any(is_relative_to(resolved, root) for root in allowed_roots):
            raise AccError(f"GC path is outside ACC-owned roots: {path}")
        if is_relative_to(resolved, (self.acc_root / "trash").resolve()):
            raise AccError(f"GC path is already trash: {path}")
        if resolved == self.runs_root.resolve() or resolved == self.acc_root.resolve():
            raise AccError(f"GC refuses to move storage root: {path}")

    def _assert_owned_trash_path(self, path: Path) -> None:
        resolved = path.resolve()
        trash_root = (self.acc_root / "trash").resolve()
        if not is_relative_to(resolved, trash_root) or resolved == trash_root:
            raise AccError(f"GC refuses to purge non-trash path: {path}")

    def _write_purge_manifest(
        self,
        purged: list[dict[str, Any]],
        skipped: list[dict[str, Any]],
    ) -> dict[str, Any]:
        manifest = {
            "schema_version": "acc.gc.purge_manifest.v1",
            "purge_id": f"purge_{uuid4().hex[:16]}",
            "created_at": utc_now_iso(),
            "purged": purged,
            "skipped": skipped,
        }
        write_json_atomic(
            self.acc_root / "gc" / "purge_manifests" / f"{manifest['purge_id']}.json",
            manifest,
        )
        return manifest

    def _iter_run_dirs(self) -> list[Path]:
        if not self.runs_root.exists():
            return []
        return [
            path
            for path in sorted(self.runs_root.iterdir())
            if path.is_dir() and not path.name.startswith("_") and path.name != "index.json"
        ]

    def _iter_graphops_proposal_dirs(self) -> list[Path]:
        root = self.runs_root / "_graphops_proposals"
        if not root.exists():
            return []
        return [path for path in sorted(root.iterdir()) if path.is_dir()]

    def _run_retention(self, run_dir: Path, summary: RunSummary | None) -> dict[str, Any]:
        path = run_dir / "retention.json"
        payload = self._load_retention(path)
        marker = self._load_optional_json(run_dir / RUN_MARKER_FILENAME)
        owner_ref = None
        if isinstance(marker, dict) and marker.get("task_id"):
            owner_ref = f"task:{marker['task_id']}"
        state = summary.status if summary is not None else "unknown"
        return retention_payload(
            {
                **payload,
                "kind": "run",
                "object_id": run_dir.name,
                "owner_ref": owner_ref,
                "state": state,
                "created_at": marker.get("created_at") if isinstance(marker, dict) else None,
                "ended_at": summary.ended_at if summary is not None else None,
                "size_bytes": safe_path_size_bytes(run_dir),
            }
        )

    def _run_retention_path(self, run_id: str) -> Path:
        return self.runs_root / validate_run_id(run_id) / "retention.json"

    def _load_retention(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        payload = self._load_optional_json(path)
        return payload if isinstance(payload, dict) else {}

    def _load_optional_json(self, path: Path) -> Any:
        if not path.exists():
            return None
        try:
            return load_json(path)
        except AccError:
            return None

    def _append_json_issue(self, issues: list[dict[str, Any]], path: Path) -> None:
        if not path.exists() or not path.is_file():
            return
        try:
            load_json(path)
        except AccError as exc:
            issues.append(self._issue("malformed_json", str(exc), path))

    def _append_jsonl_issues(self, issues: list[dict[str, Any]], path: Path) -> None:
        if not path.exists() or not path.is_file():
            return
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if not line.strip():
                continue
            try:
                json.loads(line)
            except json.JSONDecodeError as exc:
                issues.append(
                    self._issue(
                        "malformed_jsonl",
                        f"Invalid JSONL at line {line_number}: {exc}",
                        path,
                    )
                )

    def _append_trash_tombstone_issues(self, issues: list[dict[str, Any]]) -> None:
        trash_root = self.acc_root / "trash"
        if trash_root.exists():
            for trash_dir in sorted(path for path in trash_root.iterdir() if path.is_dir()):
                entry_path = trash_dir / "trash_entry.json"
                entry = self._load_optional_json(entry_path)
                if not isinstance(entry, dict):
                    issues.append(
                        self._issue(
                            "missing_or_malformed_trash_entry",
                            "Trash entry is invalid",
                            entry_path,
                        )
                    )
                    continue
                object_ref = entry.get("object_ref")
                moved_paths = entry.get("moved_paths")
                if not object_ref:
                    issues.append(
                        self._issue(
                            "trash_missing_object_ref",
                            "Trash entry has no object_ref",
                            entry_path,
                        )
                    )
                if not isinstance(moved_paths, list) or not moved_paths:
                    issues.append(
                        self._issue(
                            "trash_missing_moved_paths",
                            "Trash entry has no moved path manifest",
                            entry_path,
                        )
                    )
        for tombstone_path in self._iter_tombstone_paths():
            tombstone = self._load_optional_json(tombstone_path)
            if not isinstance(tombstone, dict):
                issues.append(
                    self._issue(
                        "malformed_tombstone",
                        "Tombstone JSON is invalid",
                        tombstone_path,
                    )
                )
                continue
            object_ref = tombstone.get("object_ref")
            gc_plan_id = tombstone.get("gc_plan_id")
            if not object_ref:
                issues.append(
                    self._issue(
                        "tombstone_missing_object_ref",
                        "Tombstone has no object_ref",
                        tombstone_path,
                    )
                )
            if gc_plan_id and not (self._plan_dir(str(gc_plan_id)) / "gc_manifest.json").exists():
                issues.append(
                    self._issue(
                        "tombstone_missing_gc_manifest",
                        f"Tombstone references missing GC manifest: {gc_plan_id}",
                        tombstone_path,
                    )
                )

    def _issue(self, code: str, message: str, path: Path) -> dict[str, Any]:
        return {
            "code": code,
            "message": message,
            "path": relative_project_path(self.project_root, path),
        }

    def _path_mtime(self, path: Path) -> datetime:
        return datetime.fromtimestamp(path.stat().st_mtime, UTC)

    def _plan_dir(self, plan_id: str) -> Path:
        if not plan_id.startswith("gc_") or not safe_ref_filename(plan_id) == plan_id:
            raise AccError(f"Invalid GC plan id: {plan_id}")
        return self.acc_root / "gc" / "plans" / plan_id

    def _load_plan(self, plan_id: str) -> dict[str, Any]:
        path = self._plan_dir(plan_id) / "gc_plan.json"
        if not path.exists():
            raise AccError(f"GC plan not found: {plan_id}")
        payload = load_json(path)
        if not isinstance(payload, dict) or payload.get("schema_version") != GC_PLAN_SCHEMA_VERSION:
            raise AccError(f"Invalid GC plan: {plan_id}")
        return payload

    def _find_session_dir(self, session_id: str) -> Path | None:
        for direct in (
            self.acc_root / "sessions" / session_id,
            self.acc_root / "sessions" / "authoring" / session_id,
        ):
            if (direct / "session.json").exists():
                return direct
        for path in self.runs_root.glob("*/nodes/*/sessions/*/session.json"):
            if path.parent.name == session_id:
                return path.parent
        return None

    def _has_active_run_lease(self, run_id: str, run_dir: Path) -> bool:
        return has_active_lease(run_dir) or (
            self.acc_root / "leases" / "runs" / f"{run_id}.json"
        ).exists()

    def _iter_tombstone_paths(self) -> list[Path]:
        paths = list((self.acc_root / "tombstones").glob("*"))
        if self.runs_root.exists():
            paths.extend(self.runs_root.glob("*/tombstone.json"))
        return sorted(paths)

    def _trash_entry_purge_blocker(self, trash_dir: Path, entry: dict[str, Any]) -> str | None:
        object_ref = entry.get("object_ref")
        if not isinstance(object_ref, str) or not object_ref:
            return "trash_missing_object_ref"
        moved_paths = entry.get("moved_paths")
        if not isinstance(moved_paths, list) or not moved_paths:
            return "trash_missing_moved_paths"
        try:
            kind, object_id = parse_object_ref(object_ref)
        except AccError:
            return "trash_invalid_object_ref"
        if kind == "run":
            if self._has_active_run_lease(object_id, self.runs_root / object_id):
                return "active_lease"
            trashed_run = trash_dir / "runs" / object_id
            if not (
                (trashed_run / RUN_MARKER_FILENAME).exists()
                or (trashed_run / "tombstone.json").exists()
            ):
                return "trash_missing_run_marker_or_tombstone"
        return None


def retention_payload(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": RETENTION_SCHEMA_VERSION,
        "kind": value.get("kind"),
        "object_id": value.get("object_id"),
        "owner_ref": value.get("owner_ref"),
        "state": value.get("state"),
        "created_at": value.get("created_at"),
        "last_accessed_at": value.get("last_accessed_at"),
        "ended_at": value.get("ended_at"),
        "size_bytes": int(value.get("size_bytes") or 0),
        "pinned": bool(value.get("pinned", False)),
        "exported": bool(value.get("exported", False)),
        "retention_class": str(value.get("retention_class") or "normal"),
        "expires_at": value.get("expires_at"),
        "local_only": bool(value.get("local_only", True)),
    }


def runtime_spec_dir_for_run(project_root: Path, run_dir: Path) -> Path:
    rel = relative_project_path(project_root, run_dir)
    digest = hashlib.sha256(rel.encode("utf-8")).hexdigest()[:12]
    return project_root / "runs" / "_workflow_function_specs" / f"run-{digest}"


def digest_path(path: Path) -> str:
    digest = hashlib.sha256()
    if not path.exists() and not path.is_symlink():
        return "sha256:" + digest.hexdigest()
    for item in iter_paths_no_symlink_targets(path):
        try:
            rel = item.relative_to(path if path.is_dir() else path.parent).as_posix()
        except ValueError:
            rel = item.name
        digest.update(rel.encode("utf-8"))
        if item.is_symlink():
            digest.update(b"symlink")
            with suppress(OSError):
                digest.update(str(item.readlink()).encode("utf-8"))
            continue
        if item.is_file():
            digest.update(b"file")
            with item.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
        elif item.is_dir():
            digest.update(b"dir")
    return "sha256:" + digest.hexdigest()


def has_active_lease(run_dir: Path) -> bool:
    return (run_dir / ".acc-active-lease.json").exists()


def parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def digest_payload(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def safe_ref_filename(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in value)


def safe_trash_id(plan_id: str, object_ref: str) -> str:
    return f"{safe_ref_filename(plan_id)}_{safe_ref_filename(object_ref)}"


def relative_project_path(project_root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(project_root.resolve()).as_posix()
    except ValueError:
        return str(path)


def is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False
