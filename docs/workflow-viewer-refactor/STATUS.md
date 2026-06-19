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

Status: complete

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
- Added `web/src/hooks/useWorkbenchBootstrap.ts` as the owner for runtime config loading, one-shot durable task bootstrap, backend task record loading, initial browser-task migration, cancellation protection, and durable-ready finalization.
- Replaced the runtime config and durable task bootstrap effects in `WorkflowViewer.tsx` with `useWorkbenchBootstrap(...)`.
- `WorkflowViewer.tsx` now keeps only the state projection callbacks for loaded durable tasks; the async startup sequencing lives in the hook.
- Added `web/src/hooks/useSelectedAgentSession.ts` as the owner for selected run-node agent session creation, session message loading, node event loading, pending interaction filtering, pending turn polling, and live run-agent event merging into the selected session.
- Replaced the local selected-agent `AgentSessionUiState`, refresh callback, initial refresh effect, and pending-turn polling effect in `WorkflowViewer.tsx` with `useSelectedAgentSession(...)`.
- `WorkflowViewer.tsx` now composes run projection event updates with selected-agent session event updates through hook callbacks, avoiding direct session-state mutation in the component.
- Added `web/src/hooks/useAssistantSession.ts` as the owner for assistant authoring-agent discovery, session creation/reuse, initial session message loading, session status transitions, busy cleanup, and creation error reporting.
- Replaced the local `ensureAssistantSession(...)` backend API logic in `WorkflowViewer.tsx` with `useAssistantSession(...)`; the component retains only the snapshot-to-payload wrapper.
- Preserved GraphOps/proposal ownership in `WorkflowViewer.tsx` and later PLAN_06. `useAssistantSession` is callback-driven so it does not take ownership of global assistant proposal state.
- Added `web/src/hooks/useArtifactContentCache.ts` as the owner for artifact cache state, run evidence priority reads, artifact fallback reads, load failure cleanup, and same-path in-flight request de-dupe.
- Replaced the local artifact cache `useState`, local `ensureArtifactContent(...)`, and local `readEvidenceContent(...)` helper in `WorkflowViewer.tsx` with `useArtifactContentCache(...)`; the component keeps evidence dock presentation.
- Added `web/src/hooks/useWorkflowBindings.ts` as the owner for workflow binding loading, unbound fallback projection, save/validate/open/select API actions, binding ref normalization, and local binding state updates.
- Replaced the local workflow binding state/effect/action functions and local binding normalization helpers in `WorkflowViewer.tsx` with `useWorkflowBindings(...)`; the component keeps only canvas metadata and notice callbacks.
- Added `web/src/hooks/useOpenedWorkflowLoader.ts` as the owner for external workflow detail loading, enabled/id gating, latest callback delivery, cancellation, and optional load-error reporting.
- Replaced the local `api.workflow(selectedWorkflowId)` effect in `WorkflowViewer.tsx` with `useOpenedWorkflowLoader(...)`; the component keeps workflow-to-canvas projection and selection updates.
- Added `web/src/hooks/useNodeRunDetails.ts` as the owner for selected node run detail cache state, `api.node(...)` detail loading, cached-key suppression, stale-response cancellation, and lightweight-summary fallback on detail errors.
- Replaced the local selected node detail cache `useState` and detail loading effect in `WorkflowViewer.tsx` with `useNodeRunDetails(...)`; the component keeps cache-key calculation and merge strategy.
- Added `web/src/hooks/useWorkbenchTaskDurability.ts` as the owner for durable Workbench task create/delete API side effects, readiness gating, create-race suppression, and delete-error reporting.
- Replaced direct `api.createWorkbenchTask(...)` / `api.deleteWorkbenchTask(...)` calls in `WorkflowViewer.tsx` with `useWorkbenchTaskDurability(...)`; the component keeps task list, active task, canvas, and selection projection.
- Added `web/src/hooks/useRunRestorationLoader.ts` as the owner for run restoration summary/state/events loading, readiness gating, stale-response cancellation, partial state/events fallback, and summary-load error reporting.
- Replaced the local run restoration effect in `WorkflowViewer.tsx` with `useRunRestorationLoader(...)`; the component keeps summary/state/events projection into `RunProjection` and task status updates.
- Added `web/src/hooks/useRunRefreshLoader.ts` as the owner for manual run refresh summary/state/events loading and optional state/events fallback.
- Replaced direct run refresh `api.run(...)` / `api.runState(...)` / `api.runEvents(...)` calls in `WorkflowViewer.tsx` with `useRunRefreshLoader(...)`; the component keeps existing run projection merging.
- Added API-backed bootstrap loaders to `web/src/hooks/useWorkbenchBootstrap.ts`, so runtime config and durable task-record loading are no longer direct component API calls.
- Added `web/src/hooks/useSelectedAgentActions.ts` as the selected-agent submit/publish/interaction API action owner.
- Added `web/src/hooks/useWorkbenchAssistantActions.ts` as the Workbench assistant session load and turn-submit API action owner.
- Added `web/src/hooks/useGraphOpsPersistence.ts` as the GraphOps proposal, validation, dry-run, approval, and apply API action owner.
- Replaced the remaining direct `api.*` endpoint calls in `WorkflowViewer.tsx` with hook-owned action callbacks.
- `web/src/components/WorkflowViewer.tsx` is now 564,834 bytes / 15,419 lines after PLAN_03 completion.

### Added Tests

