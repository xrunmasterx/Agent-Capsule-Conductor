# WorkflowViewer Refactor Status

Last updated: 2026-06-19

## PLAN_00 Baseline Guards

Status: complete

### Current File Baseline

- `web/src/components/WorkflowViewer.tsx`
  - Size: 745,328 bytes
  - Lines: 20,418

### Validation Baseline

Commands were run from `F:\Agent-Capsule-Conductor-v2\web`.

| Command | Result | Notes |
| --- | --- | --- |
| `npx tsc --noEmit` | Passed | No TypeScript errors. |
| `npm run test -- --run` | Passed | 5 files, 193 tests passed. |
| `npm run build` | Passed | Vite reports one expected chunk-size warning: generated JS chunk is larger than 500 kB. |

### Test Noise Cleanup

- Added the missing `PUT /api/workbench/tasks/:taskId/canvas` fetch mock in `web/src/App.test.tsx`.
- Verified with `npm run test -- --run src/App.test.tsx`.
- Result: 82 tests passed and the previous autosave 404 stderr noise is gone.

### Guard Coverage Confirmed

Existing tests cover the critical migration guards that later plans must preserve:

- Workflow boundary control bindings do not become runtime control edges.
- Boundary input control bindings expand by matching ports.
- Explicit boundary output mappings are preserved.
- Explicit `main -> main` data edge projection is not hidden as implicit control transfer.
- Node run evidence distinguishes workflow input binding from `control_main_default`.
- Focused workflow connection scope is preserved.
- ReactFlow drag/drop and internal node drag buffers are covered.
- Assistant `workbench_chat` does not trigger previous authoring draft validation.
- Temporary assistant-created agents block save/validate/run until persisted.

### Known Non-Blocking Baseline Warnings

- `npm run build` still warns that one production JS chunk is larger than 500 kB. This is expected at PLAN_00 and is part of the WorkflowViewer refactor debt, not a failing validation result.

## Next Plan

PLAN_01 may start after this baseline. It must keep the validation baseline green and must not move graph/canvas conversion, ReactFlow interaction, run submit, or assistant submit behavior.

## PLAN_01 Types And Constants

Status: complete

### Scope Completed

- Added `web/src/types/workbench.ts` as the shared Workbench domain type boundary.
- Added `web/src/workbench/constants.ts` as the authoritative Workbench constants boundary.
- Converted `web/src/components/canvas/canvasConstants.ts` into a compatibility re-export of the authoritative constants.
- Replaced mirror domain types in stores, hooks, assistant components, palette, run state, boundary transfer helpers, and `WorkflowViewer.tsx` with imports from `types/workbench`.
- Preserved current behavior: graph/canvas conversion, ReactFlow interaction, run submit, and assistant submit logic were not moved.

### Added Tests

- `web/src/workbench/constants.test.ts`
- `web/src/workbench/constants.compat.test.ts`
- `web/src/types/workbench.type-boundary.test.ts`
- `web/src/hooks/streamTypes.test.ts`
- `web/src/stores/workbenchStore.types.test.ts`

### Validation

Commands were run from `F:\Agent-Capsule-Conductor-v2\web`.

| Command | Result | Notes |
| --- | --- | --- |
| `npx tsc --noEmit` | Passed | Shared type imports compile. |
| `npm run test -- --run` | Passed | 10 files, 203 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |

### Static Gates

- `web/src/types/workbench.ts` has no imports from components, hooks, stores, API, or ReactFlow.
- `TASK_STORE_KEY` authoritative value is `acc.workbench.tasks.v2`.
- `AGENT_CONTROL_HANDLE_TOP` authoritative value is `50%`.
- `agentDataPortTop(index, count, nodeHeight)` keeps centered multi-port layout.
- Remaining `WorkflowViewer.tsx` wrapper imports are existing migration debt scheduled for PLAN_09.

## PLAN_02 Pure Model Extraction

Status: in progress

### Scope Completed So Far

- Added `web/src/workbench/model/boundaryTransferProjection.ts` as the pure owner for Workbench boundary-transfer metadata normalization, serialization, offline pair inference, preview error detection, and unavailable-preview diagnostics.
- Converted `web/src/components/canvas/boundaryTransfer.ts` into a compatibility facade that re-exports the pure model module.
- Added `web/src/workbench/model/taskModel.ts` for task defaults, task-store payload migration, authoring-state normalization, run-status mapping, Codex mode normalization, and empty-input policy normalization.
- Added `web/src/workbench/model/selectionModel.ts` for pure invocation-input projection, workflow/internal node labels, executable-node checks, and edge-disconnect click intent.
- Added `web/src/workbench/model/schemaPorts.ts` as the pure owner for schema-derived output-port projection.
- Added `web/src/workbench/model/canvasEdgeOps.ts` for explicit data-edge creation, data connect node views, data-edge diagnostics, data edge equivalence, and data-port add/rename/delete commands.
- Removed the corresponding local function definitions from `web/src/components/WorkflowViewer.tsx`; existing exports remain as migration compatibility for older tests and callers.

### Added Tests

- `web/src/workbench/model/boundaryTransferProjection.test.ts`
- `web/src/components/canvas/boundaryTransfer.test.ts`
- `web/src/workbench/model/taskModel.test.ts`
- `web/src/workbench/model/selectionModel.test.ts`
- `web/src/workbench/model/schemaPorts.test.ts`
- `web/src/workbench/model/canvasEdgeOps.test.ts`

### Validation So Far

Commands were run from `F:\Agent-Capsule-Conductor-v2\web`.

| Command | Result | Notes |
| --- | --- | --- |
| `npx tsc --noEmit` | Passed | Pure model imports compile. |
| `npm run test -- --run src/workbench/model/boundaryTransferProjection.test.ts src/components/canvas/boundaryTransfer.test.ts src/workbench/model/taskModel.test.ts src/workbench/model/selectionModel.test.ts` | Passed | 4 files, 17 tests passed. |
| `npm run test -- --run` | Passed | 15 files, 228 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/workbench/model/canvasEdgeOps.test.ts src/workbench/model/schemaPorts.test.ts src/App.test.tsx` | Passed | 3 files, 94 tests passed. |

### Static Gates So Far

- `web/src/workbench/model` has no imports from ReactFlow, React hooks, localStorage, API modules, stores, or `WorkflowViewer`.
- Boundary-transfer metadata keeps snake_case durable output while preserving camelCase load compatibility.
- Task-store persistence side effects remain in `WorkflowViewer.tsx`; only pure migration/default logic moved.
- `App.test.tsx` now imports migrated data-edge and port-command helpers from their real model owner instead of `WorkflowViewer.tsx`.

### Remaining PLAN_02 Work

- Extract the remaining pure graph/canvas projection helpers.
- Extract the remaining deterministic control-edge command and scoped connection helpers.
- Extract layout-data preparation that can be tested without ReactFlow rendering.
- Move additional pure selection deletion/detail helpers once their dependency graph is isolated.
- Keep React components, hooks, API calls, EventSource, localStorage IO, and ReactFlow rendering in later plans.
