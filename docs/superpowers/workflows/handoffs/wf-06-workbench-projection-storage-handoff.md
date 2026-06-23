# wf-06 Workbench Projection Storage GraphOps Cleanup Handoff

Date: 2026-06-22

## Summary

Implemented the wf-06 cleanup slice after wf-04 / wf-05 convergence:

- Added stable projection wrappers for node inspection and binding summaries while preserving existing raw evidence fields for compatibility/debug.
- Extracted run live-stream projection/cursor logic into `LiveEventProjectionService` and kept the route as a thin SSE adapter.
- Added explicit live-event replay/cursor regression coverage, including full-history large-log replay and reconnect `after_seq` behavior.
- Added incremental storage-index object upsert/delete support and moved ordinary run-summary refresh requests to object-ref-based incremental updates.
- Preserved full storage rebuild as a repair path via `repair`, `repair_rebuild`, and `full_rebuild` refresh reasons.
- Retired legacy GraphOps patch POST routes and removed production browser calls / Decision Inbox legacy v2 patch actions.
- Updated tests and web fixtures to assert the new proposal-only GraphOps behavior.

## Files inspected

Plans / handoffs / architecture:

- `docs/superpowers/plans/2026-06-21-workbench-projection-storage-graphops-cleanup.md`
- `docs/superpowers/workflows/handoffs/wf-04-invocation-harness-handoff.md`
- `docs/superpowers/workflows/handoffs/wf-05-control-modes-handoff.md`
- `docs/Design/workbench-projection-contract.md`

Projection / stream / server routes:

- `acc/app/run_projection.py`
- `acc/app/run_events.py`
- `acc/server/live_events.py`
- `acc/server/routes/runs.py`
- `acc/server/routes/graphops.py`
- `acc/app/decisions.py`

Storage/index:

- `acc/storage_index.py`
- `acc/storage_refresh.py`
- `acc/storage.py`
- `acc/run_index.py`
- `acc/app/runtime/workflow_io.py`
- `acc/server/run_manager.py`

Web:

- `web/src/api.ts`
- `web/src/types.ts`
- `web/src/components/DecisionInboxPanel.tsx`
- `web/src/components/ControlPlanePanel.tsx`
- `web/src/App.test.tsx`

Tests:

- `tests/server/test_workbench_canvas_snapshots_api.py`
- `tests/server/test_run_log_projection_api.py`
- `tests/server/test_runs_projection_api.py`
- `tests/server/test_graphops_api.py`
- `tests/unit/test_storage_index.py`
- `tests/unit/test_storage_refresh.py`
- `tests/server/test_live_event_projection_service.py`
- `tests/server/test_run_stream_live_events.py`

## Code paths changed

### Projection contracts

Changed:

- `acc/app/run_projection.py`
  - Keeps existing node projection shape and raw compatibility fields:
    - `runtime`
    - `binding_manifest`
    - `binding_resolved`
  - Adds stable wrapper projections:
    - `binding_summary` with schema `acc.projection.binding_summary.v1`
    - `node_inspector` with schema `acc.projection.node_inspector.v1`
  - Treats missing or invalid binding manifests as an empty binding summary rather than failing the projection.

Changed:

- `web/src/types.ts`
  - Adds optional `binding_summary` and `node_inspector` fields to `NodeRunSummary`.
  - Removes legacy GraphOps patch action/type fields from Decision Inbox graphops types.

### LiveEventProjectionService

Changed:

- `acc/server/live_events.py`
  - Adds `LiveEventProjectionService` as the transport-neutral live-event projection service.
  - Owns:
    - history mode handling (`none`, `tail`, `full`)
    - live-event sequence/cursor filtering
    - log offsets
    - agent event offsets
    - heartbeat timing
    - replay budget diagnostics
  - Preserves existing `WorkbenchLiveBus` behavior for process-local live event queueing/gap events.
  - Fixes review-found edge cases:
    - `history=full` chunks large logs instead of silently skipping bytes beyond the first 16 KiB chunk.
    - `history=none&after_seq=N` advances sequence state so newly appended events are not suppressed behind the previous cursor.
    - `live_events_after_seq(...)` includes replayed historical live events above the cursor.
    - generated replay live-event frames now stop when the initial replay budget is exhausted.

