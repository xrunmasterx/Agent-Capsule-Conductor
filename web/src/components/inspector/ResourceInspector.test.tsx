import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { ResourceInspector } from './ResourceInspector';

describe('ResourceInspector', () => {
  test('renders workflow class identity and path', () => {
    render(
      <ResourceInspector
        resource={{
          kind: 'workflow_class',
          workflowId: 'workflows/research',
          path: 'workflows/research.accflow.json',
          name: 'Research Workflow',
        }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Research Workflow' })).toBeInTheDocument();
    expect(screen.getByText('Workflow Class')).toBeInTheDocument();
    expect(screen.getByText('workflows/research')).toBeInTheDocument();
    expect(screen.getByText('workflows/research.accflow.json')).toBeInTheDocument();
  });

  test('renders callable class identity without workflow path', () => {
    render(
      <ResourceInspector
        resource={{
          kind: 'agent_class',
          callableId: 'stock.agent',
          name: 'Stock Agent',
        }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Stock Agent' })).toBeInTheDocument();
    expect(screen.getByText('Agent Class')).toBeInTheDocument();
    expect(screen.getByText('stock.agent')).toBeInTheDocument();
    expect(screen.queryByText('路径')).not.toBeInTheDocument();
  });
});
