import { useCallback } from 'react';

import { api } from '../api';

export type WorkbenchTaskCanvasSavePayload = {
  canvas_hash: string;
  canvas_snapshot: Record<string, unknown>;
  selection?: Record<string, unknown>;
  temporary_resources?: Record<string, unknown>;
  base_canvas_hash?: string | null;
};

export type LoadWorkbenchTaskCanvas = (taskId: string) => Promise<Record<string, unknown>>;

export type SaveWorkbenchTaskCanvas = (
  taskId: string,
  payload: WorkbenchTaskCanvasSavePayload,
) => Promise<Record<string, unknown>>;

export type UseWorkbenchTaskCanvasPersistenceResult = {
  loadWorkbenchTaskCanvas: LoadWorkbenchTaskCanvas;
  saveWorkbenchTaskCanvas: SaveWorkbenchTaskCanvas;
};

export async function loadWorkbenchTaskCanvasSnapshot(taskId: string): Promise<Record<string, unknown>> {
  return api.getWorkbenchTaskCanvas(taskId);
}

export async function saveWorkbenchTaskCanvasSnapshot(
  taskId: string,
  payload: WorkbenchTaskCanvasSavePayload,
): Promise<Record<string, unknown>> {
  return api.putWorkbenchTaskCanvas(taskId, payload);
}

export function useWorkbenchTaskCanvasPersistence(): UseWorkbenchTaskCanvasPersistenceResult {
  const loadWorkbenchTaskCanvas = useCallback<LoadWorkbenchTaskCanvas>(
    (taskId) => loadWorkbenchTaskCanvasSnapshot(taskId),
    [],
  );
  const saveWorkbenchTaskCanvas = useCallback<SaveWorkbenchTaskCanvas>(
    (taskId, payload) => saveWorkbenchTaskCanvasSnapshot(taskId, payload),
    [],
  );

  return {
    loadWorkbenchTaskCanvas,
    saveWorkbenchTaskCanvas,
  };
}
