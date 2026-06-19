# WorkflowViewer Refactor Status

Last updated: 2026-06-20

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

Status: complete

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
- Rewired `WorkflowViewer.tsx` run projections, node live logs, live events, and runtime config to consume `runStore` instead of local React state.
- Rewired `useWorkflowBindings(...)` to store binding lookup state in `runStore.workflowBindings` while keeping binding API calls inside the hook layer.
- Rewired `WorkflowViewer.tsx` assistant input, transcript, proposal, session identity, pending turn, stream events, validation, required actions, GraphOps review, busy flag, selected authoring agent, authoring agents list, and apply undo state to consume `assistantStore`.
- Kept assistant hooks unchanged at the effect boundary by adapting their existing setter callbacks to per-task store actions inside `WorkflowViewer.tsx`.
- `WorkflowViewer.tsx` no longer has local `useState` owner declarations for task/canvas/selection/focus, run projections/logs/events/runtime config, workflow bindings, or assistant session/proposal/review state.

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
| `npm run test -- --run src/stores/runStore.test.ts src/hooks/useWorkflowBindings.test.tsx` | Passed | 2 files, 11 tests passed after binding lookup moved to runStore. |
| `npm run test -- --run src/components/WorkflowViewer.drag.test.tsx` | Passed | 1 file, 101 tests passed after runStore wiring. |
| `npm run test -- --run src/App.test.tsx` | Passed | 1 file, 82 tests passed after runStore wiring. |
| `npm run test -- --run` | Passed | 67 files, 441 tests passed after runStore wiring. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains after runStore wiring. |
| `npm run test -- --run src/stores/assistantStore.test.ts src/hooks/useAssistantSession.test.tsx src/hooks/useAssistantStream.test.tsx src/components/assistant/assistantTranscript.test.ts` | Passed | 4 files, 20 tests passed after assistantStore wiring. |
| `npm run test -- --run src/App.test.tsx -t "Workbench AI assistant generates and applies a canvas-local proposal\|Workbench AI chat completion does not validate previous authoring draft\|Workbench AI assistant resets conversation state when switching tasks\|Workbench AI temporary agent blocks save validate and run after task reload\|Workbench AI temporary agent persists through GraphOps proposal approval"` | Passed | 5 selected assistant/GraphOps integration tests passed after assistantStore wiring. |
| `npm run test -- --run src/components/WorkflowViewer.drag.test.tsx` | Passed | 1 file, 101 tests passed after assistantStore wiring. |
| `npm run test -- --run` | Passed | 67 files, 441 tests passed after assistantStore wiring. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains after assistantStore wiring. |

### Static Gates

- `rg -n "const \[assistantInput|const \[assistantMessages|const \[assistantProposal|const \[authoringAgents|const \[selectedAuthoringAgentId|const \[assistantSessionId|const \[assistantAgentSession|const \[assistantPendingTurn|const \[assistantEvents|const \[assistantTurnReason|const \[assistantSessionStatus|const \[assistantBackendValidation|const \[assistantRequiredActions|const \[assistantGraphOpsReview|const \[assistantBusy|const \[assistantApplyUndo" web/src/components/WorkflowViewer.tsx` reports no matches.
- `rg -n "const \[runsById|const \[runLogsById|const \[runLiveEventsById|const \[runtimeConfig" web/src/components/WorkflowViewer.tsx` reports no matches.
- Remaining `WorkflowViewer.tsx` `useState` instances are local UI/transient controls or nested component state, not global Workbench owner state.

## PLAN_09 Final Cleanup

Status: in progress

### Cleanup Slice Completed