Changed:

- `acc/server/routes/runs.py`
  - `/api/runs/{run_id}/stream` now resolves the run directory and delegates SSE frame generation to `LiveEventProjectionService`.
  - Existing non-stream projection endpoints remain unchanged.

### Incremental storage/index updates

Changed:

- `acc/storage_index.py`
  - Adds `StorageIndex.upsert_object(object_ref)`.
  - Adds `StorageIndex.delete_object(object_ref)`.
  - Adds `build_object_row(project_root, object_ref)`.
  - Keeps `StorageIndex.rebuild()` / `rebuild_storage_index_best_effort(...)` as the full repair rebuild path.
  - Introduces object-kind producer dispatch for targeted row construction.

Changed:

- `acc/storage_refresh.py`
  - Keeps dirty request recording cheap and best-effort.
  - Stops truncating pending request logs before consumption, avoiding loss of queued object refs.
  - Uses incremental `upsert_storage_index_object(...)` when pending requests contain object refs and no repair rebuild reason.
  - Keeps full rebuild for:
    - missing pending requests
    - `repair`
    - `repair_rebuild`
    - `full_rebuild`
  - Wraps incremental upsert failures so `refresh_once()` returns `False`, keeps dirty state, and background refresh logs/retries rather than crashing.

Changed object-ref callers:

- `acc/storage.py`
  - Run claim refresh requests now include `make_run_ref(run_id)`.
- `acc/run_index.py`
  - Run index update refresh requests now include the updated run ref.
- `acc/app/runtime/workflow_io.py`
  - Workflow summary refresh requests now include the run ref.
- `acc/server/run_manager.py`
  - Ordinary Workbench run summary writes now pass the run ref.
  - Reconciliation/no-summary repair remains `repair_rebuild`.

### GraphOps legacy patch retirement

Changed:

- `acc/server/routes/graphops.py`
  - Removed legacy patch request model and POST routes:
    - `POST /api/graphops/validate`
    - `POST /api/graphops/dry-run`
    - `POST /api/graphops/apply`
  - Keeps proposal APIs:
    - `POST /api/graphops/proposals`
    - `GET /api/graphops/proposals`
    - `GET /api/graphops/proposals/{proposal_id}`
    - `POST /api/graphops/proposals/{proposal_id}/validate`
    - `POST /api/graphops/proposals/{proposal_id}/dry-run`
    - `POST /api/graphops/proposals/{proposal_id}/approve`
    - `POST /api/graphops/proposals/{proposal_id}/apply`
    - `POST /api/graphops/proposals/{proposal_id}/reject`

Changed:

- `acc/app/decisions.py`
  - Decision Inbox now emits GraphOps v3 persistence proposal items only.
  - Removed legacy example patch decision items/actions.

Changed:

- `web/src/api.ts`
  - Removed `graphopsValidate(...)` and `graphopsDryRun(...)` legacy patch helpers.
  - Keeps proposal API helpers.

Changed:

- `web/src/components/DecisionInboxPanel.tsx`
  - Runs only `validate_graphops_proposal` / `dry_run_graphops_proposal` GraphOps actions.
  - Removed stale v2 patch id fallback and dry-run-only v2 notice.

Changed:

- `web/src/components/ControlPlanePanel.tsx`
  - Removed dev-mode legacy patch validate/dry-run controls.
  - Shows proposal-API retirement guidance instead.

## Compatibility paths left in place

