/**
 * Zustand store for workbench / canvas state.
 *
 * Covers: tasks, active task, canvas model, selection, chrome layout,
 * connection mode, edge view mode, and viewport transient state.
 */

import { create } from 'zustand';
import { DEFAULT_TASK_ID, INSPECTOR_DEFAULT_WIDTH } from '../workbench/constants';
import { stripRuntimeStateFromCanvas } from '../workbench/model/canvasRuntimeState';
import { defaultTaskStorePayload } from '../workbench/model/taskModel';
import type {
  BottomDockMode,
  CanvasSelection,
  ConnectionMode,
  EdgeViewMode,
  TaskWorkspaceView,
  WorkbenchChromeState,
  WorkbenchTask,
  WorkbenchTaskStorePayload,
  WorkbenchTaskSummary,
  WorkspaceCanvasModel,
} from '../types/workbench';

export type {
  BottomDockMode,
  CanvasSelection,
  ConnectionMode,
  EdgeViewMode,
  TaskWorkspaceView,
  WorkbenchChromeState,
  WorkbenchTask,
  WorkspaceCanvasModel,
};

type CanvasUpdater = WorkspaceCanvasModel | ((prev: WorkspaceCanvasModel) => WorkspaceCanvasModel);
type TaskUpdater = WorkbenchTask | ((prev: WorkbenchTask) => WorkbenchTask);

export type ActiveTaskMeta = Pick<
  WorkbenchTask,
  'taskId' | 'title' | 'status' | 'activeRunId' | 'latestRunId' | 'savedWorkflowRef'
>;

export interface WorkbenchStoreState {
  // --- task ownership ---
  activeTaskId: string;
  taskOrder: string[];
  tasksById: Record<string, WorkbenchTask>;
  /** Compatibility mirror for legacy consumers; taskOrder is the canonical ordering field. */
  taskIds: string[];
  canvasRevisionsByTaskId: Record<string, number>;
  selectionsByTaskId: Record<string, CanvasSelection>;
  focusedWorkflowIdByTaskId: Record<string, string | null>;

  // --- selection / interaction mode ---
  connectionMode: ConnectionMode;
  edgeViewMode: EdgeViewMode;
  taskWorkspaceView: TaskWorkspaceView;

  // --- chrome layout ---
  chrome: WorkbenchChromeState;

  // --- ui transient ---
  nodeDetailOpen: boolean;
  bottomDockMode: BottomDockMode;

  // --- task actions ---
  hydrateTasks: (tasks: WorkbenchTask[], activeTaskId?: string) => void;
  setTasks: (tasks: WorkbenchTask[], activeTaskId?: string) => void;
  updateTask: (taskId: string, updater: TaskUpdater) => void;
  updateActiveTask: (updater: TaskUpdater) => void;
  upsertTask: (task: WorkbenchTask) => void;
  deleteTask: (taskId: string) => void;
  updateCanvas: (taskId: string, updater: CanvasUpdater) => void;
  setSelection: (taskId: string, selection: CanvasSelection) => void;
  setFocusedWorkflowId: (taskId: string, workflowId: string | null) => void;

  // --- scalar actions ---
  setActiveTaskId: (id: string) => void;
  setTaskIds: (ids: string[]) => void;
  setConnectionMode: (mode: ConnectionMode) => void;
  setEdgeViewMode: (mode: EdgeViewMode) => void;
  setTaskWorkspaceView: (view: TaskWorkspaceView) => void;
  setChrome: (updater: WorkbenchChromeState | ((prev: WorkbenchChromeState) => WorkbenchChromeState)) => void;
  setNodeDetailOpen: (open: boolean) => void;
  setBottomDockMode: (mode: BottomDockMode) => void;
}

type TaskOwnershipState = Pick<
  WorkbenchStoreState,
  | 'activeTaskId'
  | 'taskOrder'
  | 'tasksById'
  | 'taskIds'
  | 'canvasRevisionsByTaskId'
  | 'selectionsByTaskId'
  | 'focusedWorkflowIdByTaskId'
>;

