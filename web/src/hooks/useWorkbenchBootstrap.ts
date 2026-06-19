import { useEffect, useRef } from 'react';

import type { RuntimeConfig } from '../types';
import type { WorkbenchTask, WorkbenchTaskStorePayload } from '../types/workbench';

export type WorkbenchTaskRecord = Record<string, unknown>;

export type UseWorkbenchBootstrapOptions = {
  initialTaskStore: WorkbenchTaskStorePayload;
  loadRuntimeConfig: () => Promise<RuntimeConfig>;
  loadWorkbenchTaskRecords: () => Promise<{ tasks: WorkbenchTaskRecord[] }>;
  loadWorkbenchTask: (taskRecord: WorkbenchTaskRecord) => Promise<WorkbenchTask | null>;
  persistInitialTask: (task: WorkbenchTask) => Promise<void>;
  onRuntimeConfig: (config: RuntimeConfig | null) => void;
  onLoadedTasks: (tasks: WorkbenchTask[], activeTask: WorkbenchTask) => void;
  onMigratedInitialTasks: () => void;
  onBootstrapError: (error: unknown) => void;
  setDurableTasksReady: (ready: boolean) => void;
};

export function useWorkbenchBootstrap({
  initialTaskStore,
  loadRuntimeConfig,
  loadWorkbenchTaskRecords,
  loadWorkbenchTask,
  persistInitialTask,
  onRuntimeConfig,
  onLoadedTasks,
  onMigratedInitialTasks,
  onBootstrapError,
  setDurableTasksReady,
}: UseWorkbenchBootstrapOptions): void {
  const durableBootstrapStartedRef = useRef(false);

  useEffect(() => {
    let ignore = false;
    loadRuntimeConfig()
      .then((config) => {
        if (!ignore) {
          onRuntimeConfig(config);
        }
      })
      .catch(() => {
        if (!ignore) {
          onRuntimeConfig(null);
        }
      });
    return () => {
      ignore = true;
    };
  }, [loadRuntimeConfig, onRuntimeConfig]);

  useEffect(() => {
    if (durableBootstrapStartedRef.current) {
      return undefined;
    }
    durableBootstrapStartedRef.current = true;
    let cancelled = false;

    async function bootstrapDurableTasks() {
      try {
        const response = await loadWorkbenchTaskRecords();
        if (cancelled) {
          return;
        }
        if (response.tasks.length > 0) {
          const loadedTasks = (
            await Promise.all(response.tasks.map((taskRecord) => loadWorkbenchTask(taskRecord)))
          ).filter((task): task is WorkbenchTask => Boolean(task));
          if (cancelled || loadedTasks.length === 0) {
            return;
          }
          const activeTask =
            loadedTasks.find((task) => task.taskId === initialTaskStore.activeTaskId) ||
            loadedTasks[0];
          onLoadedTasks(loadedTasks, activeTask);
          return;
        }
        await Promise.all(initialTaskStore.tasks.map((task) => persistInitialTask(task)));
        if (!cancelled) {
          onMigratedInitialTasks();
        }
      } catch (error) {
        if (!cancelled) {
          onBootstrapError(error);
        }
      } finally {
        if (!cancelled) {
          setDurableTasksReady(true);
        }
      }
    }

    void bootstrapDurableTasks();
    return () => {
      cancelled = true;
      durableBootstrapStartedRef.current = false;
    };
  }, [
    initialTaskStore,
    loadWorkbenchTask,
    loadWorkbenchTaskRecords,
    onBootstrapError,
    onLoadedTasks,
    onMigratedInitialTasks,
    persistInitialTask,
    setDurableTasksReady,
  ]);
}
