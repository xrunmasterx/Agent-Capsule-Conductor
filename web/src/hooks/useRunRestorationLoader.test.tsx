import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import type { RunSummary, WorkflowRunResult } from '../types';
import {
  useRunRestorationLoader,
  type UseRunRestorationLoaderOptions,
} from './useRunRestorationLoader';

vi.mock('../api', () => ({
  api: {
    run: vi.fn(),
    runState: vi.fn(),
    runEvents: vi.fn(),
  },
}));

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

function Harness(options: UseRunRestorationLoaderOptions) {
  useRunRestorationLoader(options);
  return <output>{options.runId || 'none'}</output>;
}

describe('useRunRestorationLoader', () => {
  beforeEach(() => {
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

  test('does not load when disabled or missing a run id', () => {
    render(<Harness enabled={false} runId="run_1" onLoaded={vi.fn()} />);
    render(<Harness enabled runId="" onLoaded={vi.fn()} />);

    expect(api.run).not.toHaveBeenCalled();
  });

  test('loads run summary, state snapshot, and events', async () => {
    const onLoaded = vi.fn();
    render(<Harness enabled runId="run_1" onLoaded={onLoaded} />);

    await waitFor(() => {
      expect(onLoaded).toHaveBeenCalledWith({
        runId: 'run_1',
        summary: expect.objectContaining({ run_id: 'run_1' }),
        stateSnapshot: expect.objectContaining({ workflow_id: 'workflow_a' }),
        events: [expect.objectContaining({ type: 'run_completed' })],
      });
    });

    expect(api.run).toHaveBeenCalledWith('run_1');
    expect(api.runState).toHaveBeenCalledWith('run_1');
    expect(api.runEvents).toHaveBeenCalledWith('run_1');
  });

  test('still reports summary when state and events are unavailable', async () => {
    vi.mocked(api.runState).mockRejectedValueOnce(new Error('state missing'));
    vi.mocked(api.runEvents).mockRejectedValueOnce(new Error('events missing'));
    const onLoaded = vi.fn();
    render(<Harness enabled runId="run_1" onLoaded={onLoaded} />);

    await waitFor(() => {
      expect(onLoaded).toHaveBeenCalledWith(
        expect.objectContaining({
          stateSnapshot: null,
          events: null,
        }),
      );
    });
  });

  test('suppresses stale run responses after cleanup', async () => {
    let resolveRun: (summary: RunSummary) => void = () => {};
    vi.mocked(api.run).mockReturnValueOnce(
      new Promise<RunSummary>((resolve) => {
        resolveRun = resolve;
      }),
    );
    const onLoaded = vi.fn();
    const view = render(<Harness enabled runId="run_1" onLoaded={onLoaded} />);

    view.unmount();
    resolveRun(runSummary());
    await Promise.resolve();

    expect(onLoaded).not.toHaveBeenCalled();
  });

  test('reports summary load failures through the optional error callback', async () => {
    vi.mocked(api.run).mockRejectedValueOnce(new Error('run missing'));
    const onLoadFailed = vi.fn();
    render(<Harness enabled runId="run_1" onLoaded={vi.fn()} onLoadFailed={onLoadFailed} />);

    await waitFor(() => {
      expect(onLoadFailed).toHaveBeenCalledWith('run_1', expect.any(Error));
    });
  });
});