function selectionForTask(taskId: string): CanvasSelection {
  return { type: 'task_canvas', taskId };
}

function taskArrayToMap(tasks: WorkbenchTask[]): Record<string, WorkbenchTask> {
  return Object.fromEntries(tasks.map((task) => [task.taskId, task]));
}

function initialTaskOwnershipState(): TaskOwnershipState {
  const payload = defaultTaskStorePayload();
  return taskOwnershipStateFromTasks(payload.tasks, payload.activeTaskId);
}

function taskOwnershipStateFromTasks(
  tasks: WorkbenchTask[],
  requestedActiveTaskId?: string,
  previous?: Partial<TaskOwnershipState>,
): TaskOwnershipState {
  const fallbackPayload = defaultTaskStorePayload();
  const safeTasks = tasks.length ? tasks : fallbackPayload.tasks;
  const taskOrder = safeTasks.map((task) => task.taskId);
  const tasksById = taskArrayToMap(safeTasks);
  const activeTaskId =
    requestedActiveTaskId && taskOrder.includes(requestedActiveTaskId)
      ? requestedActiveTaskId
      : taskOrder.includes(previous?.activeTaskId || '')
        ? previous?.activeTaskId || taskOrder[0]
        : taskOrder[0];

  const canvasRevisionsByTaskId: Record<string, number> = {};
  const selectionsByTaskId: Record<string, CanvasSelection> = {};
  const focusedWorkflowIdByTaskId: Record<string, string | null> = {};

  taskOrder.forEach((taskId) => {
    const task = tasksById[taskId];
    canvasRevisionsByTaskId[taskId] = previous?.canvasRevisionsByTaskId?.[taskId] ?? 0;
    selectionsByTaskId[taskId] = previous?.selectionsByTaskId?.[taskId] ?? selectionForTask(taskId);
    focusedWorkflowIdByTaskId[taskId] =
      previous?.focusedWorkflowIdByTaskId?.[taskId] ?? task.canvas.focusedWorkflowId ?? null;
  });

  return {
    activeTaskId,
    taskOrder,
    tasksById,
    taskIds: taskOrder,
    canvasRevisionsByTaskId,
    selectionsByTaskId,
    focusedWorkflowIdByTaskId,
  };
}

const initialTaskOwnership = initialTaskOwnershipState();