- `web/src/hooks/useWorkbenchLiveStream.test.tsx`
- `web/src/hooks/useBoundaryTransferPreview.test.tsx`
- `web/src/hooks/useRunStream.test.tsx`
- `web/src/hooks/useAssistantStream.test.tsx`
- `web/src/hooks/useTaskPersistence.test.tsx`
- `web/src/hooks/useWorkbenchBootstrap.test.tsx`
- `web/src/hooks/useSelectedAgentSession.test.tsx`
- `web/src/hooks/useAssistantSession.test.tsx`
- `web/src/hooks/useArtifactContentCache.test.tsx`
- `web/src/hooks/useWorkflowBindings.test.tsx`
- `web/src/hooks/useOpenedWorkflowLoader.test.tsx`
- `web/src/hooks/useNodeRunDetails.test.tsx`
- `web/src/hooks/useWorkbenchTaskDurability.test.tsx`
- `web/src/hooks/useRunRestorationLoader.test.tsx`
- `web/src/hooks/useRunRefreshLoader.test.tsx`
- `web/src/hooks/useSelectedAgentActions.test.tsx`
- `web/src/hooks/useWorkbenchAssistantActions.test.tsx`
- `web/src/hooks/useGraphOpsPersistence.test.tsx`
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
| `npm run test -- --run src/hooks/useWorkbenchBootstrap.test.tsx` | Passed | 1 file, 5 tests passed. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npx tsc --noEmit` | Passed | Workbench bootstrap hook wiring compiles. |
| `npm run test -- --run` | Passed | 26 files, 292 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useSelectedAgentSession.test.tsx` | Passed | 1 file, 5 tests passed. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npx tsc --noEmit` | Passed | Selected-agent session hook wiring compiles. |
| `npm run test -- --run` | Passed | 27 files, 297 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useAssistantSession.test.tsx` | Passed | 1 file, 4 tests passed. |
| `npm run test -- --run src/App.test.tsx -t "Workbench AI assistant generates and applies a canvas-local proposal\|Workbench AI chat completion does not validate previous authoring draft\|Workbench AI assistant resets conversation state when switching tasks"` | Passed | 3 selected assistant tests passed. |
| `npx tsc --noEmit` | Passed | Assistant session hook wiring compiles. |
| `npm run test -- --run` | Passed | 28 files, 301 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useArtifactContentCache.test.tsx` | Passed | 1 file, 5 tests passed. |
| `npx tsc --noEmit` | Passed | Artifact cache hook wiring compiles. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npm run test -- --run` | Passed | 29 files, 306 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useWorkflowBindings.test.tsx` | Passed | 1 file, 6 tests passed. |
| `npx tsc --noEmit` | Passed | Workflow binding hook wiring compiles. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npm run test -- --run` | Passed | 30 files, 312 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useOpenedWorkflowLoader.test.tsx` | Passed | 1 file, 4 tests passed. |
| `npx tsc --noEmit` | Passed | Opened workflow loader hook wiring compiles. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npm run test -- --run` | Passed | 31 files, 316 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useNodeRunDetails.test.tsx` | Passed | 1 file, 5 tests passed. |
| `npx tsc --noEmit` | Passed | Node run detail hook wiring compiles. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npm run test -- --run` | Passed | 32 files, 321 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useWorkbenchTaskDurability.test.tsx` | Passed | 1 file, 4 tests passed. |
| `npx tsc --noEmit` | Passed | Workbench task durability hook wiring compiles. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npm run test -- --run` | Passed | 33 files, 325 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useRunRestorationLoader.test.tsx` | Passed | 1 file, 5 tests passed. |
| `npx tsc --noEmit` | Passed | Run restoration loader hook wiring compiles. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npm run test -- --run` | Passed | 34 files, 330 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useRunRefreshLoader.test.tsx` | Passed | 1 file, 2 tests passed. |
| `npx tsc --noEmit` | Passed | Run refresh loader hook wiring compiles. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npm run test -- --run` | Passed | 35 files, 332 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useWorkbenchTaskCanvasPersistence.test.tsx` | Passed | 1 file, 2 tests passed. |
| `npx tsc --noEmit` | Passed | Workbench task canvas persistence hook wiring compiles. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npm run test -- --run` | Passed | 36 files, 334 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useBoundaryTransferPreview.test.tsx` | Passed | 1 file, 7 tests passed. |
| `npx tsc --noEmit` | Passed | Submit-time boundary transfer validation hook wiring compiles. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npm run test -- --run` | Passed | 36 files, 337 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useSubmittedRunPolling.test.tsx` | Passed | 1 file, 3 tests passed. |
| `npx tsc --noEmit` | Passed | Submitted run polling hook wiring compiles. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npm run test -- --run` | Passed | 37 files, 340 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useWorkflowPersistence.test.tsx` | Passed | 1 file, 2 tests passed. |
| `npx tsc --noEmit` | Passed | Workflow persistence hook wiring compiles. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npm run test -- --run` | Passed | 38 files, 342 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useRunnerSubmit.test.tsx` | Passed | 1 file, 1 test passed. |
| `npx tsc --noEmit` | Passed | Runner submit hook wiring compiles. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npm run test -- --run` | Passed | 39 files, 343 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/hooks/useSelectedAgentActions.test.tsx src/hooks/useWorkbenchAssistantActions.test.tsx src/hooks/useGraphOpsPersistence.test.tsx src/hooks/useWorkbenchBootstrap.test.tsx` | Passed | 4 files, 13 tests passed. |
| `npx tsc --noEmit` | Passed | Final action hook and bootstrap loader wiring compiles. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed. |
| `npm run test -- --run` | Passed | 42 files, 351 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `python -m pytest -q tests/server/test_agent_sessions_api.py tests/server/test_runs_projection_api.py tests/server/test_workbench_canvas_snapshots_api.py tests/unit/test_workbench_adapter.py` | Failed | System Python environment is missing `fastapi`; retried with project-managed `uv`. |
| `uv run pytest -q tests/server/test_agent_sessions_api.py tests/server/test_runs_projection_api.py tests/server/test_workbench_canvas_snapshots_api.py tests/unit/test_workbench_adapter.py` | Passed | 70 backend tests passed. |

### Static Gates So Far

- `WorkflowViewer.tsx` no longer defines the Workbench live stream hook or its pure live-event helper functions.
- EdgeInspector no longer owns boundary preview loading state, API effect, or unavailable-preview fallback logic.
- `WorkflowViewer.tsx` no longer directly creates the selected-run `EventSource`; run stream ownership lives in `useRunStream`.
- `WorkflowViewer.tsx` no longer directly creates the assistant turn `EventSource`, assistant turn polling interval, or assistant draft validation request; assistant turn stream ownership lives in `useAssistantTurnStream`.
- `useAssistantStream.test.tsx` locks ordinary `workbench_chat` turns against accidental `validateAssistantDraft` calls, verifies authoring-turn validation only when the output turn id matches, and covers terminal cleanup.
- `WorkflowViewer.tsx` no longer owns task persistence timers for localStorage save, current canvas snapshot publish, or backend task autosave; debounce, cleanup, and autosave de-dupe live in `useTaskPersistence`.
- `useTaskPersistence.test.tsx` covers not-ready suppression, local save, latest snapshot wins, backend de-dupe, failure retry reset, and cleanup clearing pending timers.
- `WorkflowViewer.tsx` no longer owns runtime config loading or durable task bootstrap effects; one-shot startup, cancellation, migration, and ready finalization live in `useWorkbenchBootstrap`.
- `useWorkbenchBootstrap.test.tsx` covers runtime config success/failure, durable task load and active-task selection, initial task migration, bootstrap error handling, and cleanup suppression.
- `WorkflowViewer.tsx` no longer owns selected-agent session creation, selected node event loading, interaction filtering, or selected-agent pending-turn polling; this ownership lives in `useSelectedAgentSession`.
- `useSelectedAgentSession.test.tsx` covers no-context reset, selected run-node session loading, pending interaction filtering, load errors, pending turn polling terminal cleanup, event merge, and explicit refresh.
- `WorkflowViewer.tsx` no longer owns assistant authoring-agent discovery, workbench assistant session creation, or initial assistant session message loading; this ownership lives in `useAssistantSession`.
- `useAssistantSession.test.tsx` covers existing-session reuse, default authoring agent selection, explicit agent preservation, message projection, busy cleanup, and create-error reporting.
- `WorkflowViewer.tsx` no longer owns artifact cache state, run-evidence artifact fallback reads, or same-path artifact request de-dupe; this ownership lives in `useArtifactContentCache`.
- `useArtifactContentCache.test.tsx` covers run evidence priority, artifact fallback, normalized cache writes, same-path in-flight de-dupe, failure cleanup, and retry eligibility.
- `WorkflowViewer.tsx` no longer owns workflow binding load effects, save/validate/open/select actions, unbound fallback projection, or binding path/ref normalization; this ownership lives in `useWorkflowBindings`.
- `useWorkflowBindings.test.tsx` covers legacy/camel-case normalization, unique binding load with unbound fallback, stable-id no-reload behavior, save state/callback updates, validate/open/select actions, and runner binding ref normalization.
- `WorkflowViewer.tsx` no longer owns external workflow detail loading or stale-response cancellation for the opened-workflow path; this ownership lives in `useOpenedWorkflowLoader`.
- `useOpenedWorkflowLoader.test.tsx` covers disabled/missing-id suppression, latest callback delivery without duplicate loading, cleanup suppression of stale responses, and error callback reporting.
- `WorkflowViewer.tsx` no longer owns selected node run detail cache state, detail API loading, cached-key suppression, stale-response cancellation, or detail-load fallback behavior; this ownership lives in `useNodeRunDetails`.
- `useNodeRunDetails.test.tsx` covers missing-context suppression, detail load and merge, cached-key no-reload behavior, cleanup suppression of stale responses, and detail-load failure fallback.
- `WorkflowViewer.tsx` no longer owns durable task create/delete API calls or readiness gating; this ownership lives in `useWorkbenchTaskDurability`.
- `useWorkbenchTaskDurability.test.tsx` covers readiness suppression, create request payloads, create-race suppression, delete requests, and delete-error reporting.
- `WorkflowViewer.tsx` no longer owns run restoration summary/state/events loading, stale-response cancellation, or partial state/events fallback; this ownership lives in `useRunRestorationLoader`.
- `useRunRestorationLoader.test.tsx` covers disabled/missing-id suppression, summary/state/events loading, state/events fallback, cleanup suppression of stale responses, and summary-load error reporting.
- `WorkflowViewer.tsx` no longer owns manual run refresh summary/state/events loading; this ownership lives in `useRunRefreshLoader`.
- `useRunRefreshLoader.test.tsx` covers full refresh payload loading and state/events fallback.
- `WorkflowViewer.tsx` no longer owns Workbench task canvas get/put endpoint calls for durable task loading, initial local task migration, current snapshot publishing, or backend task autosave; this ownership lives in `useWorkbenchTaskCanvasPersistence`.
- `useWorkbenchTaskCanvasPersistence.test.tsx` covers task-canvas snapshot loading and exact save payload forwarding.
- Submit-time boundary-transfer validation now uses `useBoundaryTransferValidation(...)`; `WorkflowViewer.tsx` no longer owns the save/run preflight `api.boundaryTransferPreview(...)` call or diagnostic-to-error formatting.
- `useBoundaryTransferPreview.test.tsx` now covers validation success, backend-preview unavailable failures, and error-diagnostic blocking in addition to inspector preview loading.
- `WorkflowViewer.tsx` no longer owns submitted-run summary/state/events polling or the active-run retry timer; this ownership lives in `useSubmittedRunPolling`.
- `useSubmittedRunPolling.test.tsx` covers active-to-terminal polling, optional state/events fallback, retry after failed polls, and timer cleanup on unmount.
- `WorkflowViewer.tsx` no longer owns workflow save/validate endpoint calls; this ownership lives in `useWorkflowPersistence`.
- `useWorkflowPersistence.test.tsx` covers save force semantics, canonical preview passthrough, and workflow-id validation.
- `WorkflowViewer.tsx` no longer owns runner job submission endpoint calls; this ownership lives in `useRunnerSubmit`.
- `useRunnerSubmit.test.tsx` covers run/task/binding submit option passthrough and queued status propagation.
- Workbench bootstrap API loaders now live in `useWorkbenchBootstrapLoaders`.
- Selected-agent submit/publish/interaction API calls now live in `useSelectedAgentActions`.
- Workbench assistant session/turn API calls now live in `useWorkbenchAssistantActions`.
- GraphOps proposal, validation, dry-run, approval, and apply API calls now live in `useGraphOpsPersistence`.
- `WorkflowViewer.tsx` has no remaining direct `api.*`, `runnerApi.*`, `new EventSource`, or `setInterval` usage.
- Remaining `WorkflowViewer.tsx` `setTimeout` calls are UI defer timers only.
- `WorkflowViewer.tsx` is now 564,834 bytes / 15,419 lines after PLAN_03 completion.

## Next Plan

PLAN_04 may start. It must keep the hook ownership boundaries from PLAN_03 intact and avoid reintroducing endpoint calls, EventSource construction, or polling timers into `WorkflowViewer.tsx`.

## PLAN_04 Presentational Components

Status: complete

### Scope Completed So Far

- Switched the main `WorkflowViewer.tsx` render path for the Workbench shell, top bar, task workspace switcher, task overview page, save workflow dialog, and execution dock to the extracted presentational modules.
- Added `durableTasksReady` support to the extracted `WorkbenchShell`, preserving the `data-durable-tasks-ready` marker used by startup and regression tests.
- Removed the corresponding local `WorkflowViewer.tsx` function declarations for `WorkbenchShell`, `SaveWorkflowDialog`, `ExecutionDock`, `TaskWorkspaceSwitcher`, `TaskOverviewPage`, `TaskArtifactsPane`, `TaskRail`, and `TopBar`.
- Restored the stable `Task workspace view` aria label while keeping the visible task switcher labels on the extracted component path.
- Upgraded extracted `LiveOutputViewer` to match the current inline implementation: ACC transcript projection, `输出/日志/stdout/stderr/错误/raw` filters, pinned-scroll behavior, and the jump-to-latest action.
- Switched the `WorkflowViewer.tsx` node-detail live output path to the extracted `LiveOutputViewer`.
- Removed the local `WorkflowViewer.tsx` `LiveOutputViewer` function declaration while preserving the exported `filterLiveEvents(...)` helper used by existing tests.
- Switched node-detail overlay chrome to extracted `NodeDetailOverlay`, keeping the three detail panes local until PLAN_05.
- Removed the local `WorkflowViewer.tsx` `NodeDetailOverlay` function declaration.
- Upgraded extracted `SelectionDetailsDock` to match the inline implementation: evidence action buttons, `onReadEvidence(...)`, assistant mode body class, and current evidence title behavior.
- Switched the bottom details dock main render path to extracted `SelectionDetailsDock`.
- Removed local `WorkflowViewer.tsx` `SelectionDetailsDock` and `EvidenceDockArtifactContent` declarations.
- Removed all `*Extracted` migration aliases and the bottom migration re-export from `WorkflowViewer.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 541,991 bytes / 15,326 lines after PLAN_04 completion.

