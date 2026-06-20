import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  selectActiveCanvas,
  selectActiveSelection,
  selectActiveTask,
  selectActiveTaskMeta,
  selectCanvasRevision,
  useWorkbenchStore,
} from './workbenchStore';
import { DEFAULT_TASK_ID, INSPECTOR_DEFAULT_WIDTH } from '../workbench/constants';
import { createEmptyTask } from '../workbench/model/taskModel';
import type { CanvasSelection, WorkbenchChromeState, WorkbenchTask } from '../types/workbench';

function resetStore(): void {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
}

function task(taskId: string, title: string): WorkbenchTask {
  return createEmptyTask(taskId, title);
}

describe('workbench store shared type defaults', () => {
  beforeEach(resetStore);

  test('initializes task ownership and chrome from shared contracts', () => {
    const state = useWorkbenchStore.getState();
    const chrome: WorkbenchChromeState = state.chrome;

    expect(state.activeTaskId).toBe(DEFAULT_TASK_ID);
    expect(state.taskOrder).toEqual([DEFAULT_TASK_ID]);
    expect(state.taskIds).toEqual([DEFAULT_TASK_ID]);
    expect(state.tasksById[DEFAULT_TASK_ID]?.taskId).toBe(DEFAULT_TASK_ID);
    expect(state.canvasRevisionsByTaskId[DEFAULT_TASK_ID]).toBe(0);
    expect(state.selectionsByTaskId[DEFAULT_TASK_ID]).toEqual({ type: 'task_canvas', taskId: DEFAULT_TASK_ID });
    expect(chrome.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
  });
});

describe('workbench store task ownership', () => {
  beforeEach(resetStore);

  test('hydrates tasks into canonical maps and keeps taskIds as a compatibility mirror', () => {
    const tasks = [task('task_a', 'Task A'), task('task_b', 'Task B')];

    useWorkbenchStore.getState().hydrateTasks(tasks, 'task_b');
    const state = useWorkbenchStore.getState();

    expect(state.activeTaskId).toBe('task_b');
    expect(state.taskOrder).toEqual(['task_a', 'task_b']);
    expect(state.taskIds).toEqual(state.taskOrder);
    expect(selectActiveTask(state)?.taskId).toBe('task_b');
    expect(selectActiveCanvas(state)?.id).toBe('task_b');
  });

  test('updates one task canvas without touching sibling task canvas or revisions', () => {
    const tasks = [task('task_a', 'Task A'), task('task_b', 'Task B')];
    useWorkbenchStore.getState().hydrateTasks(tasks, 'task_a');

    useWorkbenchStore.getState().updateCanvas('task_a', (canvas) => ({ ...canvas, name: 'Task A revised' }));
    const state = useWorkbenchStore.getState();

    expect(state.tasksById.task_a.canvas.name).toBe('Task A revised');
    expect(state.tasksById.task_a.title).toBe('Task A revised');
    expect(state.tasksById.task_b.canvas.name).toBe('Task B');
    expect(selectCanvasRevision(state, 'task_a')).toBe(1);
    expect(selectCanvasRevision(state, 'task_b')).toBe(0);
  });

  test('strips runtime status when storing the durable task canvas', () => {
    const baseTask = task('task_a', 'Task A');
    const tasks = [
      {
        ...baseTask,
        canvas: {
          ...baseTask.canvas,
          workflows: [
            {
              id: 'workflow_1',
              title: 'Workflow 1',
              directory: '',
              status: 'not_run',
              inputPorts: [],
              outputPorts: [],
              internalNodes: [
                {
                  id: 'node_1',
                  name: 'Node 1',
                  task: 'Node 1',
                  kind: 'Agent',
                  status: 'not_run',
                },
              ],
              internalEdges: [],
              position: { x: 0, y: 0 },
              size: { width: 320, height: 180 },
              warnings: [],
            },
          ],
        },
      } as WorkbenchTask,
    ];
    useWorkbenchStore.getState().hydrateTasks(tasks, 'task_a');

    useWorkbenchStore.getState().updateCanvas('task_a', (canvas) => ({
      ...canvas,
      workflows: canvas.workflows.map((workflow) => ({
        ...workflow,
        status: 'success',
        internalNodes: workflow.internalNodes.map((node) => ({ ...node, status: 'failed' })),
      })),
    }));

    const storedCanvas = useWorkbenchStore.getState().tasksById.task_a.canvas;
    expect(storedCanvas.workflows[0].status).toBe('not_run');
    expect(storedCanvas.workflows[0].internalNodes[0].status).toBe('not_run');
  });

  test('does not increment canvas revision for referential no-op canvas updates', () => {
    const tasks = [task('task_a', 'Task A')];
    useWorkbenchStore.getState().hydrateTasks(tasks, 'task_a');
    const currentCanvas = useWorkbenchStore.getState().tasksById.task_a.canvas;

    useWorkbenchStore.getState().updateCanvas('task_a', currentCanvas);

    expect(selectCanvasRevision(useWorkbenchStore.getState(), 'task_a')).toBe(0);
  });

  test('selects active task metadata without exposing the canvas payload', () => {
    const tasks = [task('task_a', 'Task A'), task('task_b', 'Task B')];
    useWorkbenchStore.getState().hydrateTasks(tasks, 'task_b');
    const state = useWorkbenchStore.getState();

    expect(selectActiveTaskMeta(state)).toEqual({
      taskId: 'task_b',
      title: 'Task B',
      status: 'not_run',
      activeRunId: undefined,
      latestRunId: undefined,
      savedWorkflowRef: undefined,
    });
    expect(selectActiveTaskMeta(state)).not.toHaveProperty('canvas');
  });

  test('keeps selection and focused workflow isolated per task', () => {
    const tasks = [task('task_a', 'Task A'), task('task_b', 'Task B')];
    const workflowSelection: CanvasSelection = { type: 'workflow', id: 'workflow_a' };
    const internalSelection: CanvasSelection = { type: 'internal', workflowId: 'workflow_b', nodeId: 'node_b' };
    useWorkbenchStore.getState().hydrateTasks(tasks, 'task_a');

    useWorkbenchStore.getState().setSelection('task_a', workflowSelection);
    useWorkbenchStore.getState().setFocusedWorkflowId('task_a', 'workflow_a');
    useWorkbenchStore.getState().setSelection('task_b', internalSelection);
    useWorkbenchStore.getState().setFocusedWorkflowId('task_b', 'workflow_b');

    useWorkbenchStore.getState().setActiveTaskId('task_b');
    let state = useWorkbenchStore.getState();
    expect(selectActiveSelection(state)).toEqual(internalSelection);
    expect(state.focusedWorkflowIdByTaskId.task_b).toBe('workflow_b');

    useWorkbenchStore.getState().setActiveTaskId('task_a');
    state = useWorkbenchStore.getState();
    expect(selectActiveSelection(state)).toEqual(workflowSelection);
    expect(state.focusedWorkflowIdByTaskId.task_a).toBe('workflow_a');
  });

  test('deletes an active task with deterministic fallback and cleans per-task maps', () => {
    const tasks = [task('task_a', 'Task A'), task('task_b', 'Task B')];
    useWorkbenchStore.getState().hydrateTasks(tasks, 'task_b');
    useWorkbenchStore.getState().setSelection('task_b', { type: 'workflow', id: 'workflow_b' });
    useWorkbenchStore.getState().setFocusedWorkflowId('task_b', 'workflow_b');

    useWorkbenchStore.getState().deleteTask('task_b');
    const state = useWorkbenchStore.getState();

    expect(state.activeTaskId).toBe('task_a');
    expect(state.taskOrder).toEqual(['task_a']);
    expect(state.taskIds).toEqual(['task_a']);
    expect(state.tasksById.task_b).toBeUndefined();
    expect(state.selectionsByTaskId.task_b).toBeUndefined();
    expect(state.focusedWorkflowIdByTaskId.task_b).toBeUndefined();
  });

  test('does not expose API, ReactFlow, or source graph ownership from the store', () => {
    const source = readFileSync(join(process.cwd(), 'src/stores/workbenchStore.ts'), 'utf8');

    expect(source).not.toContain('sourceGraph');
    expect(source).not.toContain('setSourceGraph');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('@xyflow/react');
    expect(source).not.toContain(['components', 'WorkflowViewer'].join('/'));
  });
});
