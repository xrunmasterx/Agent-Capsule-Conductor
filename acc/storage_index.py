from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from acc.run_index import load_run_summary
from acc.session import utc_now_iso
from acc.storage import RUN_MARKER_FILENAME
from acc.storage_refs import (
    make_legacy_object_ref,
    make_object_ref,
    make_run_ref,
    make_session_ref,
    make_task_ref,
    parse_object_ref,
)
from acc.utils import AccError, load_json, log_stderr, safe_path_size_bytes

SQLITE_SCHEMA_VERSION = "acc.storage.index.sqlite.v1"
STORAGE_INDEX_SIZE_EXCLUDES = ("codex_home/.tmp",)


@dataclass(frozen=True)
class StorageObjectRow:
    object_ref: str
    legacy_ref: str | None
    object_kind: str
    object_id: str
    path: str
    owner_ref: str | None = None
    state: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    ended_at: str | None = None
    size_bytes: int = 0
    digest: str | None = None
    pinned: bool = False
    exported: bool = False
    retention_class: str = "normal"
    local_only: bool = True
    lease_state: str | None = None


class StorageIndex:
    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root.resolve()
        self.acc_root = self.project_root / ".acc"
        self.db_path = self.acc_root / "index.sqlite"

    def rebuild(self) -> dict[str, Any]:
        rows = build_inventory_rows(self.project_root)
        self.acc_root.mkdir(parents=True, exist_ok=True)
        conn = self._connect()
        try:
            ensure_schema(conn)
            with conn:
                conn.execute("DELETE FROM objects")
                conn.executemany(
                    """
                    INSERT INTO objects (
                      object_ref, legacy_ref, object_kind, object_id, owner_ref, path, state,
                      created_at, updated_at, ended_at, size_bytes, digest, pinned, exported,
                      retention_class, local_only, lease_state, indexed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [row_to_sql(row) for row in rows],
                )
                conn.execute(
                    "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
                    ("schema_version", SQLITE_SCHEMA_VERSION),
                )
                conn.execute(
                    "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
                    ("rebuilt_at", utc_now_iso()),
                )
        finally:
            conn.close()
        return {
            "schema_version": "acc.storage.sqlite_index.rebuild.v1",
            "sqlite_path": str(self.db_path),
            "object_count": len(rows),
            "objects_by_kind": count_by_kind(rows),
        }

    def consistency_issues(self) -> list[dict[str, Any]]:
        expected = {row.object_ref: row for row in build_inventory_rows(self.project_root)}
        if not self.db_path.exists():
            if not expected:
                return []
            return [
                {
                    "code": "missing_sqlite_index",
                    "message": ".acc/index.sqlite is missing and can be rebuilt",
                    "path": ".acc/index.sqlite",
                }
            ]
        conn = self._connect()
        try:
            ensure_schema(conn)
            actual_rows = conn.execute("SELECT object_ref, path FROM objects").fetchall()
        finally:
            conn.close()
        actual = {str(row["object_ref"]): str(row["path"]) for row in actual_rows}
        issues: list[dict[str, Any]] = []
        for object_ref, row in sorted(expected.items()):
            if object_ref not in actual:
                issues.append(
                    {
                        "code": "missing_index_row",
                        "message": f"SQLite index is missing object row: {object_ref}",
                        "path": row.path,
                    }
                )
        for object_ref, path in sorted(actual.items()):
            if object_ref not in expected:
                issues.append(
                    {
                        "code": "stale_index_row",
                        "message": f"SQLite index references missing object: {object_ref}",
                        "path": path,
                    }
                )
        return issues

    def upsert_object(self, object_ref: str) -> bool:
        """Refresh a single indexed object row without rebuilding the repository index."""
        row = build_object_row(self.project_root, object_ref)
        self.acc_root.mkdir(parents=True, exist_ok=True)
        conn = self._connect()
        try:
            ensure_schema(conn)
            with conn:
                if row is None:
                    conn.execute("DELETE FROM objects WHERE object_ref = ?", (object_ref,))
                    return False
                conn.execute(
                    """
                    INSERT OR REPLACE INTO objects (
                      object_ref, legacy_ref, object_kind, object_id, owner_ref, path, state,
                      created_at, updated_at, ended_at, size_bytes, digest, pinned, exported,
                      retention_class, local_only, lease_state, indexed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    row_to_sql(row),
                )
                conn.execute(
                    "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
                    ("schema_version", SQLITE_SCHEMA_VERSION),
                )
                conn.execute(
                    "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
                    ("incremental_updated_at", utc_now_iso()),
                )
            return True
        finally:
            conn.close()

    def delete_object(self, object_ref: str) -> bool:
        """Delete a single indexed object row without scanning repository evidence."""
        self.acc_root.mkdir(parents=True, exist_ok=True)
        conn = self._connect()
        try:
            ensure_schema(conn)
            with conn:
                cursor = conn.execute("DELETE FROM objects WHERE object_ref = ?", (object_ref,))
                conn.execute(
                    "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
                    ("schema_version", SQLITE_SCHEMA_VERSION),
                )
                conn.execute(
                    "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
                    ("incremental_updated_at", utc_now_iso()),
                )
            return cursor.rowcount > 0
        finally:
            conn.close()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn


def rebuild_storage_index(project_root: Path) -> dict[str, Any]:
    return StorageIndex(project_root).rebuild()


def rebuild_storage_index_best_effort(project_root: Path) -> dict[str, Any] | None:
    try:
        return rebuild_storage_index(project_root)
    except Exception as exc:  # noqa: BLE001 - storage index is a projection
        log_stderr(f"storage index rebuild skipped: {exc}")
        return None


def upsert_storage_index_object(project_root: Path, object_ref: str) -> bool:
    return StorageIndex(project_root).upsert_object(object_ref)


def delete_storage_index_object(project_root: Path, object_ref: str) -> bool:
    return StorageIndex(project_root).delete_object(object_ref)


def build_object_row(project_root: Path, object_ref: str) -> StorageObjectRow | None:
    project_root = project_root.resolve()
    try:
        object_kind, object_id = parse_object_ref(object_ref)
    except AccError:
        return None
    producers = OBJECT_ROW_PRODUCERS_BY_KIND.get(object_kind)
    if not producers:
        return None
    for producer in producers:
        for row in producer(project_root):
            if row.object_ref == object_ref:
                return row
    return None


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS objects (
          object_ref TEXT PRIMARY KEY,
          legacy_ref TEXT,
          object_kind TEXT NOT NULL,
          object_id TEXT NOT NULL,
          owner_ref TEXT,
          path TEXT NOT NULL,
          state TEXT,
          created_at TEXT,
          updated_at TEXT,
          ended_at TEXT,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          digest TEXT,
          pinned INTEGER NOT NULL DEFAULT 0,
          exported INTEGER NOT NULL DEFAULT 0,
          retention_class TEXT NOT NULL DEFAULT 'normal',
          local_only INTEGER NOT NULL DEFAULT 1,
          lease_state TEXT,
          indexed_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_objects_kind ON objects(object_kind)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_objects_owner ON objects(owner_ref)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_objects_state ON objects(state)")


def build_inventory_rows(project_root: Path) -> list[StorageObjectRow]:
    project_root = project_root.resolve()
    rows: list[StorageObjectRow] = []
    producers = tuple(
        producer for producers in OBJECT_ROW_PRODUCERS_BY_KIND.values() for producer in producers
    )
    for producer in producers:
        try:
            rows.extend(producer(project_root))
        except Exception as exc:  # noqa: BLE001 - one broken object family must not block index
            log_stderr(f"storage index skipped {producer.__name__}: {exc}")
    return sorted(rows, key=lambda row: row.object_ref)


def iter_run_rows(project_root: Path) -> list[StorageObjectRow]:
    runs_root = project_root / "runs"
    if not runs_root.exists():
        return []
    rows: list[StorageObjectRow] = []
    try:
        run_dirs = sorted(path for path in runs_root.iterdir() if path.is_dir())
    except OSError:
        return []
    for run_dir in run_dirs:
        try:
            if run_dir.name.startswith("_"):
                continue
            if (run_dir / "tombstone.json").exists() and not (
                run_dir / RUN_MARKER_FILENAME
            ).exists():
                continue
            marker = load_optional_json(run_dir / RUN_MARKER_FILENAME)
            summary = load_run_summary(run_dir)
            retention = load_optional_json(run_dir / "retention.json")
            owner_ref = None
            if isinstance(marker, dict) and marker.get("task_id"):
                owner_ref = make_task_ref(str(marker["task_id"]))
            rows.append(
                StorageObjectRow(
                    object_ref=make_run_ref(run_dir.name),
                    legacy_ref=make_legacy_object_ref("run", run_dir.name),
                    object_kind="run",
                    object_id=run_dir.name,
                    owner_ref=owner_ref,
                    path=relative_project_path(project_root, run_dir),
                    state=summary.status if summary is not None else "unknown",
                    created_at=marker.get("created_at") if isinstance(marker, dict) else None,
                    ended_at=summary.ended_at if summary is not None else None,
                    size_bytes=storage_index_path_size_bytes(run_dir),
                    pinned=bool(retention.get("pinned")) if isinstance(retention, dict) else False,
                    exported=bool(retention.get("exported"))
                    if isinstance(retention, dict)
                    else False,
                    retention_class=(
                        str(retention.get("retention_class") or "normal")
                        if isinstance(retention, dict)
                        else "normal"
                    ),
                    lease_state=run_lease_state(project_root, run_dir.name, run_dir),
                )
            )
        except Exception as exc:  # noqa: BLE001 - skip one broken run row
            log_stderr(f"storage index skipped run {run_dir.name}: {exc}")
    return rows


def iter_task_rows(project_root: Path) -> list[StorageObjectRow]:
    root = project_root / ".acc" / "tasks"
    if not root.exists():
        return []
    rows: list[StorageObjectRow] = []
    for task_path in sorted(root.glob("*/task.json")):
        task_dir = task_path.parent
        payload = load_optional_json(task_path)
        task_id = (
            str(payload.get("task_id") or task_dir.name)
            if isinstance(payload, dict)
            else task_dir.name
        )
        retention = load_optional_json(task_dir / "retention.json")
        state = str(payload.get("status") or "active") if isinstance(payload, dict) else "unknown"
        rows.append(
            StorageObjectRow(
                object_ref=make_task_ref(task_id),
                legacy_ref=make_legacy_object_ref("task", task_id),
                object_kind="task",
                object_id=task_id,
                path=relative_project_path(project_root, task_dir),
                state=state,
                created_at=payload.get("created_at") if isinstance(payload, dict) else None,
                updated_at=payload.get("updated_at") if isinstance(payload, dict) else None,
                size_bytes=storage_index_path_size_bytes(task_dir),
                pinned=bool(retention.get("pinned")) if isinstance(retention, dict) else False,
            )
        )
    return rows


def iter_session_rows(project_root: Path) -> list[StorageObjectRow]:
    roots = [
        project_root / ".acc" / "sessions",
        project_root / "runs" / "_agent_sessions",
        project_root / "runs" / "_authoring_sessions",
    ]
    rows: list[StorageObjectRow] = []
    seen_refs: set[str] = set()
    for root in roots:
        if not root.exists():
            continue
        for session_path in sorted(root.rglob("session.json")):
            session_dir = session_path.parent
            payload = load_optional_json(session_path)
            session_id = (
                str(payload.get("session_id") or session_dir.name)
                if isinstance(payload, dict)
                else session_dir.name
            )
            object_ref = make_session_ref(session_id)
            if object_ref in seen_refs:
                continue
            seen_refs.add(object_ref)
            owner_ref = None
            if isinstance(payload, dict):
                if payload.get("owner_ref"):
                    owner_ref = str(payload["owner_ref"])
                elif payload.get("task_id"):
                    owner_ref = make_task_ref(str(payload["task_id"]))
                elif payload.get("bound_run_id"):
                    owner_ref = make_run_ref(str(payload["bound_run_id"]))
            state = (
                str(payload.get("status") or "unknown") if isinstance(payload, dict) else "unknown"
            )
            rows.append(
                StorageObjectRow(
                    object_ref=object_ref,
                    legacy_ref=make_legacy_object_ref("session", session_id),
                    object_kind="session",
                    object_id=session_id,
                    owner_ref=owner_ref,
                    path=relative_project_path(project_root, session_dir),
                    state=state,
                    created_at=payload.get("created_at") if isinstance(payload, dict) else None,
                    updated_at=payload.get("updated_at") if isinstance(payload, dict) else None,
                    size_bytes=storage_index_path_size_bytes(session_dir),
                    pinned=bool(
                        payload.get("retention", {}).get("pinned")
                        if isinstance(payload, dict) and isinstance(payload.get("retention"), dict)
                        else False
                    ),
                )
            )
    return rows


def iter_artifact_rows(project_root: Path) -> list[StorageObjectRow]:
    runs_root = project_root / "runs"
    if not runs_root.exists():
        return []
    rows: list[StorageObjectRow] = []
    for artifact_dir in sorted(runs_root.glob("*/artifacts")):
        if not artifact_dir.is_dir() or artifact_dir.parent.name.startswith("_"):
            continue
        run_id = artifact_dir.parent.name
        rows.append(
            StorageObjectRow(
                object_ref=make_object_ref("artifact", f"{run_id}_run"),
                legacy_ref=make_legacy_object_ref("artifact", f"{run_id}_run"),
                object_kind="artifact",
                object_id=f"{run_id}_run",
                owner_ref=make_run_ref(run_id),
                path=relative_project_path(project_root, artifact_dir),
                state="present",
                size_bytes=storage_index_path_size_bytes(artifact_dir),
            )
        )
    for artifact_dir in sorted(runs_root.glob("*/nodes/*/artifacts")):
        if not artifact_dir.is_dir() or artifact_dir.parents[2].name.startswith("_"):
            continue
        run_id = artifact_dir.parents[2].name
        node_id = artifact_dir.parent.name
        object_id = f"{run_id}_{node_id}"
        rows.append(
            StorageObjectRow(
                object_ref=make_object_ref("artifact", object_id),
                legacy_ref=make_legacy_object_ref("artifact", object_id),
                object_kind="artifact",
                object_id=object_id,
                owner_ref=make_run_ref(run_id),
                path=relative_project_path(project_root, artifact_dir),
                state="present",
                size_bytes=storage_index_path_size_bytes(artifact_dir),
            )
        )
    return rows


def iter_canvas_snapshot_rows(project_root: Path) -> list[StorageObjectRow]:
    rows: list[StorageObjectRow] = []
    for snapshot_path in sorted((project_root / ".acc" / "tasks").glob("*/canvas_snapshot.json")):
        task_dir = snapshot_path.parent
        payload = load_optional_json(snapshot_path)
        task_id = (
            str(payload.get("task_id") or task_dir.name)
            if isinstance(payload, dict)
            else task_dir.name
        )
        rows.append(
            StorageObjectRow(
                object_ref=make_object_ref("canvas_snapshot", task_id),
                legacy_ref=make_legacy_object_ref("canvas_snapshot", task_id),
                object_kind="canvas_snapshot",
                object_id=task_id,
                owner_ref=make_task_ref(task_id),
                path=relative_project_path(project_root, snapshot_path),
                state="present",
                created_at=payload.get("published_at") if isinstance(payload, dict) else None,
                updated_at=payload.get("published_at") if isinstance(payload, dict) else None,
                size_bytes=storage_index_path_size_bytes(snapshot_path),
            )
        )
    return rows


def iter_graphops_rows(project_root: Path) -> list[StorageObjectRow]:
    root = project_root / "runs" / "_graphops_proposals"
    if not root.exists():
        return []
    rows: list[StorageObjectRow] = []
    for proposal_dir in sorted(path for path in root.iterdir() if path.is_dir()):
        payload = load_optional_json(proposal_dir / "proposal.json")
        proposal_id = (
            str(payload.get("proposal_id") or proposal_dir.name)
            if isinstance(payload, dict)
            else proposal_dir.name
        )
        state = str(payload.get("status") or "unknown") if isinstance(payload, dict) else "unknown"
        rows.append(
            StorageObjectRow(
                object_ref=make_object_ref("graphops_proposal", proposal_id),
                legacy_ref=make_legacy_object_ref("graphops_proposal", proposal_id),
                object_kind="graphops_proposal",
                object_id=proposal_id,
                path=relative_project_path(project_root, proposal_dir),
                state=state,
                created_at=payload.get("created_at") if isinstance(payload, dict) else None,
                updated_at=payload.get("updated_at") if isinstance(payload, dict) else None,
                size_bytes=storage_index_path_size_bytes(proposal_dir),
            )
        )
    return rows


def iter_runtime_spec_rows(project_root: Path) -> list[StorageObjectRow]:
    root = project_root / "runs" / "_workflow_function_specs"
    if not root.exists():
        return []
    return [
        StorageObjectRow(
            object_ref=make_object_ref("runtime_workflow_spec", spec_dir.name),
            legacy_ref=make_legacy_object_ref("runtime_workflow_spec", spec_dir.name),
            object_kind="runtime_workflow_spec",
            object_id=spec_dir.name,
            path=relative_project_path(project_root, spec_dir),
            state="present",
            size_bytes=storage_index_path_size_bytes(spec_dir),
        )
        for spec_dir in sorted(path for path in root.iterdir() if path.is_dir())
    ]


def iter_trash_rows(project_root: Path) -> list[StorageObjectRow]:
    root = project_root / ".acc" / "trash"
    if not root.exists():
        return []
    rows: list[StorageObjectRow] = []
    for entry_path in sorted(root.glob("*/trash_entry.json")):
        trash_dir = entry_path.parent
        payload = load_optional_json(entry_path)
        trash_id = (
            str(payload.get("trash_id") or trash_dir.name)
            if isinstance(payload, dict)
            else trash_dir.name
        )
        owner_ref = str(payload.get("object_ref")) if isinstance(payload, dict) else None
        rows.append(
            StorageObjectRow(
                object_ref=make_object_ref("trash_entry", trash_id),
                legacy_ref=make_legacy_object_ref("trash_entry", trash_id),
                object_kind="trash_entry",
                object_id=trash_id,
                owner_ref=owner_ref,
                path=relative_project_path(project_root, trash_dir),
                state="trash",
                created_at=payload.get("moved_at") if isinstance(payload, dict) else None,
                size_bytes=storage_index_path_size_bytes(trash_dir),
            )
        )
    return rows


def iter_tombstone_rows(project_root: Path) -> list[StorageObjectRow]:
    rows: list[StorageObjectRow] = []
    paths = list((project_root / ".acc" / "tombstones").glob("*"))
    paths.extend((project_root / "runs").glob("*/tombstone.json"))
    for path in sorted(paths):
        payload = load_optional_json(path)
        object_ref = (
            str(payload.get("object_ref") or path.stem) if isinstance(payload, dict) else path.stem
        )
        object_id = object_ref.replace(":", "_")
        rows.append(
            StorageObjectRow(
                object_ref=make_object_ref("tombstone", object_id),
                legacy_ref=make_legacy_object_ref("tombstone", object_id),
                object_kind="tombstone",
                object_id=object_id,
                owner_ref=object_ref,
                path=relative_project_path(project_root, path),
                state="tombstoned",
                created_at=payload.get("deleted_at") if isinstance(payload, dict) else None,
                size_bytes=storage_index_path_size_bytes(path),
            )
        )
    return rows


def iter_gc_manifest_rows(project_root: Path) -> list[StorageObjectRow]:
    rows: list[StorageObjectRow] = []
    root = project_root / ".acc" / "gc"
    for path in sorted(root.glob("plans/*/gc_manifest.json")) + sorted(
        root.glob("purge_manifests/*.json")
    ):
        payload = load_optional_json(path)
        object_id = path.parent.name if path.name == "gc_manifest.json" else path.stem
        rows.append(
            StorageObjectRow(
                object_ref=make_object_ref("gc_manifest", object_id),
                legacy_ref=make_legacy_object_ref("gc_manifest", object_id),
                object_kind="gc_manifest",
                object_id=object_id,
                path=relative_project_path(project_root, path),
                state="present",
                created_at=(
                    payload.get("applied_at") or payload.get("created_at")
                    if isinstance(payload, dict)
                    else None
                ),
                size_bytes=storage_index_path_size_bytes(path),
            )
        )
    return rows


def iter_runner_job_rows(project_root: Path) -> list[StorageObjectRow]:
    rows: list[StorageObjectRow] = []
    root = project_root / ".acc" / "runner" / "jobs"
    if not root.exists():
        return rows
    for path in sorted(root.glob("*.json")):
        payload = load_optional_json(path)
        job_id = str(payload.get("job_id") or path.stem) if isinstance(payload, dict) else path.stem
        owner_ref = None
        if isinstance(payload, dict) and isinstance(payload.get("run_id"), str):
            owner_ref = make_run_ref(str(payload["run_id"]))
        rows.append(
            StorageObjectRow(
                object_ref=make_object_ref("runner_job", job_id),
                legacy_ref=make_legacy_object_ref("runner_job", job_id),
                object_kind="runner_job",
                object_id=job_id,
                owner_ref=owner_ref,
                path=relative_project_path(project_root, path),
                state=(
                    str(payload.get("status") or "unknown")
                    if isinstance(payload, dict)
                    else "unknown"
                ),
                created_at=payload.get("created_at") if isinstance(payload, dict) else None,
                updated_at=payload.get("updated_at") if isinstance(payload, dict) else None,
                size_bytes=storage_index_path_size_bytes(path),
            )
        )
    return rows


OBJECT_ROW_PRODUCERS_BY_KIND = {
    "run": (iter_run_rows,),
    "task": (iter_task_rows,),
    "session": (iter_session_rows,),
    "artifact": (iter_artifact_rows,),
    "canvas_snapshot": (iter_canvas_snapshot_rows,),
    "graphops_proposal": (iter_graphops_rows,),
    "runtime_workflow_spec": (iter_runtime_spec_rows,),
    "trash_entry": (iter_trash_rows,),
    "tombstone": (iter_tombstone_rows,),
    "gc_manifest": (iter_gc_manifest_rows,),
    "runner_job": (iter_runner_job_rows,),
}


def row_to_sql(row: StorageObjectRow) -> tuple[Any, ...]:
    return (
        row.object_ref,
        row.legacy_ref,
        row.object_kind,
        row.object_id,
        row.owner_ref,
        row.path,
        row.state,
        row.created_at,
        row.updated_at,
        row.ended_at,
        row.size_bytes,
        row.digest,
        int(row.pinned),
        int(row.exported),
        row.retention_class,
        int(row.local_only),
        row.lease_state,
        utc_now_iso(),
    )


def count_by_kind(rows: list[StorageObjectRow]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.object_kind] = counts.get(row.object_kind, 0) + 1
    return dict(sorted(counts.items()))


def load_optional_json(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        return load_json(path)
    except AccError:
        return None


def storage_index_path_size_bytes(path: Path) -> int:
    return safe_path_size_bytes(path, exclude_relative_parts=STORAGE_INDEX_SIZE_EXCLUDES)


def relative_project_path(project_root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(project_root.resolve()).as_posix()
    except ValueError:
        return str(path)


def run_lease_state(project_root: Path, run_id: str, run_dir: Path) -> str | None:
    if (run_dir / ".acc-active-lease.json").exists():
        return "active"
    if (project_root / ".acc" / "leases" / "runs" / f"{run_id}.json").exists():
        return "active"
    return None
