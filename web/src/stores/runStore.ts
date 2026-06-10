/**
 * Zustand store for run execution state.
 *
 * Covers: run projections keyed by runId, per-node live logs, runtime config,
 * workflow bindings, and polling state.
 */

import { create } from 'zustand';
import type { RuntimeConfig, WorkflowBindingView } from '../types';

// ---------------------------------------------------------------------------
// Local type mirrors (will unify with types/workbench.ts in a later step)
// ---------------------------------------------------------------------------

export type WorkflowStatus =
  | 'not_run'
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'crashed'
  | 'scheduled';

export type NodeLiveLogs = {
  stdout: string;
  stderr: string;
  stdoutOffset: number;
  stderrOffset: number;
};

export type RunProjectionSlim = {
  runId: string;
  taskId: string;
  status: WorkflowStatus;
  pollState: 'idle' | 'polling' | 'error';
};

export interface RunStoreState {
  // --- data ---
  runsById: Record<string, RunProjectionSlim>;
  runLogsById: Record<string, Record<string, NodeLiveLogs>>;
  runtimeConfig: RuntimeConfig | null;
  workflowBindings: Record<string, WorkflowBindingView>;

  // --- actions ---
  setRuntimeConfig: (config: RuntimeConfig | null) => void;
  setWorkflowBindings: (bindings: Record<string, WorkflowBindingView>) => void;
  upsertRun: (runId: string, patch: Partial<RunProjectionSlim>) => void;
  removeRun: (runId: string) => void;
  setRunLogs: (
    runId: string,
    nodeId: string,
    updater: (prev: NodeLiveLogs) => NodeLiveLogs,
  ) => void;
  clearRunLogs: (runId: string) => void;
}

const emptyLogs: NodeLiveLogs = { stdout: '', stderr: '', stdoutOffset: 0, stderrOffset: 0 };

export const useRunStore = create<RunStoreState>((set) => ({
  runsById: {},
  runLogsById: {},
  runtimeConfig: null,
  workflowBindings: {},

  setRuntimeConfig: (config) => set({ runtimeConfig: config }),
  setWorkflowBindings: (bindings) => set({ workflowBindings: bindings }),

  upsertRun: (runId, patch) =>
    set((state) => ({
      runsById: {
        ...state.runsById,
        [runId]: {
          ...(state.runsById[runId] || { runId, taskId: '', status: 'not_run' as const, pollState: 'idle' as const }),
          ...patch,
        },
      },
    })),

  removeRun: (runId) =>
    set((state) => {
      const { [runId]: _, ...rest } = state.runsById;
      const { [runId]: __, ...restLogs } = state.runLogsById;
      return { runsById: rest, runLogsById: restLogs };
    }),

  setRunLogs: (runId, nodeId, updater) =>
    set((state) => {
      const existing = state.runLogsById[runId]?.[nodeId] || emptyLogs;
      return {
        runLogsById: {
          ...state.runLogsById,
          [runId]: {
            ...state.runLogsById[runId],
            [nodeId]: updater(existing),
          },
        },
      };
    }),

  clearRunLogs: (runId) =>
    set((state) => {
      const { [runId]: _, ...rest } = state.runLogsById;
      return { runLogsById: rest };
    }),
}));
