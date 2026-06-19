import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  selectActiveRunForTask,
  selectRunLogs,
  selectTaskRunIds,
  useRunStore,
  type RunProjection,
} from './runStore';
import type { WorkbenchLiveEvent } from '../types';

function resetStore(): void {
  useRunStore.setState(useRunStore.getInitialState(), true);
}

function run(runId: string, taskId: string, nodeId = 'root'): RunProjection {
  return {
    runId,
    taskId,
    status: 'queued',
    scope: 'task',
    targetId: nodeId,
    graph: {
      id: nodeId,
      name: nodeId,
      version: '2.0',
      nodes: [],
      edges: [],
      control_edges: [],
      data_edges: [],
    },
    runDir: `runs/${runId}`,
    run: null,
    events: [],
    overlay: null,
    pollState: 'idle',
  };
}

function liveEvent(runId: string, seq: number): WorkbenchLiveEvent {
  return {
    event_id: `${runId}-${seq}`,
    seq,
    source: 'run_node',
    run_id: runId,
    type: 'agent_status',
    text: `event ${seq}`,
    timestamp: `2026-06-19T00:00:0${seq}Z`,
  };
}

describe('runStore ownership', () => {
  beforeEach(resetStore);

  test('partitions runs and active run ids by task', () => {
    useRunStore.getState().upsertRun(run('run_1', 'task_a'));
    useRunStore.getState().upsertRun(run('run_2', 'task_b'));
    useRunStore.getState().setActiveRunForTask('task_a', 'run_1');
    useRunStore.getState().setActiveRunForTask('task_b', 'run_2');

    const state = useRunStore.getState();
    expect(selectTaskRunIds(state, 'task_a')).toEqual(['run_1']);
    expect(selectTaskRunIds(state, 'task_b')).toEqual(['run_2']);
    expect(selectActiveRunForTask(state, 'task_a')?.runId).toBe('run_1');
    expect(selectActiveRunForTask(state, 'task_b')?.runId).toBe('run_2');
  });

  test('keeps same node id logs isolated by run id', () => {
    useRunStore.getState().upsertRun(run('run_1', 'task_a'));
    useRunStore.getState().upsertRun(run('run_2', 'task_b'));

    useRunStore.getState().setRunLogs('run_1', 'shared_node', (previous) => ({
      ...previous,
      stdout: 'from run 1',
      stdoutOffset: 10,
    }));
    useRunStore.getState().setRunLogs('run_2', 'shared_node', (previous) => ({
      ...previous,
      stdout: 'from run 2',
      stdoutOffset: 20,
    }));

    const state = useRunStore.getState();
    expect(selectRunLogs(state, 'run_1', 'shared_node').stdout).toBe('from run 1');
    expect(selectRunLogs(state, 'run_2', 'shared_node').stdout).toBe('from run 2');
  });

  test('ignores live events and logs for unknown run ids', () => {
    useRunStore.getState().appendLiveEvent('missing_run', liveEvent('missing_run', 1));
    useRunStore.getState().setRunLogs('missing_run', 'node', (previous) => ({
      ...previous,
      stdout: 'should be ignored',
    }));

    const state = useRunStore.getState();
    expect(state.liveEventsByRunId.missing_run).toBeUndefined();
    expect(state.runLogsById.missing_run).toBeUndefined();
  });

  test('removing a run clears indexes, live events, logs, and active run pointer', () => {
    useRunStore.getState().upsertRun(run('run_1', 'task_a'));
    useRunStore.getState().setActiveRunForTask('task_a', 'run_1');
    useRunStore.getState().appendLiveEvent('run_1', liveEvent('run_1', 1));
    useRunStore.getState().setRunLogs('run_1', 'node', (previous) => ({ ...previous, stdout: 'log' }));

    useRunStore.getState().removeRun('run_1');
    const state = useRunStore.getState();

    expect(state.runsById.run_1).toBeUndefined();
    expect(state.runIdsByTaskId.task_a).toEqual([]);
    expect(state.activeRunIdsByTaskId.task_a).toBeNull();
    expect(state.liveEventsByRunId.run_1).toBeUndefined();
    expect(state.runLogsById.run_1).toBeUndefined();
  });

  test('does not import API, ReactFlow, or WorkflowViewer dependencies', () => {
    const source = readFileSync(join(process.cwd(), 'src/stores/runStore.ts'), 'utf8');
    expect(source).not.toContain('api.');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('@xyflow/react');
    expect(source).not.toContain('WorkflowViewer');
  });
});