### Added Tests

- `web/src/components/execution/ExecutionDock.test.tsx`
- `web/src/components/execution/RunOverlay.test.tsx`
- `web/src/components/inspector/NodeDetailOverlay.test.tsx`
- `web/src/components/workbench/WorkbenchShell.test.tsx`
- `web/src/components/workbench/TopBar.test.tsx`

### Validation So Far

Commands were run from `F:\Agent-Capsule-Conductor-v2\web`.

| Command | Result | Notes |
| --- | --- | --- |
| `npm run test -- --run src/components/execution/ExecutionDock.test.tsx src/components/workbench/WorkbenchShell.test.tsx src/components/workbench/TopBar.test.tsx` | Passed | 3 files, 5 tests passed. |
| `npx tsc --noEmit` | Passed | Extracted workbench/execution component wiring compiles. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 183 tests passed after preserving `Task workspace view` aria label. |
| `npm run test -- --run src/components/execution/ExecutionDock.test.tsx src/components/workbench/WorkbenchShell.test.tsx src/components/workbench/TopBar.test.tsx src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 5 files, 188 tests passed. |
| `npm run test -- --run` | Passed | 45 files, 356 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/components/execution/RunOverlay.test.tsx src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 3 files, 185 tests passed. |
| `npx tsc --noEmit` | Passed | Extracted live output viewer wiring compiles. |
| `npm run test -- --run` | Passed | 46 files, 358 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/components/inspector/NodeDetailOverlay.test.tsx src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 3 files, 184 tests passed. |
| `npx tsc --noEmit` | Passed | Extracted node-detail overlay wiring compiles. |
| `npm run test -- --run` | Passed | 47 files, 359 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npm run test -- --run src/components/inspector/SelectionDetailsDock.test.tsx src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 3 files, 187 tests passed. |
| `npx tsc --noEmit` | Passed | Extracted selection-details dock wiring compiles. |
| `npm run test -- --run` | Passed | 47 files, 361 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |

### Static Gates So Far

- `WorkflowViewer.tsx` no longer defines the low-risk workbench/execution local display functions listed above.
- The main render path uses the extracted workbench/execution components for the top-level shell, task overview, save dialog, and run controls.
- `WorkflowViewer.tsx` no longer defines the local `LiveOutputViewer`; node-detail live output uses `components/execution/RunOverlay.tsx`.
- `WorkflowViewer.tsx` no longer defines the local `NodeDetailOverlay`; node-detail chrome uses `components/inspector/NodeDetailOverlay.tsx`.
- `WorkflowViewer.tsx` no longer defines local `SelectionDetailsDock` or `EvidenceDockArtifactContent`; bottom details dock rendering uses `components/inspector/SelectionDetailsDock.tsx`.
- `WorkflowViewer.tsx` no longer contains `Extracted` migration aliases or migration re-exports.

## Next Plan

PLAN_05 may start. It should keep the presentational component ownership from PLAN_04 intact while moving inspector-specific business panes and models out of `WorkflowViewer.tsx`.

## PLAN_05 Inspector

Status: complete

### Scope Completed So Far

- Added `web/src/workbench/model/inspectorActions.ts` as the pure view-model owner for data-connection panel projections.
- Added `web/src/components/inspector/DataConnectionsPanel.tsx` and switched all `WorkflowViewer.tsx` call sites to the extracted component.
- Removed the local `DataConnectionsPanel` function from `WorkflowViewer.tsx`.
- Replaced the old prompt-based port rename interaction with an inline rename form, making the behavior testable and avoiding `window.prompt` in inspector code.
- Moved `DataConnectionDraft` into `web/src/types/workbench.ts` so inspector components no longer depend on a main-file-local type.
- Added `web/src/hooks/useCallableDetail.ts` and removed the local `useCallableDetail(...)` implementation from `WorkflowViewer.tsx`, keeping callable API access in the hook layer instead of the inspector component layer.
- Added `web/src/components/inspector/PortInspector.tsx` and removed the local `PortInspector` from `WorkflowViewer.tsx`.
- Added `web/src/components/inspector/EdgeInspector.tsx` and removed the local `EdgeInspector` from `WorkflowViewer.tsx`.
- `EdgeInspector` receives the boundary preview snapshot builder from the parent and uses `useBoundaryTransferPreview`; it does not directly call API or construct canonical graph snapshots itself.
- Added `web/src/components/inspector/InspectorRenderers.ts` as the prop boundary for renderer primitives still owned by the shell during the transition.
- Added `web/src/components/inspector/WorkflowInspector.tsx` and removed the local `WorkflowInspector` from `WorkflowViewer.tsx`.
- Added `web/src/components/inspector/InternalNodeInspector.tsx` and removed the local `InternalNodeInspector` from `WorkflowViewer.tsx`.
- Added `web/src/components/inspector/RightInspector.tsx` and removed the local `RightInspector` and `InspectorTabs` from `WorkflowViewer.tsx`.
- Moved `AgentNodeConnectionEditor` into `web/src/types/workbench.ts`, so the extracted right inspector and the shell share a stable editor contract.
- Kept callable-detail loading in `useCallableDetail(...)`; inspector components do not call API directly.
- `web/src/components/WorkflowViewer.tsx` is now 487,990 bytes / 13,796 lines after PLAN_05 completion.

### Added Tests

- `web/src/workbench/model/inspectorActions.test.ts`
- `web/src/components/inspector/DataConnectionsPanel.test.tsx`
- `web/src/components/inspector/PortInspector.test.tsx`
- `web/src/components/inspector/EdgeInspector.test.tsx`
- `web/src/components/inspector/WorkflowInspector.test.tsx`
- `web/src/components/inspector/InternalNodeInspector.test.tsx`
- `web/src/components/inspector/RightInspector.test.tsx`

### Validation So Far

Commands were run from `F:\Agent-Capsule-Conductor-v2\web`.

| Command | Result | Notes |
| --- | --- | --- |
| `npx tsc --noEmit` | Passed | Data connection model/component extraction compiles. |
| `npm run test -- --run src/workbench/model/inspectorActions.test.ts src/components/inspector/DataConnectionsPanel.test.tsx` | Passed | 2 files, 6 tests passed. |
| `npm run test -- --run src/components/inspector/EdgeInspector.test.tsx src/components/inspector/PortInspector.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 3 files, 106 tests passed. |
| `npm run test -- --run` | Passed | 49 files, 367 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |
| `npx tsc --noEmit` | Passed | Right/Workflow/Internal inspector extraction compiles. |
| `npm run test -- --run src/components/inspector/WorkflowInspector.test.tsx src/components/inspector/InternalNodeInspector.test.tsx src/components/inspector/RightInspector.test.tsx src/components/inspector/EdgeInspector.test.tsx src/components/inspector/PortInspector.test.tsx src/components/inspector/DataConnectionsPanel.test.tsx` | Passed | 6 files, 16 tests passed. |
| `npm run test -- --run` | Passed | 54 files, 379 tests passed. |
| `npm run build` | Passed | Same expected chunk-size warning remains. |

