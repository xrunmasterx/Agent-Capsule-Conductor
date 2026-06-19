import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';

import type { NodeLogDelta, RunEvent, RunSummary, WorkbenchLiveEvent, WorkflowGraph, WorkflowRunResult } from '../types';
import type { NodeLiveLogs, RunProjection } from '../types/workbench';
import {
  useRunProjectionActions,
  type UseRunProjectionActionsResult,
} from './useRunProjectionActions';

const loadRunRefresh = vi.fn();

vi.mock('./useRunRefreshLoader', () => ({
  useRunRefreshLoader: () => loadRunRefresh,
}));

let latestActions: UseRunProjectionActionsResult | null = null;
let latestRunsById: Record<string, RunProjection> = {};
let latestRunLogsById: Record<string, Record<string, NodeLiveLogs>> = {};
let latestLiveEventsByRunId: Record<string, WorkbenchLiveEvent[]> = {};

function workflowGraph(): WorkflowGraph {
  return {
    id: 'workflow_1',
    name: 'Workflow 1',
    version: '1.0.0',
    nodes: [
      {
        id: 'agent_1',
        label: 'Agent 1',
        callable_ref: { kind: 'agent_class', id: 'callable_1' },
      },
    ],
    edges: [],
    control_edges: [],
    data_edges: [],
  };
}

function runSummary(status = 'success'): RunSummary {
  return {
    run_id: 'run_1',
    workflow_id: 'workflow_1',
    status,
    run_dir: 'runs/run_1',
    node_count: 1,
    failed_nodes: [],
    nodes: [],
  };
}

function workflowRun(status = 'success'): WorkflowRunResult {
  return {
    workflow_id: 'workflow_1',
    status,
    run_dir: 'runs/run_1',
    nodes: [
      {
        node_id: 'agent_1',
        callable_id: 'callable_1',
        status,
        run_dir: 'runs/run_1/nodes/agent_1',
        input_path: 'runs/run_1/nodes/agent_1/agent_payload.json',
        prompt_path: 'runs/run_1/nodes/agent_1/resolved_prompt.md',
        output_path: 'runs/run_1/nodes/agent_1/output.json',
        artifact_dir: 'runs/run_1/nodes/agent_1/artifacts',
        event_log: 'runs/run_1/nodes/agent_1/events.jsonl',
        stdout_log: 'runs/run_1/nodes/agent_1/stdout.log',
        stderr_log: 'runs/run_1/nodes/agent_1/stderr.log',
        errors: [],
      },
    ],
    edges: [],
    errors: [],
  };
}

function runProjection(partial: Partial<RunProjection> = {}): RunProjection {
  const graph = workflowGraph();
  return {
    runId: 'run_1',
    taskId: 'task_1',
    status: 'running',
    scope: 'task',
    targetId: graph.id,
    graph,
    runDir: 'runs/run_1',
    run: workflowRun('running'),
    events: [],
    overlay: null,
    pollState: 'idle',
    ...partial,
  };
}

function logDelta(partial: Partial<NodeLogDelta> = {}): NodeLogDelta {
  return {
    type: 'node_log_delta',
    run_id: 'run_1',
    node_id: 'agent_1',
    ui_node_id: 'workflow_1__internal__agent_1',
    node_run_dir: 'runs/run_1/nodes/agent_1',
    stream: 'stdout',
    offset: 0,
    next_offset: 5,
    text: 'hello',
    ...partial,
  };
}

function liveEvent(partial: Partial<WorkbenchLiveEvent> = {}): WorkbenchLiveEvent {
  return {
    event_id: 'live_1',
    seq: 1,
    source: 'run_node',
    run_id: 'run_1',
    node_id: 'agent_1',
    type: 'agent_message',
    text: 'hello',
    timestamp: '2026-06-20T00:00:00Z',
    ...partial,
  } as WorkbenchLiveEvent;
}

function agentEvent(partial: Partial<RunEvent> = {}): RunEvent {
  return {
    type: 'node_started',
    run_id: 'run_1',
    node_id: 'agent_1',
    timestamp: '2026-06-20T00:00:00Z',
    ...partial,
  };
}

function Harness({ initialRuns = { run_1: runProjection() } }: { initialRuns?: Record<string, RunProjection> }) {
  const [runsById, setRunsById] = useState<Record<string, RunProjection>>(initialRuns);
  const [runLogsById, setRunLogsById] = useState<Record<string, Record<string, NodeLiveLogs>>>({});
  const [liveEventsByRunId, setRunLiveEventsById] = useState<Record<string, WorkbenchLiveEvent[]>>({});

  latestActions = useRunProjectionActions({
    runsById,
    setRunsById,
    setRunLogsById,
    setRunLiveEventsById,
  });
  latestRunsById = runsById;
  latestRunLogsById = runLogsById;
  latestLiveEventsByRunId = liveEventsByRunId;

  return <output>run-projection-actions</output>;
}

describe('useRunProjectionActions', () => {
  beforeEach(() => {
    latestActions = null;
    latestRunsById = {};
    latestRunLogsById = {};
    latestLiveEventsByRunId = {};
    loadRunRefresh.mockResolvedValue({
      runId: 'run_1',
      summary: runSummary('success'),
      stateSnapshot: workflowRun('success'),
      events: [agentEvent({ type: 'workflow_completed' })],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('updates an existing run projection and ignores missing runs', () => {
    render(<Harness />);

    act(() => {
      latestActions?.updateRunProjection('run_1', (current) => ({ ...current, status: 'success' }));
      latestActions?.updateRunProjection('missing_run', (current) => ({ ...current, status: 'failed' }));
    });

    expect(latestRunsById.run_1.status).toBe('success');
    expect(latestRunsById.missing_run).toBeUndefined();
  });

  test('appends node log deltas to every selectable node log key', () => {
    render(<Harness />);

    act(() => {
      latestActions?.appendNodeLogDelta(logDelta());
    });

    expect(latestRunLogsById.run_1.workflow_1__internal__agent_1.stdout).toBe('hello');
    expect(latestRunLogsById.run_1['runs/run_1/nodes/agent_1'].stdout).toBe('hello');
    expect(latestRunLogsById.run_1.agent_1.stdout).toBe('hello');
  });

  test('merges agent events into the selected run projection', () => {
    render(<Harness />);

    act(() => {
      latestActions?.appendRunAgentEventToProjection('run_1', agentEvent());
      latestActions?.appendRunAgentEventToProjection('run_1', agentEvent());
    });

    expect(latestRunsById.run_1.events).toHaveLength(1);
    expect(latestRunsById.run_1.events[0]).toMatchObject({ type: 'node_started', node_id: 'agent_1' });
  });

  test('appends bounded live events by run id', () => {
    render(<Harness />);

    act(() => {
      latestActions?.appendRunLiveEvent('run_1', liveEvent());
      latestActions?.appendRunLiveEvent('run_1', liveEvent({ event_id: 'live_2', seq: 2 }));
    });

    expect(latestLiveEventsByRunId.run_1.map((event) => event.event_id)).toEqual(['live_1', 'live_2']);
  });

  test('refreshes a run projection from durable run state', async () => {
    render(<Harness />);

    await act(async () => {
      await latestActions?.refreshRunProjection('run_1');
    });

    expect(loadRunRefresh).toHaveBeenCalledWith('run_1');
    expect(latestRunsById.run_1.status).toBe('success');
    expect(latestRunsById.run_1.run?.status).toBe('success');
    expect(latestRunsById.run_1.overlay?.status).toBe('success');
    expect(latestRunsById.run_1.events).toEqual([expect.objectContaining({ type: 'workflow_completed' })]);
  });
});
