from __future__ import annotations

import asyncio
import json
import threading
from contextlib import suppress
from pathlib import Path
from typing import Any
from uuid import uuid4

from acc.session import utc_now_iso
from acc.storage import append_jsonl_locked, write_json_atomic
from acc.storage_index import rebuild_storage_index_best_effort, upsert_storage_index_object
from acc.utils import log_stderr

REFRESH_DIR = ".acc/storage"
DIRTY_FILENAME = "index_refresh_dirty.json"
REQUESTS_FILENAME = "index_refresh_requests.jsonl"
REQUEST_LOG_MAX_LINES = 1000
REPAIR_REBUILD_REASONS = {"repair", "repair_rebuild", "full_rebuild"}

_ACTIVE_SERVICES: dict[Path, StorageIndexRefreshService] = {}
_ACTIVE_SERVICES_LOCK = threading.Lock()


def request_storage_index_refresh(
    project_root: Path,
    *,
    reason: str,
    object_ref: str | None = None,
) -> None:
    """Record a cheap, best-effort request to refresh the sqlite storage index."""
    try:
        root = project_root.resolve()
        refresh_dir = root / REFRESH_DIR
        payload: dict[str, Any] = {
            "schema_version": "acc.storage.index_refresh_request.v1",
            "requested_at": utc_now_iso(),
            "reason": reason,
            "generation": uuid4().hex,
        }
        if object_ref:
            payload["object_ref"] = object_ref
        write_json_atomic(
            refresh_dir / DIRTY_FILENAME,
            {
                "schema_version": "acc.storage.index_refresh_dirty.v1",
                "dirty": True,
                "updated_at": payload["requested_at"],
                "reason": reason,
                "object_ref": object_ref,
                "generation": payload["generation"],
            },
        )
        append_jsonl_locked(refresh_dir / REQUESTS_FILENAME, payload)
        _wake_registered_service(root)
    except Exception as exc:  # noqa: BLE001 - projection refresh must not block callers
        log_stderr(f"storage index refresh request skipped: {exc}")


class StorageIndexRefreshService:
    def __init__(
        self,
        project_root: Path,
        *,
        debounce_seconds: float = 0.25,
        poll_seconds: float = 5.0,
    ) -> None:
        self.project_root = project_root.resolve()
        self.debounce_seconds = debounce_seconds
        self.poll_seconds = poll_seconds
        self._task: asyncio.Task[None] | None = None
        self._stop_event: asyncio.Event | None = None
        self._wake_event: asyncio.Event | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    @property
    def dirty_path(self) -> Path:
        return self.project_root / REFRESH_DIR / DIRTY_FILENAME

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._loop = asyncio.get_running_loop()
        self._stop_event = asyncio.Event()
        self._wake_event = asyncio.Event()
        self._task = asyncio.create_task(self._run(), name="storage-index-refresh")
        _register_service(self)
        if self.dirty_path.exists():
            self._wake_event.set()

    async def stop(self) -> None:
        if self._task is None:
            return
        _unregister_service(self)
        if self._stop_event is not None:
            self._stop_event.set()
        if self._wake_event is not None:
            self._wake_event.set()
        with suppress(asyncio.CancelledError):
            await self._task
        self._task = None
        self._loop = None

    def trigger(self, *, reason: str, object_ref: str | None = None) -> None:
        request_storage_index_refresh(self.project_root, reason=reason, object_ref=object_ref)
        self.wake()

    def wake(self) -> None:
        if self._wake_event is None:
            return
        if self._loop is None:
            self._wake_event.set()
            return
        self._loop.call_soon_threadsafe(self._wake_event.set)

    async def refresh_once(self) -> bool:
        dirty_snapshot = self._dirty_snapshot()
        requests = self._pending_requests()
        try:
            result = await asyncio.to_thread(self._apply_pending_requests, requests)
        except Exception as exc:  # noqa: BLE001 - projection refresh must retry later
            log_stderr(f"storage index incremental refresh failed: {exc}")
            return False
        if not result:
            return False
        if dirty_snapshot is not None and self._dirty_snapshot() == dirty_snapshot:
            with suppress(OSError):
                self.dirty_path.unlink()
            with suppress(OSError):
                (self.project_root / REFRESH_DIR / REQUESTS_FILENAME).unlink()
        return True

    def _pending_requests(self) -> list[dict[str, Any]]:
        request_path = self.project_root / REFRESH_DIR / REQUESTS_FILENAME
        if not request_path.exists():
            return []
        requests: list[dict[str, Any]] = []
        try:
            for line in request_path.read_text(encoding="utf-8", errors="replace").splitlines():
                if not line.strip():
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict):
                    requests.append(payload)
        except OSError:
            return []
        return requests

    def _apply_pending_requests(self, requests: list[dict[str, Any]]) -> bool:
        if self._requires_repair_rebuild(requests):
            return rebuild_storage_index_best_effort(self.project_root) is not None
        object_refs = [
            str(request.get("object_ref"))
            for request in requests
            if isinstance(request.get("object_ref"), str) and request.get("object_ref")
        ]
        if not object_refs:
            return rebuild_storage_index_best_effort(self.project_root) is not None
        for object_ref in dict.fromkeys(object_refs):
            try:
                upsert_storage_index_object(self.project_root, object_ref)
            except Exception as exc:  # noqa: BLE001 - one failed upsert keeps dirty state
                log_stderr(f"storage index upsert skipped for {object_ref}: {exc}")
                return False
        return True

    def _requires_repair_rebuild(self, requests: list[dict[str, Any]]) -> bool:
        if not requests:
            return True
        for request in requests:
            reason = str(request.get("reason") or "")
            if reason in REPAIR_REBUILD_REASONS:
                return True
        return False

    def _dirty_snapshot(self) -> str | None:
        try:
            raw = self.dirty_path.read_text(encoding="utf-8")
            parsed = json.loads(raw)
        except (OSError, json.JSONDecodeError):
            return None
        if not isinstance(parsed, dict):
            return None
        generation = parsed.get("generation")
        if isinstance(generation, str) and generation:
            return generation
        return raw

    async def _run(self) -> None:
        assert self._stop_event is not None
        assert self._wake_event is not None
        while not self._stop_event.is_set():
            with suppress(TimeoutError):
                await asyncio.wait_for(self._wake_event.wait(), timeout=self.poll_seconds)
            self._wake_event.clear()
            if self._stop_event.is_set():
                break
            if not self.dirty_path.exists():
                continue
            await asyncio.sleep(self.debounce_seconds)
            if self._stop_event.is_set() or not self.dirty_path.exists():
                continue
            try:
                success = await self.refresh_once()
            except Exception as exc:  # noqa: BLE001 - background projection must keep running
                log_stderr(f"storage index background refresh crashed: {exc}")
                success = False
            if not success:
                log_stderr("storage index background refresh failed; dirty marker retained")


def _register_service(service: StorageIndexRefreshService) -> None:
    with _ACTIVE_SERVICES_LOCK:
        _ACTIVE_SERVICES[service.project_root] = service


def _unregister_service(service: StorageIndexRefreshService) -> None:
    with _ACTIVE_SERVICES_LOCK:
        if _ACTIVE_SERVICES.get(service.project_root) is service:
            _ACTIVE_SERVICES.pop(service.project_root, None)


def _wake_registered_service(project_root: Path) -> None:
    with _ACTIVE_SERVICES_LOCK:
        service = _ACTIVE_SERVICES.get(project_root)
    if service is not None:
        service.wake()
