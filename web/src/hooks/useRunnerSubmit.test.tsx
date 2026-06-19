import { render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { runnerApi } from '../api';
import type { WorkflowGraph } from '../types';
import { useRunnerSubmit } from './useRunnerSubmit';

vi.mock('../api', () => ({
  runnerApi: {
    submitJob: vi.fn(),
  },
}));

let latestActions: ReturnType<typeof useRunnerSubmit> | null = null;

function workflowGraph(): WorkflowGraph {
  return {
    id: 'run_1',
    name: 'Run 1',
    version: '1.0.0',
    nodes: [],
    edges: [],
  };
}

function Harness() {
  latestActions = useRunnerSubmit();
  return <output>runner-submit</output>;
}

describe('useRunnerSubmit', () => {
  afterEach(() => {
    latestActions = null;
    vi.clearAllMocks();
  });

  test('submits runner jobs without rewriting submit options', async () => {
    vi.mocked(runnerApi.submitJob).mockResolvedValue({
      schema_version: 'acc.runner.job.v1',
      runner_id: 'local-runner',
      workspace_alias: 'default',
      job_id: 'job_1',
      run_id: 'run_1',
      task_id: 'task_1',
      workflow_id: 'workflow_1',
      status: 'queued',
    });
    const graph = workflowGraph();
    const options = {
      runId: 'run_1',
      taskId: 'task_1',
      bindingRef: 'bindings/workflow_1',
    };
    render(<Harness />);

    const result = await latestActions?.submitRunnerJob(graph, options);

    expect(runnerApi.submitJob).toHaveBeenCalledWith(graph, options);
    expect(result?.status).toBe('queued');
  });
});
