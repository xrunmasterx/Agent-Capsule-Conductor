import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { NodeLogDelta, RunEvent, RunSummary, WorkbenchLiveEvent, WorkflowGraph, WorkflowRunResult } from '../types';
import type { RunProjection } from '../types/workbench';
import { useRunStore } from '../stores/runStore';
import {
  useRunProjectionActions,
  type UseRunProjectionActionsResult,
} from './useRunProjectionActions';

const loadRunRefresh = vi.fn();

vi.mock('./useRunRefreshLoader', () => ({
  useRunRefreshLoader: () => loadRunRefresh,
}));

let latestActions: UseRunProjectionActionsResult | null = null;

function resetStore(): void {
  act(() => {
    useRunStore.setState(useRunStore.getInitialState(), true);
  });
}

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

function Harness() {
  latestActions = useRunProjectionActions();
  return <output>run-projection-actions</output>;
}

describe('useRunProjectionActions', () => {
  beforeEach(() => {
    resetStore();
    latestActions = null;
    loadRunRefresh.mockResolvedValue({
      runId: 'run_1',
      summary: runSummary('success'),
      stateSnapshot: workflowRun('success'),
      events: [agentEvent({ type: 'workflow_completed' })],
    });
    useRunStore.setState({ runsById: { run_1: runProjection() } });
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  test('updates an existing run projection and ignores missing runs', () => {
    render(<Harness />);

    act(() => {
      latestActions?.updateRunProjection('run_1', (current) => ({ ...current, status: 'success' }));
      latestActions?.updateRunProjection('missing_run', (current) => ({ ...current, status: 'failed' }));
    });

    expect(useRunStore.getState().runsById.run_1.status).toBe('success');
    expect(useRunStore.getState().runsById.missing_run).toBeUndefined();
  });

  test('appends node log deltas to every selectable node log key', () => {
    render(<Harness />);

    act(() => {
      latestActions?.appendNodeLogDeltas('run_1', [logDelta()]);
    });

    const logs = useRunStore.getState().runLogsById.run_1;
    expect(logs.workflow_1__internal__agent_1.stdout).toBe('hello');
    expect(logs['runs/run_1/nodes/agent_1'].stdout).toBe('hello');
    expect(logs.agent_1.stdout).toBe('hello');
  });

  test('ignores duplicate and backwards node log offsets', () => {
    render(<Harness />);

    act(() => {
      latestActions?.appendNodeLogDeltas('run_1', [
        logDelta({ offset: 0, next_offset: 5, text: 'hello' }),
        logDelta({ offset: 0, next_offset: 5, text: 'hello' }),
        logDelta({ offset: 2, next_offset: 7, text: 'llo!!' }),
        logDelta({ offset: 5, next_offset: 11, text: ' world' }),
      ]);
    });

    expect(useRunStore.getState().runLogsById.run_1.agent_1.stdout).toBe('hello world');
    expect(useRunStore.getState().runLogsById.run_1.agent_1.stdoutOffset).toBe(11);
  });

  test('merges agent events into the selected run projection', () => {
    render(<Harness />);

    act(() => {
      latestActions?.appendRunAgentEventsToProjection('run_1', [agentEvent(), agentEvent()]);
    });

    expect(useRunStore.getState().runsById.run_1.events).toHaveLength(1);
    expect(useRunStore.getState().runsById.run_1.events[0]).toMatchObject({ type: 'node_started', node_id: 'agent_1' });
  });

  test('appends bounded live events by run id', () => {
    render(<Harness />);

    act(() => {
      latestActions?.appendRunLiveEvents('run_1', [
        liveEvent(),
        liveEvent({ event_id: 'live_2', seq: 2 }),
      ]);
    });

    expect(useRunStore.getState().liveEventsByRunId.run_1.map((event) => event.event_id)).toEqual(['live_1', 'live_2']);
  });

  test('refreshes a run projection from durable run state', async () => {
    render(<Harness />);

    await act(async () => {
      await latestActions?.refreshRunProjection('run_1');
    });

    const run = useRunStore.getState().runsById.run_1;
    expect(loadRunRefresh).toHaveBeenCalledWith('run_1');
    expect(run.status).toBe('success');
    expect(run.run?.status).toBe('success');
    expect(run.overlay?.status).toBe('success');
    expect(run.events).toEqual([expect.objectContaining({ type: 'workflow_completed' })]);
  });
});
