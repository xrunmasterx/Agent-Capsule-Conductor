import { useEffect, useRef } from 'react';

import type { WorkbenchTask, WorkbenchTaskStorePayload } from '../types/workbench';

export type UseTaskPersistenceOptions = {
  durableTasksReady: boolean;
  activeTaskId: string;
  tasks: WorkbenchTask[];
  saveLocalTaskStore: (payload: WorkbenchTaskStorePayload) => void;
  snapshotPublishKey: string;
  publishCurrentSnapshot: () => Promise<void>;
  backendPersistKey: string;
  buildBackendTaskSnapshot: () => WorkbenchTask | null;
  persistTaskToBackend: (task: WorkbenchTask) => Promise<void>;
  onSnapshotPublishError?: (error: unknown) => void;
  onBackendAutosaveError?: (error: unknown) => void;
  snapshotDelayMs?: number;
  backendDelayMs?: number;
};

export function useTaskPersistence({
  durableTasksReady,
  activeTaskId,
  tasks,
  saveLocalTaskStore,
  snapshotPublishKey,
  publishCurrentSnapshot,
  backendPersistKey,
  buildBackendTaskSnapshot,
  persistTaskToBackend,
  onSnapshotPublishError,
  onBackendAutosaveError,
  snapshotDelayMs = 400,
  backendDelayMs = 700,
}: UseTaskPersistenceOptions): void {
  const backendTimerRef = useRef<number | null>(null);
  const lastBackendPersistKeyRef = useRef('');

  useEffect(() => {
    if (!durableTasksReady) {
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      void publishCurrentSnapshot().catch((error) => {
        onSnapshotPublishError?.(error);
      });
    }, snapshotDelayMs);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    durableTasksReady,
    onSnapshotPublishError,
    publishCurrentSnapshot,
    snapshotDelayMs,
    snapshotPublishKey,
  ]);

  useEffect(() => {
    if (!durableTasksReady) {
      return;
    }
    saveLocalTaskStore({ version: 1, activeTaskId, tasks });
  }, [activeTaskId, durableTasksReady, saveLocalTaskStore, tasks]);

  useEffect(() => {
    if (!durableTasksReady || !backendPersistKey) {
      return undefined;
    }
    if (lastBackendPersistKeyRef.current === backendPersistKey) {
      return undefined;
    }
    if (backendTimerRef.current) {
      window.clearTimeout(backendTimerRef.current);
    }
    const taskSnapshot = buildBackendTaskSnapshot();
    if (!taskSnapshot) {
      return undefined;
    }
    backendTimerRef.current = window.setTimeout(() => {
      backendTimerRef.current = null;
      lastBackendPersistKeyRef.current = backendPersistKey;
      void persistTaskToBackend(taskSnapshot).catch((error) => {
        lastBackendPersistKeyRef.current = '';
        onBackendAutosaveError?.(error);
      });
    }, backendDelayMs);
    return () => {
      if (backendTimerRef.current) {
        window.clearTimeout(backendTimerRef.current);
        backendTimerRef.current = null;
      }
    };
  }, [
    backendDelayMs,
    backendPersistKey,
    buildBackendTaskSnapshot,
    durableTasksReady,
    onBackendAutosaveError,
    persistTaskToBackend,
  ]);
}
