import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { useAssistantStore } from '../stores/assistantStore';
import { useRunStore, type RunProjection } from '../stores/runStore';
import { useWorkbenchStore } from '../stores/workbenchStore';
import type { WorkbenchTask, WorkbenchTaskStorePayload } from '../types/workbench';
import { createEmptyTask } from '../workbench/model/taskModel';
import { useWorkbenchStoreInitialization } from './useWorkbenchStoreInitialization';

function resetStores(): void {
  useAssistantStore.setState(useAssistantStore.getInitialState(), true);
  useRunStore.setState(useRunStore.getInitialState(), true);
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
}

function task(taskId: string, title = taskId): WorkbenchTask {
  return createEmptyTask(taskId, title);
}

function run(runId: string): RunProjection {
  return {
    runId,
    taskId: 'stale_task',
    status: 'running',
    scope: 'task',
    targetId: 'root',
    graph: {
      id: 'root',
      name: 'Root',
      version: '2.0',
      nodes: [],
      edges: [],
      control_edges: [],
      data_edges: [],
    },
    runDir: `runs/${runId}`,
    run: null,
    events: [],
    overlay: null,
    pollState: 'polling',
  };
}

function payload(): WorkbenchTaskStorePayload {
  return {
    version: 1,
    activeTaskId: 'task_b',
    tasks: [task('task_a', 'Task A'), task('task_b', 'Task B')],
  };
}

describe('useWorkbenchStoreInitialization', () => {
  beforeEach(resetStores);
  afterEach(resetStores);

  test('resets transient stores and hydrates the initial task store once', () => {
    useAssistantStore.getState().setAuthoringAgents([
      {
        id: 'stale_agent',
        version: '1',
        kind: 'agent_class',
        runtime: 'codex_cli',
        backend: 'codex',
        source_id: 'stale_agent',
        name: 'Stale Agent',
        default_permissions: {},
      },
    ]);
    useRunStore.getState().upsertRun(run('stale_run'));

    const { rerender } = renderHook(
      ({ initialTaskStore }) => useWorkbenchStoreInitialization(initialTaskStore),
      { initialProps: { initialTaskStore: payload() } },
    );

    expect(useAssistantStore.getState().authoringAgents).toEqual([]);
    expect(useRunStore.getState().runsById).toEqual({});
    expect(useWorkbenchStore.getState().activeTaskId).toBe('task_b');
    expect(useWorkbenchStore.getState().taskOrder).toEqual(['task_a', 'task_b']);

    useWorkbenchStore.getState().setActiveTaskId('task_a');
    rerender({ initialTaskStore: payload() });
    expect(useWorkbenchStore.getState().activeTaskId).toBe('task_a');
  });
});
