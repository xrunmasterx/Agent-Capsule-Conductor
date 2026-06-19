import { useCallback } from 'react';

import { api } from '../api';

export type UseWorkbenchTaskDurabilityOptions = {
  durableTasksReady: boolean;
  onDeleteError?: (error: unknown) => void;
};

export type UseWorkbenchTaskDurabilityResult = {
  createDurableTask: (taskId: string, title: string) => void;
  deleteDurableTask: (taskId: string) => void;
};

export function useWorkbenchTaskDurability({
  durableTasksReady,
  onDeleteError,
}: UseWorkbenchTaskDurabilityOptions): UseWorkbenchTaskDurabilityResult {
  const createDurableTask = useCallback(
    (taskId: string, title: string) => {
      if (!durableTasksReady) {
        return;
      }
      void api.createWorkbenchTask({ task_id: taskId, title }).catch(() => {
        // The debounced canvas save can recreate the durable task if this request races.
      });
    },
    [durableTasksReady],
  );

  const deleteDurableTask = useCallback(
    (taskId: string) => {
      if (!durableTasksReady) {
        return;
      }
      void api.deleteWorkbenchTask(taskId).catch((error) => {
        onDeleteError?.(error);
      });
    },
    [durableTasksReady, onDeleteError],
  );

  return {
    createDurableTask,
    deleteDurableTask,
  };
}
