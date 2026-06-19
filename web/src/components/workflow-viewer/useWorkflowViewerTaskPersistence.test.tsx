import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { CallableSummary, WorkflowSummary } from '../../types';
import type {
  AuthoringContextSnapshot,
  WorkbenchTask,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import type { UseTaskPersistenceOptions } from '../../hooks/useTaskPersistence';
import { useWorkflowViewerTaskPersistence } from './useWorkflowViewerTaskPersistence';

const useTaskPersistenceMock = vi.fn();
const persistWorkbenchTaskToBackendMock = vi.fn();

vi.mock('../../hooks/useTaskPersistence', () => ({
  useTaskPersistence: (options: UseTaskPersistenceOptions) => useTaskPersistenceMock(options),
  persistWorkbenchTaskToBackend: (...args: unknown[]) => persistWorkbenchTaskToBackendMock(...args),
}));

function canvas(): WorkspaceCanvasModel {
  return {
    id: 'task_1',
    name: 'Task 1',
    rootWorkflowId: 'workflow_1',
    workflows: [],
    edges: [],
  };
}

function task(canvasModel = canvas()): WorkbenchTask {
  return {
    taskId: 'task_1',
    title: 'Task 1',
    canvas: canvasModel,
    status: 'not_run',
    authoring: { temporaryResources: {} },
  };
}

function snapshot(canvasModel = canvas()): AuthoringContextSnapshot {
  return {
    snapshot_id: 'hash_1',
    task_id: 'task_1',
    target: { kind: 'task_canvas', task_id: 'task_1' },
    canvas: canvasModel,
    canonical_graph: {
      id: 'workflow_1',
      name: 'Workflow 1',
      version: '1.0.0',
      nodes: [],
      edges: [],
    },
    selection: { type: 'workflow', id: 'workflow_1' },
    callable_catalog: [],
    workflow_catalog: [],
  };
}

function latestOptions(): UseTaskPersistenceOptions {
  const options = useTaskPersistenceMock.mock.calls.at(-1)?.[0] as UseTaskPersistenceOptions | undefined;
  if (!options) {
    throw new Error('useTaskPersistence was not called');
  }
  return options;
}

describe('useWorkflowViewerTaskPersistence', () => {
  test('builds durable snapshot publish and backend autosave options', async () => {
    const saveLocalTaskStore = vi.fn();
    const saveWorkbenchTaskCanvas = vi.fn().mockResolvedValue({});
    const currentAuthoringSnapshot = vi.fn(() => snapshot());
    const temporaryResources = {
      temp_agent: {
        draft_id: 'temp_agent',
        kind: 'agent_template' as const,
        status: 'draft' as const,
        agent_draft: {
          id: 'temp_agent',
          name: 'Temp Agent',
          runtime: 'codex',
          default_prompt: 'test',
          input_ports: {},
          output_ports: {},
        },
        referenced_by: [],
      },
    };

    renderHook(() =>
      useWorkflowViewerTaskPersistence({
        durableTasksReady: true,
        activeTaskId: 'task_1',
        tasks: [task()],
        currentTask: task(),
        canvas: canvas(),
        selection: { type: 'workflow', id: 'workflow_1' },
        callables: [] as CallableSummary[],
        workflows: [] as WorkflowSummary[],
        temporaryResources,
        currentAuthoringSnapshot,
        currentAuthoringCanvasHash: 'hash_1',
        saveLocalTaskStore,
        saveWorkbenchTaskCanvas,
      }),
    );

    const options = latestOptions();
    expect(options.snapshotPublishKey).toBe('task_1:hash_1:workflow:workflow_1');
    expect(options.backendPersistKey).toBe('task_1:hash_1');

    await options.publishCurrentSnapshot();
    expect(saveWorkbenchTaskCanvas).toHaveBeenCalledWith(
      'task_1',
      expect.objectContaining({
        canvas_hash: 'hash_1',
        selection: { type: 'workflow', id: 'workflow_1' },
        temporary_resources: temporaryResources,
      }),
    );
  });

  test('strips runtime state before building backend task snapshot and delegates persist', async () => {
    const saveWorkbenchTaskCanvas = vi.fn().mockResolvedValue({});
    const runtimeCanvas = {
      ...canvas(),
      workflows: [
        {
          id: 'workflow_1',
          title: 'Workflow 1',
          directory: 'workflows/workflow_1',
          status: 'success' as const,
          inputPorts: [],
          outputPorts: [],
          internalNodes: [
            {
              id: 'agent_1',
              name: 'Agent 1',
              task: 'agent',
              kind: 'Agent' as const,
              status: 'failed' as const,
            },
          ],
          internalEdges: [],
          position: { x: 0, y: 0 },
          size: { width: 100, height: 100 },
          warnings: [],
        },
      ],
    };

    renderHook(() =>
      useWorkflowViewerTaskPersistence({
        durableTasksReady: true,
        activeTaskId: 'task_1',
        tasks: [task(runtimeCanvas)],
        currentTask: task(runtimeCanvas),
        canvas: runtimeCanvas,
        selection: { type: 'task_canvas', taskId: 'task_1' },
        callables: [] as CallableSummary[],
        workflows: [] as WorkflowSummary[],
        temporaryResources: {},
        currentAuthoringSnapshot: () => snapshot(runtimeCanvas),
        currentAuthoringCanvasHash: 'hash_1',
        saveLocalTaskStore: vi.fn(),
        saveWorkbenchTaskCanvas,
      }),
    );

    const options = latestOptions();
    const snapshotTask = options.buildBackendTaskSnapshot();
    expect(snapshotTask?.canvas.workflows[0].status).toBe('not_run');
    expect(snapshotTask?.canvas.workflows[0].internalNodes[0].status).toBe('not_run');

    await options.persistTaskToBackend(snapshotTask as WorkbenchTask);
    expect(persistWorkbenchTaskToBackendMock).toHaveBeenCalledWith(
      snapshotTask,
      [],
      [],
      saveWorkbenchTaskCanvas,
    );
  });
});
