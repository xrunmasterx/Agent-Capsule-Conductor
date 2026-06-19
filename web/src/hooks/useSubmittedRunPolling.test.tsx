import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import type { RunSummary } from '../types';
import { useSubmittedRunPolling } from './useSubmittedRunPolling';

vi.mock('../api', () => ({
  api: {
    run: vi.fn(),
    runState: vi.fn(),
    runEvents: vi.fn(),
  },
}));

let latestActions: ReturnType<typeof useSubmittedRunPolling> | null = null;

function summary(status: string): RunSummary {
  return {
    run_id: 'run_1',
    workflow_id: 'workflow_1',
    status,
    run_dir: 'runs/run_1',
    node_count: 0,
    failed_nodes: [],
    nodes: [],
  };
}

function runEvents() {
  return {
    run_id: 'run_1',
    event_log: 'runs/run_1/events.jsonl',
    events: [],
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function Harness() {
  latestActions = useSubmittedRunPolling();
  return <output>submitted-run-polling</output>;
}

describe('useSubmittedRunPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    latestActions = null;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test('polls run snapshots and continues while the caller reports an active run', async () => {
    vi.mocked(api.run)
      .mockResolvedValueOnce(summary('running'))
      .mockResolvedValueOnce(summary('success'));
    vi.mocked(api.runState).mockRejectedValue(new Error('state missing'));
    vi.mocked(api.runEvents).mockResolvedValue(runEvents());
    const onSnapshot = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const onError = vi.fn();

    render(<Harness />);
    vi.mocked(api.run).mockResolvedValue(summary('running'));
    latestActions?.pollSubmittedRunUntilTerminal({
      runId: 'run_1',
      foreground: true,
      onSnapshot,
      onError,
    });

    await flushPromises();
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(onSnapshot).toHaveBeenCalledTimes(2);

    expect(api.run).toHaveBeenCalledWith('run_1');
    expect(onSnapshot.mock.calls[0][0]).toEqual({
      summary: summary('running'),
      stateSnapshot: null,
      events: [],
    });
    expect(onError).not.toHaveBeenCalled();
  });

  test('falls back when optional state and event reads fail', async () => {
    vi.mocked(api.run).mockResolvedValue(summary('success'));
    vi.mocked(api.runState).mockRejectedValue(new Error('state missing'));
    vi.mocked(api.runEvents).mockRejectedValue(new Error('events missing'));
    const onSnapshot = vi.fn().mockReturnValue(false);

    render(<Harness />);
    latestActions?.pollSubmittedRunUntilTerminal({
      runId: 'run_1',
      foreground: false,
      onSnapshot,
      onError: vi.fn(),
    });

    await flushPromises();
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot.mock.calls[0][0]).toEqual({
      summary: summary('success'),
      stateSnapshot: null,
      events: [],
    });
  });

  test('retries failed polls in the background and clears pending timers on unmount', async () => {
    vi.mocked(api.run)
      .mockRejectedValueOnce(new Error('run missing'))
      .mockResolvedValueOnce(summary('success'));
    vi.mocked(api.runState).mockRejectedValue(new Error('state missing'));
    vi.mocked(api.runEvents).mockResolvedValue(runEvents());
    const onSnapshot = vi.fn().mockReturnValue(false);
    const onError = vi.fn();

    const view = render(<Harness />);
    latestActions?.pollSubmittedRunUntilTerminal({
      runId: 'run_1',
      foreground: true,
      onSnapshot,
      onError,
    });

    await flushPromises();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSnapshot).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2500);
    await flushPromises();
    expect(onSnapshot).toHaveBeenCalledTimes(1);

    latestActions?.pollSubmittedRunUntilTerminal({
      runId: 'run_1',
      foreground: true,
      onSnapshot: vi.fn().mockReturnValue(true),
      onError: vi.fn(),
    });
    await flushPromises();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