export const useWorkbenchStore = create<WorkbenchStoreState>((set) => ({
  ...initialTaskOwnership,

  connectionMode: 'control',
  edgeViewMode: 'control',
  taskWorkspaceView: 'blueprint',

  chrome: {
    leftPanel: 'none',
    rightPanel: 'none',
    inspectorWidth: INSPECTOR_DEFAULT_WIDTH,
  },

  nodeDetailOpen: false,
  bottomDockMode: 'evidence',

  // --- task actions ---
  hydrateTasks: (tasks, activeTaskId) =>
    set((state) => taskOwnershipStateFromTasks(tasks, activeTaskId, state)),
  setTasks: (tasks, activeTaskId) =>
    set((state) => taskOwnershipStateFromTasks(tasks, activeTaskId, state)),
  upsertTask: (task) =>
    set((state) => {
      const taskOrder = state.taskOrder.includes(task.taskId)
        ? state.taskOrder
        : [...state.taskOrder, task.taskId];
      return taskOwnershipStateFromTasks(
        taskOrder
          .map((taskId) => (taskId === task.taskId ? task : state.tasksById[taskId]))
          .filter((candidateTask): candidateTask is WorkbenchTask => Boolean(candidateTask)),
        state.activeTaskId,
        state,
      );
    }),
  updateTask: (taskId, updater) =>
    set((state) => {
      const task = state.tasksById[taskId];
      if (!task) {
        return {};
      }
      const nextTask = typeof updater === 'function' ? updater(task) : updater;
      if (nextTask === task) {
        return {};
      }
      const nextCanvas = stripRuntimeStateFromCanvas(nextTask.canvas);
      const canvasChanged = nextCanvas !== task.canvas;
      return {
        tasksById: {
          ...state.tasksById,
          [taskId]: {
            ...nextTask,
            taskId,
            title: nextCanvas.name,
            canvas: nextCanvas,
          },
        },
        ...(canvasChanged
          ? {
              canvasRevisionsByTaskId: {
                ...state.canvasRevisionsByTaskId,
                [taskId]: (state.canvasRevisionsByTaskId[taskId] ?? 0) + 1,
              },
            }
          : {}),
      };
    }),
  updateActiveTask: (updater) =>
    set((state) => {
      const task = state.tasksById[state.activeTaskId];
      if (!task) {
        return {};
      }
      const nextTask = typeof updater === 'function' ? updater(task) : updater;
      if (nextTask === task) {
        return {};
      }
      const nextCanvas = stripRuntimeStateFromCanvas(nextTask.canvas);
      const canvasChanged = nextCanvas !== task.canvas;
      return {
        tasksById: {
          ...state.tasksById,
          [state.activeTaskId]: {
            ...nextTask,
            taskId: state.activeTaskId,
            title: nextCanvas.name,
            canvas: nextCanvas,
          },
        },
        ...(canvasChanged
          ? {
              canvasRevisionsByTaskId: {
                ...state.canvasRevisionsByTaskId,
                [state.activeTaskId]: (state.canvasRevisionsByTaskId[state.activeTaskId] ?? 0) + 1,
              },
            }
          : {}),
      };
    }),
  deleteTask: (taskId) =>
    set((state) => {
      const nextTasks = state.taskOrder
        .filter((candidateTaskId) => candidateTaskId !== taskId)
        .map((candidateTaskId) => state.tasksById[candidateTaskId])
        .filter((candidateTask): candidateTask is WorkbenchTask => Boolean(candidateTask));
      const nextActiveTaskId = state.activeTaskId === taskId ? nextTasks[0]?.taskId : state.activeTaskId;
      return taskOwnershipStateFromTasks(nextTasks, nextActiveTaskId, state);
    }),
  updateCanvas: (taskId, updater) =>
    set((state) => {
      const task = state.tasksById[taskId];
      if (!task) {
        return {};
      }
      const nextCanvas = typeof updater === 'function' ? updater(task.canvas) : updater;
      if (nextCanvas === task.canvas) {
        return {};
      }
      const durableCanvas = stripRuntimeStateFromCanvas(nextCanvas);
      return {
        tasksById: {
          ...state.tasksById,
          [taskId]: { ...task, title: durableCanvas.name, canvas: durableCanvas },
        },
        canvasRevisionsByTaskId: {
          ...state.canvasRevisionsByTaskId,
          [taskId]: (state.canvasRevisionsByTaskId[taskId] ?? 0) + 1,
        },
      };
    }),
  setSelection: (taskId, selection) =>
    set((state) => {
      if (!state.tasksById[taskId]) {
        return {};
      }
      return { selectionsByTaskId: { ...state.selectionsByTaskId, [taskId]: selection } };
    }),
  setFocusedWorkflowId: (taskId, workflowId) =>
    set((state) => {
      if (!state.tasksById[taskId]) {
        return {};
      }
      return { focusedWorkflowIdByTaskId: { ...state.focusedWorkflowIdByTaskId, [taskId]: workflowId } };
    }),

  // --- scalar actions ---
  setActiveTaskId: (id) =>
    set((state) => (state.tasksById[id] ? { activeTaskId: id } : {})),
  setTaskIds: (ids) =>
    set((state) => {
      const taskOrder = ids.filter((id) => Boolean(state.tasksById[id]));
      if (!taskOrder.length) {
        return {};
      }
      return {
        activeTaskId: taskOrder.includes(state.activeTaskId) ? state.activeTaskId : taskOrder[0],
        taskOrder,
        taskIds: taskOrder,
      };
    }),
  setConnectionMode: (mode) => set({ connectionMode: mode }),
  setEdgeViewMode: (mode) => set({ edgeViewMode: mode }),
  setTaskWorkspaceView: (view) => set({ taskWorkspaceView: view }),
  setChrome: (updater) =>
    set((state) => ({
      chrome: typeof updater === 'function' ? updater(state.chrome) : updater,
    })),
  setNodeDetailOpen: (open) => set({ nodeDetailOpen: open }),
  setBottomDockMode: (mode) => set({ bottomDockMode: mode }),
}));

