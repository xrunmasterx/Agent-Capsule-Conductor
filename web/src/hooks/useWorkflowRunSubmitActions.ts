import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { WorkflowBindingView, WorkflowGraph } from '../types';
import type { RunProjection, WorkbenchTask } from '../types/workbench';
import { temporaryResourceIssueForGraph } from '../workbench/model/authoringProposal';
import {
  isActiveRunStatus,
  normalizeTaskRunStatus,
  taskStatusFromRunStatus,
} from '../workbench/model/taskModel';
import { statusLabel } from '../workbench/model/selectedNodeModel';
import {
  workflowRunFromRunStateSnapshot,
  workflowRunFromRunSummary,
} from '../workbench/model/workflowRuntimeProjection';
import {
  liveWorkflowRunFromEvents,
  mergeWorkflowRunWithEvents,
  runOverlayFromRun,
  type RunOverlayState,
} from '../components/workflow-viewer/runState';
import { textArtifact } from '../workbench/model/workflowViewerShell';
import { useRunStore } from '../stores/runStore';
import { useWorkbenchStore } from '../stores/workbenchStore';
import { bindingPathOf, bindingRefOfPath } from './useWorkflowBindings';
import type { EvidenceDockState } from './useEvidenceDockActions';
import type { StartSubmittedRunPollingOptions } from './useSubmittedRunPolling';
import type { SubmitRunnerJob } from './useRunnerSubmit';

export type RunWorkflowGraph = (
  graph: WorkflowGraph,
  scope: RunOverlayState['scope'],
  targetId: string,
) => Promise<void>;

export type UseWorkflowRunSubmitActionsOptions = {
  activeTaskId: string;
  selectedRunId: string | null;
  workflowBindings: Record<string, WorkflowBindingView>;
  submitRunnerJob: SubmitRunnerJob;
  pollSubmittedRunUntilTerminal: (options: StartSubmittedRunPollingOptions) => void;
  setMessage: Dispatch<SetStateAction<string>>;
  setEvidenceDock: Dispatch<SetStateAction<EvidenceDockState>>;
  setTasks?: Dispatch<SetStateAction<WorkbenchTask[]>>;
  setRunsById?: Dispatch<SetStateAction<Record<string, RunProjection>>>;
  updateRunProjection: (runId: string, update: (current: RunProjection) => RunProjection) => void;
  graphRef: MutableRefObject<WorkflowGraph>;
  ensureBoundaryTransfersValid: () => Promise<void>;
  reportTemporaryResourceIssue: (issue: string) => void;
  onChanged?: () => void;
};

export type UseWorkflowRunSubmitActionsResult = {
  runWorkflowGraph: RunWorkflowGraph;
};