- Raw `runtime` and `binding_manifest` fields remain in node projections for existing UI/debug consumers; new wrapper fields are additive.
- `GET /api/graphops/examples` remains for now, but production browser code no longer calls legacy patch validate/dry-run/apply.
- Full storage index rebuild remains available and is still used for repair reasons.
- Route-local helper functions in `acc/server/routes/runs.py` remain for existing tests/import compatibility even though the live stream route now delegates to `LiveEventProjectionService`.
- Workbench compile/save/run boundaries in `acc/app/workbench_adapter.py`, `acc/app/workflow_submission.py`, and `acc/server/routes/workflows.py` remain untouched.

## Deletion targets now safe / still blocked

Now safe / completed:

- Legacy GraphOps patch POST route surface is removed from server routing.
- Production web code no longer calls:
  - `graphopsValidate`
  - `graphopsDryRun`
  - `/api/graphops/validate`
  - `/api/graphops/dry-run`
  - `/api/graphops/apply`
- Decision Inbox no longer emits legacy v2 patch actions.
- Ordinary run storage refresh paths can use incremental run-object upsert rather than repository-wide rebuild.

Still blocked / deferred:

- Full removal of raw projection fields (`runtime`, `binding_manifest`) is deferred until UI standard views fully consume stable wrapper projections and debug evidence disclosure is separated.
- Full removal of route-owned compatibility helpers in `acc/server/routes/runs.py` is deferred; they still support tests/import compatibility.
- Full storage rebuild cannot be removed; it is intentionally retained as repair-only behavior.
- Workbench legacy alias/fallback cleanup (`main_compat`, `legacy_value_edges`, `legacy_passthrough`, legacy session roots, reader-side repair) remains outside this slice.
- `GET /api/graphops/examples` can be revisited later; no production browser patch mutation calls remain.

## Tests added or updated

Added:

- `tests/server/test_live_event_projection_service.py`
  - stable history sequence behavior
  - cursor replay filtering
  - heartbeat preservation
- `tests/server/test_run_stream_live_events.py`
  - full-history large-log replay does not skip tail bytes
  - reconnect with `history=none&after_seq=N` emits newly appended events immediately

Updated:

- `tests/server/test_runs_projection_api.py`
  - asserts `binding_summary` and `node_inspector` projection wrappers.
- `tests/unit/test_storage_index.py`
  - asserts single-object upsert and delete without full inventory rebuild.
- `tests/unit/test_storage_refresh.py`
  - asserts pending request log is retained until consumed.
  - asserts incremental refresh avoids full rebuild when object refs are present.
  - asserts upsert failures retain dirty state.
- `tests/server/test_graphops_api.py`
  - asserts legacy patch POST routes return 404.
  - keeps v3 proposal create/validate/dry-run/approve/apply/reject coverage.
- `web/src/App.test.tsx`
  - updates Control Plane GraphOps test to expect proposal guidance after legacy patch retirement.

## Commands run and results

Focused wf-06 regression run:

```powershell
uv run pytest -q tests/unit/test_storage_index.py tests/unit/test_storage_refresh.py tests/server/test_live_event_projection_service.py tests/server/test_graphops_api.py tests/server/test_runs_projection_api.py tests/server/test_run_log_projection_api.py tests/server/test_workbench_canvas_snapshots_api.py
```

Result:

```text
49 passed in 6.73s
```

Review-fix regression run:

```powershell
uv run pytest -q tests/unit/test_storage_refresh.py tests/server/test_live_event_projection_service.py tests/server/test_run_stream_live_events.py
```

Result:

```text
13 passed in 1.25s
```

Expanded wf-06 Python validation after review fixes:

```powershell
uv run pytest -q tests/unit/test_storage_index.py tests/unit/test_storage_refresh.py tests/server/test_live_event_projection_service.py tests/server/test_run_stream_live_events.py tests/server/test_graphops_api.py tests/server/test_runs_projection_api.py tests/server/test_run_log_projection_api.py tests/server/test_workbench_canvas_snapshots_api.py
```

