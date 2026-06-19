import { render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import type { WorkflowGraph } from '../types';
import { useWorkflowPersistence } from './useWorkflowPersistence';

vi.mock('../api', () => ({
  api: {
    saveWorkflow: vi.fn(),
    validateWorkflow: vi.fn(),
  },
}));

let latestActions: ReturnType<typeof useWorkflowPersistence> | null = null;

function workflowGraph(): WorkflowGraph {
  return {
    id: 'workflow_1',
    name: 'Workflow 1',
    version: '1.0.0',
    nodes: [],
    edges: [],
  };
}

function Harness() {
  latestActions = useWorkflowPersistence();
  return <output>workflow-persistence</output>;
}

describe('useWorkflowPersistence', () => {
  afterEach(() => {
    latestActions = null;
    vi.clearAllMocks();
  });

  test('saves workflow graphs with explicit force semantics', async () => {
    vi.mocked(api.saveWorkflow).mockResolvedValue({
      status: 'saved',
      workflow_id: 'workflow_1',
      canonical_preview: { workflow_id: 'workflow_1' },
    });
    const graph = workflowGraph();
    render(<Harness />);

    const result = await latestActions?.saveWorkflowGraph(graph, true);

    expect(api.saveWorkflow).toHaveBeenCalledWith(graph, true);
    expect(result?.canonical_preview).toEqual({ workflow_id: 'workflow_1' });
  });

  test('validates saved workflow ids', async () => {
    vi.mocked(api.validateWorkflow).mockResolvedValue({
      status: 'valid',
      workflow_id: 'workflow_1',
    });
    render(<Harness />);

    const result = await latestActions?.validateWorkflowGraph('workflow_1');

    expect(api.validateWorkflow).toHaveBeenCalledWith('workflow_1');
    expect(result?.status).toBe('valid');
  });
});
