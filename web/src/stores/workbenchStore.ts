/**
 * Zustand store for workbench / canvas state.
 *
 * Covers: tasks, active task, canvas model, selection, chrome layout,
 * connection mode, edge view mode, and viewport transient state.
 */

import { create } from 'zustand';
import { DEFAULT_TASK_ID, INSPECTOR_DEFAULT_WIDTH } from '../workbench/constants';
import type {
  BottomDockMode,
  ConnectionMode,
  EdgeViewMode,
  TaskWorkspaceView,
  WorkbenchChromeState,
} from '../types/workbench';

export type {
  BottomDockMode,
  ConnectionMode,
  EdgeViewMode,
  TaskWorkspaceView,
  WorkbenchChromeState,
};

/**
 * Minimal shape — the full WorkspaceCanvasModel & WorkbenchTask types are
 * still owned by WorkflowViewer; this store only manages the *identity* and
 * scalar flags so that deeply-nested children can read them without prop
 * drilling.  Canvas mutations continue to live in WorkflowViewer until the
 * full migration (step 13).
 */
export interface WorkbenchStoreState {
  // --- task identity ---
  activeTaskId: string;
  taskIds: string[];

  // --- selection / interaction mode ---
  connectionMode: ConnectionMode;
  edgeViewMode: EdgeViewMode;
  taskWorkspaceView: TaskWorkspaceView;

  // --- chrome layout ---
  chrome: WorkbenchChromeState;

  // --- ui transient ---
  nodeDetailOpen: boolean;
  bottomDockMode: BottomDockMode;

  // --- actions ---
  setActiveTaskId: (id: string) => void;
  setTaskIds: (ids: string[]) => void;
  setConnectionMode: (mode: ConnectionMode) => void;
  setEdgeViewMode: (mode: EdgeViewMode) => void;
  setTaskWorkspaceView: (view: TaskWorkspaceView) => void;
  setChrome: (updater: WorkbenchChromeState | ((prev: WorkbenchChromeState) => WorkbenchChromeState)) => void;
  setNodeDetailOpen: (open: boolean) => void;
  setBottomDockMode: (mode: BottomDockMode) => void;
}

export const useWorkbenchStore = create<WorkbenchStoreState>((set) => ({
  activeTaskId: DEFAULT_TASK_ID,
  taskIds: [DEFAULT_TASK_ID],

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

  // --- actions ---
  setActiveTaskId: (id) => set({ activeTaskId: id }),
  setTaskIds: (ids) => set({ taskIds: ids }),
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