- Removed the compatibility helper export block from `web/src/components/WorkflowViewer.tsx`; the component no longer acts as a test helper barrel.
- Migrated `web/src/components/WorkflowViewer.drag.test.tsx` imports to the real owner modules for canvas, graph projection, edge ops, selection, selected-node, schema-port, and authoring helpers.
- Migrated `web/src/App.test.tsx` imports to the real owner modules for palette ops, assistant transcript projection, live-event helpers, selected-node helpers, canvas projection, selection, graph projection, and the demo canvas fixture.
- Added `web/src/workbench/model/workspaceDemoCanvas.ts` as the owner for the stock research demo canvas fixture and its local schema/edge helpers.
- Moved `nodeRunHasWorkflowInputBinding(...)` and `nodeLogDeltaKeys(...)` into `web/src/workbench/model/selectedNodeModel.ts`.
- Moved `filterLiveEvents(...)` into `web/src/hooks/useWorkbenchLiveStream.ts`, next to the live-event bounding and node-run live-state helpers.
- `web/src/components/WorkflowViewer.tsx` is now 226,439 bytes / 6,010 lines after removing the compatibility export barrel and demo fixture.
- Added `web/src/workbench/model/workflowRuntimeProjection.ts` as the pure owner for reusable workflow-class projection, run-summary/state-snapshot projection, node-run projection keys, legacy workflow graph adaptation, graph normalization, and single-node graph construction.
- `web/src/components/WorkflowViewer.tsx` is now 214,959 bytes / 5,834 lines after moving runtime graph/run projection helpers.
- Moved task localStorage helpers, backend task loading, backend canvas snapshot normalization, and backend task autosave DTO construction into `web/src/hooks/useTaskPersistence.ts`.
- `web/src/components/WorkflowViewer.tsx` is now 211,393 bytes / 5,732 lines after moving task persistence helpers.
- Added `web/src/workbench/model/workbenchViewProjection.ts` as the owner for blueprint panel visibility projection and authoring selection labels.
- `web/src/components/WorkflowViewer.tsx` is now 209,605 bytes / 5,686 lines after moving Workbench view projection helpers.
- Removed the unused legacy `InternalNodeCard` component and its now-unused layout/label imports.
- `web/src/components/WorkflowViewer.tsx` is now 207,411 bytes / 5,618 lines after deleting the dead internal-node card renderer.
- Moved resource detail rendering and the `ResourceTemplate` type into `web/src/components/inspector/ResourceInspector.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 206,136 bytes / 5,581 lines after moving `ResourceInspector`.
- Moved workflow main-input binding evidence notice rendering into `web/src/components/inspector/WorkflowMainInputBindingNotice.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 204,969 bytes / 5,549 lines after moving `WorkflowMainInputBindingNotice`.
- Moved live stdout/stderr log rendering into `web/src/components/inspector/LiveLogBlocks.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 204,594 bytes / 5,535 lines after moving `LiveLogBlocks`.
- Moved reusable port-list rendering into `web/src/components/inspector/PortList.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 204,146 bytes / 5,520 lines after moving `PortList`.
- Moved node evidence path buttons, runtime evidence, and binding evidence rendering into `web/src/components/inspector/NodeEvidencePaths.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 202,210 bytes / 5,455 lines after moving `NodeEvidencePaths`.
- Moved workspace binding dialog rendering and transient select/validate/save UI state into `web/src/components/workbench/WorkflowBindingDialog.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 198,711 bytes / 5,353 lines after moving `WorkflowBindingDialog`.
- Moved selected-node input evidence rendering into `web/src/components/inspector/SelectionInputPane.tsx` and moved recursive structured value rendering into `web/src/components/inspector/StructuredValueView.tsx`.
- Removed the now-dead local `isControlMainAggregate(...)` and `compactValue(...)` helpers from `WorkflowViewer.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 192,743 bytes / 5,170 lines after moving `SelectionInputPane` and `StructuredValueView`.
- Moved selected-node output evidence rendering, final-output artifact parsing, and output field prioritization into `web/src/components/inspector/SelectionOutputPane.tsx`.
- Removed the now-dead local `evidenceActionByLabel(...)`, output artifact parser, output field label, and empty output value helpers from `WorkflowViewer.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 184,753 bytes / 4,935 lines after moving `SelectionOutputPane`.
- Moved reusable schema field card rendering and schema/port/artifact-contract field projection into `web/src/components/inspector/SchemaFieldCards.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 181,359 bytes / 4,841 lines after moving schema field rendering helpers.
- Moved assistant selected-node runtime output tabs, live output view, output schema view, and error view into `web/src/components/inspector/SelectedNodeRuntimePane.tsx`.
- `WorkflowViewer.tsx` now only formats agent event text for that runtime pane instead of owning the pane UI.
- `web/src/components/WorkflowViewer.tsx` is now 178,229 bytes / 4,772 lines after moving `SelectedNodeRuntimePane`.
- Moved the Codex execution mode selector into `web/src/components/inspector/CodexExecutionModeSelector.tsx`, restoring readable UTF-8 Chinese labels and risk notices.
- `web/src/components/WorkflowViewer.tsx` is now 177,128 bytes / 4,743 lines after moving `CodexExecutionModeSelector`.
- Moved node prompt/static input editing into `web/src/components/inspector/NodePromptEditor.tsx`, restoring readable UTF-8 Chinese labels and validation messages.
- Moved `mergeInvocationInput(...)` into `web/src/workbench/model/selectionModel.ts`, next to the prompt/static-input projection helpers it composes.
- `web/src/components/WorkflowViewer.tsx` is now 173,489 bytes / 4,871 lines after moving `NodePromptEditor`.
- Moved invocation identity rendering into `web/src/components/inspector/InvocationIdentityCard.tsx`.
- Moved invocation prompt/static-input JSON editing into `web/src/components/inspector/InvocationInputEditor.tsx`, restoring readable UTF-8 Chinese labels and validation messages.
- `web/src/components/WorkflowViewer.tsx` is now 169,447 bytes / 4,728 lines after moving invocation editor components.
- Moved selected-detail property group rendering into `web/src/components/inspector/PropertyGroups.tsx`, restoring the readable Chinese section label.
- Moved node technical detail disclosure into `web/src/components/inspector/TechnicalDetailsDisclosure.tsx`, including local expand/collapse state and technical evidence JSON blocks.
- `web/src/components/WorkflowViewer.tsx` is now 167,172 bytes / 4,662 lines after moving property and technical detail components.
- Moved node run evidence rendering into `web/src/components/inspector/RunEvidenceCard.tsx`, including evidence facts, data-flow rows, evidence path actions, output summary projection, and live-log excerpt display.
- Removed the corresponding run-evidence-only helper functions from `WorkflowViewer.tsx`; the shell keeps only generic agent-event string helpers still used elsewhere.
- `web/src/components/WorkflowViewer.tsx` is now 159,679 bytes / 4,442 lines after moving `RunEvidenceCard`.
- Moved artifact evidence preview loading/rendering into `web/src/components/inspector/EvidencePreview.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 158,252 bytes / 4,382 lines after moving `EvidencePreview`.
- Moved Agent Session output/status/debug/timeline rendering into `web/src/components/inspector/AgentSessionPanel.tsx`, including publish actions, pending approval actions, artifact path buttons, message summaries, and agent event timeline display.
- Restored readable UTF-8 Chinese labels in the extracted Agent Session panel, replacing the damaged legacy strings that were still embedded in `WorkflowViewer.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 147,634 bytes / 4,078 lines after moving `AgentSessionPanel`.
- Moved right-inspector and node-detail overlay node property composition into `web/src/components/inspector/AgentNodeSettingsPanel.tsx`.
- Restored readable UTF-8 Chinese labels in the extracted node settings/property panels and removed the unused `agentLiveState` prop from the selection properties composition.
- `web/src/components/WorkflowViewer.tsx` is now 129,309 bytes / 3,622 lines after moving `AgentNodeSettingsPanel` and `SelectionPropertiesPane`.
- Added `web/src/workbench/model/agentEventText.ts` as the pure owner for agent event summaries, assistant-message projection, agent-event merge/de-duplication, live output filter labels, transcript entry labels, and runtime agent event text.
- Moved the generic event timeline renderer into `web/src/components/inspector/EventTimeline.tsx`.
- Restored readable UTF-8 Chinese labels for the extracted live output filters and event empty state.
- `web/src/components/WorkflowViewer.tsx` is now 117,217 bytes / 3,263 lines after moving agent event text helpers and `EventTimeline`.
- Moved node-run detail cache keying and merge helpers into `web/src/workbench/model/workflowRuntimeProjection.ts`.
- Deleted unused local canvas/edge helper leftovers from `WorkflowViewer.tsx`: `uniqueEdgeId`, `addEdgeWithControlDependency`, `internalEdgeEndpointToFlowId`, `edgeConnectsRemainingNodes`, `workflowSummaryForRef`, and `isChildWorkflowSummary`.
- `web/src/components/WorkflowViewer.tsx` is now 113,108 bytes / 3,114 lines after moving run-detail merge helpers and deleting dead edge helpers.
- Added `web/src/workbench/model/workflowViewerShell.ts` for remaining shell-only pure helpers: selection keys, drawer titles, node-detail model checks, JSDOM detection, text artifact construction, artifact name parsing, and log truncation.
- Deleted dead local `evidenceIdentityLabel` and `parentPath` helpers from `WorkflowViewer.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 110,294 bytes / 3,013 lines after moving shell helper functions.
- Added `web/src/hooks/useWorkbenchTaskActions.ts` as the owner for Workbench task-level actions: demo loading, external workflow open intent, task switch, task creation, guarded task deletion, and whole-canvas auto layout.
- Removed the corresponding local task action functions and now-dead `resetCanvas(...)` helper from `WorkflowViewer.tsx`.
- Restored readable UTF-8 Chinese user messages for the extracted task action paths.
- `web/src/components/WorkflowViewer.tsx` is now 110,190 bytes / 2,941 lines after moving task actions.
- Added `web/src/hooks/useDataConnectionActions.ts` as the owner for data connection draft actions, data-edge completion, new input-port connection, and data-connect port add/rename/delete actions.
- Removed the corresponding local data connection action functions from `WorkflowViewer.tsx`.
- Restored readable UTF-8 Chinese user messages for the extracted data connection paths.
- `web/src/components/WorkflowViewer.tsx` is now 105,432 bytes / 2,813 lines after moving data connection actions.
- Added `web/src/hooks/useInvocationSettingsActions.ts` as the owner for workflow/internal invocation input, label, forward-main-output, empty-input policy, and Codex execution mode updates.
- Removed the corresponding local invocation settings mutation functions from `WorkflowViewer.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 101,082 bytes / 2,666 lines after moving invocation settings actions.
- Added `web/src/hooks/useOpenedWorkflowCanvas.ts` as the owner for external workflow detail loading projection into canonical graph, workspace canvas, selection, message, and evidence-dock close state.
- Removed direct `graphToWorkspaceCanvas(...)`, `graphFromLegacyWorkflow(...)`, and `normalizeWorkflowGraph(...)` usage from `WorkflowViewer.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 100,162 bytes / 2,651 lines after moving opened-workflow canvas projection.
- Added `web/src/hooks/useEvidenceDockActions.ts` as the owner for artifact evidence opening, large-log truncation, evidence owner metadata, and dock close state.
- Removed local `readEvidence(...)` and `closeEvidenceDock(...)` action ownership from `WorkflowViewer.tsx`.
- Restored readable UTF-8 Chinese default evidence titles in the extracted evidence dock action hook.
- `web/src/components/WorkflowViewer.tsx` is now 99,574 bytes / 2,627 lines after moving evidence dock actions.
- Added `web/src/hooks/useWorkflowRunSubmitActions.ts` as the owner for runner submit, queued run projection, binding-ref submit options, submitted-run polling projection, terminal task status updates, temporary callable blocking, and run-error evidence.
- Removed local `runWorkflowGraph(...)` submission/polling implementation from `WorkflowViewer.tsx`; the shell now only decides whether to run the task, selected workflow, or selected node.
- Restored readable UTF-8 Chinese run submit/error messages in the extracted run submit action hook.
- `web/src/components/WorkflowViewer.tsx` is now 91,939 bytes / 2,483 lines after moving workflow run submit actions.
- Added `web/src/hooks/useWorkflowSaveValidationActions.ts` as the owner for save workflow, confirm save dialog behavior, workflow validation, boundary-transfer validation guards, temporary-resource blocker evidence, and boundary preview snapshot construction.
- Removed local save/validate/temporary-resource guard functions from `WorkflowViewer.tsx`; run submit now reuses the extracted guard callbacks.
- `web/src/components/WorkflowViewer.tsx` is now 88,516 bytes / 2,376 lines after moving workflow save and validation actions.
- Added `web/src/hooks/useSelectedAgentTurnActions.ts` as the owner for selected node agent turn submission, output publishing, pending interaction answers, provider-session guard propagation, and post-action refreshes.
- Removed local selected-agent turn action functions from `WorkflowViewer.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 87,494 bytes / 2,354 lines after moving selected agent turn actions.
- Added `web/src/hooks/useAssistantProposalGenerateActions.ts` as the owner for Workbench assistant turn submission, input validation, provider-session guard propagation, pending-turn state, drawer opening, and submit-failure cleanup.
- Removed local `generateAssistantProposal(...)` from `WorkflowViewer.tsx`.
- `web/src/components/WorkflowViewer.tsx` is now 85,873 bytes / 2,318 lines after moving assistant proposal generation actions.

### Added/Updated Tests

- Extended `web/src/workbench/model/selectedNodeModel.test.ts` with `nodeLogDeltaKeys(...)` normalization and de-duplication coverage.
- Added `web/src/workbench/model/workflowRuntimeProjection.test.ts` for stateless workflow-class projection, legacy workflow conversion, run projection, single-node graph creation, and node-run projection keys.
- Extended `web/src/hooks/useTaskPersistence.test.tsx` with task-store localStorage, backend canvas snapshot normalization, and backend task record loading coverage.
- Added `web/src/workbench/model/workbenchViewProjection.test.ts` for blueprint panel visibility and authoring selection label coverage.
- Added `web/src/components/inspector/ResourceInspector.test.tsx` for workflow and callable resource detail rendering.
- Added `web/src/components/inspector/WorkflowMainInputBindingNotice.test.tsx` for absent, unbound, pending, successful-evidence, and missing-evidence states.
- Added `web/src/components/inspector/LiveLogBlocks.test.tsx` for empty and stdout/stderr rendering states.
- Added `web/src/components/inspector/PortList.test.tsx` for port label and contract metadata rendering.
- Added `web/src/components/inspector/NodeEvidencePaths.test.tsx` for evidence path actions, runtime/binding JSON evidence, artifacts state, and live logs.
- Added `web/src/components/workbench/WorkflowBindingDialog.test.tsx` for current binding rendering, open-folder action, directory selection, validation, and save behavior.
- Added `web/src/components/inspector/SelectionInputPane.test.tsx` for input artifact loading, named-port rendering, control-main aggregate source expansion, text fallback, and empty evidence states.
- Added `web/src/components/inspector/SelectionOutputPane.test.tsx` for live log streams, final JSON output rendering, text fallback, final-output loading, and no-output disabled state.
- Added `web/src/components/inspector/SchemaFieldCards.test.tsx` for card rendering, empty state, JSON schema projection, artifact contract projection, fallback port projection, and schema-field de-duplication.
- Added `web/src/components/inspector/SelectedNodeRuntimePane.test.tsx` for non-node empty state, live output, schema tab, error tab, and tab reset on selected node changes.
- Added `web/src/components/inspector/CodexExecutionModeSelector.test.tsx` for option rendering, normalized mode changes, and high-risk mode notices.
- Added `web/src/components/inspector/NodePromptEditor.test.tsx` for prompt editing, clear/reset behavior, advanced static-input editing, object validation, and node-change reset behavior.
- Extended `web/src/workbench/model/selectionModel.test.ts` with `mergeInvocationInput(...)` coverage for static input preservation and empty legacy prompt-key cleanup.
- Added `web/src/components/inspector/InvocationIdentityCard.test.tsx` for identity field rendering and label editing.
- Added `web/src/components/inspector/InvocationInputEditor.test.tsx` for prompt updates, static JSON edits, object validation, formatting, and reset behavior.
- Added `web/src/components/inspector/PropertyGroups.test.tsx` for grouped property row rendering.
- Added `web/src/components/inspector/TechnicalDetailsDisclosure.test.tsx` for collapsed/expanded technical evidence, live log, runtime mode, and callable-detail rendering.
- Added `web/src/components/inspector/RunEvidenceCard.test.tsx` for empty state, run facts, binding/data-flow rows, evidence action callbacks, output summary, and live-log rendering.
- Added `web/src/components/inspector/EvidencePreview.test.tsx` for empty, loaded artifact, and artifact error rendering.
- Added `web/src/components/inspector/AgentSessionPanel.test.tsx` for no-render states, publishable session rendering, draft publish, pending approval answers, artifact path actions, session messages, timeline summaries, loading, error, and unbound states.
- Added `web/src/components/inspector/AgentNodeSettingsPanel.test.tsx` for node basics editing, template summary rendering, property group fallback, and selected-node Agent Session composition.
- Added `web/src/workbench/model/agentEventText.test.ts` for structured assistant message summaries, session-message projection, agent event de-duplication/sorting, live event text, filter labels, and transcript labels.
- Added `web/src/components/inspector/EventTimeline.test.tsx` for empty timeline rendering and reverse chronological event display.
- Extended `web/src/workbench/model/workflowRuntimeProjection.test.ts` with node-run detail cache key and merge coverage.
- Added `web/src/workbench/model/workflowViewerShell.test.ts` for selection keys, drawer titles, node detail detection, text artifact projection, artifact path names, and large-log truncation.
- Added `web/src/hooks/useWorkbenchTaskActions.test.tsx` for external workflow open intent, task switching cleanup, durable task creation, running-task delete guard, delete fallback task creation, demo loading, and auto-layout graph refresh.
- Added `web/src/hooks/useDataConnectionActions.test.tsx` for data connection draft lifecycle, missing-source guard, data-edge creation, new input-port connection, and port add/rename/delete actions.
- Added `web/src/hooks/useInvocationSettingsActions.test.tsx` for workflow/internal input, label fallback, control-main forwarding, empty-input policy, and Codex execution mode normalization updates.
- Added `web/src/hooks/useOpenedWorkflowCanvas.test.tsx` for external workflow detail projection, loader integration, disabled-load guard, and empty focus-graph selection behavior.
- Added `web/src/hooks/useEvidenceDockActions.test.tsx` for close-state reset, missing-path no-op reads, artifact owner metadata, and large-log truncation coverage.
- Added `web/src/hooks/useWorkflowRunSubmitActions.test.tsx` for runner submit options, queued projection initialization, terminal polling snapshots, boundary-transfer validation failure, and temporary callable blocking.
- Added `web/src/hooks/useWorkflowSaveValidationActions.test.tsx` for save graph options, dialog validation, validation-error evidence, and boundary preview snapshot projection.
- Added `web/src/hooks/useSelectedAgentTurnActions.test.tsx` for selected agent turn submit, output publish, pending interaction answers, and missing-session/run error guards.
- Added `web/src/hooks/useAssistantProposalGenerateActions.test.tsx` for assistant turn submit payloads, cached-session reuse, session reload, blank-input guard, and submit-failure cleanup.
- Existing `web/src/App.test.tsx` and `web/src/components/WorkflowViewer.drag.test.tsx` now validate against the real owner imports instead of `WorkflowViewer.tsx` compatibility exports.

### Validation So Far

Commands were run from `F:\Agent-Capsule-Conductor-v2\web`.

| Command | Result | Notes |
| --- | --- | --- |
| `npx tsc --noEmit` | Passed | Helper-owner migration compiles. |
| `npm run test -- --run src/App.test.tsx src/components/WorkflowViewer.drag.test.tsx src/workbench/model/selectedNodeModel.test.ts` | Passed | 3 files, 192 tests passed. |
| `npm run test -- --run src/workbench/model/workflowRuntimeProjection.test.ts src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 187 tests passed. |
| `npm run test -- --run src/hooks/useTaskPersistence.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 192 tests passed. |
| `npm run test -- --run src/workbench/model/workbenchViewProjection.test.ts src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 186 tests passed. |
| `npm run test -- --run src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 2 files, 183 tests passed after removing unused `InternalNodeCard`. |
| `npm run test -- --run src/components/inspector/ResourceInspector.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 185 tests passed. |
| `npm run test -- --run src/components/inspector/WorkflowMainInputBindingNotice.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 188 tests passed. |
| `npm run test -- --run src/components/inspector/LiveLogBlocks.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 185 tests passed. |
| `npm run test -- --run src/components/inspector/PortList.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 184 tests passed. |
| `npm run test -- --run src/components/inspector/NodeEvidencePaths.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 185 tests passed. |
| `npx tsc --noEmit` | Passed | Workflow binding dialog extraction compiles. |
| `npm run test -- --run src/components/workbench/WorkflowBindingDialog.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 185 tests passed. |
| `npx tsc --noEmit` | Passed | Selection input pane and structured value extraction compile. |
| `npm run test -- --run src/components/inspector/SelectionInputPane.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 186 tests passed. |
| `npx tsc --noEmit` | Passed | Selection output pane extraction compiles. |
| `npm run test -- --run src/components/inspector/SelectionOutputPane.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 186 tests passed. |
| `npx tsc --noEmit` | Passed | Schema field card extraction compiles. |
| `npm run test -- --run src/components/inspector/SchemaFieldCards.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 186 tests passed. |
| `npx tsc --noEmit` | Passed | Selected node runtime pane extraction compiles. |
| `npm run test -- --run src/components/inspector/SelectedNodeRuntimePane.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 187 tests passed. |
| `npx tsc --noEmit` | Passed | Codex execution mode selector extraction compiles. |
| `npm run test -- --run src/components/inspector/CodexExecutionModeSelector.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 185 tests passed. |
| `npm run test -- --run` | Passed | 80 files, 481 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Node prompt editor extraction compiles. |
| `npm run test -- --run src/components/inspector/NodePromptEditor.test.tsx src/workbench/model/selectionModel.test.ts src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 4 files, 195 tests passed. |
| `npx tsc --noEmit` | Passed | Full frontend typecheck passes after Node prompt editor extraction. |
| `npm run test -- --run` | Passed | 81 files, 485 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Invocation editor extraction compiles. |
| `npm run test -- --run src/components/inspector/InvocationIdentityCard.test.tsx src/components/inspector/InvocationInputEditor.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 4 files, 188 tests passed. |
| `npm run test -- --run` | Passed | 83 files, 490 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Property group and technical disclosure extraction compiles. |
| `npm run test -- --run src/components/inspector/PropertyGroups.test.tsx src/components/inspector/TechnicalDetailsDisclosure.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 4 files, 186 tests passed. |
| `npm run test -- --run` | Passed | 85 files, 493 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Run evidence card extraction compiles. |
| `npm run test -- --run src/components/inspector/RunEvidenceCard.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 185 tests passed. |
| `npm run test -- --run` | Passed | 86 files, 495 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Evidence preview extraction compiles. |
| `npm run test -- --run src/components/inspector/EvidencePreview.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 186 tests passed. |
| `npm run test -- --run` | Passed | 87 files, 498 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Agent Session panel extraction compiles. |
| `npm run test -- --run src/components/inspector/AgentSessionPanel.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 187 tests passed. |
| `npm run test -- --run` | Passed | 88 files, 502 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Agent node settings panel extraction compiles. |
| `npm run test -- --run src/components/inspector/AgentNodeSettingsPanel.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 186 tests passed. |
| `npm run test -- --run` | Passed | 89 files, 505 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Agent event text extraction compiles. |
| `npm run test -- --run src/workbench/model/agentEventText.test.ts src/components/inspector/EventTimeline.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 4 files, 190 tests passed. |
| `npm run test -- --run` | Passed | 91 files, 512 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Run-detail merge extraction compiles. |
| `npm run test -- --run src/workbench/model/workflowRuntimeProjection.test.ts src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 188 tests passed. |
| `npm run test -- --run` | Passed | 91 files, 513 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Shell helper extraction compiles. |
| `npm run test -- --run src/workbench/model/workflowViewerShell.test.ts src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 187 tests passed. |
| `npm run test -- --run` | Passed | 92 files, 517 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Workbench task action hook extraction compiles. |
| `npm run test -- --run src/hooks/useWorkbenchTaskActions.test.tsx` | Passed | 1 file, 7 tests passed. |
| `npm run test -- --run src/hooks/useWorkbenchTaskActions.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 190 tests passed. |
| `npm run test -- --run` | Passed | 93 files, 524 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Data connection action hook extraction compiles. |
| `npm run test -- --run src/hooks/useDataConnectionActions.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 188 tests passed. |
| `npm run test -- --run` | Passed | 94 files, 529 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Invocation settings action hook extraction compiles. |
| `npm run test -- --run src/hooks/useInvocationSettingsActions.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 188 tests passed. |
| `npm run test -- --run` | Passed | 95 files, 534 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Opened workflow canvas projection hook compiles. |
| `npm run test -- --run src/hooks/useOpenedWorkflowCanvas.test.tsx src/hooks/useOpenedWorkflowLoader.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 4 files, 190 tests passed. |
| `npm run test -- --run` | Passed | 96 files, 537 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Evidence dock action hook extraction compiles. |
| `npm run test -- --run src/hooks/useEvidenceDockActions.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 186 tests passed. |
| `npm run test -- --run` | Passed | 97 files, 540 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Workflow run submit action hook extraction compiles. |
| `npm run test -- --run src/hooks/useWorkflowRunSubmitActions.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 187 tests passed. |
| `npm run test -- --run` | Passed | 98 files, 544 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Workflow save/validation action hook extraction compiles. |
| `npm run test -- --run src/hooks/useWorkflowSaveValidationActions.test.tsx src/hooks/useWorkflowRunSubmitActions.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 4 files, 191 tests passed. |
| `npm run test -- --run` | Passed | 99 files, 548 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Selected agent turn action hook extraction compiles. |
| `npm run test -- --run src/hooks/useSelectedAgentTurnActions.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 187 tests passed. |
| `npm run test -- --run` | Passed | 100 files, 552 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Assistant proposal generation action hook extraction compiles. |
| `npm run test -- --run src/hooks/useAssistantProposalGenerateActions.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 187 tests passed. |
| `npm run test -- --run` | Passed | 101 files, 556 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Assistant proposal apply/undo/discard action hook extraction compiles. |
| `npm run test -- --run src/hooks/useAssistantProposalApplyActions.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 187 tests passed. |
| `npm run test -- --run` | Passed | 102 files, 560 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Assistant GraphOps persistence action hook extraction compiles. |
| `npm run test -- --run src/hooks/useAssistantGraphOpsPersistenceActions.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 187 tests passed. |
| `npm run test -- --run` | Passed | 103 files, 564 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Workflow run selection action hook extraction compiles. |
| `npm run test -- --run src/hooks/useWorkflowRunSelectionActions.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 189 tests passed. |
| `npm run test -- --run` | Passed | 104 files, 570 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Canvas selection UI action hook extraction compiles. |
| `npm run test -- --run src/hooks/useCanvasSelectionUiActions.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 190 tests passed. |
| `npm run test -- --run` | Passed | 105 files, 577 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Assistant authoring session action hook extraction compiles. |
| `npm run test -- --run src/hooks/useAssistantAuthoringSessionActions.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 190 tests passed. |
| `npm run test -- --run` | Passed | 106 files, 584 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Run projection action hook extraction compiles. |
| `npm run test -- --run src/hooks/useRunProjectionActions.test.tsx src/hooks/useRunStream.test.tsx src/hooks/useSelectedAgentTurnActions.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 4 files, 113 tests passed. |
| `npm run test -- --run` | Passed | 107 files, 589 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Canvas graph state action hook extraction compiles. |
| `npm run test -- --run src/hooks/useCanvasGraphStateActions.test.tsx src/hooks/useWorkflowBindings.test.tsx src/hooks/useWorkbenchTaskActions.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 4 files, 119 tests passed. |
| `npm run test -- --run` | Passed | 108 files, 594 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Run restoration action hook extraction compiles. |
| `npm run test -- --run src/hooks/useRunRestorationActions.test.tsx src/hooks/useRunRestorationLoader.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 3 files, 111 tests passed. |
| `npm run test -- --run` | Passed | 109 files, 599 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Durable task bootstrap action hook extraction compiles. |
| `npm run test -- --run src/hooks/useWorkbenchDurableTaskBootstrapActions.test.tsx src/hooks/useWorkbenchBootstrap.test.tsx src/hooks/useTaskPersistence.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 4 files, 121 tests passed. |
| `npm run test -- --run` | Passed | 110 files, 604 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Assistant task store binding hook extraction compiles. |
| `npm run test -- --run src/hooks/useAssistantTaskStoreBindings.test.tsx src/stores/assistantStore.test.ts src/hooks/useAssistantAuthoringSessionActions.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 4 files, 117 tests passed. |
| `npm run test -- --run` | Passed | 111 files, 608 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Workbench task store binding hook extraction compiles. |
| `npm run test -- --run src/hooks/useWorkbenchTaskStoreBindings.test.tsx src/stores/workbenchStore.types.test.ts src/hooks/useCanvasGraphStateActions.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 4 files, 116 tests passed. |
| `npm run test -- --run` | Passed | 112 files, 612 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Run store binding hook extraction compiles. |
| `npm run test -- --run src/hooks/useRunStoreBindings.test.tsx src/stores/runStore.test.ts src/hooks/useRunProjectionActions.test.tsx src/hooks/useRunStream.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 5 files, 116 tests passed. |
| `npm run test -- --run` | Passed | 113 files, 614 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | Workbench store initialization hook extraction compiles. |
| `npm run test -- --run src/hooks/useWorkbenchStoreInitialization.test.tsx src/hooks/useWorkbenchBootstrap.test.tsx src/hooks/useWorkbenchTaskStoreBindings.test.tsx src/hooks/useAssistantTaskStoreBindings.test.tsx src/hooks/useRunStoreBindings.test.tsx src/components/WorkflowViewer.drag.test.tsx` | Passed | 6 files, 118 tests passed. |
| `npm run test -- --run` | Passed | 114 files, 615 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | WorkflowViewer dock extraction compiles. |
| `npm run test -- --run src/components/workflow-viewer/WorkflowViewerDock.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 3 files, 185 tests passed. |
| `npm run test -- --run` | Passed | 115 files, 617 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | WorkflowViewer node detail overlay extraction compiles. |
| `npm run test -- --run src/components/workflow-viewer/WorkflowViewerNodeDetailOverlay.test.tsx src/components/inspector/NodeDetailOverlay.test.tsx src/components/inspector/SelectionInputPane.test.tsx src/components/inspector/SelectionOutputPane.test.tsx src/components/inspector/AgentNodeSettingsPanel.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 7 files, 195 tests passed. |
| `npm run test -- --run` | Passed | 116 files, 619 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | WorkflowViewer right panel extraction compiles. |
| `npm run test -- --run src/components/workflow-viewer/WorkflowViewerRightPanel.test.tsx src/components/workflow-viewer/WorkflowViewerNodeDetailOverlay.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 4 files, 187 tests passed. |
| `npm run test -- --run` | Passed | 117 files, 621 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | WorkflowViewer main stage extraction compiles. |
| `npm run test -- --run src/components/workflow-viewer/WorkflowViewerMainStage.test.tsx src/components/workflow-viewer/WorkflowViewerRightPanel.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 4 files, 187 tests passed. |
| `npm run test -- --run` | Passed | 118 files, 623 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |
| `npx tsc --noEmit` | Passed | WorkflowViewer selection-state hook extraction compiles. |
| `npm run test -- --run src/components/workflow-viewer/useWorkflowViewerSelectionState.test.tsx src/components/workflow-viewer/WorkflowViewerMainStage.test.tsx src/components/WorkflowViewer.drag.test.tsx src/App.test.tsx` | Passed | 4 files, 187 tests passed. |
| `npm run test -- --run` | Passed | 119 files, 625 tests passed. |
| `npm run build` | Passed | Same expected Vite chunk-size warning remains for the main production JS chunk. |

### Static Gates So Far

- `web/src/components/WorkflowViewer.tsx` no longer contains a bottom-level compatibility `export { ... }` block.
- `web/src/App.test.tsx` and `web/src/components/WorkflowViewer.drag.test.tsx` no longer import test helpers from `WorkflowViewer.tsx`.
- `components/assistant`, `components/authoring`, `components/canvas`, `components/inspector`, `hooks`, `stores`, and `workbench` do not import from `WorkflowViewer.tsx`.
- `workspaceDemoCanvas()` no longer lives in `WorkflowViewer.tsx`.
- `WorkflowViewer.tsx` no longer defines `reusableWorkflowClassGraph`, `workflowRunFromRunSummary`, `workflowRunFromRunStateSnapshot`, `nodeRunProjectionKey`, `normalizeWorkflowGraph`, `graphFromLegacyWorkflow`, `singleNodeWorkflowGraph`, or `findCallableId`.
- `WorkflowViewer.tsx` no longer defines `loadWorkbenchTaskFromBackend`, `persistWorkbenchTaskToBackend`, `canvasFromBackendSnapshot`, `loadTaskStore`, or `saveTaskStore`.
- `WorkflowViewer.tsx` no longer defines `workbenchViewProjection`, `authoringSelectionLabel`, or the local `WorkbenchViewProjection` type.
- `WorkflowViewer.tsx` no longer defines or references the unused legacy `InternalNodeCard` renderer.
- `WorkflowViewer.tsx` no longer defines `ResourceInspector` or the local `ResourceTemplate` type.
- `WorkflowViewer.tsx` no longer defines `WorkflowMainInputBindingNotice` or imports `nodeRunHasWorkflowInputBinding` for UI rendering.
- `WorkflowViewer.tsx` no longer defines `LiveLogBlocks`.
- `WorkflowViewer.tsx` no longer defines `PortList`.
- `WorkflowViewer.tsx` no longer defines `NodeEvidencePaths`.
- `WorkflowViewer.tsx` no longer defines `WorkflowBindingDialog`.
- `WorkflowViewer.tsx` no longer defines `SelectionInputPane` or `StructuredValueView`.
- `WorkflowViewer.tsx` no longer defines the unused `isControlMainAggregate` or `compactValue` helpers.
- `WorkflowViewer.tsx` no longer defines `SelectionOutputPane`, output artifact parser helpers, or `evidenceActionByLabel`.
- `WorkflowViewer.tsx` no longer defines `SchemaFieldCards`, `schemaFieldsFromPorts`, `schemaFieldsFromArtifactContract`, `schemaFieldsFromJsonSchema`, or `dedupeSchemaFields`.
- `WorkflowViewer.tsx` no longer defines `SelectedNodeRuntimePane`, `SelectionLiveOutput`, `NodeOutputSchemaPane`, or `NodeErrorPane`.
- `WorkflowViewer.tsx` no longer defines `CodexExecutionModeSelector`.
- `WorkflowViewer.tsx` no longer defines `NodePromptEditor` or local prompt-input merge logic.
- `WorkflowViewer.tsx` no longer defines `InvocationIdentityCard` or `InvocationInputEditor`.
- `WorkflowViewer.tsx` no longer imports prompt/static input projection helpers from `selectionModel`.
- `WorkflowViewer.tsx` no longer defines `PropertyGroups` or `TechnicalDetailsDisclosure`.
- `WorkflowViewer.tsx` no longer imports `Fragment`, `ChevronDown`, or `ChevronUp`.
- `WorkflowViewer.tsx` no longer defines `RunEvidenceCard`, `EvidenceFact`, `EvidenceAction`, or run-evidence-only binding/output summary helpers.
- `WorkflowViewer.tsx` no longer imports `statusTone` or `latestLogExcerpt`.
- `WorkflowViewer.tsx` no longer defines `EvidencePreview`.
- `WorkflowViewer.tsx` no longer defines `AgentSessionPanel`, `AgentSessionDebugDetails`, `AgentEventTimeline`, or `canPublishAgentOutput`.
- `WorkflowViewer.tsx` no longer imports `FileText`, `RefreshCw`, or `UploadCloud`.
- `WorkflowViewer.tsx` no longer defines `AgentNodeSettings`, `SelectionPropertiesPane`, or `SelectionNodeProperties`.
- `WorkflowViewer.tsx` no longer owns callable template display/provider/skills/thinking-label helpers used only by node settings panels.
- `WorkflowViewer.tsx` no longer imports node-settings-only inspector components such as `DataConnectionsPanel`, `NodePromptEditor`, `RunEvidenceCard`, `TechnicalDetailsDisclosure`, or `WorkflowMainInputBindingNotice`.
- `WorkflowViewer.tsx` no longer defines agent-event text helpers such as `agentEventSummary`, `agentMessagesToAssistantMessages`, `mergeAgentEvents`, `agentEventsLiveText`, or `failedAgentEventsText`.
- `WorkflowViewer.tsx` no longer defines `EventTimeline`.
- `WorkflowViewer.tsx` no longer defines node-run detail merge/cache helpers.
- `WorkflowViewer.tsx` no longer defines unused canvas/edge helper leftovers: `uniqueEdgeId`, `addEdgeWithControlDependency`, `internalEdgeEndpointToFlowId`, `edgeConnectsRemainingNodes`, `workflowSummaryForRef`, or `isChildWorkflowSummary`.
- `WorkflowViewer.tsx` no longer defines shell helper functions such as `selectionKey`, `isJsdomRuntime`, `inspectorDrawerTitle`, `textArtifact`, or `truncateLargeLog`.
- `WorkflowViewer.tsx` no longer imports `workspaceDemoCanvas`, `createEmptyTask`, `nextTaskTitle`, or `DEFAULT_TASK_ID` for task action orchestration.
- `WorkflowViewer.tsx` no longer defines `createDemo`, `openWorkflow`, `switchTask`, `newTask`, `deleteTask`, `autoLayout`, or `resetCanvas`.
- `WorkflowViewer.tsx` no longer imports data-edge command helpers such as `createDataEdgeCommand`, `addPortToDataConnectNode`, `renamePortOnDataConnectNode`, `deletePortFromDataConnectNode`, or `uniqueInputPortIdForNode`.
- `WorkflowViewer.tsx` no longer defines data connection action functions such as `beginDataConnection`, `completeDataConnection`, `completeDataConnectionWithNewInputPort`, `addDataConnectPort`, `renameDataConnectPort`, or `deleteDataConnectPort`.
- `WorkflowViewer.tsx` no longer imports `normalizedCodexExecutionMode` or defines invocation settings mutation functions for input, labels, forward-main-output, empty-input policy, or Codex execution mode.
- `WorkflowViewer.tsx` no longer imports `graphToWorkspaceCanvas`, `graphFromLegacyWorkflow`, `normalizeWorkflowGraph`, or `WorkflowDetail` for opened-workflow loading.
- `WorkflowViewer.tsx` no longer defines `readEvidence(...)` or `closeEvidenceDock(...)`; evidence dock action ownership moved to `useEvidenceDockActions(...)`.
- `WorkflowViewer.tsx` no longer defines `runWorkflowGraph(...)`; runner submit, queued projection, polling snapshot merge, and run-error evidence ownership moved to `useWorkflowRunSubmitActions(...)`.
- `WorkflowViewer.tsx` no longer defines `requestSaveWorkflow(...)`, `confirmSaveWorkflow(...)`, `saveGraph(...)`, `validateGraph(...)`, `currentTemporaryResourceIssue(...)`, `ensureBoundaryTransfersValid(...)`, or `reportTemporaryResourceIssue(...)`.
- `WorkflowViewer.tsx` no longer defines `submitSelectedAgentTurn(...)`, `publishSelectedAgentOutput(...)`, or `answerSelectedAgentInteraction(...)`.
- `WorkflowViewer.tsx` no longer defines `generateAssistantProposal(...)`; Workbench assistant turn submission ownership moved to `useAssistantProposalGenerateActions(...)`.
- `WorkflowViewer.tsx` no longer defines `applyAssistantProposal(...)`, `undoLastAssistantApply(...)`, or `discardAssistantProposal(...)`; assistant proposal apply/undo/discard ownership moved to `useAssistantProposalApplyActions(...)`.
- `WorkflowViewer.tsx` no longer defines `persistTemporaryResourceDraft(...)` or `applyGraphOpsPersistenceReview(...)`; assistant temporary-resource GraphOps persistence ownership moved to `useAssistantGraphOpsPersistenceActions(...)`.
- `WorkflowViewer.tsx` no longer defines `runGraph(...)`, `runSelectedWorkflow(...)`, or `runSelectedNode(...)`; selected run entry-point ownership moved to `useWorkflowRunSelectionActions(...)`.
- `WorkflowViewer.tsx` no longer defines selection UI actions such as `startInspectorResize(...)`, `selectCanvasObject(...)`, `openNodeDetails(...)`, `deleteSelectedCanvasObject(...)`, or `openCallableResourceFromNode(...)`; ownership moved to `useCanvasSelectionUiActions(...)`.
- `WorkflowViewer.tsx` no longer defines assistant authoring session glue such as `resetAssistantConversationState(...)`, `currentAuthoringSnapshot(...)`, `addAssistantSystemMessage(...)`, or `ensureAssistantSession(...)`; ownership moved to `useAssistantAuthoringSessionActions(...)`.
- `WorkflowViewer.tsx` no longer defines run projection callbacks such as `updateRunProjection(...)`, `appendNodeLogDelta(...)`, `appendRunAgentEventToProjection(...)`, `appendRunLiveEvent(...)`, or `refreshRunProjection(...)`; ownership moved to `useRunProjectionActions(...)`.
- `WorkflowViewer.tsx` no longer defines canvas/task/graph sync actions such as `updateCanvas(...)`, `updateCanvasAndGraph(...)`, `handleWorkflowBindingSaved(...)`, or `handleWorkflowBindingFolderOpened(...)`; ownership moved to `useCanvasGraphStateActions(...)`.
- `WorkflowViewer.tsx` no longer defines selected task run restoration callbacks; ownership moved to `useRunRestorationActions(...)`.
- `WorkflowViewer.tsx` no longer defines durable task bootstrap loader/persist/state callbacks; ownership moved to `useWorkbenchDurableTaskBootstrapActions(...)`.
- `WorkflowViewer.tsx` no longer defines assistant store `SetStateAction` facade callbacks; ownership moved to `useAssistantTaskStoreBindings(...)`.
- `WorkflowViewer.tsx` no longer defines workbench store `SetStateAction` facade callbacks for tasks, canvas, selection, or focused workflow; ownership moved to `useWorkbenchTaskStoreBindings(...)`.
- `WorkflowViewer.tsx` no longer directly selects run projections, logs, live events, or runtime config from `runStore`; ownership moved to `useRunStoreBindings(...)`.
- `WorkflowViewer.tsx` no longer imports the assistant, run, or workbench Zustand stores directly; one-shot reset/hydration ownership moved to `useWorkbenchStoreInitialization(...)`.
- `WorkflowViewer.tsx` no longer owns the workflow binding dialog, save workflow dialog, or bottom evidence/assistant dock composition; ownership moved to `WorkflowViewerDock`.
- `WorkflowViewer.tsx` no longer owns node detail overlay pane composition or selected node edit routing; ownership moved to `WorkflowViewerNodeDetailOverlay`.
- `WorkflowViewer.tsx` no longer owns right drawer resource/inspector composition or inspector renderer wiring; ownership moved to `WorkflowViewerRightPanel`.
- `WorkflowViewer.tsx` no longer owns task workspace main-stage composition; ownership for task view switching, overview rendering, canvas rendering, and execution dock wiring moved to `WorkflowViewerMainStage`.
- `WorkflowViewer.tsx` no longer owns selected workflow/port/edge/internal-node lookup, selected detail model enrichment, callable detail lookup, selected agent session binding, or selected agent live-state projection; ownership moved to `useWorkflowViewerSelectionState`.
- `WorkflowViewer.tsx` no longer imports ReactFlow/ReactFlow-node-renderer/DOM connection helper implementation details; the remaining graph-conversion static gate hit is the existing `canvasToWorkflowGraph` source-graph initialization debt.
- `WorkflowViewer.tsx` is now 37,390 bytes / 1,045 lines after selection-state hook extraction.
- `WorkflowViewer.tsx` no longer ends with local helper definitions; the file now ends at the `WorkflowViewer` component close.
