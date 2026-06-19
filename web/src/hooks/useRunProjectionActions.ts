import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { NodeLogDelta, RunEvent, WorkbenchLiveEvent } from '../types';
import type { NodeLiveLogs, RunProjection } from '../types/workbench';
import { boundedLiveEvents } from './useWorkbenchLiveStream';
import { mergeAgentEvents } from '../workbench/model/agentEventText';
import { normalizeTaskRunStatus } from '../workbench/model/taskModel';
import {
  workflowRunFromRunStateSnapshot,
  workflowRunFromRunSummary,
} from '../workbench/model/workflowRuntimeProjection';
import { nodeLogDeltaKeys } from '../workbench/model/selectedNodeModel';
import {
  liveWorkflowRunFromEvents,
  mergeWorkflowRunWithEvents,
  runOverlayFromRun,
} from '../components/workflow-viewer/runState';
import { MAX_LOG_PREVIEW_LINES } from '../workbench/constants';
import { useRunRefreshLoader } from './useRunRefreshLoader';

export type UseRunProjectionActionsOptions = {
  runsById: Record<string, RunProjection>;
  setRunsById: Dispatch<SetStateAction<Record<string, RunProjection>>>;
  setRunLogsById: Dispatch<SetStateAction<Record<string, Record<string, NodeLiveLogs>>>>;
  setRunLiveEventsById: Dispatch<SetStateAction<Record<string, WorkbenchLiveEvent[]>>>;
};

export type UseRunProjectionActionsResult = {
  updateRunProjection: (runId: string, update: (current: RunProjection) => RunProjection) => void;
  appendNodeLogDelta: (delta: NodeLogDelta) => void;
  appendRunAgentEventToProjection: (runId: string, event: RunEvent) => void;
  appendRunLiveEvent: (runId: string, event: WorkbenchLiveEvent) => void;
  refreshRunProjection: (runId: string) => Promise<void>;
};

function trimLiveLog(value: string): string {
  const lines = value.split(/\r?\n/);
  if (lines.length <= MAX_LOG_PREVIEW_LINES) {
    return value;
  }
  return lines.slice(-MAX_LOG_PREVIEW_LINES).join('\n');
}

export function useRunProjectionActions({
  runsById,
  setRunsById,
  setRunLogsById,
  setRunLiveEventsById,
}: UseRunProjectionActionsOptions): UseRunProjectionActionsResult {
  const loadRunRefresh = useRunRefreshLoader();

  const updateRunProjection = useCallback(
    (runId: string, update: (current: RunProjection) => RunProjection) => {
      setRunsById((current) => {
        const projection = current[runId];
        if (!projection) {
          return current;
        }
        return { ...current, [runId]: update(projection) };
      });
    },
    [setRunsById],
  );

  const appendNodeLogDelta = useCallback(
    (delta: NodeLogDelta) => {
      setRunLogsById((current) => {
        const runLogs = current[delta.run_id] || {};
        const logKeys = nodeLogDeltaKeys(delta);
        const primaryKey = logKeys[0] || delta.node_id;
        const previous = runLogs[primaryKey] || {
          stdout: '',
          stderr: '',
          stdoutOffset: 0,
          stderrOffset: 0,
        };
        const nextNodeLogs: NodeLiveLogs =
          delta.stream === 'stdout'
            ? {
                ...previous,
                stdout: trimLiveLog(previous.stdout + delta.text),
                stdoutOffset: delta.next_offset,
              }
            : {
                ...previous,
                stderr: trimLiveLog(previous.stderr + delta.text),
                stderrOffset: delta.next_offset,
              };
        return {
          ...current,
          [delta.run_id]: {
            ...runLogs,
            ...Object.fromEntries(logKeys.map((key) => [key, nextNodeLogs])),
          },
        };
      });
    },
    [setRunLogsById],
  );

  const appendRunAgentEventToProjection = useCallback(
    (runId: string, event: RunEvent) => {
      setRunsById((current) => {
        const projection = current[runId];
        if (!projection) {
          return current;
        }
        return {
          ...current,
          [runId]: {
            ...projection,
            events: mergeAgentEvents(projection.events, [event]),
          },
        };
      });
    },
    [setRunsById],
  );

  const appendRunLiveEvent = useCallback(
    (runId: string, event: WorkbenchLiveEvent) => {
      setRunLiveEventsById((current) => ({
        ...current,
        [runId]: boundedLiveEvents(current[runId] || [], [event]),
      }));
    },
    [setRunLiveEventsById],
  );

  const refreshRunProjection = useCallback(
    async (runId: string) => {
      const current = runsById[runId];
      if (!current) {
        return;
      }
      const { summary, stateSnapshot, events } = await loadRunRefresh(runId);
      const snapshotRun = stateSnapshot
        ? workflowRunFromRunStateSnapshot(stateSnapshot, current.graph)
        : workflowRunFromRunSummary(summary, current.graph);
      const liveRun = mergeWorkflowRunWithEvents(
        snapshotRun,
        liveWorkflowRunFromEvents(current.graph, summary.run_dir || current.runDir, events),
      );
      const runStatus = normalizeTaskRunStatus(summary.status || liveRun.status);
      const overlay = runOverlayFromRun({ ...liveRun, status: runStatus }, {
        runId,
        scope: current.scope,
        targetId: current.targetId,
      });
      setRunsById((state) => ({
        ...state,
        [runId]: {
          ...current,
          status: runStatus,
          summary,
          run: { ...liveRun, status: runStatus },
          events,
          overlay,
        },
      }));
    },
    [loadRunRefresh, runsById, setRunsById],
  );

  return {
    updateRunProjection,
    appendNodeLogDelta,
    appendRunAgentEventToProjection,
    appendRunLiveEvent,
    refreshRunProjection,
  };
}
