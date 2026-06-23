# Workbench Projection Storage GraphOps Cleanup Plan

> **For workflow agents:** This plan cleans user-facing Workbench/API/projection/storage surfaces after core contracts are stable. Do not break save/open/run behavior.

## Current audit status (2026-06-22)

Status: **partially complete**. `LiveEventProjectionService`, selected stream replay/cursor tests, storage-index incremental primitives, and legacy GraphOps patch POST route retirement are implemented. Governed GraphOps proposal validate/dry-run APIs remain active architecture, not the retired patch-route surface. Remaining work includes settling the Workbench compile boundary, turning named projection contracts into code-level contracts, removing raw runtime evidence from normal payloads, eliminating remaining hot-path run-index rebuilds, and retiring remaining examples/Workbench compatibility paths.

See `docs/superpowers/plans/STATUS.md` for the cross-plan audit summary.

## Goal

Move Workbench and API to stable projection contracts, reduce storage/projection performance cost, and retire legacy GraphOps/graph/session/event compatibility surfaces.

## Architecture

Target:

```text
Workbench authoring model
  -> explicit compile boundary
  -> canonical runtime bundle / accflow
  -> run evidence
  -> projection services
  -> Workbench standard views
```

Live target:

```text
LiveEventProjectionService
  -> monotonic ids
  -> cursor/resume/gap semantics
  -> cached topology / append offsets
  -> polling as fallback/refetch only
```

Storage target:

```text
primary evidence writes
  -> incremental object/run projection upsert/delete
  -> full rebuild as repair-only command
```

## Must Read

- `AGENTS.md`
- `docs/architecture/05-api-ui-boundaries.md`
- `docs/architecture/06-graphops-governance.md`
- `docs/Design/workbench-projection-contract.md`
- `docs/superpower_acc_architecture/SECOND_PASS_CLEANUP_AUDIT.md`
- `web/src/workbench/model/canvasProjection.ts`
- `web/src/workbench/model/workflowGraphProjection.ts`
- `acc/app/workbench_adapter.py`
- `acc/app/workbench_boundary_transfer.py`
- `acc/server/routes/workflows.py`
- `acc/server/routes/runs.py`
- `acc/app/run_events.py`
- `acc/server/run_projection.py`
- `acc/storage_index.py`
- `acc/storage_refresh.py`
- `acc/server/routes/graphops.py`

## Constraints

- Do not delete Workbench projection helpers before compile boundary is stable.
- Do not create a god `LiveEventProjectionService` without identity/cursor/order contracts.
- Keep full rebuild as repair command until incremental correctness is proven.
- GraphOps remains active governed mutation architecture; only legacy patch routes are candidates for retirement.
- Capture save/open/run behavior before migration.

## Tasks

### Task 1 — Define Workbench compile boundary

Choose and document where canonical conversion happens:

- server-only;
- web-only;
- mirrored by shared schema/spec.

Compile boundary should output canonical runtime bundle / `.accflow` shape.

### Task 2 — Define projection contracts

Stabilize:

- `WorkflowCanvasProjection`;
- `NodeInspectorProjection`;
- `BindingSummaryProjection`;
- `RunTimelineProjection`;
- `ArtifactPreviewProjection`;
- `LiveEventProjection`.

### Task 3 — Add Workbench regression snapshots

Capture:

- open saved task;
- overview/blueprint switching;
- drag/drop;
- submit run;
- reopen run projection;
- inspect nested workflow nodes;
- debug raw evidence disclosure.

### Task 4 — Split live event contract from transport

Define:

- event identity;
- sequence/cursor;
- ordering;
- replay;
- gap/refetch semantics;
- nested event subviews;
- agent turn events;
- log deltas.

Then move route-owned polling/file scans into service.

### Task 5 — Incremental storage/index updates

Replace hot-path full rebuilds with:

- per-object upsert;
- per-object delete;
- object change journal;
- batched flush;
- repair-only full rebuild command.

### Task 6 — Retire legacy GraphOps patch routes

Only after UI/tests/tooling use proposal APIs and governance preview/dry-run semantics are preserved.

Status: **legacy patch POST routes retired**. Governed proposal validate/dry-run APIs remain active and should not be counted as the old patch-route surface. Remaining cleanup is examples/compatibility surfaces plus any Workbench paths that still bypass the governed proposal lifecycle.

Delete or migrate:

- legacy patch validate/dry-run/apply route models;
- browser calls to `graphopsValidate` / `graphopsDryRun`;
- decision inbox legacy example patch items.

### Task 7 — Remove legacy Workbench and storage compatibility

After migration/proofs:

- legacy graph/canvas metadata fallback;
- `main_compat`;
- `legacy_value_edges` / `legacy_passthrough`;
- synthetic session node creation if replaced by explicit schema;
- legacy session roots;
- reader-side event repair;
- `parse_legacy_run_dir` if run_id-only API is accepted.

## Validation

```bash
uv run pytest -q tests/server/test_workbench_canvas_snapshots_api.py tests/server/test_run_log_projection_api.py tests/server/test_runs_projection_api.py
cd web
npm run test -- --run
npm run build
```

Add or run tests for:

- projection contract snapshots;
- event cursor/replay/gap semantics;
- one run-summary write does not trigger repository-wide index rebuild;
- full repair rebuild still reconstructs index;
- no production browser calls to legacy GraphOps patch APIs.

## Deletion Targets

- legacy GraphOps patch routes after proposal migration.
- route-owned SSE/polling loops after live event projection service.
- full rebuild calls in ordinary mutation path after incremental updates.
- Workbench legacy alias/fallback logic after canonical compile boundary.
- legacy session roots after migration.
- reader-side legacy event repair after canonical writers.

## Completion Criteria

- Workbench standard views consume stable projections.
- Raw runtime manifests are debug/evidence only.
- Live streams have explicit replay/gap semantics.
- Storage/index updates are incremental in normal path.
- GraphOps governance remains, but old patch surface is gone.
