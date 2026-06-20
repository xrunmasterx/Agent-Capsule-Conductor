import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { NodeLogDelta, RunEvent, RunSummary, WorkbenchLiveEvent } from '../types';
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
  appendNodeLogDeltas: (runId: string, deltas: NodeLogDelta[]) => void;
  appendRunAgentEventsToProjection: (runId: string, events: RunEvent[]) => void;
  appendRunLiveEvents: (runId: string, events: WorkbenchLiveEvent[]) => void;
  applyRunSummary: (runId: string, summary: RunSummary) => void;
  refreshRunProjection: (runId: string) => Promise<void>;
};

const MAX_AGENT_EVENTS_IN_PROJECTION = 1000;

function trimLiveLog(value: string): string {
  const lines = value.split(/\r?\n/);
  if (lines.length <= MAX_LOG_PREVIEW_LINES) {
    return value;
  }
  return lines.slice(-MAX_LOG_PREVIEW_LINES).join('\n');
}

function appendLogDelta(previous: NodeLiveLogs, delta: NodeLogDelta): NodeLiveLogs {
  const offsetKey = delta.stream === 'stdout' ? 'stdoutOffset' : 'stderrOffset';
  const textKey = delta.stream;
  const previousOffset = previous[offsetKey] || 0;
  const deltaOffset = typeof delta.offset === 'number' ? delta.offset : previousOffset;
  const nextOffset = typeof delta.next_offset === 'number' ? delta.next_offset : deltaOffset + delta.text.length;
  if (nextOffset <= previousOffset || deltaOffset < previousOffset) {
    return previous;
  }
  const gapText =
    deltaOffset > previousOffset
      ? `\n[log gap: ${previousOffset}-${deltaOffset}]\n`
      : '';
  return {
    ...previous,
    [textKey]: trimLiveLog(`${previous[textKey]}${gapText}${delta.text}`),
    [offsetKey]: nextOffset,
  };
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

  const appendNodeLogDeltas = useCallback(
    (runId: string, deltas: NodeLogDelta[]) => {
      if (deltas.length === 0) {
        return;
      }
      setRunLogsById((current) => {
        let runLogs = current[runId] || {};
        let changed = false;
        for (const delta of deltas) {
          if (delta.run_id !== runId || !delta.text) {
            continue;
          }
          const logKeys = nodeLogDeltaKeys(delta);
          const primaryKey = logKeys[0] || delta.node_id;
          const previous = runLogs[primaryKey] || {
            stdout: '',
            stderr: '',
            stdoutOffset: 0,
            stderrOffset: 0,
          };
          const nextNodeLogs = appendLogDelta(previous, delta);
          if (nextNodeLogs === previous) {
            continue;
          }
          runLogs = {
            ...runLogs,
            ...Object.fromEntries(logKeys.map((key) => [key, nextNodeLogs])),
          };
          changed = true;
        }
        if (!changed) {
          return current;
        }
        return {
          ...current,
          [runId]: runLogs,
        };
      });
    },
    [setRunLogsById],
  );

  const appendRunAgentEventsToProjection = useCallback(
    (runId: string, events: RunEvent[]) => {
      if (events.length === 0) {
        return;
      }
      setRunsById((current) => {
        const projection = current[runId];
        if (!projection) {
          return current;
        }
        const merged = mergeAgentEvents(projection.events, events).slice(-MAX_AGENT_EVENTS_IN_PROJECTION);
        return {
          ...current,
          [runId]: {
            ...projection,
            events: merged,
          },
        };
      });
    },
    [setRunsById],
  );

  const appendRunLiveEvents = useCallback(
    (runId: string, events: WorkbenchLiveEvent[]) => {
      if (events.length === 0) {
        return;
      }
      setRunLiveEventsById((current) => ({
        ...current,
        [runId]: boundedLiveEvents(current[runId] || [], events),
      }));
    },
    [setRunLiveEventsById],
  );

  const applyRunSummary = useCallback(
    (runId: string, summary: RunSummary) => {
      setRunsById((current) => {
        const projection = current[runId];
        if (!projection) {
          return current;
        }
        return {
          ...current,
          [runId]: {
            ...projection,
            summary,
            status: normalizeTaskRunStatus(summary.status),
          },
        };
      });
    },
    [setRunsById],
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
    appendNodeLogDeltas,
    appendRunAgentEventsToProjection,
    appendRunLiveEvents,
    applyRunSummary,
    refreshRunProjection,
  };
}
