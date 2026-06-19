import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { useRunStore, type RunProjection } from '../stores/runStore';
import type { RuntimeConfig, WorkbenchLiveEvent } from '../types';
import { useRunStoreBindings } from './useRunStoreBindings';

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

describe('useRunStoreBindings', () => {
  beforeEach(resetStore);
  afterEach(resetStore);

  test('projects run store state and setters', () => {
    const { result } = renderHook(() => useRunStoreBindings());

    act(() => {
      result.current.setRunsById({ run_1: run('run_1') });
      result.current.setRunLogsById({ run_1: { node_1: { stdout: 'out', stderr: '', stdoutOffset: 3, stderrOffset: 0 } } });
      result.current.setRunLiveEventsById({ run_1: [liveEvent('run_1')] });
      result.current.setRuntimeConfig(runtimeConfig());
    });

    expect(result.current.runsById.run_1?.runId).toBe('run_1');
    expect(result.current.runLogsById.run_1.node_1.stdout).toBe('out');
    expect(result.current.runLiveEventsById.run_1).toHaveLength(1);
    expect(result.current.runtimeConfig?.run_mode).toBe('hermetic');
  });

  test('preserves store updater semantics', () => {
    const { result } = renderHook(() => useRunStoreBindings());

    act(() => {
      result.current.setRunsById({ run_1: run('run_1') });
      result.current.setRunsById((current) => ({ ...current, run_2: run('run_2', 'task_2') }));
      result.current.setRunLogsById((current) => ({
        ...current,
        run_2: { node_2: { stdout: 'second', stderr: '', stdoutOffset: 6, stderrOffset: 0 } },
      }));
      result.current.setRunLiveEventsById((current) => ({ ...current, run_2: [liveEvent('run_2')] }));
    });

    expect(Object.keys(result.current.runsById)).toEqual(['run_1', 'run_2']);
    expect(result.current.runLogsById.run_2.node_2.stdoutOffset).toBe(6);
    expect(result.current.runLiveEventsById.run_2[0].run_id).toBe('run_2');
  });
});