### Static Gates So Far

- `WorkflowViewer.tsx` no longer defines local `DataConnectionsPanel`.
- `WorkflowViewer.tsx` no longer defines local `PortInspector`.
- `WorkflowViewer.tsx` no longer defines local `EdgeInspector`.
- `WorkflowViewer.tsx` no longer defines local `WorkflowInspector`.
- `WorkflowViewer.tsx` no longer defines local `InternalNodeInspector`.
- `WorkflowViewer.tsx` no longer defines local `RightInspector` or `InspectorTabs`.
- `web/src/components/inspector` has no direct `api.*` usage.
- `web/src/components/inspector` has no direct boundary-transfer preview implementation; `EdgeInspector` depends on the hook boundary only.
- `web/src/components/WorkflowViewer.tsx`, `web/src/components/inspector`, and `web/src/workbench/model` have no `window.prompt` usage.
- `web/src` has no `selection.kind` usage.
- `web/src/workbench/model/inspectorActions.ts` imports no React, API modules, stores, or `WorkflowViewer`.

## PLAN_06 Assistant GraphOps

Status: complete

### Scope Completed So Far

- Added `web/src/workbench/model/graphOpsProposal.ts` as the pure owner for temporary-agent GraphOps proposal id creation, persistent callable id derivation, temporary callable id detection, and create-agent transaction construction.
- Removed the corresponding local GraphOps helper functions from `WorkflowViewer.tsx`; the component now imports the pure model helpers.
- Preserved existing temporary-agent fallback id behavior for compatibility: `tmp_agent_empty` still maps to `agentempty`.
- Added `web/src/workbench/model/paletteCanvasOps.ts` as the pure owner for palette item to canvas node/container creation, next-selection prediction, id slugging, and unique id allocation.
- Removed the corresponding local palette canvas creation helpers from `WorkflowViewer.tsx`; the ReactFlow-specific pending-connection helper remains local and calls the pure node factory.
- Added `web/src/workbench/model/authoringProposal.ts` as the pure owner for authoring canvas hash, target projection, assistant turn reason fallback, validation merge, backend validation conversion, authoring API payload projection, temporary-resource replacement, temporary-resource run/save blockers, and operation summaries.
- Removed those local support functions from `WorkflowViewer.tsx`; the remaining local authoring functions are the larger proposal build/validate/apply body that will move next.
- Added `web/src/components/assistant/assistantTranscript.ts` as the owner for assistant transcript item projection, live-event merging, GraphOps list filtering, and assistant display-status derivation.
- Removed the corresponding transcript projection helpers and local assistant transcript/status types from `WorkflowViewer.tsx`; the component now keeps only transcript rendering components and imports the projection model.
- `WorkflowViewer.tsx` is now 454,062 bytes / 12,238 lines, below the previous Babel 500KB deopt threshold.
- Added `web/src/components/authoring/authoringRuntime.ts` as the owner for authoring id creation, snapshot capture, deterministic proposal build, proposal validation, proposal apply, and authoring canvas operation helpers.
- Removed the local authoring runtime implementation from `WorkflowViewer.tsx`; the component now invokes the authoring runtime through imports.
- `web/src/components/authoring/AuthoringSession.tsx` and `ProposalReview.tsx` now re-export from the real authoring owner instead of `WorkflowViewer.tsx`.
- `WorkflowViewer.tsx` is now 412,224 bytes / 11,109 lines after authoring runtime extraction.
- Added `web/src/components/assistant/AssistantConsole.tsx` as the owner for `AssistantDrawer`, `AssistantDockContent`, assistant transcript rendering, composer controls, proposal summary, and GraphOps review UI.
- Replaced the stale `web/src/components/assistant/AssistantDrawer.tsx` implementation with a compatibility re-export to the current AssistantConsole owner.
- Removed local Assistant drawer/dock UI definitions from `WorkflowViewer.tsx`; selected-node runtime output remains a slot passed from the shell so assistant UI does not own schema/evidence details.
- `WorkflowViewer.tsx` is now 377,999 bytes / 10,127 lines after Assistant UI extraction.

