import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useRef, useState } from 'react';

import type { RunSummary, WorkflowGraph } from '../types';
import type { RunProjection, WorkbenchTask } from '../types/workbench';
import { useWorkflowRunSubmitActions, type RunWorkflowGraph } from './useWorkflowRunSubmitActions';
import type { EvidenceDockState } from './useEvidenceDockActions';
import type { StartSubmittedRunPollingOptions } from './useSubmittedRunPolling';

let latestRunWorkflowGraph: RunWorkflowGraph | null = null;
let latestMessage = '';
let latestTasks: WorkbenchTask[] = [];
let latestRunsById: Record<string, RunProjection> = {};
let latestEvidenceDock: EvidenceDockState | null = null;
let latestGraphRef: { current: WorkflowGraph } | null = null;
let latestSourceGraph: WorkflowGraph | null = null;

const submitRunnerJob = vi.fn();
const pollSubmittedRunUntilTerminal = vi.fn();
const ensureBoundaryTransfersValid = vi.fn();
const reportTemporaryResourceIssue = vi.fn();
const updateRunProjection = vi.fn();
const onChanged = vi.fn();

function workflowGraph(overrides: Partial<WorkflowGraph> = {}): WorkflowGraph {
  return {
    id: 'workflow_1',
    name: 'Workflow 1',
    version: '1.0.0',
    nodes: [],
    edges: [],
    control_edges: [],
    data_edges: [],
    ...overrides,
  };
}

function workbenchTask(): WorkbenchTask {
  return {
    taskId: 'task_1',
    title: 'Task 1',
    canvas: {
      id: 'task_1',
      name: 'Task 1',
      rootWorkflowId: 'task_1',
      workflows: [],
      edges: [],
    },
    status: 'not_run',
  };
}

function Harness({
  selectedRunId = null,
}: {
  selectedRunId?: string | null;
}) {
  const graphRef = useRef<WorkflowGraph>(workflowGraph({ id: 'initial_graph' }));
  const [message, setMessage] = useState('');
  const [tasks, setTasks] = useState<WorkbenchTask[]>([workbenchTask()]);
  const [runsById, setRunsById] = useState<Record<string, RunProjection>>({});
  const [sourceGraph, setSourceGraph] = useState<WorkflowGraph>(workflowGraph({ id: 'initial_source' }));
  const [evidenceDock, setEvidenceDock] = useState<EvidenceDockState>({
    open: false,
    title: '运行证据',
    content: null,
  });

  latestRunWorkflowGraph = useWorkflowRunSubmitActions({
    activeTaskId: 'task_1',
    selectedRunId,
    workflowBindings: {
      workflow_1: {
        workflow_id: 'workflow_1',
        binding_path: 'bindings/workflow_1',
        exists: true,
        status: 'valid',
      },
    },
    submitRunnerJob,
    pollSubmittedRunUntilTerminal,
    setMessage,
    setEvidenceDock,
    setTasks,
    setRunsById,
    updateRunProjection,
    graphRef,
    setSourceGraph,
    ensureBoundaryTransfersValid,
    reportTemporaryResourceIssue,
    onChanged,
  }).runWorkflowGraph;
  latestMessage = message;
  latestTasks = tasks;
  latestRunsById = runsById;
  latestEvidenceDock = evidenceDock;
  latestGraphRef = graphRef;
  latestSourceGraph = sourceGraph;

  return <output>{message}</output>;
}

