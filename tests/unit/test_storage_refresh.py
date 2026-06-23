from __future__ import annotations

import asyncio
import json
from pathlib import Path

from acc.storage_refresh import (
    DIRTY_FILENAME,
    REFRESH_DIR,
    REQUESTS_FILENAME,
    StorageIndexRefreshService,
    request_storage_index_refresh,
)


def test_request_storage_index_refresh_writes_dirty_marker_and_request(
    tmp_path: Path,
) -> None:
    request_storage_index_refresh(
        tmp_path,
        reason="unit_test",
        object_ref="run:v1:run_a",
    )

    refresh_dir = tmp_path / REFRESH_DIR
    marker = json.loads((refresh_dir / DIRTY_FILENAME).read_text(encoding="utf-8"))
    requests = [
        json.loads(line)
        for line in (refresh_dir / REQUESTS_FILENAME).read_text(encoding="utf-8").splitlines()
    ]
    assert marker["dirty"] is True
    assert marker["reason"] == "unit_test"
    assert marker["object_ref"] == "run:v1:run_a"
    assert requests[-1]["reason"] == "unit_test"
    assert requests[-1]["object_ref"] == "run:v1:run_a"
    assert isinstance(marker["generation"], str)
    assert marker["generation"] == requests[-1]["generation"]


def test_request_storage_index_refresh_retains_pending_request_log(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr("acc.storage_refresh.REQUEST_LOG_MAX_LINES", 3)

    for index in range(5):
        request_storage_index_refresh(
            tmp_path,
            reason=f"unit_test_{index}",
            object_ref=f"run:v1:run_{index}",
        )

    requests = [
        json.loads(line)
        for line in (
            tmp_path / REFRESH_DIR / REQUESTS_FILENAME
        ).read_text(encoding="utf-8").splitlines()
    ]

    assert [item["reason"] for item in requests] == [
        "unit_test_0",
        "unit_test_1",
        "unit_test_2",
        "unit_test_3",
        "unit_test_4",
    ]


def test_refresh_once_incrementally_upserts_object_and_clears_dirty_marker(
    tmp_path: Path,
    monkeypatch,
) -> None:
    run_dir = tmp_path / "runs" / "run_a"
    run_dir.mkdir(parents=True)
    (run_dir / "run_summary.json").write_text(
        json.dumps(
            {
                "run_id": "run_a",
                "status": "success",
                "run_dir": str(run_dir.resolve()),
                "node_count": 0,
                "nodes": [],
            }
        ),
        encoding="utf-8",
    )
    rebuild_calls: list[Path] = []

    def forbidden_rebuild(root: Path) -> dict[str, object] | None:
        rebuild_calls.append(root)
        return None

    monkeypatch.setattr("acc.storage_refresh.rebuild_storage_index_best_effort", forbidden_rebuild)
    request_storage_index_refresh(tmp_path, reason="unit_test", object_ref="run:v1:run_a")
    service = StorageIndexRefreshService(tmp_path)

    assert asyncio.run(service.refresh_once()) is True

    assert rebuild_calls == []
    assert not (tmp_path / REFRESH_DIR / DIRTY_FILENAME).exists()
    assert (tmp_path / ".acc" / "index.sqlite").exists()


def test_refresh_once_keeps_dirty_marker_on_repair_rebuild_failure(
    tmp_path: Path,
    monkeypatch,
) -> None:
    request_storage_index_refresh(tmp_path, reason="repair_rebuild")
    monkeypatch.setattr("acc.storage_refresh.rebuild_storage_index_best_effort", lambda root: None)
    service = StorageIndexRefreshService(tmp_path)

    assert asyncio.run(service.refresh_once()) is False

    assert (tmp_path / REFRESH_DIR / DIRTY_FILENAME).exists()


def test_refresh_once_keeps_dirty_marker_when_incremental_upsert_fails(
    tmp_path: Path,
    monkeypatch,
) -> None:
    def failing_upsert(root: Path, object_ref: str) -> bool:
        raise RuntimeError(f"boom: {object_ref}")

    monkeypatch.setattr("acc.storage_refresh.upsert_storage_index_object", failing_upsert)
    request_storage_index_refresh(tmp_path, reason="unit_test", object_ref="run:v1:run_a")
    service = StorageIndexRefreshService(tmp_path)

    assert asyncio.run(service.refresh_once()) is False

    assert (tmp_path / REFRESH_DIR / DIRTY_FILENAME).exists()
    assert (tmp_path / REFRESH_DIR / REQUESTS_FILENAME).exists()


def test_refresh_once_keeps_new_dirty_marker_written_during_rebuild(
    tmp_path: Path,
    monkeypatch,
) -> None:
    request_storage_index_refresh(tmp_path, reason="repair_rebuild")

    def rebuild(root: Path) -> dict[str, object]:
        request_storage_index_refresh(root, reason="during_rebuild")
        return {"ok": True}

    monkeypatch.setattr("acc.storage_refresh.rebuild_storage_index_best_effort", rebuild)
    service = StorageIndexRefreshService(tmp_path)

    assert asyncio.run(service.refresh_once()) is True

    marker = json.loads(
        (tmp_path / REFRESH_DIR / DIRTY_FILENAME).read_text(encoding="utf-8")
    )
    assert marker["reason"] == "during_rebuild"


def test_refresh_service_debounces_multiple_triggers(tmp_path: Path, monkeypatch) -> None:
    calls: list[Path] = []

    def rebuild(root: Path) -> dict[str, object]:
        calls.append(root)
        return {"ok": True}

    monkeypatch.setattr("acc.storage_refresh.rebuild_storage_index_best_effort", rebuild)

    async def scenario() -> None:
        service = StorageIndexRefreshService(tmp_path, debounce_seconds=0.01, poll_seconds=60)
        await service.start()
        try:
            for _index in range(5):
                service.trigger(reason="repair_rebuild")
            for _ in range(50):
                if len(calls) == 1 and not service.dirty_path.exists():
                    return
                await asyncio.sleep(0.01)
            raise AssertionError(f"unexpected rebuild calls: {len(calls)}")
        finally:
            await service.stop()

    asyncio.run(scenario())

    assert len(calls) == 1


def test_direct_refresh_request_wakes_registered_service(
    tmp_path: Path,
    monkeypatch,
) -> None:
    calls: list[Path] = []

    def rebuild(root: Path) -> dict[str, object]:
        calls.append(root)
        return {"ok": True}

    monkeypatch.setattr("acc.storage_refresh.rebuild_storage_index_best_effort", rebuild)

    async def scenario() -> None:
        service = StorageIndexRefreshService(tmp_path, debounce_seconds=0.01, poll_seconds=60)
        await service.start()
        try:
            request_storage_index_refresh(tmp_path, reason="repair_rebuild")
            for _ in range(50):
                if calls and not service.dirty_path.exists():
                    return
                await asyncio.sleep(0.01)
            raise AssertionError("registered service was not woken")
        finally:
            await service.stop()

    asyncio.run(scenario())

    assert calls == [tmp_path.resolve()]