### Added Tests

- `web/src/workbench/model/graphOpsProposal.test.ts`
- `web/src/workbench/model/paletteCanvasOps.test.ts`
- `web/src/workbench/model/authoringProposal.test.ts`
- `web/src/components/assistant/assistantTranscript.test.ts`
- Existing `web/src/components/WorkflowViewer.drag.test.tsx` authoring assertions now import proposal runtime helpers from `web/src/components/authoring/authoringRuntime.ts`.
- Existing App assistant integration tests now exercise the extracted AssistantConsole path.

### Validation So Far

Commands were run from `F:\Agent-Capsule-Conductor-v2\web`.

| Command | Result | Notes |
| --- | --- | --- |
| `npx tsc --noEmit` | Passed | GraphOps proposal model extraction compiles. |
| `npm run test -- --run src/workbench/model/graphOpsProposal.test.ts` | Passed | 1 file, 4 tests passed. |
| `npm run test -- --run src/workbench/model/graphOpsProposal.test.ts src/hooks/useGraphOpsPersistence.test.tsx src/App.test.tsx -t "temporary agent|GraphOps|Workbench AI temporary"` | Passed | 3 files, 6 selected tests passed; temporary-agent GraphOps integration tests still pass. |
| `npx tsc --noEmit` | Passed | Palette canvas op extraction compiles. |
| `npm run test -- --run src/workbench/model/paletteCanvasOps.test.ts src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 105 tests passed. |
| `npx tsc --noEmit` | Passed | Authoring support model extraction compiles. |
| `npm run test -- --run src/workbench/model/authoringProposal.test.ts` | Passed | 1 file, 5 tests passed. |
| `npm run test -- --run src/workbench/model/authoringProposal.test.ts src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx -t "CanvasAuthoringProposal|temporary agent|Workbench AI temporary|chat completion does not validate"` | Passed | 2 files plus selected App/drag tests passed; direct authoring model tests are covered by the previous command because the `-t` filter intentionally selects integration cases. |
| `npx tsc --noEmit` | Passed | Assistant transcript projection extraction compiles. |
| `npm run test -- --run src/components/assistant/assistantTranscript.test.ts` | Passed | 1 file, 5 tests passed. |
| `npm run test -- --run src/components/assistant/assistantTranscript.test.ts src/App.test.tsx -t "Workbench AI chat completion does not validate previous authoring draft\|Workbench AI temporary agent blocks save validate and run after task reload\|Workbench AI temporary agent persists through GraphOps proposal approval\|Workbench AI assistant generates and applies a canvas-local proposal\|assistantTranscript"` | Passed | 2 files, 9 selected tests passed. |
| `npm run test -- --run src/components/WorkflowViewer.drag.test.tsx` | Passed | 1 file, 101 tests passed. |
| `npx tsc --noEmit` | Passed | Authoring runtime extraction compiles. |
| `npm run test -- --run src/workbench/model/authoringProposal.test.ts src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 106 tests passed; drag test authoring helpers import the new runtime owner. |
| `npm run test -- --run src/App.test.tsx -t "Workbench AI assistant generates and applies a canvas-local proposal\|Workbench AI chat completion does not validate previous authoring draft\|Workbench AI temporary agent blocks save validate and run after task reload\|Workbench AI temporary agent persists through GraphOps proposal approval"` | Passed | 4 selected assistant/GraphOps integration tests passed. |
| `npx tsc --noEmit` | Passed | AssistantConsole extraction compiles. |
| `npm run test -- --run src/components/assistant/assistantTranscript.test.ts src/components/WorkflowViewer.drag.test.tsx` | Passed | 2 files, 106 tests passed. |
| `npm run test -- --run src/App.test.tsx -t "Workbench AI assistant generates and applies a canvas-local proposal\|Workbench AI chat completion does not validate previous authoring draft\|Workbench AI temporary agent blocks save validate and run after task reload\|Workbench AI temporary agent persists through GraphOps proposal approval"` | Passed | 4 selected assistant/GraphOps integration tests passed after AssistantConsole extraction. |

