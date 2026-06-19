import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { RunProjection, WorkbenchTask } from '../types/workbench';
import { canvasToWorkflowGraph } from '../workbench/model/workflowGraphProjection';
import {
  isActiveRunStatus,
  normalizeTaskRunStatus,
  taskStatusFromRunStatus,
} from '../workbench/model/taskModel';
import {
  workflowRunFromRunStateSnapshot,
  workflowRunFromRunSummary,
} from '../workbench/model/workflowRuntimeProjection';
import {
  liveWorkflowRunFromEvents,
  mergeWorkflowRunWithEvents,
  runOverlayFromRun,
} from '../components/workflow-viewer/runState';
import {
  useRunRestorationLoader,
  type RunRestorationPayload,
} from './useRunRestorationLoader';

export type UseRunRestorationActionsOptions = {
  currentTask: WorkbenchTask | undefined;
  runsById: Record<string, RunProjection>;
  setRunsById: Dispatch<SetStateAction<Record<string, RunProjection>>>;
  setTasks: Dispatch<SetStateAction<WorkbenchTask[]>>;
};

export type UseRunRestorationActionsResult = {
  restorationRunId: string | null;
  shouldRestoreRun: boolean;
};

export function useRunRestorationActions({
  currentTask,
  runsById,
  setRunsById,
  setTasks,
}: UseRunRestorationActionsOptions): UseRunRestorationActionsResult {
  const restorationRunId = currentTask?.activeRunId || currentTask?.latestRunId || null;
  const shouldRestoreRun = Boolean(restorationRunId && !runsById[restorationRunId]?.run);

  const handleRunRestorationLoaded = useCallback(
    ({ runId, summary, stateSnapshot, events }: RunRestorationPayload) => {
      if (!currentTask) {
        return;
      }
      const taskGraph = canvasToWorkflowGraph(currentTask.canvas);
      const restoredRun = stateSnapshot
        ? workflowRunFromRunStateSnapshot(stateSnapshot, taskGraph)
        : workflowRunFromRunSummary(summary, taskGraph);
      const liveRun = events
        ? mergeWorkflowRunWithEvents(
            restoredRun,
            liveWorkflowRunFromEvents(taskGraph, summary.run_dir || `runs/${runId}`, events),
          )
        : restoredRun;
      const overlay = runOverlayFromRun(liveRun, {
        runId,
        scope: 'task',
        targetId: taskGraph.id,
      });
      setRunsById((current) => ({
        ...current,
        [runId]: {
          runId,
          taskId: currentTask.taskId,
          status: normalizeTaskRunStatus(restoredRun.status),
          scope: 'task',
          targetId: taskGraph.id,
          graph: taskGraph,
          runDir: summary.run_dir,
          summary,
          run: liveRun,
          events: events || [],
          overlay,
          pollState: 'idle',
        },
      }));
      setTasks((current) =>
        current.map((task) =>
          task.taskId === currentTask.taskId
            ? {
                ...task,
                status: taskStatusFromRunStatus(restoredRun.status),
                latestRunId: runId,
                activeRunId: isActiveRunStatus(restoredRun.status) ? runId : undefined,
              }
            : task,
        ),
      );
    },
    [currentTask, setRunsById, setTasks],
  );

  const handleRunRestorationFailed = useCallback(
    (runId: string) => {
      setRunsById((current) => {
        const next = { ...current };
        delete next[runId];
        return next;
      });
    },
    [setRunsById],
  );

  useRunRestorationLoader({
    enabled: shouldRestoreRun,
    runId: restorationRunId,
    onLoaded: handleRunRestorationLoaded,
    onLoadFailed: handleRunRestorationFailed,
  });

  return { restorationRunId, shouldRestoreRun };
}