Result:

```text
52 passed in 6.36s
```

Requested wf-06 server validation:

```powershell
uv run pytest -q tests/server/test_workbench_canvas_snapshots_api.py tests/server/test_run_log_projection_api.py tests/server/test_runs_projection_api.py
```

Result:

```text
28 passed in 2.76s
```

Added wf-06 regression tests:

```powershell
uv run pytest -q tests/unit/test_storage_index.py tests/unit/test_storage_refresh.py tests/server/test_live_event_projection_service.py tests/server/test_run_stream_live_events.py tests/server/test_graphops_api.py
```

Result:

```text
24 passed in 3.34s
```

Combined phase validation:

```powershell
uv run pytest -q tests/unit/test_callable_normalization.py tests/unit/test_generic_cli_adapter.py tests/unit/test_codex_cli_adapter.py tests/unit/test_codex_app_server_adapter.py tests/integration/test_core_v2_control_ledger_runtime.py tests/integration/test_handoff_p0.py tests/server/test_runner_api.py tests/server/test_graphops_api.py tests/unit/test_storage_index.py tests/unit/test_storage_refresh.py tests/server/test_live_event_projection_service.py tests/server/test_run_stream_live_events.py
```

Result:

```text
89 passed in 69.96s (0:01:09)
```

Focused ruff validation:

```powershell
uv run ruff check acc/storage_index.py acc/storage_refresh.py acc/storage.py acc/run_index.py acc/app/runtime/workflow_io.py acc/server/run_manager.py acc/server/live_events.py acc/server/routes/runs.py acc/server/routes/graphops.py acc/app/run_projection.py acc/app/decisions.py tests/unit/test_storage_index.py tests/unit/test_storage_refresh.py tests/server/test_live_event_projection_service.py tests/server/test_run_stream_live_events.py tests/server/test_graphops_api.py tests/server/test_runs_projection_api.py
```

Result:

```text
All checks passed!
```

Web test suite:

```powershell
npm --prefix web run test -- --run
```

Result:

```text
126 passed, 652 tests passed
```

Web build:

```powershell
npm --prefix web run build
```

Result:

```text
tsc -b && vite build succeeded
```

Vite emitted the existing chunk-size warning for a >500 KiB chunk.

Static GraphOps browser proof:

```powershell
rg -n "graphopsValidate|graphopsDryRun|/api/graphops/(validate|dry-run|apply)|validate_patch|dry_run_patch" web/src --glob "*.{ts,tsx}"
```

Result:

```text
No matches found
```

Static GraphOps production Python proof:

```powershell
rg -n "LegacyGraphOpsPatchRequest|/api/graphops/(validate|dry-run|apply)|validate_patch|dry_run_patch|graphops_v2_example_decision_items" acc --glob "*.py"
```

Result:

```text
No matches found
```

## Unresolved product / architecture decisions

- Whether to remove `GET /api/graphops/examples` now that legacy patch mutation routes are gone.
- When to stop exposing raw `runtime` / `binding_manifest` in standard node projections and make them debug/evidence-only via a separate endpoint.
- Whether live event sequence IDs should eventually become persisted stable IDs rather than per-connection projected sequence numbers.
- How aggressively to migrate legacy Workbench alias/fallback/session-root compatibility after UI standard views fully consume stable projections.
- Whether storage refresh should grow a separate bounded history log distinct from the pending request queue; current implementation retains pending requests until consumed.

## Recommended next workflow

Proceed to post-wf-06 cleanup / freeze:

- Run a broader end-to-end smoke over Workbench save/open/run and live streaming in a browser.
- Decide whether to delete `GET /api/graphops/examples` and update docs that still mention legacy patch POST routes.
- Gradually move UI consumers from raw projection fields to `node_inspector` / `binding_summary`.
- Add repair command UX for full storage rebuild, keeping ordinary mutation paths incremental.
