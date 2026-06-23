# ACC Workbench P2 Backend Projection Slimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Current audit status (2026-06-22)

Status: **complete for the named backend-slimming slice**. JSONL offset streaming, heartbeat behavior, slim canvas save responses, and the current async submit compile flow are implemented. The compile-count regression now patches the current `WorkflowSubmissionService` app-layer boundary and passes. Broader backend/projection cleanup remains tracked by later status/submission and projection/storage plans.

See `docs/superpowers/plans/STATUS.md` for the cross-plan audit summary.

**Goal:** Make backend run streaming and Workbench persistence scale with appended data and changed snapshots instead of full run/canvas size.

**Architecture:** Run streaming uses per-connection file offsets plus heartbeat frames and avoids repeatedly reading full JSONL files. Workbench canvas save returns a slim acknowledgement by default. Workflow run submit performs one compile/normalize pass before handing work to the runtime manager.

**Tech Stack:** FastAPI, Python 3, pytest, filesystem JSONL evidence, ACC run projection services.

---

## File Structure

- Modify `acc/server/routes/runs.py`: add heartbeat frames and use tail/offset helpers for stream event reads.
- Modify `acc/app/run_events.py`: add tested helpers for reading appended JSONL records from byte offsets.
- Modify `tests/server/test_runs_projection_api.py`: cover stream heartbeat and tail helper behavior.
- Modify `acc/app/workbench_tasks.py`: return slim canvas save metadata from put path.
- Modify `acc/server/routes/workbench.py`: expose slim `PUT /canvas` response unless `?include_snapshot=1`.
- Modify `acc/server/routes/workflows.py`: remove duplicated preflight/prepare compile pass for async submit.

## Task 1: JSONL Tail Helper

**Files:**
- Modify: `acc/app/run_events.py`
- Test: `tests/unit/test_run_events_tail.py`

- [x] **Step 1: Write failing helper tests**

```python
from pathlib import Path

from acc.app.run_events import read_jsonl_since_offset


def test_read_jsonl_since_offset_returns_records_and_next_offset(tmp_path: Path) -> None:
    log = tmp_path / "events.jsonl"
    log.write_text('{"event_seq":1}\\n{"event_seq":2}\\n', encoding="utf-8")

    records, offset = read_jsonl_since_offset(log, 0, limit=10)

    assert [record["event_seq"] for record in records] == [1, 2]
    assert offset == log.stat().st_size


def test_read_jsonl_since_offset_reads_only_new_records(tmp_path: Path) -> None:
    log = tmp_path / "events.jsonl"
    log.write_text('{"event_seq":1}\\n', encoding="utf-8")
    _, offset = read_jsonl_since_offset(log, 0, limit=10)
    with log.open("a", encoding="utf-8") as handle:
        handle.write('{"event_seq":2}\\n')

    records, next_offset = read_jsonl_since_offset(log, offset, limit=10)

    assert [record["event_seq"] for record in records] == [2]
    assert next_offset == log.stat().st_size
```

- [x] **Step 2: Run tests**

Run: `python -m pytest tests/unit/test_run_events_tail.py -q`

Expected: fail because `read_jsonl_since_offset` does not exist.

- [x] **Step 3: Implement helper**

```python
def read_jsonl_since_offset(path: Path, offset: int, limit: int = 200) -> tuple[list[dict[str, Any]], int]:
    if not path.exists():
        return [], offset
    records: list[dict[str, Any]] = []
    with path.open("rb") as handle:
        handle.seek(max(0, offset))
        for raw_line in handle:
            if len(records) >= limit:
                break
            try:
                line = raw_line.decode("utf-8").strip()
                if line:
                    records.append(json.loads(line))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
        return records, handle.tell()
```

- [x] **Step 4: Run tests**

Run: `python -m pytest tests/unit/test_run_events_tail.py -q`

Expected: pass.

## Task 2: Stream Heartbeat

