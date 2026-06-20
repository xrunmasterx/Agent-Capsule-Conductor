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
  setTasks: Dispatch<SetStateAction<WorkbenchTask[]>>;
  setRunsById: Dispatch<SetStateAction<Record<string, RunProjection>>>;
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
        setRunsById((current) => ({
          ...current,
          [runId]: {
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
          },
        }));
        setTasks((current) =>
          current.map((task) =>
            task.taskId === taskId
              ? { ...task, status: 'queued', activeRunId: runId, latestRunId: runId }
              : task,
          ),
        );
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
            setRunsById((current) => ({
              ...current,
              [runId]: {
                ...(current[runId] || {
                  runId,
                  taskId,
                  scope,
                  targetId,
                  graph: runnableGraph,
                  runDir,
                }),
                status: runStatus,
                summary,
                run: { ...liveRun, status: runStatus },
                events,
                overlay,
                pollState: 'polling',
              },
            }));
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
        setTasks((current) =>
          current.map((task) =>
            task.taskId === taskId
              ? { ...task, status: 'failed', activeRunId: undefined, latestRunId: runId }
              : task,
          ),
        );
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
