import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  useRunStore,
  type RunProjection,
} from '../stores/runStore';
import type { RuntimeConfig, WorkbenchLiveEvent } from '../types';
import {
  useRunLiveEvents,
  useRunLogsForRun,
  useRunProjection,
  useRunStoreActions,
  useRuntimeConfig,
} from './useRunStoreBindings';

function resetStore(): void {
  act(() => {
    useRunStore.setState(useRunStore.getInitialState(), true);
  });
}

function run(runId: string, taskId = 'task_1'): RunProjection {
  return {
    runId,
    taskId,
    status: 'queued',
    scope: 'task',
    targetId: 'root',
    graph: {
      id: 'root',
      name: 'Root',
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

function liveEvent(runId: string): WorkbenchLiveEvent {
  return {
    event_id: `${runId}-1`,
    seq: 1,
    source: 'run_node',
    run_id: runId,
    type: 'agent_status',
    text: 'running',
    timestamp: '2026-06-20T00:00:00Z',
  };
}

function runtimeConfig(): RuntimeConfig {
  return {
    run_mode: 'hermetic',
    external_agent_execution_enabled: false,
    real_external_agents_enabled: false,
  };
}

describe('useRunStoreBindings selected slices', () => {
  beforeEach(resetStore);
  afterEach(resetStore);

  test('exposes action binding plus selected run slices', () => {
    const { result } = renderHook(() => ({
      actions: useRunStoreActions(),
      runtimeConfig: useRuntimeConfig(),
      run: useRunProjection('run_1'),
      logs: useRunLogsForRun('run_1'),
      events: useRunLiveEvents('run_1'),
    }));

    act(() => {
      result.current.actions.upsertRun(run('run_1'));
      result.current.actions.setRunLogs('run_1', 'node_1', () => ({
        stdout: 'out',
        stderr: '',
        stdoutOffset: 3,
        stderrOffset: 0,
      }));
      result.current.actions.appendLiveEvents('run_1', [liveEvent('run_1')]);
      result.current.actions.setRuntimeConfig(runtimeConfig());
    });

    expect(result.current.run?.runId).toBe('run_1');
    expect(result.current.logs.node_1.stdout).toBe('out');
    expect(result.current.events).toHaveLength(1);
    expect(result.current.runtimeConfig?.run_mode).toBe('hermetic');
  });

  test('unrelated run updates do not change selected run fallback references', () => {
    const { result } = renderHook(() => ({
      run: useRunProjection('run_1'),
      logs: useRunLogsForRun('run_1'),
      events: useRunLiveEvents('run_1'),
    }));
    const initialLogs = result.current.logs;
    const initialEvents = result.current.events;

    act(() => {
      useRunStore.getState().upsertRun(run('run_2', 'task_2'));
      useRunStore.getState().appendLiveEvents('run_2', [liveEvent('run_2')]);
      useRunStore.getState().setRunLogs('run_2', 'node_2', () => ({
        stdout: 'second',
        stderr: '',
        stdoutOffset: 6,
        stderrOffset: 0,
      }));
    });

    expect(result.current.run).toBeUndefined();
    expect(result.current.logs).toBe(initialLogs);
    expect(result.current.events).toBe(initialEvents);
  });
});
