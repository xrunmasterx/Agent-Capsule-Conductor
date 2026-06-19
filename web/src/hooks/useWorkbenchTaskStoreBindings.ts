import { useCallback, useMemo, type SetStateAction } from 'react';

import { useWorkbenchStore } from '../stores/workbenchStore';
import type {
  BottomDockMode,
  CanvasSelection,
  ConnectionMode,
  EdgeViewMode,
  TaskWorkspaceView,
  WorkbenchChromeState,
  WorkbenchTask,
  WorkspaceCanvasModel,
} from '../types/workbench';
import { normalizeCanvasEdges } from '../workbench/model/canvasEdgeOps';

export type WorkbenchTaskStoreBindings = {
  tasks: WorkbenchTask[];
  activeTaskId: string;
  setActiveTaskId: (id: string) => void;
  connectionMode: ConnectionMode;
  setConnectionMode: (mode: ConnectionMode) => void;
  chrome: WorkbenchChromeState;
  setChrome: (next: SetStateAction<WorkbenchChromeState>) => void;
  edgeViewMode: EdgeViewMode;
  setEdgeViewMode: (mode: EdgeViewMode) => void;
  taskWorkspaceView: TaskWorkspaceView;
  setTaskWorkspaceView: (view: TaskWorkspaceView) => void;
  bottomDockMode: BottomDockMode;
  setBottomDockMode: (mode: BottomDockMode) => void;
  nodeDetailOpen: boolean;
  setNodeDetailOpen: (open: boolean) => void;
  selection: CanvasSelection;
  focusedWorkflowId: string | null;
  setTasks: (next: SetStateAction<WorkbenchTask[]>) => void;
  setCanvas: (next: SetStateAction<WorkspaceCanvasModel>) => void;
  setSelection: (next: SetStateAction<CanvasSelection>) => void;
  setFocusedWorkflowId: (next: SetStateAction<string | null>) => void;
};

function resolveSetState<T>(current: T, next: SetStateAction<T>): T {
  return typeof next === 'function' ? (next as (value: T) => T)(current) : next;
}

function currentTasks(): WorkbenchTask[] {
  const state = useWorkbenchStore.getState();
  return state.taskOrder
    .map((taskId) => state.tasksById[taskId])
    .filter((task): task is WorkbenchTask => Boolean(task));
}

export function useWorkbenchTaskStoreBindings(): WorkbenchTaskStoreBindings {
  const taskOrder = useWorkbenchStore((state) => state.taskOrder);
  const tasksById = useWorkbenchStore((state) => state.tasksById);
  const tasks = useMemo(
    () => taskOrder.map((taskId) => tasksById[taskId]).filter((task): task is WorkbenchTask => Boolean(task)),
    [taskOrder, tasksById],
  );
  const activeTaskId = useWorkbenchStore((state) => state.activeTaskId);
  const setActiveTaskId = useWorkbenchStore((state) => state.setActiveTaskId);
  const setStoreTasks = useWorkbenchStore((state) => state.setTasks);
  const setStoreCanvas = useWorkbenchStore((state) => state.updateCanvas);
  const storeSetSelection = useWorkbenchStore((state) => state.setSelection);
  const storeSetFocusedWorkflowId = useWorkbenchStore((state) => state.setFocusedWorkflowId);
  const connectionMode = useWorkbenchStore((state) => state.connectionMode);
  const setConnectionMode = useWorkbenchStore((state) => state.setConnectionMode);
  const chrome = useWorkbenchStore((state) => state.chrome);
  const setChrome = useWorkbenchStore((state) => state.setChrome);
  const edgeViewMode = useWorkbenchStore((state) => state.edgeViewMode);
  const setEdgeViewMode = useWorkbenchStore((state) => state.setEdgeViewMode);
  const taskWorkspaceView = useWorkbenchStore((state) => state.taskWorkspaceView);
  const setTaskWorkspaceView = useWorkbenchStore((state) => state.setTaskWorkspaceView);
  const bottomDockMode = useWorkbenchStore((state) => state.bottomDockMode);
  const setBottomDockMode = useWorkbenchStore((state) => state.setBottomDockMode);
  const nodeDetailOpen = useWorkbenchStore((state) => state.nodeDetailOpen);
  const setNodeDetailOpen = useWorkbenchStore((state) => state.setNodeDetailOpen);
  const selection = useWorkbenchStore((state) =>
    state.selectionsByTaskId[state.activeTaskId] || { type: 'task_canvas', taskId: state.activeTaskId },
  );
  const focusedWorkflowId = useWorkbenchStore((state) => state.focusedWorkflowIdByTaskId[state.activeTaskId] || null);

  const setTasks = useCallback((next: SetStateAction<WorkbenchTask[]>) => {
    const state = useWorkbenchStore.getState();
    setStoreTasks(resolveSetState(currentTasks(), next), state.activeTaskId);
  }, [setStoreTasks]);

  const setCanvas = useCallback((next: SetStateAction<WorkspaceCanvasModel>) => {
    const state = useWorkbenchStore.getState();
    const task = state.tasksById[state.activeTaskId];
    if (!task) {
      return;
    }
    setStoreCanvas(state.activeTaskId, normalizeCanvasEdges(resolveSetState(task.canvas, next)));
  }, [setStoreCanvas]);

  const setSelection = useCallback((next: SetStateAction<CanvasSelection>) => {
    const state = useWorkbenchStore.getState();
    const currentSelection =
      state.selectionsByTaskId[state.activeTaskId] || { type: 'task_canvas', taskId: state.activeTaskId };
    storeSetSelection(state.activeTaskId, resolveSetState(currentSelection, next));
  }, [storeSetSelection]);

  const setFocusedWorkflowId = useCallback((next: SetStateAction<string | null>) => {
    const state = useWorkbenchStore.getState();
    const currentFocusedWorkflowId = state.focusedWorkflowIdByTaskId[state.activeTaskId] || null;
    storeSetFocusedWorkflowId(state.activeTaskId, resolveSetState(currentFocusedWorkflowId, next));
  }, [storeSetFocusedWorkflowId]);

  return {
    tasks,
    activeTaskId,
    setActiveTaskId,
    connectionMode,
    setConnectionMode,
    chrome,
    setChrome,
    edgeViewMode,
    setEdgeViewMode,
    taskWorkspaceView,
    setTaskWorkspaceView,
    bottomDockMode,
    setBottomDockMode,
    nodeDetailOpen,
    setNodeDetailOpen,
    selection,
    focusedWorkflowId,
    setTasks,
    setCanvas,
    setSelection,
    setFocusedWorkflowId,
  };
}
