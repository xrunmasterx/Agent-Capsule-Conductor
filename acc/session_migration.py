from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from typing import Any

from acc.session import utc_now_iso
from acc.storage import write_json_atomic
from acc.storage_index import rebuild_storage_index
from acc.storage_refs import make_session_ref, make_task_ref
from acc.store import load_json
from acc.utils import AccError

SESSION_MIGRATION_PLAN_SCHEMA_VERSION = "acc.session_migration.plan.v1"
SESSION_MIGRATION_MANIFEST_SCHEMA_VERSION = "acc.session_migration.manifest.v1"


def migrate_sessions(
    project_root: Path,
    *,
    apply: bool,
) -> dict[str, Any]:
    project_root = project_root.resolve()
    actions = [action for action in discover_legacy_session_actions(project_root)]
    plan = {
        "schema_version": SESSION_MIGRATION_PLAN_SCHEMA_VERSION,
        "project_root": str(project_root),
        "created_at": utc_now_iso(),
        "mode": "apply" if apply else "dry_run",
        "actions": actions,
    }
    if not apply:
        return plan

    applied: list[dict[str, Any]] = []
    for action in actions:
        result = apply_session_migration_action(project_root, action)
        applied.append(result)
    manifest = {
        "schema_version": SESSION_MIGRATION_MANIFEST_SCHEMA_VERSION,
        "project_root": str(project_root),
        "created_at": utc_now_iso(),
        "actions": applied,
    }
    rebuild_storage_index(project_root)
    return manifest


def discover_legacy_session_actions(project_root: Path) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    seen_targets: set[str] = set()
    for root, session_kind in (
        (project_root / "runs" / "_authoring_sessions", "authoring"),
        (project_root / "runs" / "_agent_sessions", "agent"),
    ):
        if not root.exists():
            continue
        for session_path in sorted(root.rglob("session.json")):
            session_dir = session_path.parent
            payload = load_optional_object(session_path)
            session_id = (
                str(payload.get("session_id") or session_dir.name)
                if isinstance(payload, dict)
                else session_dir.name
            )
            destination = destination_for_session(project_root, session_kind, session_id)
            key = destination.as_posix()
            if key in seen_targets:
                continue
            seen_targets.add(key)
            actions.append(
                {
                    "session_id": session_id,
                    "session_ref": make_session_ref(session_id),
                    "session_kind": session_kind,
                    "source": relative_project_path(project_root, session_dir),
                    "destination": relative_project_path(project_root, destination),
                    "source_digest": digest_path(session_dir),
                    "destination_digest": destination_migration_digest(destination),
                    "status": migration_status(session_dir, destination),
                }
            )
    return actions


def apply_session_migration_action(
    project_root: Path,
    action: dict[str, Any],
) -> dict[str, Any]:
    source = (project_root / str(action["source"])).resolve()
    destination = (project_root / str(action["destination"])).resolve()
    assert_project_child(project_root, source)
    assert_project_child(project_root, destination)
    source_digest = str(action.get("source_digest") or digest_path(source))

    if destination.exists():
        destination_digest = destination_migration_digest(destination)
        if destination_digest == source_digest:
            return {
                **action,
                "status": "skipped_existing",
                "destination_digest": destination_digest,
            }
        raise AccError(
            f"Session migration destination already exists with different content: {destination}"
        )

    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination)
    session_path = destination / "session.json"
    payload = load_optional_object(session_path)
    if isinstance(payload, dict):
        payload = enrich_session_payload(payload, action)
        write_json_atomic(session_path, payload)
    manifest = {
        "schema_version": SESSION_MIGRATION_MANIFEST_SCHEMA_VERSION,
        "session_id": action["session_id"],
        "session_ref": action["session_ref"],
        "session_kind": action["session_kind"],
        "source": action["source"],
        "destination": action["destination"],
        "source_digest": source_digest,
        "migrated_at": utc_now_iso(),
    }
    write_json_atomic(destination / "migration_manifest.json", manifest)
    return {
        **action,
        "status": "migrated",
        "destination_digest": digest_path(destination),
        "manifest": relative_project_path(project_root, destination / "migration_manifest.json"),
    }


def enrich_session_payload(payload: dict[str, Any], action: dict[str, Any]) -> dict[str, Any]:
    session_id = str(action["session_id"])
    task_id = payload.get("task_id")
    owner_ref = payload.get("owner_ref")
    if not owner_ref and isinstance(task_id, str) and task_id:
        owner_ref = make_task_ref(task_id)
    return {
        **payload,
        "session_ref": payload.get("session_ref") or make_session_ref(session_id),
        "owner_ref": owner_ref,
        "migrated_from": action["source"],
        "updated_at": payload.get("updated_at") or utc_now_iso(),
        "retention": payload.get("retention") or {"pinned": False, "retention_class": "normal"},
    }


def destination_for_session(project_root: Path, session_kind: str, session_id: str) -> Path:
    safe_session_id = safe_segment(session_id)
    if session_kind == "authoring":
        return project_root / ".acc" / "sessions" / "authoring" / safe_session_id
    return project_root / ".acc" / "sessions" / safe_session_id


def migration_status(source: Path, destination: Path) -> str:
    if not source.exists():
        return "missing_source"
    if not destination.exists():
        return "pending"
    if digest_path(source) == destination_migration_digest(destination):
        return "skipped_existing"
    return "conflict"


def destination_migration_digest(destination: Path) -> str | None:
    manifest = load_optional_object(destination / "migration_manifest.json")
    if isinstance(manifest, dict) and isinstance(manifest.get("source_digest"), str):
        return manifest["source_digest"]
    return digest_path(destination) if destination.exists() else None


def safe_segment(value: str) -> str:
    if not value or value in {".", ".."} or "/" in value or "\\" in value:
        raise AccError(f"Invalid session id for migration: {value}")
    return value


def load_optional_object(path: Path) -> dict[str, Any] | None:
    try:
        payload = load_json(path)
    except AccError:
        return None
    return payload if isinstance(payload, dict) else None


def digest_path(path: Path) -> str:
    digest = hashlib.sha256()
    if not path.exists():
        return "sha256:" + digest.hexdigest()
    for item in sorted(path.rglob("*"), key=lambda candidate: candidate.as_posix()):
        rel = item.relative_to(path).as_posix()
        digest.update(rel.encode("utf-8"))
        if item.is_file():
            digest.update(b"file")
            with item.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
        elif item.is_dir():
            digest.update(b"dir")
    return "sha256:" + digest.hexdigest()


def assert_project_child(project_root: Path, path: Path) -> None:
    if not path.is_relative_to(project_root):
        raise AccError(f"Session migration path escapes project root: {path}")


def relative_project_path(project_root: Path, path: Path) -> str:
    return path.resolve().relative_to(project_root.resolve()).as_posix()