describe('useWorkflowRunSubmitActions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T00:00:00Z'));
    submitRunnerJob.mockResolvedValue({
      schema_version: 'acc.runner.job.v1',
      runner_id: 'local-runner',
      workspace_alias: 'default',
      job_id: 'job_1',
      run_id: 'ui_workflow_workflow_1_1781913600000',
      task_id: 'task_1',
      workflow_id: 'workflow_1',
      status: 'queued',
    });
    ensureBoundaryTransfersValid.mockResolvedValue(undefined);
  });

  afterEach(() => {
    latestRunWorkflowGraph = null;
    latestMessage = '';
    latestTasks = [];
    latestRunsById = {};
    latestEvidenceDock = null;
    latestGraphRef = null;
    latestSourceGraph = null;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test('submits a task graph with binding ref and initializes queued projection', async () => {
    render(<Harness />);
    const graph = workflowGraph();

    await act(async () => {
      await latestRunWorkflowGraph?.(graph, 'task', 'task_1');
    });

    const runId = 'ui_workflow_workflow_1_1781913600000';
    expect(ensureBoundaryTransfersValid).toHaveBeenCalledTimes(1);
    expect(submitRunnerJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: runId, name: 'Workflow 1 run' }),
      {
        runId,
        taskId: 'task_1',
        bindingRef: 'binding:workflow_1',
      },
    );
    expect(latestRunsById[runId]).toMatchObject({
      runId,
      taskId: 'task_1',
      status: 'queued',
      scope: 'task',
      targetId: 'task_1',
      runDir: `runs/${runId}`,
      pollState: 'idle',
    });
    expect(latestTasks[0]).toMatchObject({
      status: 'queued',
      activeRunId: runId,
      latestRunId: runId,
    });
    expect(latestEvidenceDock?.owner).toMatchObject({
      kind: 'run',
      taskId: 'task_1',
      runId,
    });
    expect(latestGraphRef?.current).toBe(graph);
    expect(latestSourceGraph).toBe(graph);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test('applies terminal polling snapshots to run and task projection', async () => {
    render(<Harness />);
    const graph = workflowGraph();

    await act(async () => {
      await latestRunWorkflowGraph?.(graph, 'task', 'task_1');
    });

    const pollOptions = pollSubmittedRunUntilTerminal.mock.calls[0]?.[0] as
      | StartSubmittedRunPollingOptions
      | undefined;
    expect(pollOptions?.foreground).toBe(false);
    const summary: RunSummary = {
      run_id: 'ui_workflow_workflow_1_1781913600000',
      workflow_id: 'workflow_1',
      status: 'success',
      run_dir: 'runs/ui_workflow_workflow_1_1781913600000',
      node_count: 0,
      failed_nodes: [],
      nodes: [],
    };

    await act(async () => {
      pollOptions?.onSnapshot({ summary, stateSnapshot: null, events: [] });
    });

    const runId = 'ui_workflow_workflow_1_1781913600000';
    expect(latestRunsById[runId]).toMatchObject({
      status: 'success',
      pollState: 'polling',
    });
    expect(latestTasks[0]).toMatchObject({
      status: 'success',
      activeRunId: undefined,
      latestRunId: runId,
    });
    expect(latestMessage).toBe('运行 workflow_1: 成功');
  });

  test('blocks task runs when boundary transfer validation fails', async () => {
    ensureBoundaryTransfersValid.mockRejectedValueOnce(new Error('boundary invalid'));
    render(<Harness />);

    await act(async () => {
      await latestRunWorkflowGraph?.(workflowGraph(), 'task', 'task_1');
    });

    expect(submitRunnerJob).not.toHaveBeenCalled();
    expect(latestMessage).toBe('运行失败: boundary invalid');
    expect(latestRunsById).toEqual({});
  });

  test('reports temporary callable graph issues before submitting', async () => {
    render(<Harness />);

    await act(async () => {
      await latestRunWorkflowGraph?.(
        workflowGraph({
          nodes: [
            {
              id: 'tmp_node',
              label: 'Temporary Node',
              callable_ref: { kind: 'agent_class', id: 'tmp_agent_demo' },
            },
          ],
        }),
        'node',
        'tmp_node',
      );
    });

    expect(reportTemporaryResourceIssue).toHaveBeenCalledWith(
      expect.stringContaining('Temporary Node'),
    );
    expect(submitRunnerJob).not.toHaveBeenCalled();
  });
});