export function selectActiveTaskId(state: WorkbenchStoreState): string {
  return state.activeTaskId;
}

export function selectTaskOrder(state: WorkbenchStoreState): string[] {
  return state.taskOrder;
}

export function selectActiveTask(state: WorkbenchStoreState): WorkbenchTask | undefined {
  return state.tasksById[state.activeTaskId];
}

let cachedTaskSummaryOrder: string[] | null = null;
let cachedTaskSummaryObjects = new Map<string, WorkbenchTaskSummary>();
let cachedTaskSummaryArray: WorkbenchTaskSummary[] = [];

function summaryForTask(task: WorkbenchTask): WorkbenchTaskSummary {
  const previous = cachedTaskSummaryObjects.get(task.taskId);
  if (
    previous &&
    previous.title === task.title &&
    previous.status === task.status &&
    previous.activeRunId === task.activeRunId &&
    previous.latestRunId === task.latestRunId
  ) {
    return previous;
  }
  return {
    taskId: task.taskId,
    title: task.title,
    status: task.status,
    activeRunId: task.activeRunId,
    latestRunId: task.latestRunId,
  };
}

export function selectTaskSummaries(state: WorkbenchStoreState): WorkbenchTaskSummary[] {
  let changed =
    !cachedTaskSummaryOrder ||
    cachedTaskSummaryOrder.length !== state.taskOrder.length ||
    cachedTaskSummaryOrder.some((taskId, index) => taskId !== state.taskOrder[index]);
  const nextObjects = new Map<string, WorkbenchTaskSummary>();
  const nextArray: WorkbenchTaskSummary[] = [];
  state.taskOrder.forEach((taskId, index) => {
    const task = state.tasksById[taskId];
    if (!task) {
      changed = true;
      return;
    }
    const summary = summaryForTask(task);
    nextObjects.set(taskId, summary);
    nextArray.push(summary);
    if (cachedTaskSummaryArray[index] !== summary) {
      changed = true;
    }
  });
  cachedTaskSummaryObjects = nextObjects;
  cachedTaskSummaryOrder = [...state.taskOrder];
  if (!changed) {
    return cachedTaskSummaryArray;
  }
  cachedTaskSummaryArray = nextArray;
  return cachedTaskSummaryArray;
}

export function selectActiveTaskMeta(state: WorkbenchStoreState): ActiveTaskMeta | undefined {
  const task = selectActiveTask(state);
  if (!task) {
    return undefined;
  }
  return {
    taskId: task.taskId,
    title: task.title,
    status: task.status,
    activeRunId: task.activeRunId,
    latestRunId: task.latestRunId,
    savedWorkflowRef: task.savedWorkflowRef,
  };
}

export function selectActiveCanvas(state: WorkbenchStoreState): WorkspaceCanvasModel | undefined {
  return selectActiveTask(state)?.canvas;
}

export function selectActiveSelection(state: WorkbenchStoreState): CanvasSelection {
  return state.selectionsByTaskId[state.activeTaskId] ?? selectionForTask(state.activeTaskId);
}

export function selectCanvasRevision(state: WorkbenchStoreState, taskId: string): number {
  return state.canvasRevisionsByTaskId[taskId] ?? 0;
}

export function selectActiveCanvasRevision(state: WorkbenchStoreState): number {
  return selectCanvasRevision(state, state.activeTaskId);
}

export function selectActiveFocusedWorkflowId(state: WorkbenchStoreState): string | null {
  return state.focusedWorkflowIdByTaskId[state.activeTaskId] || null;
}

export function selectTaskStorePayload(state: WorkbenchStoreState): WorkbenchTaskStorePayload {
  return {
    version: 1 as const,
    activeTaskId: state.activeTaskId,
    tasks: state.taskOrder
      .map((taskId) => state.tasksById[taskId])
      .filter((task): task is WorkbenchTask => Boolean(task)),
  };
}