### Static Gates So Far

- `WorkflowViewer.tsx` no longer defines local `graphOpsProposalId`.
- `WorkflowViewer.tsx` no longer defines local `persistentCallableIdForDraft`.
- `WorkflowViewer.tsx` no longer defines local `graphOpsTransactionForTemporaryAgent`.
- `WorkflowViewer.tsx` no longer defines local `isTemporaryCallableId`.
- `WorkflowViewer.tsx` no longer defines local `addWorkflowFromPalette`, `addCallableNodeFromPalette`, `addInternalNodeFromPalette`, `internalNodeFromPaletteItem`, `nextPaletteSelection`, `paletteItemBaseId`, `slugId`, `uniqueId`, or `uniqueInvocationLabel`.
- `WorkflowViewer.tsx` no longer defines local `canvasAuthoringHash`, `stableJsonStringify`, `hashString`, `authoringTargetFromSelection`, `effectiveAssistantTurnReason`, `mergeAuthoringValidation`, `authoringValidationFromBackend`, `authoringBackendCanvasSnapshot`, `authoringSelectionPayload`, `replaceTemporaryResourceWithCallable`, `temporaryResourceIssueForCanvas`, `temporaryResourceIssueForGraph`, `authoringOperationSummary`, or `isInspectableNodeSelection`.
- `WorkflowViewer.tsx` no longer defines local `AssistantProcessEvent`, `AssistantTranscriptItem`, `AssistantDisplayStatus`, `graphOpsStringList`, `buildAssistantTranscriptItems`, or `assistantDisplayStatus`.
- `components/assistant/assistantTranscript.ts` has no React import and contains no API, store, localStorage, EventSource, or ReactFlow dependency.
- `WorkflowViewer.tsx` no longer defines local `authoringId`, `captureAuthoringSnapshot`, `buildDeterministicCanvasAuthoringProposal`, `validateCanvasAuthoringProposal`, or `applyCanvasAuthoringProposal`.
- `components/authoring`, `components/assistant`, `hooks`, and `workbench` no longer import from `WorkflowViewer.tsx`.
- `WorkflowViewer.tsx` no longer defines local `AssistantDrawer`, `AssistantDockContent`, `AssistantControlRail`, or `AssistantProposalSummary`.
- `WorkflowViewer.tsx` no longer directly calls assistant/GraphOps API endpoints; assistant session, turn stream, and GraphOps persistence remain hook-owned.

