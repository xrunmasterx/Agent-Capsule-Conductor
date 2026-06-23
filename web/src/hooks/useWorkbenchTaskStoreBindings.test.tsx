import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { useWorkbenchStore } from '../stores/workbenchStore';
import { createEmptyTask } from '../workbench/model/taskModel';
import type { CanvasSelection, WorkbenchTask, WorkflowCanvasEdge } from '../types/workbench';
import { useWorkbenchTaskStoreBindings } from './useWorkbenchTaskStoreBindings';

function resetStore(): void {
  act(() => {
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  });
}

function task(taskId: string, title = taskId): WorkbenchTask {
  return createEmptyTask(taskId, title);
}

function controlEdge(id = 'edge_1'): WorkflowCanvasEdge {
  return {
    id,
    kind: 'control',
    source: { workflowId: 'source' },
    target: { workflowId: 'target' },
  };
}

describe('useWorkbenchTaskStoreBindings', () => {
  beforeEach(resetStore);
  afterEach(resetStore);

  test('projects ordered tasks and active task state from the store', () => {
    const tasks = [task('task_a', 'Task A'), task('task_b', 'Task B')];
    act(() => {
      useWorkbenchStore.getState().hydrateTasks(tasks, 'task_b');
    });

    const { result } = renderHook(() => useWorkbenchTaskStoreBindings());

    expect(result.current.activeTaskId).toBe('task_b');
    expect(result.current.taskSummaries.map((item) => item.taskId)).toEqual(['task_a', 'task_b']);
    expect(result.current.selection).toEqual({ type: 'task_canvas', taskId: 'task_b' });
    expect(result.current.focusedWorkflowId).toBeNull();
  });

  test('updates task arrays with value and updater callbacks', () => {
    act(() => {
      useWorkbenchStore.getState().hydrateTasks([task('task_a', 'Task A')], 'task_a');
    });
    const { result } = renderHook(() => useWorkbenchTaskStoreBindings());

    act(() => {
      result.current.setTasks([task('task_b', 'Task B')]);
      result.current.setTasks((current) => [...current, task('task_c', 'Task C')]);
    });

    expect(result.current.taskSummaries.map((item) => item.taskId)).toEqual(['task_b', 'task_c']);
    expect(result.current.activeTaskId).toBe('task_b');
  });

  test('updates and normalizes the active task canvas only', () => {
    act(() => {
      useWorkbenchStore.getState().hydrateTasks([task('task_a', 'Task A'), task('task_b', 'Task B')], 'task_a');
    });
    const { result } = renderHook(() => useWorkbenchTaskStoreBindings());

    act(() => {
      result.current.setCanvas((canvas) => ({
        ...canvas,
        name: 'Task A revised',
        edges: [controlEdge('duplicate'), controlEdge('duplicate')],
      }));
    });

    const state = useWorkbenchStore.getState();
    expect(state.tasksById.task_a.canvas.name).toBe('Task A revised');
    expect(state.tasksById.task_a.canvas.edges).toHaveLength(1);
    expect(state.tasksById.task_b.canvas.name).toBe('Task B');
    expect(state.canvasRevisionsByTaskId.task_a).toBe(1);
    expect(state.canvasRevisionsByTaskId.task_b).toBe(0);
  });

  test('keeps task summaries stable when inactive canvas payload changes without summary fields', () => {
    const tasks = [task('task_a', 'Task A'), task('task_b', 'Task B')];
    act(() => {
      useWorkbenchStore.getState().hydrateTasks(tasks, 'task_a');
    });
    const { result } = renderHook(() => useWorkbenchTaskStoreBindings());
    const initialSummaries = result.current.taskSummaries;
    const initialCurrentTask = result.current.currentTask;

    act(() => {
      useWorkbenchStore.getState().updateCanvas('task_b', (canvas) => ({
        ...canvas,
        edges: [controlEdge('edge_b')],
      }));
    });

    expect(result.current.taskSummaries).toBe(initialSummaries);
    expect(result.current.currentTask).toBe(initialCurrentTask);
  });
});
