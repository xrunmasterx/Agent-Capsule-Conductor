import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import type { NodeRunSummary } from '../types';
import { useNodeRunDetails, type UseNodeRunDetailsOptions } from './useNodeRunDetails';

vi.mock('../api', () => ({
  api: {
    node: vi.fn(),
  },
}));

let latestDetails: ReturnType<typeof useNodeRunDetails> | null = null;

function nodeRun(overrides: Partial<NodeRunSummary> = {}): NodeRunSummary {
  return {
    node_id: 'node_a',
    callable_id: 'callable_a',
    status: 'running',
    run_dir: 'runs/run_1/node_a',
    ...overrides,
  };
}

function mergeDetail(base: NodeRunSummary, detail: NodeRunSummary): NodeRunSummary {
  return {
    ...base,
    ...detail,
    status: detail.status || base.status,
    run_dir: detail.run_dir || base.run_dir,
  };
}

function Harness(options: UseNodeRunDetailsOptions) {
  latestDetails = useNodeRunDetails(options);
  return <output>{Object.keys(latestDetails.nodeRunDetailsByKey).join(',')}</output>;
}

describe('useNodeRunDetails', () => {
  beforeEach(() => {
    latestDetails = null;
    vi.mocked(api.node).mockResolvedValue(
      nodeRun({
        status: 'success',
        output_path: 'out/output.json',
      }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('does not load without a selected run, node, or detail key', () => {
    render(<Harness runId={null} nodeRun={nodeRun()} detailKey="key_a" mergeDetail={mergeDetail} />);
    render(<Harness runId="run_1" nodeRun={null} detailKey="key_a" mergeDetail={mergeDetail} />);
    render(<Harness runId="run_1" nodeRun={nodeRun()} detailKey="" mergeDetail={mergeDetail} />);

    expect(api.node).not.toHaveBeenCalled();
  });

  test('loads and caches selected node run details', async () => {
    render(<Harness runId="run_1" nodeRun={nodeRun()} detailKey="key_a" mergeDetail={mergeDetail} />);

    await waitFor(() => {
      expect(latestDetails?.nodeRunDetailsByKey.key_a).toMatchObject({
        status: 'success',
        output_path: 'out/output.json',
      });
    });

    expect(api.node).toHaveBeenCalledWith('run_1', 'node_a');
  });

  test('does not reload when the same detail key is already cached', async () => {
    const view = render(
      <Harness runId="run_1" nodeRun={nodeRun()} detailKey="key_a" mergeDetail={mergeDetail} />,
    );
    await waitFor(() => {
      expect(latestDetails?.nodeRunDetailsByKey.key_a).toBeDefined();
    });

    view.rerender(
      <Harness runId="run_1" nodeRun={nodeRun()} detailKey="key_a" mergeDetail={mergeDetail} />,
    );

    expect(api.node).toHaveBeenCalledTimes(1);
  });

  test('suppresses stale detail responses after cleanup', async () => {
    let resolveDetail: (detail: NodeRunSummary) => void = () => {};
    vi.mocked(api.node).mockReturnValueOnce(
      new Promise<NodeRunSummary>((resolve) => {
        resolveDetail = resolve;
      }),
    );
    const view = render(
      <Harness runId="run_1" nodeRun={nodeRun()} detailKey="key_a" mergeDetail={mergeDetail} />,
    );

    view.unmount();
    resolveDetail(nodeRun({ status: 'success' }));
    await Promise.resolve();

    expect(latestDetails?.nodeRunDetailsByKey.key_a).toBeUndefined();
  });

  test('keeps lightweight summaries usable when detail loading fails', async () => {
    vi.mocked(api.node).mockRejectedValueOnce(new Error('missing'));
    render(<Harness runId="run_1" nodeRun={nodeRun()} detailKey="key_a" mergeDetail={mergeDetail} />);

    await waitFor(() => {
      expect(api.node).toHaveBeenCalledTimes(1);
    });
    expect(latestDetails?.nodeRunDetailsByKey.key_a).toBeUndefined();
  });
});
