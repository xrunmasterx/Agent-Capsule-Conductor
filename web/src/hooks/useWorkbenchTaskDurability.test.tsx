import { render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import {
  useWorkbenchTaskDurability,
  type UseWorkbenchTaskDurabilityOptions,
} from './useWorkbenchTaskDurability';

vi.mock('../api', () => ({
  api: {
    createWorkbenchTask: vi.fn(),
    deleteWorkbenchTask: vi.fn(),
  },
}));

let latestActions: ReturnType<typeof useWorkbenchTaskDurability> | null = null;

function Harness(options: UseWorkbenchTaskDurabilityOptions) {
  latestActions = useWorkbenchTaskDurability(options);
  return <output>task-durability</output>;
}

describe('useWorkbenchTaskDurability', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test('does not call the backend before durable tasks are ready', () => {
    render(<Harness durableTasksReady={false} />);

    latestActions?.createDurableTask('task_1', 'Task 1');
    latestActions?.deleteDurableTask('task_1');

    expect(api.createWorkbenchTask).not.toHaveBeenCalled();
    expect(api.deleteWorkbenchTask).not.toHaveBeenCalled();
  });

  test('creates durable task records when ready', () => {
    vi.mocked(api.createWorkbenchTask).mockResolvedValue({ task_id: 'task_1' });
    render(<Harness durableTasksReady />);

    latestActions?.createDurableTask('task_1', 'Task 1');

    expect(api.createWorkbenchTask).toHaveBeenCalledWith({
      task_id: 'task_1',
      title: 'Task 1',
    });
  });

  test('ignores create races because canvas autosave can recreate the task', async () => {
    vi.mocked(api.createWorkbenchTask).mockRejectedValue(new Error('race'));
    render(<Harness durableTasksReady />);

    latestActions?.createDurableTask('task_1', 'Task 1');
    await Promise.resolve();

    expect(api.createWorkbenchTask).toHaveBeenCalledTimes(1);
  });

  test('deletes durable task records and reports delete errors', async () => {
    const onDeleteError = vi.fn();
    vi.mocked(api.deleteWorkbenchTask).mockRejectedValue(new Error('delete failed'));
    render(<Harness durableTasksReady onDeleteError={onDeleteError} />);

    latestActions?.deleteDurableTask('task_1');
    await Promise.resolve();

    expect(api.deleteWorkbenchTask).toHaveBeenCalledWith('task_1');
    expect(onDeleteError).toHaveBeenCalledWith(expect.any(Error));
  });
});
