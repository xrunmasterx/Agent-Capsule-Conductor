# ACC Workbench P1 State Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Current audit status (2026-06-22)

Status: **partially complete**. Store selectors, canvas revisions, a dedicated selector test file, derived graph coverage, and runtime overlay helpers are present. Remaining blockers are writable graph-reference compatibility and remaining hot-path projection compatibility that is narrower than the original broad `tasks[]`/run-store wording. Do not treat the plan as fully closed until those cleanup gates are either completed or explicitly deferred by an amended plan.

See `docs/superpowers/plans/STATUS.md` for the cross-plan audit summary.

**Goal:** Make the Workbench canvas and run overlay lightweight by replacing broad `tasks[]` and full-run subscriptions with selector-based ownership and derived graph state.

**Architecture:** `workbenchStore` owns durable task/canvas state by task id. `WorkflowGraph` is derived from `canvasRevision` and never written as a second source of truth. Runtime status is passed as small maps to node renderers instead of cloning canvas objects.

**Tech Stack:** React 19, Zustand 5 selectors, ReactFlow, Vitest, TypeScript.

---

## File Structure

- Modify `web/src/stores/workbenchStore.ts`: add selectors/helpers for active task, active canvas, active task metadata, and canvas revision.
- Replace `web/src/hooks/useWorkbenchTaskStoreBindings.ts`: remove legacy `tasks[]` facade from hot paths after migration.
- Modify `web/src/components/workflow-viewer/WorkflowViewerController.tsx`: subscribe only to active canvas/task metadata and selected run slices.
- Remove or narrow `web/src/components/workflow-viewer/useWorkflowViewerGraphState.ts`: replace writable `sourceGraph` with `useMemo(canvasRevision -> canvasToWorkflowGraph(canvas))`.
- Modify `web/src/components/workflow-viewer/runState.ts`: stop cloning canvas for overlays; expose `nodeStatusById` and `workflowStatusById`.
- Modify `web/src/components/canvas/WorkspaceCanvas.tsx`: accept runtime status maps separately from canvas.

## Task 1: Store Selectors

**Files:**
- Modify: `web/src/stores/workbenchStore.ts`
- Test: `web/src/stores/workbenchStore.selectors.test.ts`

- [x] **Step 1: Write selector tests**

```ts
import { describe, expect, test } from 'vitest';
import { selectActiveCanvas, selectActiveTaskMeta } from './workbenchStore';

describe('workbenchStore selectors', () => {
  test('selectActiveCanvas returns only the active task canvas', () => {
    const state = {
      activeTaskId: 'task-a',
      taskOrder: ['task-a', 'task-b'],
      tasksById: {
        'task-a': { taskId: 'task-a', title: 'A', canvas: { id: 'canvas-a', name: 'A', rootWorkflowId: 'root', workflows: [], edges: [] } },
        'task-b': { taskId: 'task-b', title: 'B', canvas: { id: 'canvas-b', name: 'B', rootWorkflowId: 'root', workflows: [], edges: [] } },
      },
    } as Parameters<typeof selectActiveCanvas>[0];

    expect(selectActiveCanvas(state)?.id).toBe('canvas-a');
  });

  test('selectActiveTaskMeta excludes the canvas payload', () => {
    const state = {
      activeTaskId: 'task-a',
      taskOrder: ['task-a'],
      tasksById: {
        'task-a': { taskId: 'task-a', title: 'A', status: 'not_run', activeRunId: 'run-a', canvas: { id: 'canvas-a', name: 'A', rootWorkflowId: 'root', workflows: [], edges: [] } },
      },
    } as Parameters<typeof selectActiveTaskMeta>[0];

    expect(selectActiveTaskMeta(state)).toEqual({ taskId: 'task-a', title: 'A', status: 'not_run', activeRunId: 'run-a', latestRunId: undefined, savedWorkflowRef: undefined });
  });
});
```

- [x] **Step 2: Run selector tests**

Run: `npm --prefix web run test -- src/stores/workbenchStore.selectors.test.ts --run`

Expected: pass.

- [x] **Step 3: Implement selectors**

```ts
export function selectActiveCanvas(state: WorkbenchStoreState): WorkspaceCanvasModel | null {
  const task = state.activeTaskId ? state.tasksById[state.activeTaskId] : null;
  return task?.canvas || null;
}

export function selectActiveTaskMeta(state: WorkbenchStoreState): ActiveTaskMeta | null {
  const task = state.activeTaskId ? state.tasksById[state.activeTaskId] : null;
  if (!task) {
    return null;
  }
  return {
    taskId: task.taskId,
    title: task.title,
    status: task.status,
    activeRunId: task.activeRunId,
    latestRunId: task.latestRunId,
    savedWorkflowRef: task.savedWorkflowRef,
  };
}
```

