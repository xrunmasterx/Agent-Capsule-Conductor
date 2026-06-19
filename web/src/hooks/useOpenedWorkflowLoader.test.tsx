import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import type { WorkflowDetail } from '../types';
import { useOpenedWorkflowLoader, type UseOpenedWorkflowLoaderOptions } from './useOpenedWorkflowLoader';

vi.mock('../api', () => ({
  api: {
    workflow: vi.fn(),
  },
}));

function workflow(id: string): WorkflowDetail {
  return {
    workflow_id: id,
    file_id: `${id}.accflow.json`,
    path: `workflows/${id}.accflow.json`,
    workflow: {},
    graph: {
      id,
      name: id,
      version: '1',
      nodes: [],
      edges: [],
    },
  };
}

function Harness(options: UseOpenedWorkflowLoaderOptions) {
  useOpenedWorkflowLoader(options);
  return <output>{options.workflowId || 'none'}</output>;
}

describe('useOpenedWorkflowLoader', () => {
  beforeEach(() => {
    vi.mocked(api.workflow).mockImplementation(async (workflowId) => workflow(workflowId));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('does not load when disabled or missing a workflow id', () => {
    const onWorkflowLoaded = vi.fn();

    render(<Harness enabled={false} workflowId="workflow_a" onWorkflowLoaded={onWorkflowLoaded} />);
    render(<Harness enabled workflowId="" onWorkflowLoaded={onWorkflowLoaded} />);

    expect(api.workflow).not.toHaveBeenCalled();
    expect(onWorkflowLoaded).not.toHaveBeenCalled();
  });

  test('loads the selected workflow and calls the latest callback', async () => {
    const firstCallback = vi.fn();
    const latestCallback = vi.fn();
    const view = render(
      <Harness enabled workflowId="workflow_a" onWorkflowLoaded={firstCallback} />,
    );
    view.rerender(
      <Harness enabled workflowId="workflow_a" onWorkflowLoaded={latestCallback} />,
    );

    await waitFor(() => {
      expect(latestCallback).toHaveBeenCalledWith(expect.objectContaining({ workflow_id: 'workflow_a' }));
    });

    expect(firstCallback).not.toHaveBeenCalled();
    expect(api.workflow).toHaveBeenCalledTimes(1);
  });

  test('suppresses stale workflow responses after cleanup', async () => {
    let resolveWorkflow: (workflow: WorkflowDetail) => void = () => {};
    vi.mocked(api.workflow).mockReturnValueOnce(
      new Promise<WorkflowDetail>((resolve) => {
        resolveWorkflow = resolve;
      }),
    );
    const onWorkflowLoaded = vi.fn();
    const view = render(
      <Harness enabled workflowId="workflow_a" onWorkflowLoaded={onWorkflowLoaded} />,
    );

    view.unmount();
    resolveWorkflow(workflow('workflow_a'));
    await Promise.resolve();

    expect(onWorkflowLoaded).not.toHaveBeenCalled();
  });

  test('reports load errors through the optional error callback', async () => {
    vi.mocked(api.workflow).mockRejectedValueOnce(new Error('load failed'));
    const onError = vi.fn();

    render(
      <Harness
        enabled
        workflowId="workflow_a"
        onWorkflowLoaded={vi.fn()}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
