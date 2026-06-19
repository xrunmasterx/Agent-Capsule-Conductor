import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import type { RunSummary, WorkflowRunResult } from '../types';
import { useRunRefreshLoader } from './useRunRefreshLoader';

vi.mock('../api', () => ({
  api: {
    run: vi.fn(),
    runState: vi.fn(),
    runEvents: vi.fn(),
  },
}));

let latestLoad: ((runId: string) => Promise<unknown>) | null = null;

function runSummary(runId = 'run_1'): RunSummary {
  return {
    run_id: runId,
    workflow_id: 'workflow_a',
    status: 'success',
    run_dir: `runs/${runId}`,
    node_count: 0,
    failed_nodes: [],
    nodes: [],
  };
}

function runState(runId = 'run_1'): WorkflowRunResult {
  return {
    workflow_id: 'workflow_a',
    status: 'success',
    run_dir: `runs/${runId}`,
    nodes: [],
    edges: [],
  };
}

function Harness() {
  latestLoad = useRunRefreshLoader();
  return <output>run-refresh</output>;
}

describe('useRunRefreshLoader', () => {
  beforeEach(() => {
    latestLoad = null;
    vi.mocked(api.run).mockResolvedValue(runSummary());
    vi.mocked(api.runState).mockResolvedValue(runState());
    vi.mocked(api.runEvents).mockResolvedValue({
      run_id: 'run_1',
      event_log: 'events.jsonl',
      events: [{ type: 'run_completed', run_id: 'run_1' }],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('loads run summary, state snapshot, and events', async () => {
    render(<Harness />);

    await expect(latestLoad?.('run_1')).resolves.toMatchObject({
      runId: 'run_1',
      summary: { run_id: 'run_1' },
      stateSnapshot: { workflow_id: 'workflow_a' },
      events: [{ type: 'run_completed' }],
    });

    expect(api.run).toHaveBeenCalledWith('run_1');
    expect(api.runState).toHaveBeenCalledWith('run_1');
    expect(api.runEvents).toHaveBeenCalledWith('run_1');
  });

  test('returns null state and empty events when optional projections are unavailable', async () => {
    vi.mocked(api.runState).mockRejectedValueOnce(new Error('state missing'));
    vi.mocked(api.runEvents).mockRejectedValueOnce(new Error('events missing'));
    render(<Harness />);

    await expect(latestLoad?.('run_1')).resolves.toMatchObject({
      stateSnapshot: null,
      events: [],
    });
  });
});
