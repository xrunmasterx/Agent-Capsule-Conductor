import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { WorkbenchTask } from '../types/workbench';
import { useTaskPersistence, type UseTaskPersistenceOptions } from './useTaskPersistence';

function task(taskId = 'task_1'): WorkbenchTask {
  return {
    taskId,
    title: 'Task',
    canvas: {
      id: taskId,
      name: 'Task',
      layout: 'workspace-canvas',
      rootWorkflowId: taskId,
      workflows: [],
      edges: [],
    },
    authoring: { temporaryResources: {} },
    status: 'not_run',
  };
}

function Harness(options: UseTaskPersistenceOptions) {
  useTaskPersistence(options);
  return <output>{options.snapshotPublishKey}</output>;
}

function baseOptions(overrides: Partial<UseTaskPersistenceOptions> = {}): UseTaskPersistenceOptions {
  const currentTask = task();
  return {
    durableTasksReady: true,
    activeTaskId: currentTask.taskId,
    tasks: [currentTask],
    saveLocalTaskStore: vi.fn(),
    snapshotPublishKey: 'snapshot_1',
    publishCurrentSnapshot: vi.fn().mockResolvedValue(undefined),
    backendPersistKey: 'task_1:hash_1',
    buildBackendTaskSnapshot: vi.fn(() => currentTask),
    persistTaskToBackend: vi.fn().mockResolvedValue(undefined),
    snapshotDelayMs: 40,
    backendDelayMs: 70,
    ...overrides,
  };
}

describe('useTaskPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test('does not persist before durable tasks are ready', () => {
    const options = baseOptions({ durableTasksReady: false });

    render(<Harness {...options} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(options.saveLocalTaskStore).not.toHaveBeenCalled();
    expect(options.publishCurrentSnapshot).not.toHaveBeenCalled();
    expect(options.persistTaskToBackend).not.toHaveBeenCalled();
  });

  test('saves the local task store once durable tasks are ready', () => {
    const options = baseOptions();

    render(<Harness {...options} />);

    expect(options.saveLocalTaskStore).toHaveBeenCalledWith({
      version: 1,
      activeTaskId: 'task_1',
      tasks: options.tasks,
    });
  });

  test('debounces current snapshot publishing and only publishes the latest key', () => {
    const firstPublish = vi.fn().mockResolvedValue(undefined);
    const secondPublish = vi.fn().mockResolvedValue(undefined);
    const view = render(<Harness {...baseOptions({ publishCurrentSnapshot: firstPublish })} />);

    view.rerender(
      <Harness
        {...baseOptions({
          snapshotPublishKey: 'snapshot_2',
          publishCurrentSnapshot: secondPublish,
        })}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(39);
    });
    expect(firstPublish).not.toHaveBeenCalled();
    expect(secondPublish).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(firstPublish).not.toHaveBeenCalled();
    expect(secondPublish).toHaveBeenCalledTimes(1);
  });

  test('debounces backend autosave and dedupes the same persisted key', async () => {
    const persistTaskToBackend = vi.fn().mockResolvedValue(undefined);
    const options = baseOptions({ persistTaskToBackend });
    const view = render(<Harness {...options} />);

    act(() => {
      vi.advanceTimersByTime(70);
    });
    expect(persistTaskToBackend).toHaveBeenCalledTimes(1);

    view.rerender(<Harness {...baseOptions({ persistTaskToBackend })} />);
    act(() => {
      vi.advanceTimersByTime(70);
    });
    expect(persistTaskToBackend).toHaveBeenCalledTimes(1);
  });

  test('clears backend dedupe key after autosave failure so a later render can retry', async () => {
    const onBackendAutosaveError = vi.fn();
    const persistTaskToBackend = vi
      .fn()
      .mockRejectedValueOnce(new Error('stale'))
      .mockResolvedValue(undefined);
    const view = render(
      <Harness {...baseOptions({ onBackendAutosaveError, persistTaskToBackend })} />,
    );

    await act(async () => {
      vi.advanceTimersByTime(70);
      await Promise.resolve();
    });
    expect(onBackendAutosaveError).toHaveBeenCalledWith(expect.any(Error));

    view.rerender(
      <Harness
        {...baseOptions({
          backendPersistKey: 'task_1:hash_2',
          onBackendAutosaveError,
          persistTaskToBackend,
        })}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(70);
      await Promise.resolve();
    });
    expect(persistTaskToBackend).toHaveBeenCalledTimes(2);
  });

  test('clears timers on cleanup', () => {
    const publishCurrentSnapshot = vi.fn().mockResolvedValue(undefined);
    const persistTaskToBackend = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <Harness {...baseOptions({ persistTaskToBackend, publishCurrentSnapshot })} />,
    );

    view.unmount();
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(publishCurrentSnapshot).not.toHaveBeenCalled();
    expect(persistTaskToBackend).not.toHaveBeenCalled();
  });
});