## PLAN_07 ReactFlow Canvas

Status: complete

### Scope Completed So Far

- Replaced the `web/src/components/canvas/NodeRenderer.tsx` re-export shim with the real `WorkflowContainer`, `AgentToolNode`, stable `nodeTypes`, `FlowNodeLayoutContext`, and ReactFlow node data types.
- Removed local `WorkflowContainer`, `AgentToolNode`, node-renderer data types, and local `nodeTypes` ownership from `WorkflowViewer.tsx`; `WorkspaceCanvas` now consumes them from `NodeRenderer.tsx`.
- Added `web/src/components/canvas/connectionDom.ts` for connection handle classification, endpoint lookup, flow-node DOM lookup, connection trace buffering, and handle lookup by endpoint.
- Added `web/src/components/canvas/CanvasToolbar.tsx` for canvas toolbar controls, node-create menu, and connection preview line rendering.
- Extended `web/src/components/canvas/flowProjection.ts` to own ReactFlow node projection, node identity/layout keys, node reconciliation, drag commit keys, and flow-edge address decoding.
- Added `web/src/components/canvas/canvasPointer.ts` for pointer/touch coordinate normalization, ReactFlow coordinate fallback, and connection-preview start-point calculation.
- Added `web/src/components/canvas/canvasFocus.ts` for workflow-focus canvas projection with input/output boundary pseudo nodes.
- Added `web/src/components/canvas/canvasMutation.ts` for canvas resize/move, drag commit/reparenting, palette drop target resolution, executable-root/internal-node conversion, and pending palette connection mutation.
- Added `web/src/components/canvas/canvasDomGuards.ts` for text-editing keyboard target and node-detail double-click guard logic.
- Added `web/src/components/canvas/canvasDataDrop.ts` for data-edge body-drop preview and command creation.
- Replaced `web/src/components/canvas/WorkspaceCanvas.tsx` re-export shim with the real ReactFlow canvas root and moved ReactFlow CSS import there.
- Removed local `WorkspaceCanvas`, ReactFlow imports, canvas toolbar/menu/preview components, connection DOM helpers, pointer helpers, focus projection, canvas mutation helpers, and data body-drop helpers from `WorkflowViewer.tsx`.
- `WorkflowViewer.tsx` is now 253,016 bytes / 6,731 lines after the latest PLAN_07 slice.

### Added/Updated Tests