- [x] **Step 4: Run selector tests**

Run: `npm --prefix web run test -- src/stores/workbenchStore.selectors.test.ts --run`

Expected: pass.

## Task 2: Derived Graph State

**Files:**
- Modify: `web/src/components/workflow-viewer/useWorkflowViewerGraphState.ts`
- Modify: `web/src/hooks/useCanvasGraphStateActions.ts`
- Test: `web/src/components/workflow-viewer/useWorkflowViewerGraphState.test.tsx`

- [x] **Step 1: Write derived graph test**

```tsx
import { renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useWorkflowViewerGraphState } from './useWorkflowViewerGraphState';

describe('useWorkflowViewerGraphState', () => {
  test('derives graph from canvas revision without exposing a graph setter', () => {
    const canvas = { id: 'canvas-a', name: 'A', rootWorkflowId: 'root', workflows: [], edges: [] };
    const { result, rerender } = renderHook(({ revision }) => useWorkflowViewerGraphState(canvas, revision), {
      initialProps: { revision: 1 },
    });

    const firstGraph = result.current.sourceGraph;
    rerender({ revision: 1 });
    expect(result.current.sourceGraph).toBe(firstGraph);
    rerender({ revision: 2 });
    expect(result.current.sourceGraph).not.toBe(firstGraph);
    expect('setSourceGraph' in result.current).toBe(false);
  });
});
```

- [x] **Step 2: Run test**

Run: `cd web; npm run test -- src/components/workflow-viewer/useWorkflowViewerGraphState.test.tsx --run`

Expected: fail because the hook exposes writable graph state.

- [x] **Step 3: Implement revision-derived graph**

Use `useMemo(() => canvasToWorkflowGraph(canvas), [canvas, canvasRevision])` and remove the exposed `setSourceGraph` setter. Writable `graphRef.current` compatibility in action hooks remains intentionally deferred/open and must not be counted as retired by this checked step.

- [x] **Step 4: Run focused tests**

Run: `cd web; npm run test -- src/components/workflow-viewer/useWorkflowViewerGraphState.test.tsx --run`

Expected: pass.

## Task 3: Overlay As Runtime Map

**Files:**
- Modify: `web/src/components/workflow-viewer/runState.ts`
- Modify: `web/src/components/workflow-viewer/WorkflowViewerController.tsx`
- Modify: `web/src/components/canvas/WorkspaceCanvas.tsx`
- Test: `web/src/components/workflow-viewer/runState.test.ts`

- [x] **Step 1: Write overlay test**

```ts
import { describe, expect, test } from 'vitest';
import { overlayStatusForNode } from './runState';

describe('run overlay status maps', () => {
  test('resolves node status without cloning canvas', () => {
    expect(overlayStatusForNode({ nodeStatusById: { node_a: 'running' } }, 'node_a', 'not_run')).toBe('running');
    expect(overlayStatusForNode({ nodeStatusById: {} }, 'node_b', 'not_run')).toBe('not_run');
  });
});
```

- [x] **Step 2: Run test**

Run: `cd web; npm run test -- src/components/workflow-viewer/runState.test.ts --run`

Expected: fail because `overlayStatusForNode` does not exist.

- [x] **Step 3: Implement status-map API**

Add `overlayStatusForNode` and pass `runOverlay.nodeStatusById` to canvas rendering instead of calling `applyRunOverlayToCanvas`.

- [x] **Step 4: Run build-level check**

Run: `cd web; npx tsc --noEmit`

Expected: pass.

## Verification Completed

- `cd web; npm run test -- src/stores/workbenchStore.types.test.ts src/components/workflow-viewer/useWorkflowViewerGraphState.test.tsx src/components/workflow-viewer/runState.test.ts src/components/canvas/flowProjection.test.ts src/hooks/useCanvasGraphStateActions.test.tsx src/hooks/useWorkbenchTaskActions.test.tsx src/hooks/useOpenedWorkflowCanvas.test.tsx src/hooks/useWorkbenchDurableTaskBootstrapActions.test.tsx src/hooks/useWorkflowSaveValidationActions.test.tsx src/hooks/useWorkflowRunSubmitActions.test.tsx src/hooks/useAssistantProposalApplyActions.test.tsx src/hooks/useAssistantGraphOpsPersistenceActions.test.tsx --run`
  - Passed: 12 files, 57 tests.
- `cd web; npx tsc --noEmit`
  - Passed.
- `cd web; npm run test -- --run`
  - Passed: 126 files, 646 tests.
- `cd web; npm run build`
  - Passed with the existing Vite large chunk warning.
