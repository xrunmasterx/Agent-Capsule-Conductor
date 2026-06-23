import { useCallback } from 'react';

import type { CallableSummary, WorkflowSummary } from '../../types';
import type {
  AuthoringContextSnapshot,
  CanvasSelection,
  TemporaryResourceDraft,
  WorkbenchTask,
  WorkbenchTaskStorePayload,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import {
  authoringBackendCanvasSnapshot,
  authoringSelectionPayload,
} from '../../workbench/model/authoringProposal';
import { selectionKey } from '../../workbench/model/workflowViewerShell';
import {
  persistWorkbenchTaskToBackend,
  useTaskPersistence,
} from '../../hooks/useTaskPersistence';
import type { SaveWorkbenchTaskCanvas } from '../../hooks/useWorkbenchTaskCanvasPersistence';
import { stripRuntimeStateFromCanvas } from './runState';

export type WorkflowViewerTaskPersistenceOptions = {
  durableTasksReady: boolean;
  activeTaskId: string;
  tasks?: WorkbenchTask[];
  currentTask?: WorkbenchTask;
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  callables: CallableSummary[];
  workflows: WorkflowSummary[];
  temporaryResources: Record<string, TemporaryResourceDraft>;
  currentAuthoringSnapshot: () => AuthoringContextSnapshot;
  currentAuthoringCanvasHash: string;
  saveLocalTaskStore: (payload: WorkbenchTaskStorePayload) => void;
  saveWorkbenchTaskCanvas: SaveWorkbenchTaskCanvas;
  onBackendAutosaveError?: (error: unknown) => void;
};

export function useWorkflowViewerTaskPersistence({
  durableTasksReady,
  activeTaskId,
  tasks: _tasks,
  currentTask,
  canvas,
  selection,
  callables,
  workflows,
  temporaryResources,
  currentAuthoringSnapshot,
  currentAuthoringCanvasHash,
  saveLocalTaskStore,
  saveWorkbenchTaskCanvas,
  onBackendAutosaveError,
}: WorkflowViewerTaskPersistenceOptions): void {
  const publishCurrentTaskSnapshot = useCallback(async () => {
    const snapshot = currentAuthoringSnapshot();
    await saveWorkbenchTaskCanvas(snapshot.task_id, {
      canvas_hash: snapshot.snapshot_id,
      canvas_snapshot: authoringBackendCanvasSnapshot(snapshot),
      selection: authoringSelectionPayload(snapshot.selection),
      temporary_resources: temporaryResources,
    });
  }, [
    currentAuthoringSnapshot,
    saveWorkbenchTaskCanvas,
    temporaryResources,
  ]);
  const buildBackendTaskSnapshot = useCallback((): WorkbenchTask | null => {
    if (!currentTask) {
      return null;
    }
    return {
      ...currentTask,
      canvas: stripRuntimeStateFromCanvas(canvas),
    };
  }, [canvas, currentTask]);
  const persistBackendTaskSnapshot = useCallback(
    (taskSnapshot: WorkbenchTask) =>
      persistWorkbenchTaskToBackend(taskSnapshot, callables, workflows, saveWorkbenchTaskCanvas),
    [callables, workflows, saveWorkbenchTaskCanvas],
  );

  useTaskPersistence({
    durableTasksReady,
    activeTaskId,
    saveLocalTaskStore,
    snapshotPublishKey: `${activeTaskId}:${currentAuthoringCanvasHash}:${selectionKey(selection)}`,
    publishCurrentSnapshot: publishCurrentTaskSnapshot,
    backendPersistKey: currentTask ? `${activeTaskId}:${currentAuthoringCanvasHash}` : '',
    buildBackendTaskSnapshot,
    persistTaskToBackend: persistBackendTaskSnapshot,
    onBackendAutosaveError,
  });
}
