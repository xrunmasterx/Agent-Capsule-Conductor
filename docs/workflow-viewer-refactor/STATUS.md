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

Status: complete

### Scope Completed So Far

- Added `web/src/workbench/model/boundaryTransferProjection.ts` as the pure owner for Workbench boundary-transfer metadata normalization, serialization, offline pair inference, preview error detection, and unavailable-preview diagnostics.
- Converted `web/src/components/canvas/boundaryTransfer.ts` into a compatibility facade that re-exports the pure model module.
- Added `web/src/workbench/model/taskModel.ts` for task defaults, task-store payload migration, authoring-state normalization, run-status mapping, Codex mode normalization, and empty-input policy normalization.
- Added `web/src/workbench/model/selectionModel.ts` for pure invocation-input projection, workflow/internal node labels, scoped edge selection/address normalization, selection intent normalization, deletion eligibility, deletion transforms, active-status checks, and edge-disconnect click intent.
- Added `web/src/workbench/model/edgeAddress.ts` as the pure owner for root/workflow edge addresses and ReactFlow edge id encoding.
- Added `web/src/workbench/model/workflowNodeModel.ts` as the pure owner for boundary node ids, executable workflow-node checks, internal flow node ids, and flow-endpoint resolution.
- Added `web/src/workbench/model/schemaPorts.ts` as the pure owner for schema-derived output-port projection.
- Added `web/src/workbench/model/canvasEdgeOps.ts` for explicit data-edge creation, data connect node views, data-edge diagnostics, data edge equivalence, and data-port add/rename/delete commands.
- Added `web/src/workbench/model/canvasLayout.ts` for dagre workspace/internal layout, workflow fit/expand helpers, palette placement, and finite numeric helpers.
- Extended `web/src/workbench/model/canvasEdgeOps.ts` to own deterministic scoped connection resolution, pending endpoint recovery, control/data edge commit, control cycle checks, control slot limits, and connection token encode/decode.
- Added boundary-node helpers to `web/src/workbench/model/workflowNodeModel.ts` so connection logic no longer depends on component-local boundary parsing.
- Added `web/src/components/canvas/flowProjection.ts` as the owner for ReactFlow edge DTO projection, scoped edge ids, boundary-shell edge handles, focused-boundary control rendering, and explicit data-edge visibility.
- Extended `web/src/workbench/model/canvasEdgeOps.ts` to own unique canvas-edge de-duplication and workflow-boundary control binding identification shared by save/preview/projection paths.
- Added `web/src/workbench/model/workflowGraphProjection.ts` as the pure owner for canvas-to-Core graph projection, internal workflow graph projection, invocation previews, workflow boundary binding projection, graph edge canonical preview, and reusable port projection helpers.
- Extended `web/src/workbench/model/canvasEdgeOps.ts` to export workflow-boundary edge detection shared by graph projection and canvas edge normalization.
- Added `web/src/workbench/model/selectedNodeModel.ts` as the pure owner for node-run lookup, live-log lookup, workflow main input binding state, and selected node settings projection.
- Added `web/src/workbench/model/canvasProjection.ts` as the pure owner for Core graph-to-canvas projection, focused workflow boundary node projection, graph edge metadata decoding, workflow port decoding, and executable-node schema-derived output-port projection.
- Extended `web/src/workbench/model/selectedNodeModel.ts` to own selected entity detail projection, log excerpt projection, evidence action projection, node event filtering, status labeling, binding directory projection, and edge transfer explanation helpers.
- Removed the corresponding local function definitions from `web/src/components/WorkflowViewer.tsx`; existing exports remain as migration compatibility for older tests and callers.
- `web/src/components/WorkflowViewer.tsx` is now 587,370 bytes / 16,104 lines after the latest slice.

### Added Tests