- Existing `web/src/components/WorkflowViewer.drag.test.tsx` now exercises node renderer through the extracted `NodeRenderer.tsx` implementation.
- Added/extended canvas module tests:
  - `web/src/components/canvas/connectionDom.test.ts`
  - `web/src/components/canvas/CanvasToolbar.test.tsx`
  - `web/src/components/canvas/flowProjection.test.ts`
  - `web/src/components/canvas/canvasPointer.test.ts`
  - `web/src/components/canvas/canvasFocus.test.ts`
  - `web/src/components/canvas/canvasMutation.test.ts`
  - `web/src/components/canvas/canvasDomGuards.test.ts`
  - `web/src/components/canvas/canvasDataDrop.test.ts`

### Validation So Far

Commands were run from `F:\Agent-Capsule-Conductor-v2\web`.

| Command | Result | Notes |
| --- | --- | --- |
| `npx tsc --noEmit` | Passed | NodeRenderer extraction compiles. |
| `npm run test -- --run src/components/WorkflowViewer.drag.test.tsx` | Passed | 1 file, 101 tests passed. |
| `npx tsc --noEmit` | Passed | WorkspaceCanvas and canvas helper extraction compile. |
| `npm run test -- --run src/components/WorkflowViewer.drag.test.tsx src/components/canvas/canvasMutation.test.ts src/components/canvas/canvasDataDrop.test.ts src/components/canvas/flowProjection.test.ts` | Passed | 4 files, 120 tests passed. |
| `npm run test -- --run` | Passed | 65 files, 426 tests passed. |
| `npm run build` | Passed | Vite still reports the expected chunk-size warning for the main production JS chunk. |

### Static Gates So Far

- `WorkflowViewer.tsx` no longer defines local `AgentToolNode`, `WorkflowContainer`, or local `nodeTypes`.
- `web/src/components/canvas/NodeRenderer.tsx` no longer re-exports from `WorkflowViewer.tsx`.
- `WorkflowViewer.tsx` no longer defines local `WorkspaceCanvas`.
- `web/src/components/canvas/WorkspaceCanvas.tsx` no longer re-exports from `WorkflowViewer.tsx`.
- `web/src/components/canvas/WorkspaceCanvas.tsx` owns ReactFlow root rendering and imports ReactFlow CSS.
- `rg -n "function WorkspaceCanvas" web/src/components/WorkflowViewer.tsx web/src/components/canvas/WorkspaceCanvas.tsx` reports the function only in `WorkspaceCanvas.tsx`.

## PLAN_08 Store Ownership

Status: in progress

### Scope Completed So Far

- Upgraded `web/src/stores/workbenchStore.ts` from scalar task identity state to a task ownership store for `WorkbenchTask` records, task ordering, active task, per-task canvas revisions, per-task selection, and per-task focused workflow id.
- Kept `taskIds` as a compatibility mirror of canonical `taskOrder` so existing consumers can migrate incrementally.
- Added task owner actions for hydrate/set/upsert/delete, canvas updates, per-task selection, and per-task focused workflow state.
- Added selectors for active task id, task order, active task, active canvas, active selection, and canvas revision.
- Preserved the store as a frontend state boundary only: no API calls, no ReactFlow dependency, no `WorkflowViewer` dependency, and no `sourceGraph` ownership.
- Rewired `WorkflowViewer.tsx` to consume store-owned task list, active task, canvas, selection, focused workflow id, connection mode, edge view mode, task workspace view, chrome, bottom dock mode, and node-detail open state.
- Kept `sourceGraph` as a local derived projection and kept run/assistant/API/EventSource state out of the store.
- Reset store UI scalars on each `WorkflowViewer` mount before hydrating persisted tasks, preserving per-instance behavior that local React state previously provided and preventing test/runtime cross-instance leakage.
- Upgraded `web/src/stores/runStore.ts` into a run/task partitioned owner for run projections, task run indexes, active run ids, node logs, live events, runtime config, and workflow bindings.
- Upgraded `web/src/stores/assistantStore.ts` into a per-task assistant owner with session/proposal/review/undo state and stale turn-completion guards.
- Kept both stores pure: no API calls, no EventSource, no ReactFlow, and no `WorkflowViewer` dependency.

### Added Tests

- Extended `web/src/stores/workbenchStore.types.test.ts` with task hydration, task-isolated canvas revision updates, per-task selection/focus isolation, active-task fallback on delete, and static boundary checks.
- Added `web/src/stores/runStore.test.ts` for task/run isolation, same-node log isolation, unknown-run event/log ignore behavior, removal cleanup, and static dependency boundaries.
- Added `web/src/stores/assistantStore.test.ts` for per-task proposal isolation, per-task reset, stale turn completion rejection, matching turn completion, and static dependency boundaries.

### Validation So Far

Commands were run from `F:\Agent-Capsule-Conductor-v2\web`.

| Command | Result | Notes |
| --- | --- | --- |
| `npx tsc --noEmit` | Passed | Store task ownership contract compiles. |
| `npm run test -- --run src/stores/workbenchStore.types.test.ts` | Passed | 1 file, 6 tests passed. |
| `npm run test -- --run src/components/WorkflowViewer.drag.test.tsx` | Passed | 1 file, 101 tests passed; existing WorkflowViewer compatibility exports still work. |
| `npm run test -- --run src/App.test.tsx` | Passed | 1 file, 82 tests passed after WorkflowViewer consumed store-owned state. |
| `npm run test -- --run` | Passed | 65 files, 431 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains. |
| `npm run test -- --run src/stores/runStore.test.ts src/stores/assistantStore.test.ts src/stores/workbenchStore.types.test.ts` | Passed | 3 files, 16 tests passed for store ownership contracts. |

### Remaining PLAN_08 Work

- Rewire `WorkflowViewer.tsx` run/assistant local state to dispatch through `runStore` and `assistantStore` selectors/actions, without moving API/EventSource effects into stores.
- Continue reducing `WorkflowViewer.tsx` shell glue now that task/canvas owner state has moved to the store.
