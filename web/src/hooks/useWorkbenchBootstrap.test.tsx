import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import type { RuntimeConfig } from '../types';
import type { WorkbenchTask, WorkbenchTaskStorePayload } from '../types/workbench';
import {
  useWorkbenchBootstrap,
  useWorkbenchBootstrapLoaders,
  type UseWorkbenchBootstrapOptions,
} from './useWorkbenchBootstrap';

vi.mock('../api', () => ({
  api: {
    runtimeConfig: vi.fn(),
    workbenchTasks: vi.fn(),
  },
}));

function task(taskId: string): WorkbenchTask {
  return {
    taskId,
    title: taskId,
    canvas: {
      id: taskId,
      name: taskId,
      layout: 'workspace-canvas',
      rootWorkflowId: taskId,
      workflows: [],
      edges: [],
    },
    authoring: { temporaryResources: {} },
    status: 'not_run',
  };
}

function initialStore(): WorkbenchTaskStorePayload {
  return {
    version: 1,
    activeTaskId: 'task_local',
    tasks: [task('task_local')],
  };
}

function runtimeConfig(): RuntimeConfig {
  return {
    run_mode: 'hermetic',
    external_agent_execution_enabled: false,
    real_external_agents_enabled: false,
  };
}

function baseOptions(overrides: Partial<UseWorkbenchBootstrapOptions> = {}): UseWorkbenchBootstrapOptions {
  return {
    initialTaskStore: initialStore(),
    loadRuntimeConfig: vi.fn().mockResolvedValue(runtimeConfig()),
    loadWorkbenchTaskRecords: vi.fn().mockResolvedValue({ tasks: [] }),
    loadWorkbenchTask: vi.fn().mockResolvedValue(null),
    persistInitialTask: vi.fn().mockResolvedValue(undefined),
    onRuntimeConfig: vi.fn(),
    onLoadedTasks: vi.fn(),
    onMigratedInitialTasks: vi.fn(),
    onBootstrapError: vi.fn(),
    setDurableTasksReady: vi.fn(),
    ...overrides,
  };
}

function Harness(options: UseWorkbenchBootstrapOptions) {
  useWorkbenchBootstrap(options);
  return <output>bootstrap</output>;
}

let latestLoaders: ReturnType<typeof useWorkbenchBootstrapLoaders> | null = null;

function LoaderHarness() {
  latestLoaders = useWorkbenchBootstrapLoaders();
  return <output>bootstrap-loaders</output>;
}

describe('useWorkbenchBootstrap', () => {
  afterEach(() => {
    latestLoaders = null;
    vi.clearAllMocks();
  });

  test('provides API-backed bootstrap loaders for runtime config and durable task records', async () => {
    vi.mocked(api.runtimeConfig).mockResolvedValue(runtimeConfig());
    vi.mocked(api.workbenchTasks).mockResolvedValue({ tasks: [{ task_id: 'task_1' }] });

    render(<LoaderHarness />);

    await expect(latestLoaders?.loadRuntimeConfig()).resolves.toEqual(runtimeConfig());
    await expect(latestLoaders?.loadWorkbenchTaskRecords()).resolves.toEqual({
      tasks: [{ task_id: 'task_1' }],
    });
    expect(api.runtimeConfig).toHaveBeenCalledTimes(1);
    expect(api.workbenchTasks).toHaveBeenCalledTimes(1);
  });

  test('loads runtime config and migrates initial local tasks when backend has no tasks', async () => {
    const options = baseOptions();

    render(<Harness {...options} />);

    await waitFor(() => expect(options.onRuntimeConfig).toHaveBeenCalledWith(runtimeConfig()));
    await waitFor(() => expect(options.persistInitialTask).toHaveBeenCalledWith(options.initialTaskStore.tasks[0]));
    expect(options.onMigratedInitialTasks).toHaveBeenCalledTimes(1);
    expect(options.setDurableTasksReady).toHaveBeenCalledWith(true);
    expect(options.onLoadedTasks).not.toHaveBeenCalled();
  });

  test('returns null runtime config on load failure without failing durable task bootstrap', async () => {
    const options = baseOptions({
      loadRuntimeConfig: vi.fn().mockRejectedValue(new Error('config failed')),
    });

    render(<Harness {...options} />);

    await waitFor(() => expect(options.onRuntimeConfig).toHaveBeenCalledWith(null));
    await waitFor(() => expect(options.setDurableTasksReady).toHaveBeenCalledWith(true));
  });

  test('loads durable backend tasks and selects the stored active task when present', async () => {
    const loadedA = task('task_a');
    const loadedB = task('task_b');
    const options = baseOptions({
      initialTaskStore: { version: 1, activeTaskId: 'task_b', tasks: [task('task_local')] },
      loadWorkbenchTaskRecords: vi.fn().mockResolvedValue({
        tasks: [{ task_id: 'task_a' }, { task_id: 'task_b' }],
      }),
      loadWorkbenchTask: vi
        .fn()
        .mockResolvedValueOnce(loadedA)
        .mockResolvedValueOnce(loadedB),
    });

    render(<Harness {...options} />);

    await waitFor(() => expect(options.onLoadedTasks).toHaveBeenCalledWith([loadedA, loadedB], loadedB));
    expect(options.persistInitialTask).not.toHaveBeenCalled();
    expect(options.setDurableTasksReady).toHaveBeenCalledWith(true);
  });

  test('reports durable bootstrap errors and still marks durable tasks ready', async () => {
    const error = new Error('tasks failed');
    const options = baseOptions({
      loadWorkbenchTaskRecords: vi.fn().mockRejectedValue(error),
    });

    render(<Harness {...options} />);

    await waitFor(() => expect(options.onBootstrapError).toHaveBeenCalledWith(error));
    expect(options.setDurableTasksReady).toHaveBeenCalledWith(true);
  });

  test('does not call durable task callbacks after cleanup', async () => {
    let resolveTasks: (value: { tasks: [] }) => void = () => undefined;
    const options = baseOptions({
      loadWorkbenchTaskRecords: vi.fn(
        () => new Promise<{ tasks: [] }>((resolve) => {
          resolveTasks = resolve;
        }),
      ),
    });
    const view = render(<Harness {...options} />);

    view.unmount();
    resolveTasks({ tasks: [] });

    await Promise.resolve();
    expect(options.onMigratedInitialTasks).not.toHaveBeenCalled();
    expect(options.setDurableTasksReady).not.toHaveBeenCalled();
  });
});
