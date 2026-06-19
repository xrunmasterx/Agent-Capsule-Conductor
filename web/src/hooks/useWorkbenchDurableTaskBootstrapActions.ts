import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { CallableSummary, RuntimeConfig, WorkflowGraph, WorkflowSummary } from '../types';
import type { CanvasSelection, WorkbenchTask, WorkbenchTaskStorePayload, WorkspaceCanvasModel } from '../types/workbench';
import { normalizeCanvasEdges } from '../workbench/model/canvasEdgeOps';
import { canvasToWorkflowGraph } from '../workbench/model/workflowGraphProjection';
import {
  loadWorkbenchTaskFromBackend,
  persistWorkbenchTaskToBackend,
} from './useTaskPersistence';
import type {
  LoadWorkbenchTaskCanvas,
  SaveWorkbenchTaskCanvas,
} from './useWorkbenchTaskCanvasPersistence';
import {
  useWorkbenchBootstrap,
  useWorkbenchBootstrapLoaders,
} from './useWorkbenchBootstrap';

export type UseWorkbenchDurableTaskBootstrapActionsOptions = {
  initialTaskStore: WorkbenchTaskStorePayload;
  callablesRef: MutableRefObject<CallableSummary[]>;
  workflowsRef: MutableRefObject<WorkflowSummary[]>;
  graphRef: MutableRefObject<WorkflowGraph>;
  loadWorkbenchTaskCanvas: LoadWorkbenchTaskCanvas;
  saveWorkbenchTaskCanvas: SaveWorkbenchTaskCanvas;
  setRuntimeConfig: (config: RuntimeConfig | null) => void;
  setTasks: Dispatch<SetStateAction<WorkbenchTask[]>>;
  setActiveTaskId: (taskId: string) => void;
  setCanvas: Dispatch<SetStateAction<WorkspaceCanvasModel>>;
  setSourceGraph: Dispatch<SetStateAction<WorkflowGraph>>;
  setSelection: Dispatch<SetStateAction<CanvasSelection>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setDurableTasksReady: Dispatch<SetStateAction<boolean>>;
};

export function useWorkbenchDurableTaskBootstrapActions({
  initialTaskStore,
  callablesRef,
  workflowsRef,
  graphRef,
  loadWorkbenchTaskCanvas,
  saveWorkbenchTaskCanvas,
  setRuntimeConfig,
  setTasks,
  setActiveTaskId,
  setCanvas,
  setSourceGraph,
  setSelection,
  setMessage,
  setDurableTasksReady,
}: UseWorkbenchDurableTaskBootstrapActionsOptions): void {
  const { loadRuntimeConfig, loadWorkbenchTaskRecords } = useWorkbenchBootstrapLoaders();

  const loadDurableWorkbenchTask = useCallback(
    (taskRecord: Record<string, unknown>) => loadWorkbenchTaskFromBackend(taskRecord, loadWorkbenchTaskCanvas),
    [loadWorkbenchTaskCanvas],
  );

  const persistInitialWorkbenchTask = useCallback(
    (task: WorkbenchTask) =>
      persistWorkbenchTaskToBackend(
        task,
        callablesRef.current,
        workflowsRef.current,
        saveWorkbenchTaskCanvas,
      ),
    [callablesRef, saveWorkbenchTaskCanvas, workflowsRef],
  );

  const handleLoadedDurableTasks = useCallback(
    (loadedTasks: WorkbenchTask[], nextActiveTask: WorkbenchTask) => {
      const nextCanvas = normalizeCanvasEdges(nextActiveTask.canvas);
      setTasks(loadedTasks);
      setActiveTaskId(nextActiveTask.taskId);
      setCanvas(nextCanvas);
      const nextGraph = canvasToWorkflowGraph(nextCanvas);
      graphRef.current = nextGraph;
      setSourceGraph(nextGraph);
      setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
      setMessage('已从本地 runner 加载持久化任务');
    },
    [graphRef, setActiveTaskId, setCanvas, setMessage, setSelection, setSourceGraph, setTasks],
  );

  const handleMigratedInitialTasks = useCallback(() => {
    setMessage('已迁移浏览器任务缓存到本地 runner');
  }, [setMessage]);

  const handleWorkbenchBootstrapError = useCallback(
    (error: unknown) => {
      setMessage(error instanceof Error ? error.message : String(error));
    },
    [setMessage],
  );

  useWorkbenchBootstrap({
    initialTaskStore,
    loadRuntimeConfig,
    loadWorkbenchTaskRecords,
    loadWorkbenchTask: loadDurableWorkbenchTask,
    persistInitialTask: persistInitialWorkbenchTask,
    onRuntimeConfig: setRuntimeConfig,
    onLoadedTasks: handleLoadedDurableTasks,
    onMigratedInitialTasks: handleMigratedInitialTasks,
    onBootstrapError: handleWorkbenchBootstrapError,
    setDurableTasksReady,
  });
}
