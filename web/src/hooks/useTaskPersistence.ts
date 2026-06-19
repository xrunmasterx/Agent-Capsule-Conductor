import { useEffect, useRef } from 'react';

import type { CallableSummary, WorkflowSummary } from '../types';
import {
  authoringBackendCanvasSnapshot,
  authoringSelectionPayload,
} from '../workbench/model/authoringProposal';
import { normalizeCanvasEdges } from '../workbench/model/canvasEdgeOps';
import {
  defaultTaskStorePayload,
  emptyWorkspaceCanvas,
  normalizeWorkbenchAuthoringState,
  taskStorePayloadFromSerialized,
} from '../workbench/model/taskModel';
import { TASK_STORE_KEY } from '../workbench/constants';
import type {
  WorkbenchTask,
  WorkbenchTaskStorePayload,
  WorkflowCanvasEdge,
  WorkflowContainerModel,
  WorkspaceCanvasModel,
} from '../types/workbench';
import { captureAuthoringSnapshot } from '../components/authoring/authoringRuntime';
import { stripRuntimeStateFromCanvas } from '../components/workflow-viewer/runState';
import type { LoadWorkbenchTaskCanvas, SaveWorkbenchTaskCanvas } from './useWorkbenchTaskCanvasPersistence';

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

export async function loadWorkbenchTaskFromBackend(
  taskRecord: Record<string, unknown>,
  loadTaskCanvas: LoadWorkbenchTaskCanvas,
): Promise<WorkbenchTask | null> {
  const taskId = typeof taskRecord.task_id === 'string' ? taskRecord.task_id : '';
  if (!taskId) {
    return null;
  }
  let canvasRecord: Record<string, unknown> | null = null;
  try {
    canvasRecord = await loadTaskCanvas(taskId);
  } catch {
    canvasRecord = null;
  }
  const canvas = canvasFromBackendSnapshot(taskId, taskRecord, canvasRecord);
  if (!canvas) {
    return null;
  }
  return {
    taskId,
    title: typeof taskRecord.title === 'string' ? taskRecord.title : canvas.name,
    canvas,
    authoring: normalizeWorkbenchAuthoringState({
      temporaryResources:
        canvasRecord && isRecord(canvasRecord.temporary_resources)
          ? canvasRecord.temporary_resources
          : {},
    }),
    savedWorkflowRef:
      typeof taskRecord.saved_workflow_ref === 'string' ? taskRecord.saved_workflow_ref : undefined,
    activeRunId: typeof taskRecord.active_run_id === 'string' ? taskRecord.active_run_id : undefined,
    latestRunId: typeof taskRecord.latest_run_id === 'string' ? taskRecord.latest_run_id : undefined,
    status: 'not_run',
  };
}

export function canvasFromBackendSnapshot(
  taskId: string,
  taskRecord: Record<string, unknown>,
  canvasRecord: Record<string, unknown> | null,
): WorkspaceCanvasModel | null {
  const snapshot = canvasRecord?.canvas_snapshot;
  if (!isRecord(snapshot)) {
    return emptyWorkspaceCanvas(
      taskId,
      typeof taskRecord.title === 'string' ? taskRecord.title : 'Untitled task',
    );
  }
  const id = typeof snapshot.id === 'string' ? snapshot.id : taskId;
  const name =
    typeof snapshot.name === 'string'
      ? snapshot.name
      : typeof taskRecord.title === 'string'
        ? taskRecord.title
        : 'Untitled task';
  if (!Array.isArray(snapshot.workflows) || !Array.isArray(snapshot.edges)) {
    return null;
  }
  return normalizeCanvasEdges({
    id,
    name,
    layout: 'workspace-canvas',
    rootWorkflowId: typeof snapshot.rootWorkflowId === 'string' ? snapshot.rootWorkflowId : id,
    workflows: snapshot.workflows as WorkflowContainerModel[],
    edges: snapshot.edges as WorkflowCanvasEdge[],
  });
}

export async function persistWorkbenchTaskToBackend(
  task: WorkbenchTask,
  callables: CallableSummary[],
  workflows: WorkflowSummary[],
  saveTaskCanvas: SaveWorkbenchTaskCanvas,
): Promise<void> {
  const canvas = stripRuntimeStateFromCanvas(task.canvas);
  const snapshot = captureAuthoringSnapshot({
    taskId: task.taskId,
    canvas,
    selection: { type: 'task_canvas', taskId: task.taskId },
    callables,
    workflows,
  });
  await saveTaskCanvas(task.taskId, {
    canvas_hash: snapshot.snapshot_id,
    canvas_snapshot: authoringBackendCanvasSnapshot(snapshot),
    selection: authoringSelectionPayload(snapshot.selection),
    temporary_resources: task.authoring?.temporaryResources || {},
  });
}

export function loadTaskStore(): WorkbenchTaskStorePayload {
  if (typeof window === 'undefined') {
    return defaultTaskStorePayload();
  }
  const stored = window.localStorage.getItem(TASK_STORE_KEY);
  return taskStorePayloadFromSerialized(stored);
}

export function saveTaskStore(payload: WorkbenchTaskStorePayload): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(TASK_STORE_KEY, JSON.stringify(payload));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