export function useWorkflowRunSubmitActions({
  activeTaskId,
  selectedRunId,
  workflowBindings,
  submitRunnerJob,
  pollSubmittedRunUntilTerminal,
  setMessage,
  setEvidenceDock,
  setTasks,
  setRunsById,
  updateRunProjection,
  graphRef,
  ensureBoundaryTransfersValid,
  reportTemporaryResourceIssue,
  onChanged,
}: UseWorkflowRunSubmitActionsOptions): UseWorkflowRunSubmitActionsResult {
  const runWorkflowGraph = useCallback<RunWorkflowGraph>(
    async (graph, scope, targetId) => {
      const graphIssue = temporaryResourceIssueForGraph(graph);
      if (graphIssue) {
        reportTemporaryResourceIssue(graphIssue);
        return;
      }
      if (scope === 'task') {
        try {
          await ensureBoundaryTransfersValid();
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          setMessage(`运行失败: ${text}`);
          return;
        }
      }
      const runId = `ui_workflow_${graph.id}_${Date.now()}`;
      const runDir = `runs/${runId}`;
      const runnableGraph: WorkflowGraph = {
        ...graph,
        id: runId,
        name: graph.name ? `${graph.name} run` : `${graph.id} run`,
      };
      const binding = workflowBindings[graph.id];
      const bindingPath = binding?.exists ? bindingPathOf(binding) : '';
      const taskId = activeTaskId;

      try {
        if (scope === 'task') {
          graphRef.current = graph;
        }
        const initialRun = liveWorkflowRunFromEvents(runnableGraph, runDir, []);
        const initialOverlay = runOverlayFromRun(
          { ...initialRun, status: 'queued' },
          { runId, scope, targetId },
        );
        const initialProjection: RunProjection = {
          runId,
          taskId,
          status: 'queued',
          scope,
          targetId,
          graph: runnableGraph,
          runDir,
          run: { ...initialRun, status: 'queued' },
          events: [],
          overlay: initialOverlay,
          pollState: 'idle',
        };
        if (setRunsById) {
          setRunsById((current) => ({ ...current, [runId]: initialProjection }));
        } else {
          useRunStore.getState().upsertRun(initialProjection);
        }
        if (setTasks) {
          setTasks((current) =>
            current.map((task) =>
              task.taskId === taskId
                ? { ...task, status: 'queued', activeRunId: runId, latestRunId: runId }
                : task,
            ),
          );
        } else {
          useWorkbenchStore.getState().updateTask(taskId, (task) => ({
            ...task,
            status: 'queued',
            activeRunId: runId,
            latestRunId: runId,
          }));
        }
        setMessage(`运行 ${graph.id}: 已提交，等待节点事件...`);
        setEvidenceDock((current) => ({
          open: current.open,
          title: '运行证据',
          content: null,
          owner: { kind: 'run', taskId, runId, createdAt: new Date().toISOString() },
        }));
        const submitted = await submitRunnerJob(runnableGraph, {
          runId,
          taskId,
          ...(bindingPath ? { bindingRef: bindingRefOfPath(bindingPath) } : {}),
        });
        if (setTasks) {
          setTasks((current) =>
            current.map((task) =>
              task.taskId === taskId
                ? {
                    ...task,
                    status: taskStatusFromRunStatus(submitted.status),
                    activeRunId: runId,
                    latestRunId: runId,
                  }
                : task,
            ),
          );
        } else {
          useWorkbenchStore.getState().updateTask(taskId, (task) => ({
            ...task,
            status: taskStatusFromRunStatus(submitted.status),
            activeRunId: runId,
            latestRunId: runId,
          }));
        }
        pollSubmittedRunUntilTerminal({
          runId,
          foreground: selectedRunId === runId,
          onSnapshot: ({ summary, stateSnapshot, events }) => {
            const snapshotRun = stateSnapshot
              ? workflowRunFromRunStateSnapshot(stateSnapshot, runnableGraph)
              : workflowRunFromRunSummary(summary, runnableGraph);
            const liveRun = mergeWorkflowRunWithEvents(
              snapshotRun,
              liveWorkflowRunFromEvents(runnableGraph, summary.run_dir || runDir, events),
            );
            const runStatus = normalizeTaskRunStatus(summary.status || liveRun.status);
            const overlay = runOverlayFromRun({ ...liveRun, status: runStatus }, { runId, scope, targetId });
            const nextProjection: RunProjection = {
              ...((setRunsById ? undefined : useRunStore.getState().runsById[runId]) || {
                runId,
                taskId,
                scope,
                targetId,
                graph: runnableGraph,
                runDir,
                status: runStatus,
                run: null,
                events: [],
                overlay: null,
                pollState: 'idle',
              }),
              status: runStatus,
              summary,
              run: { ...liveRun, status: runStatus },
              events,
              overlay,
              pollState: 'polling',
            };
            if (setRunsById) {
              setRunsById((current) => ({ ...current, [runId]: { ...(current[runId] || nextProjection), ...nextProjection } }));
            } else {
              useRunStore.getState().upsertRun(nextProjection);
            }
            if (setTasks) {
              setTasks((current) =>
                current.map((task) =>
                  task.taskId === taskId
                    ? {
                        ...task,
                        status: taskStatusFromRunStatus(runStatus),
                        activeRunId: isActiveRunStatus(runStatus) ? runId : undefined,
                        latestRunId: runId,
                      }
                    : task,
                ),
              );
            } else {
              useWorkbenchStore.getState().updateTask(taskId, (task) => ({
                ...task,
                status: taskStatusFromRunStatus(runStatus),
                activeRunId: isActiveRunStatus(runStatus) ? runId : undefined,
                latestRunId: runId,
              }));
            }
            if (isActiveRunStatus(runStatus)) {
              return true;
            }
            setMessage(`运行 ${liveRun.workflow_id}: ${statusLabel(runStatus)}`);
            onChanged?.();
            return false;
          },
          onError: () => {
            updateRunProjection(runId, (current) => ({ ...current, pollState: 'error' }));
          },
        });
        setMessage(`运行 ${runId}: 已提交`);
        onChanged?.();
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        setMessage(`运行失败: ${text}`);
        setEvidenceDock({
          open: true,
          title: '运行错误',
          content: textArtifact('run-error.log', text, 'log'),
          owner: { kind: 'run', taskId, runId, createdAt: new Date().toISOString() },
        });
        updateRunProjection(runId, (current) => ({ ...current, status: 'failed', pollState: 'error' }));
        if (setTasks) {
          setTasks((current) =>
            current.map((task) =>
              task.taskId === taskId
                ? { ...task, status: 'failed', activeRunId: undefined, latestRunId: runId }
                : task,
            ),
          );
        } else {
          useWorkbenchStore.getState().updateTask(taskId, (task) => ({
            ...task,
            status: 'failed',
            activeRunId: undefined,
            latestRunId: runId,
          }));
        }
      }
    },
    [
      activeTaskId,
      ensureBoundaryTransfersValid,
      graphRef,
      onChanged,
      pollSubmittedRunUntilTerminal,
      reportTemporaryResourceIssue,
      selectedRunId,
      setEvidenceDock,
      setMessage,
      setRunsById,
      setTasks,
      submitRunnerJob,
      updateRunProjection,
      workflowBindings,
    ],
  );

  return { runWorkflowGraph };
}
