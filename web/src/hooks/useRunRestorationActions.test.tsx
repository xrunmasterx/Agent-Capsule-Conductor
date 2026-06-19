import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';

import type { RunEvent, RunSummary, WorkflowGraph, WorkflowRunResult } from '../types';
import type { RunProjection, WorkbenchTask, WorkflowContainerModel, WorkspaceCanvasModel } from '../types/workbench';
import {
  useRunRestorationActions,
  type UseRunRestorationActionsResult,
} from './useRunRestorationActions';
import type { RunRestorationPayload, UseRunRestorationLoaderOptions } from './useRunRestorationLoader';

const loaderState = vi.hoisted(() => ({
  latestOptions: null as UseRunRestorationLoaderOptions | null,
}));

vi.mock('./useRunRestorationLoader', () => ({
  useRunRestorationLoader: (options: UseRunRestorationLoaderOptions) => {
    loaderState.latestOptions = options;
  },
}));

let latestResult: UseRunRestorationActionsResult | null = null;
let latestRunsById: Record<string, RunProjection> = {};
let latestTasks: WorkbenchTask[] = [];

function workflow(): WorkflowContainerModel {
  return {
    id: 'workflow_1',
    title: 'Workflow 1',
    directory: '',
    status: 'not_run',
    inputPorts: [],
    outputPorts: [],
    internalNodes: [],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 320, height: 180 },
    warnings: [],
  };
}

function canvas(): WorkspaceCanvasModel {
  return {
    id: 'task_1',
    name: 'Task 1',
    rootWorkflowId: 'task_1',
    workflows: [workflow()],
    edges: [],
  };
}

function graph(): WorkflowGraph {
  return {
    id: 'task_1',
    name: 'Task 1',
    version: '1.0.0',
    nodes: [
      {
        id: 'workflow_1',
        label: 'Workflow 1',
        callable_ref: { kind: 'agent_class', id: 'callable_1' },
      },
    ],
    edges: [],
    control_edges: [],
    data_edges: [],
  };
}

function task(partial: Partial<WorkbenchTask> = {}): WorkbenchTask {
  return {
    taskId: 'task_1',
    title: 'Task 1',
    canvas: canvas(),
    status: 'running',
    activeRunId: 'run_1',
    latestRunId: 'run_1',
    ...partial,
  };
}

function summary(status = 'success'): RunSummary {
  return {
    run_id: 'run_1',
    workflow_id: 'task_1',
    status,
    run_dir: 'runs/run_1',
    node_count: 1,
    failed_nodes: [],
    nodes: [],
  };
}

function workflowRun(status = 'success'): WorkflowRunResult {
  return {
    workflow_id: 'task_1',
    status,
    run_dir: 'runs/run_1',
    nodes: [
      {
        node_id: 'workflow_1',
        callable_id: 'callable_1',
        status,
        run_dir: 'runs/run_1/nodes/workflow_1',
        input_path: 'runs/run_1/nodes/workflow_1/agent_payload.json',
        prompt_path: 'runs/run_1/nodes/workflow_1/resolved_prompt.md',
        output_path: 'runs/run_1/nodes/workflow_1/output.json',
        artifact_dir: 'runs/run_1/nodes/workflow_1/artifacts',
        event_log: 'runs/run_1/nodes/workflow_1/events.jsonl',
        stdout_log: 'runs/run_1/nodes/workflow_1/stdout.log',
        stderr_log: 'runs/run_1/nodes/workflow_1/stderr.log',
        errors: [],
      },
    ],
    edges: [],
    errors: [],
  };
}

function runProjection(partial: Partial<RunProjection> = {}): RunProjection {
  return {
    runId: 'run_1',
    taskId: 'task_1',
    status: 'running',
    scope: 'task',
    targetId: 'task_1',
    graph: graph(),
    runDir: 'runs/run_1',
    run: null,
    events: [],
    overlay: null,
    pollState: 'idle',
    ...partial,
  };
}

function payload(partial: Partial<RunRestorationPayload> = {}): RunRestorationPayload {
  return {
    runId: 'run_1',
    summary: summary('success'),
    stateSnapshot: workflowRun('success'),
    events: [{ type: 'workflow_completed', run_id: 'run_1' } as RunEvent],
    ...partial,
  };
}

function Harness({
  initialTask = task(),
  initialRuns = {},
}: {
  initialTask?: WorkbenchTask | undefined;
  initialRuns?: Record<string, RunProjection>;
}) {
  const [tasks, setTasks] = useState<WorkbenchTask[]>(initialTask ? [initialTask] : []);
  const [runsById, setRunsById] = useState<Record<string, RunProjection>>(initialRuns);
  const currentTask = tasks[0];

  latestResult = useRunRestorationActions({
    currentTask,
    runsById,
    setRunsById,
    setTasks,
  });
  latestTasks = tasks;
  latestRunsById = runsById;

  return <output>run-restoration-actions</output>;
}

describe('useRunRestorationActions', () => {
  beforeEach(() => {
    loaderState.latestOptions = null;
    latestResult = null;
    latestRunsById = {};
    latestTasks = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('enables restoration when a task has a run id without a hydrated run projection', () => {
    render(<Harness />);

    expect(latestResult).toEqual({ restorationRunId: 'run_1', shouldRestoreRun: true });
    expect(loaderState.latestOptions).toMatchObject({ enabled: true, runId: 'run_1' });
  });

  test('does not restore when the run projection is already hydrated', () => {
    render(<Harness initialRuns={{ run_1: runProjection({ run: workflowRun('running') }) }} />);

    expect(latestResult).toEqual({ restorationRunId: 'run_1', shouldRestoreRun: false });
    expect(loaderState.latestOptions).toMatchObject({ enabled: false, runId: 'run_1' });
  });

  test('loads durable run state into run projection and task status', () => {
    render(<Harness />);

    act(() => {
      loaderState.latestOptions?.onLoaded(payload());
    });

    expect(latestRunsById.run_1).toMatchObject({
      runId: 'run_1',
      taskId: 'task_1',
      status: 'success',
      scope: 'task',
      targetId: 'task_1',
      pollState: 'idle',
    });
    expect(latestRunsById.run_1.run?.status).toBe('success');
    expect(latestRunsById.run_1.overlay?.status).toBe('success');
    expect(latestRunsById.run_1.events).toEqual([expect.objectContaining({ type: 'workflow_completed' })]);
    expect(latestTasks[0]).toMatchObject({
      status: 'success',
      latestRunId: 'run_1',
      activeRunId: undefined,
    });
  });

  test('keeps active run id for active restored statuses', () => {
    render(<Harness />);

    act(() => {
      loaderState.latestOptions?.onLoaded(payload({
        summary: summary('running'),
        stateSnapshot: workflowRun('running'),
        events: [],
      }));
    });

    expect(latestTasks[0]).toMatchObject({
      status: 'running',
      latestRunId: 'run_1',
      activeRunId: 'run_1',
    });
  });

  test('removes stale projections when restoration fails', () => {
    render(<Harness initialRuns={{ run_1: runProjection() }} />);

    act(() => {
      loaderState.latestOptions?.onLoadFailed?.('run_1', new Error('missing'));
    });

    expect(latestRunsById.run_1).toBeUndefined();
  });
});
