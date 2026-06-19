import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { InvocationIdentityCard } from './InvocationIdentityCard';

describe('InvocationIdentityCard', () => {
  test('renders identity fields and optional references', () => {
    render(
      <InvocationIdentityCard
        scope="workflow:fundamentals"
        nodeId="summary_agent"
        label="Summary"
        callableId="stock-research-synthesis.codex"
        workflowRef="workflows/demo"
      />,
    );

    expect(screen.getByText('workflow:fundamentals')).toBeInTheDocument();
    expect(screen.getByText('summary_agent')).toBeInTheDocument();
    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getByText('stock-research-synthesis.codex')).toBeInTheDocument();
    expect(screen.getByText('workflows/demo')).toBeInTheDocument();
  });

  test('edits invocation label when a change handler is provided', () => {
    const onLabelChange = vi.fn();
    render(
      <InvocationIdentityCard
        scope="root"
        nodeId="agent_a"
        label="Old label"
        onLabelChange={onLabelChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Invocation label'), { target: { value: 'New label' } });

    expect(onLabelChange).toHaveBeenCalledWith('New label');
  });
});
