import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { PortList } from './PortList';

describe('PortList', () => {
  test('renders port labels and contract metadata', () => {
    render(
      <PortList
        title="Inputs"
        ports={[
          { id: 'main', label: 'Main input', direction: 'input', required: true, cardinality: 'one' },
          { id: 'context', label: 'Context', direction: 'input', required: false, cardinality: 'many' },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Inputs' })).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('Main input')).toBeInTheDocument();
    expect(screen.getByText('required / one')).toBeInTheDocument();
    expect(screen.getByText('optional / many')).toBeInTheDocument();
  });
});
