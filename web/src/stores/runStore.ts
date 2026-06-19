/**
 * Zustand store for run execution state.
 *
 * Store actions accept already-normalized payloads only. API calls, polling,
 * EventSource handling, and filesystem reads stay in hooks.
 */

import { create } from 'zustand';
import type { RuntimeConfig, WorkbenchLiveEvent, WorkflowBindingView } from '../types';
import type { NodeLiveLogs, RunProjection, WorkflowStatus } from '../types/workbench';

export type { NodeLiveLogs, RunProjection, WorkflowStatus };

export interface RunStoreState {
  runsById: Record<string, RunProjection>;
  runIdsByTaskId: Record<string, string[]>;
  activeRunIdsByTaskId: Record<string, string | null>;
  runLogsById: Record<string, Record<string, NodeLiveLogs>>;
  liveEventsByRunId: Record<string, WorkbenchLiveEvent[]>;
  runtimeConfig: RuntimeConfig | null;
  workflowBindings: Record<string, WorkflowBindingView>;

  setRuntimeConfig: (config: RuntimeConfig | null) => void;
  setWorkflowBindings: (bindings: Record<string, WorkflowBindingView>) => void;
  upsertRun: (run: RunProjection) => void;
  patchRun: (runId: string, patch: Partial<RunProjection>) => void;
  removeRun: (runId: string) => void;
  setActiveRunForTask: (taskId: string, runId: string | null) => void;
  setRunLogs: (runId: string, nodeKey: string, updater: (prev: NodeLiveLogs) => NodeLiveLogs) => void;
  clearRunLogs: (runId: string) => void;
  appendLiveEvent: (runId: string, event: WorkbenchLiveEvent, limit?: number) => void;
  clearRunLiveEvents: (runId: string) => void;
}

const emptyLogs: NodeLiveLogs = { stdout: '', stderr: '', stdoutOffset: 0, stderrOffset: 0 };
const DEFAULT_LIVE_EVENT_LIMIT = 200;

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

export const useRunStore = create<RunStoreState>((set) => ({
  runsById: {},
  runIdsByTaskId: {},
  activeRunIdsByTaskId: {},
  runLogsById: {},
  liveEventsByRunId: {},
  runtimeConfig: null,
  workflowBindings: {},

  setRuntimeConfig: (config) => set({ runtimeConfig: config }),
  setWorkflowBindings: (bindings) => set({ workflowBindings: bindings }),

  upsertRun: (run) =>
    set((state) => ({
      runsById: {
        ...state.runsById,
        [run.runId]: run,
      },
      runIdsByTaskId: {
        ...state.runIdsByTaskId,
        [run.taskId]: appendUnique(state.runIdsByTaskId[run.taskId] || [], run.runId),
      },
    })),

  patchRun: (runId, patch) =>
    set((state) => {
      const current = state.runsById[runId];
      if (!current) {
        return {};
      }
      const nextRun = { ...current, ...patch };
      const nextRunIdsByTaskId =
        patch.taskId && patch.taskId !== current.taskId
          ? {
              ...state.runIdsByTaskId,
              [current.taskId]: (state.runIdsByTaskId[current.taskId] || []).filter((id) => id !== runId),
              [patch.taskId]: appendUnique(state.runIdsByTaskId[patch.taskId] || [], runId),
            }
          : state.runIdsByTaskId;
      return {
        runsById: { ...state.runsById, [runId]: nextRun },
        runIdsByTaskId: nextRunIdsByTaskId,
      };
    }),

  removeRun: (runId) =>
    set((state) => {
      const run = state.runsById[runId];
      const { [runId]: _removedRun, ...runsById } = state.runsById;
      const { [runId]: _removedLogs, ...runLogsById } = state.runLogsById;
      const { [runId]: _removedLiveEvents, ...liveEventsByRunId } = state.liveEventsByRunId;
      if (!run) {
        return { runsById, runLogsById, liveEventsByRunId };
      }
      const runIdsByTaskId = {
        ...state.runIdsByTaskId,
        [run.taskId]: (state.runIdsByTaskId[run.taskId] || []).filter((id) => id !== runId),
      };
      const activeRunIdsByTaskId = { ...state.activeRunIdsByTaskId };
      if (activeRunIdsByTaskId[run.taskId] === runId) {
        activeRunIdsByTaskId[run.taskId] = null;
      }
      return { runsById, runLogsById, liveEventsByRunId, runIdsByTaskId, activeRunIdsByTaskId };
    }),

  setActiveRunForTask: (taskId, runId) =>
    set((state) => ({
      activeRunIdsByTaskId: { ...state.activeRunIdsByTaskId, [taskId]: runId },
    })),

  setRunLogs: (runId, nodeKey, updater) =>
    set((state) => {
      if (!state.runsById[runId]) {
        return {};
      }
      const existing = state.runLogsById[runId]?.[nodeKey] || emptyLogs;
      return {
        runLogsById: {
          ...state.runLogsById,
          [runId]: {
            ...state.runLogsById[runId],
            [nodeKey]: updater(existing),
          },
        },
      };
    }),

  clearRunLogs: (runId) =>
    set((state) => {
      const { [runId]: _removed, ...runLogsById } = state.runLogsById;
      return { runLogsById };
    }),

  appendLiveEvent: (runId, event, limit = DEFAULT_LIVE_EVENT_LIMIT) =>
    set((state) => {
      if (!state.runsById[runId]) {
        return {};
      }
      const existing = state.liveEventsByRunId[runId] || [];
      return {
        liveEventsByRunId: {
          ...state.liveEventsByRunId,
          [runId]: [...existing, event].slice(-limit),
        },
      };
    }),

  clearRunLiveEvents: (runId) =>
    set((state) => {
      const { [runId]: _removed, ...liveEventsByRunId } = state.liveEventsByRunId;
      return { liveEventsByRunId };
    }),
}));

export function selectTaskRunIds(state: RunStoreState, taskId: string): string[] {
  return state.runIdsByTaskId[taskId] || [];
}

export function selectActiveRunForTask(state: RunStoreState, taskId: string): RunProjection | undefined {
  const activeRunId = state.activeRunIdsByTaskId[taskId];
  return activeRunId ? state.runsById[activeRunId] : undefined;
}

export function selectRunLogs(state: RunStoreState, runId: string, nodeKey: string): NodeLiveLogs {
  return state.runLogsById[runId]?.[nodeKey] || emptyLogs;
}
