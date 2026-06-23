import { beforeEach, describe, expect, test } from 'vitest';

import {
  selectActiveCanvas,
  selectActiveCanvasRevision,
  selectActiveTaskMeta,
  useWorkbenchStore,
} from './workbenchStore';
import { createEmptyTask } from '../workbench/model/taskModel';
import type { WorkbenchTask } from '../types/workbench';

function resetStore(): void {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
}

function task(taskId: string, title: string): WorkbenchTask {
  return createEmptyTask(taskId, title);
}

describe('workbenchStore selectors', () => {
  beforeEach(resetStore);

  test('selectActiveCanvas returns only the active task canvas', () => {
    useWorkbenchStore.getState().hydrateTasks([task('task_a', 'Task A'), task('task_b', 'Task B')], 'task_b');

    const state = useWorkbenchStore.getState();

    expect(selectActiveCanvas(state)?.id).toBe('task_b');
  });

  test('selectActiveTaskMeta excludes the canvas payload', () => {
    useWorkbenchStore.getState().hydrateTasks([task('task_a', 'Task A')], 'task_a');

    const meta = selectActiveTaskMeta(useWorkbenchStore.getState());

    expect(meta).toEqual({
      taskId: 'task_a',
      title: 'Task A',
      status: 'not_run',
      activeRunId: undefined,
      latestRunId: undefined,
      savedWorkflowRef: undefined,
    });
    expect(meta).not.toHaveProperty('canvas');
  });

  test('selectActiveCanvasRevision follows the active task only', () => {
    useWorkbenchStore.getState().hydrateTasks([task('task_a', 'Task A'), task('task_b', 'Task B')], 'task_a');
    useWorkbenchStore.getState().updateCanvas('task_b', (canvas) => ({ ...canvas, name: 'Task B revised' }));

    expect(selectActiveCanvasRevision(useWorkbenchStore.getState())).toBe(0);

    useWorkbenchStore.getState().setActiveTaskId('task_b');

    expect(selectActiveCanvasRevision(useWorkbenchStore.getState())).toBe(1);
  });
});