- `web/src/workbench/model/boundaryTransferProjection.test.ts`
- `web/src/components/canvas/boundaryTransfer.test.ts`
- `web/src/workbench/model/taskModel.test.ts`
- `web/src/workbench/model/selectionModel.test.ts`
- `web/src/workbench/model/schemaPorts.test.ts`
- `web/src/workbench/model/canvasEdgeOps.test.ts`
- `web/src/workbench/model/canvasLayout.test.ts`
- `web/src/components/canvas/flowProjection.test.ts`
- `web/src/workbench/model/workflowGraphProjection.test.ts`
- `web/src/workbench/model/selectedNodeModel.test.ts`
- `web/src/workbench/model/canvasProjection.test.ts`
- Extended `web/src/workbench/model/selectedNodeModel.test.ts` with selected detail model, live-log excerpt, evidence action, edge transfer priority, canvas detail, and workflow binding-directory coverage.

### Validation So Far

Commands were run from `F:\Agent-Capsule-Conductor-v2\web`.

| Command | Result | Notes |
| --- | --- | --- |
| `npx tsc --noEmit` | Passed | Pure model imports compile. |
| `npm run test -- --run src/workbench/model/boundaryTransferProjection.test.ts src/components/canvas/boundaryTransfer.test.ts src/workbench/model/taskModel.test.ts src/workbench/model/selectionModel.test.ts` | Passed | 4 files, 17 tests passed. |
| `npm run test -- --run` | Passed | 16 files, 239 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/workbench/model/canvasEdgeOps.test.ts src/workbench/model/schemaPorts.test.ts src/App.test.tsx` | Passed | 3 files, 94 tests passed. |
| `npm run test -- --run src/workbench/model/canvasLayout.test.ts src/App.test.tsx` | Passed | 2 files, 89 tests passed. |
| `npm run test -- --run src/workbench/model/selectionModel.test.ts src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 3 files, 191 tests passed. |
| `npm run test -- --run src/workbench/model/canvasEdgeOps.test.ts src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 113 tests passed. |
| `npm run test -- --run` | Passed | 16 files, 243 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/components/canvas/flowProjection.test.ts src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 108 tests passed. |
| `npx tsc --noEmit` | Passed | Flow projection extraction compiles. |
| `npm run test -- --run` | Passed | 17 files, 250 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/workbench/model/workflowGraphProjection.test.ts src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 187 tests passed. |
| `npx tsc --noEmit` | Passed | Graph projection extraction compiles. |
| `npm run test -- --run` | Passed | 18 files, 254 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/workbench/model/selectedNodeModel.test.ts src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 188 tests passed. |
| `npx tsc --noEmit` | Passed | Selected node model extraction compiles. |
| `npm run test -- --run` | Passed | 19 files, 259 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/workbench/model/canvasProjection.test.ts src/workbench/model/workflowGraphProjection.test.ts src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 4 files, 190 tests passed. |
| `npx tsc --noEmit` | Passed | Canvas graph decode extraction compiles. |
| `npm run test -- --run` | Passed | 20 files, 262 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/workbench/model/selectedNodeModel.test.ts src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 191 tests passed. |
| `npx tsc --noEmit` | Passed | Selected detail projection extraction compiles. |
| `npm run test -- --run` | Passed | 20 files, 265 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |

### Static Gates So Far

- `web/src/workbench/model` has no imports from ReactFlow, React hooks, localStorage, API modules, stores, or `WorkflowViewer`.
- Boundary-transfer metadata keeps snake_case durable output while preserving camelCase load compatibility.
- Task-store persistence side effects remain in `WorkflowViewer.tsx`; only pure migration/default logic moved.
- `App.test.tsx` now imports migrated data-edge and port-command helpers from their real model owner instead of `WorkflowViewer.tsx`.
- `App.test.tsx` now imports migrated selection helpers from their real model owner instead of `WorkflowViewer.tsx`.
- `WorkflowViewer.tsx` no longer imports `dagre`; layout tests import the real `canvasLayout` owner.
- `WorkflowViewer.tsx` no longer owns selection normalization, scoped edge-address lookup, flow endpoint id parsing, active-status checks, or selection deletion transforms.
- `WorkflowViewer.tsx` no longer owns scoped connection resolution, pending endpoint recovery, connection commit, control cycle/slot validation, or connection token encode/decode.
- `WorkflowViewer.tsx` no longer owns ReactFlow edge DTO projection, unique Flow edge id filtering, implicit main data-edge filtering, or boundary-shell/focused-boundary edge handle mapping.
- `WorkflowViewer.tsx` no longer owns canvas-to-Core graph projection, internal workflow graph projection, invocation preview projection, workflow boundary binding projection, graph edge canonical preview, or reusable port projection helpers.
- `WorkflowViewer.tsx` no longer owns node-run lookup, live-log lookup, workflow main input binding state, or selected node settings projection.
- `WorkflowViewer.tsx` no longer owns Core graph-to-canvas projection, focused workflow boundary node projection, graph edge metadata decoding, workflow port decoding, executable-node schema output projection, or graph node directory fallback projection.
- `WorkflowViewer.tsx` no longer owns selected entity detail projection, selected detail property groups, log excerpt projection, evidence action projection, status labels, binding directory projection, or control-edge transfer explanation helpers.
- `web/src/workbench/model` has no direct `ReactFlow`, `Handle`, `NodeResizer`, React hook, `localStorage`, API, store, or `WorkflowViewer` dependency.

### PLAN_02 Handoff Notes

- Authoring snapshot/proposal/apply helpers still live in `WorkflowViewer.tsx` because they cross assistant state, temporary resources, GraphOps proposal review, and API-backed validation. They are intentionally handed to PLAN_06 instead of being forced into `taskModel.ts`.
- `workspaceDemoCanvas()` still lives in `WorkflowViewer.tsx`. Moving it cleanly requires a dedicated demo/fixture owner because the factory currently shares demo schema, internal-node, and data-edge helper code with canvas interaction helpers. Treat this as PLAN_09 cleanup unless an earlier plan creates the demo fixture boundary.
- React components, hooks, API calls, EventSource, localStorage IO, and ReactFlow rendering remain in later plans.

## Next Plan

PLAN_03 may start. It must migrate effect/hooks ownership without changing the pure model contracts established in PLAN_01 and PLAN_02.

## PLAN_03 Effect Hooks

Status: in progress

### Scope Completed So Far

- Added `web/src/hooks/useWorkbenchLiveStream.ts` as the hook owner for Workbench live EventSource streaming, scope keys, run/turn scope filtering, gap refill, live event bounding, and agent-run-event replay projection.
- Removed local `useWorkbenchLiveStream`, `WorkbenchLiveStreamScope`, `WorkbenchLiveStreamState`, `boundedLiveEvents`, `liveEventFromAgentRunEvent`, and live stream matcher/refill helpers from `web/src/components/WorkflowViewer.tsx`.
- `WorkflowViewer.tsx` now consumes live stream state through `useWorkbenchLiveStream(...)` for selected agent turns and assistant turns.
- Added `web/src/hooks/useBoundaryTransferPreview.ts` as the hook owner for boundary-transfer preview API calls, loading preview state, unavailable diagnostics, and cleanup-safe response handling.
- Replaced EdgeInspector-local boundary preview state/effect with `useBoundaryTransferPreview(...)`.
- `WorkflowViewer.tsx` now memoizes boundary preview snapshots before passing them to the hook, preventing render-triggered duplicate preview requests.
- Extended `web/src/hooks/useRunStream.ts` to own selected-run EventSource streaming for `node_log_delta`, `agent_event`, `live_event`, and `summary` frames.
- Replaced the selected-run inline EventSource effect in `WorkflowViewer.tsx` with `useRunStream(...)`.
- Fixed and wired `web/src/hooks/useAssistantStream.ts` as the hook owner for assistant turn EventSource streaming, polling refresh, terminal cleanup, assistant transcript message projection, and authoring-draft validation gating.
- Replaced the assistant turn inline EventSource/polling effect in `WorkflowViewer.tsx` with `useAssistantTurnStream(...)`.
- Preserved the critical `workbench_chat` gate: ordinary assistant chat still does not validate a previous authoring draft, even when `current_output_turn_id` is present.
- `WorkflowViewer.tsx` passes a stable assistant turn session id derived from `assistantSessionId || assistantPendingTurn.session_id`, so the hook does not depend on outer React state landing before the submitted turn record.
- Added `web/src/hooks/useTaskPersistence.ts` as the owner for local task-store save, current canvas snapshot publish debounce, backend task autosave debounce, backend autosave de-dupe, timer cleanup, and failure retry reset.
- Replaced the localStorage save, 400ms snapshot publish, and 700ms backend task autosave effects in `WorkflowViewer.tsx` with `useTaskPersistence(...)`.
- Kept snapshot construction and backend DTO serialization in the existing authoring helpers for now, so this PLAN_03 slice changes effect ownership without moving authoring/GraphOps semantics.
- `web/src/components/WorkflowViewer.tsx` is now 572,604 bytes / 16,303 lines after the latest slice.

### Added Tests

- `web/src/hooks/useWorkbenchLiveStream.test.tsx`
- `web/src/hooks/useBoundaryTransferPreview.test.tsx`
- `web/src/hooks/useRunStream.test.tsx`
- `web/src/hooks/useAssistantStream.test.tsx`
- `web/src/hooks/useTaskPersistence.test.tsx`
- Extended `web/src/hooks/streamTypes.test.ts`

### Validation So Far

Commands were run from `F:\Agent-Capsule-Conductor-v2\web`.

| Command | Result | Notes |
| --- | --- | --- |
| `npx tsc --noEmit` | Passed | Extracted live stream hook compiles. |
| `npm run test -- --run src/hooks/useWorkbenchLiveStream.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 186 tests passed. |
| `npm run test -- --run` | Passed | 21 files, 268 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useBoundaryTransferPreview.test.tsx src/hooks/useWorkbenchLiveStream.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 4 files, 190 tests passed. |
| `npx tsc --noEmit` | Passed | Boundary preview hook extraction compiles. |
| `npm run test -- --run` | Passed | 22 files, 272 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useRunStream.test.tsx src/hooks/streamTypes.test.ts src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 4 files, 188 tests passed. |
| `npx tsc --noEmit` | Passed | Run stream hook extraction compiles. |
| `npm run test -- --run` | Passed | 23 files, 275 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useAssistantStream.test.tsx src/hooks/streamTypes.test.ts` | Passed | 2 files, 8 tests passed. |
| `npm run test -- --run src/App.test.tsx -t "Workbench AI chat completion does not validate previous authoring draft"` | Passed | Confirms ordinary chat does not call assistant draft validation after hook wiring. |
| `npm run test -- --run src/hooks/useAssistantStream.test.tsx src/hooks/streamTypes.test.ts src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 4 files, 191 tests passed. |
| `npx tsc --noEmit` | Passed | Assistant turn stream hook wiring compiles. |
| `npm run test -- --run` | Passed | 24 files, 281 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useTaskPersistence.test.tsx` | Passed | 1 file, 6 tests passed. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npx tsc --noEmit` | Passed | Task persistence hook wiring compiles. |
| `npm run test -- --run` | Passed | 25 files, 287 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |

### Static Gates So Far

- `WorkflowViewer.tsx` no longer defines the Workbench live stream hook or its pure live-event helper functions.
- EdgeInspector no longer owns boundary preview loading state, API effect, or unavailable-preview fallback logic.
- `WorkflowViewer.tsx` no longer directly creates the selected-run `EventSource`; run stream ownership lives in `useRunStream`.
- `WorkflowViewer.tsx` no longer directly creates the assistant turn `EventSource`, assistant turn polling interval, or assistant draft validation request; assistant turn stream ownership lives in `useAssistantTurnStream`.
- `useAssistantStream.test.tsx` locks ordinary `workbench_chat` turns against accidental `validateAssistantDraft` calls, verifies authoring-turn validation only when the output turn id matches, and covers terminal cleanup.
- `WorkflowViewer.tsx` no longer owns task persistence timers for localStorage save, current canvas snapshot publish, or backend task autosave; debounce, cleanup, and autosave de-dupe live in `useTaskPersistence`.
- `useTaskPersistence.test.tsx` covers not-ready suppression, local save, latest snapshot wins, backend de-dupe, failure retry reset, and cleanup clearing pending timers.
- `WorkflowViewer.tsx` still has direct `api.*`, `runnerApi.*`, and timer usage for run submit, task bootstrap, submit-time boundary preview, binding actions, artifact loading, selected-agent polling, and UI-only defer timers. These are remaining PLAN_03 slices.
