import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { NodeLogDelta, RunEvent, RunSummary, WorkbenchLiveEvent } from '../types';
import type { NodeLiveLogs, RunProjection } from '../types/workbench';
import { useRunStore } from '../stores/runStore';
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
import { boundedLiveEvents } from './useWorkbenchLiveStream';
import { useRunRefreshLoader } from './useRunRefreshLoader';

export type UseRunProjectionActionsOptions = {
  runsById?: Record<string, RunProjection>;
  setRunsById?: Dispatch<SetStateAction<Record<string, RunProjection>>>;
  setRunLogsById?: Dispatch<SetStateAction<Record<string, Record<string, NodeLiveLogs>>>>;
  setRunLiveEventsById?: Dispatch<SetStateAction<Record<string, WorkbenchLiveEvent[]>>>;
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
  runsById: legacyRunsById,
  setRunsById: legacySetRunsById,
  setRunLogsById: legacySetRunLogsById,
  setRunLiveEventsById: legacySetRunLiveEventsById,
}: UseRunProjectionActionsOptions = {}): UseRunProjectionActionsResult {
  const loadRunRefresh = useRunRefreshLoader();
  const updateRun = useRunStore((state) => state.updateRun);
  const setRunLogs = useRunStore((state) => state.setRunLogs);
  const appendLiveEvents = useRunStore((state) => state.appendLiveEvents);

  const updateRunProjection = useCallback(
    (runId: string, update: (current: RunProjection) => RunProjection) => {
      if (legacySetRunsById) {
        legacySetRunsById((current) => {
          const projection = current[runId];
          return projection ? { ...current, [runId]: update(projection) } : current;
        });
        return;
      }
      updateRun(runId, update);
    },
    [legacySetRunsById, updateRun],
  );

  const appendNodeLogDeltas = useCallback(
    (runId: string, deltas: NodeLogDelta[]) => {
      if (deltas.length === 0) {
        return;
      }
      if (legacySetRunLogsById) {
        legacySetRunLogsById((current) => {
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
          return changed ? { ...current, [runId]: runLogs } : current;
        });
        return;
      }
      for (const delta of deltas) {
        if (delta.run_id !== runId || !delta.text) {
          continue;
        }
        const logKeys = nodeLogDeltaKeys(delta);
        logKeys.forEach((key) => {
          setRunLogs(runId, key, (previous) => appendLogDelta(previous, delta));
        });
      }
    },
    [legacySetRunLogsById, setRunLogs],
  );

  const appendRunAgentEventsToProjection = useCallback(
    (runId: string, events: RunEvent[]) => {
      if (events.length === 0) {
        return;
      }
      const update = (projection: RunProjection) => ({
        ...projection,
        events: mergeAgentEvents(projection.events, events).slice(-MAX_AGENT_EVENTS_IN_PROJECTION),
      });
      if (legacySetRunsById) {
        legacySetRunsById((current) => {
          const projection = current[runId];
          return projection ? { ...current, [runId]: update(projection) } : current;
        });
        return;
      }
      updateRun(runId, update);
    },
    [legacySetRunsById, updateRun],
  );

  const appendRunLiveEvents = useCallback(
    (runId: string, events: WorkbenchLiveEvent[]) => {
      if (events.length === 0) {
        return;
      }
      if (legacySetRunLiveEventsById) {
        legacySetRunLiveEventsById((current) => ({
          ...current,
          [runId]: boundedLiveEvents(current[runId] || [], events),
        }));
        return;
      }
      appendLiveEvents(runId, events);
    },
    [appendLiveEvents, legacySetRunLiveEventsById],
  );

  const applyRunSummary = useCallback(
    (runId: string, summary: RunSummary) => {
      const update = (projection: RunProjection) => ({
        ...projection,
        summary,
        status: normalizeTaskRunStatus(summary.status),
      });
      if (legacySetRunsById) {
        legacySetRunsById((current) => {
          const projection = current[runId];
          return projection ? { ...current, [runId]: update(projection) } : current;
        });
        return;
      }
      updateRun(runId, update);
    },
    [legacySetRunsById, updateRun],
  );

  const refreshRunProjection = useCallback(
    async (runId: string) => {
      const current = legacyRunsById?.[runId] || useRunStore.getState().runsById[runId];
      if (!current) {
        return;
      }
      const { summary, stateSnapshot, events } = await loadRunRefresh(runId);
      if (!legacySetRunsById && !useRunStore.getState().runsById[runId]) {
        return;
      }
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
      const update = (latest: RunProjection) => ({
        ...latest,
        status: runStatus,
        summary,
        run: { ...liveRun, status: runStatus },
        events,
        overlay,
      });
      if (legacySetRunsById) {
        legacySetRunsById((state) => ({ ...state, [runId]: update(state[runId] || current) }));
        return;
      }
      updateRun(runId, update);
    },
    [legacyRunsById, legacySetRunsById, loadRunRefresh, updateRun],
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