**Files:**
- Modify: `acc/server/routes/runs.py`
- Test: `tests/server/test_runs_projection_api.py`

- [x] **Step 1: Add stream heartbeat assertion**

Add a server-route test that creates an empty run directory, opens `/api/runs/{run_id}/stream`, reads the first chunk, and asserts the chunk starts with `: heartbeat` or contains an SSE `event: heartbeat` frame.

- [x] **Step 2: Run test**

Run: `python -m pytest tests/server/test_runs_projection_api.py -q`

Expected: fail because idle stream currently sleeps without yielding.

- [x] **Step 3: Implement heartbeat frame**

Inside `stream_run`, track `last_emit_monotonic`. If no event frame was yielded for 15 seconds, yield `": heartbeat\n\n"` and update the timestamp.

- [x] **Step 4: Run server tests**

Run: `python -m pytest tests/server/test_runs_projection_api.py -q`

Expected: pass.

## Task 3: Slim Canvas Save Response

**Files:**
- Modify: `acc/app/workbench_tasks.py`
- Modify: `acc/server/routes/workbench.py`
- Test: `tests/server/test_workbench_canvas_snapshots_api.py`

- [x] **Step 1: Add slim response test**

Add a test that calls `PUT /api/workbench/tasks/{task_id}/canvas` and asserts the response has `task_id`, `canvas_hash`, and `saved_at`, and does not include `canvas_snapshot` unless `include_snapshot=1` is provided.

- [x] **Step 2: Run test**

Run: `python -m pytest tests/server/test_workbench_canvas_snapshots_api.py -q`

Expected: fail because the route currently returns the full snapshot.

- [x] **Step 3: Implement response split**

Return a slim dict from the route by default:

```python
{
    "task_id": saved["task_id"],
    "canvas_hash": saved["canvas_hash"],
    "saved_at": saved.get("updated_at"),
}
```

When `include_snapshot=1`, return the existing full response to preserve debugging compatibility.

- [x] **Step 4: Run test**

Run: `python -m pytest tests/server/test_workbench_canvas_snapshots_api.py -q`

Expected: pass.

## Task 4: Single Compile Pass For Submit

**Files:**
- Modify: `acc/server/routes/workflows.py`
- Test: `tests/server/test_workbench_core_v2_api.py`

- [x] **Step 1: Add compile count regression test**

Patch `acc.app.workflow_submission.compile_runtime_graph` with a counter, call `/api/workflows/run-graph/submit`, and assert the compile count is `1`.

- [x] **Step 2: Run test**

Run: `python -m pytest tests/server/test_workbench_core_v2_api.py -q`

Expected: fail because submit currently preflights and prepares separately.

- [x] **Step 3: Reuse preflight result**

Return the compiled bundle/prepared graph from preflight and pass it into prepare, or merge preflight and prepare into one function used by submit.

- [x] **Step 4: Run test**

Run: `python -m pytest tests/server/test_workbench_core_v2_api.py -q`

Expected: pass.

## Verification

- `uv run pytest tests/unit/test_run_events_tail.py -q` -> 3 passed.
- `uv run pytest tests/server/test_runs_projection_api.py -q` -> 13 passed.
- `uv run pytest tests/server/test_workbench_canvas_snapshots_api.py -q` -> 7 passed.
- `uv run pytest tests/server/test_workbench_core_v2_api.py::test_submit_workbench_container_compiles_once -q` -> 1 passed.
- `uv run pytest tests/unit/test_run_events_tail.py tests/server/test_runs_projection_api.py tests/server/test_workbench_canvas_snapshots_api.py tests/server/test_workbench_core_v2_api.py -q` -> 47 passed.
- `uv run pytest -q --ignore=tests/integration` -> 660 passed.

Note: direct `python -m pytest tests/server/test_runs_projection_api.py -q` failed in this shell because the plain Python environment did not have `fastapi`; project verification used `uv run pytest`.
