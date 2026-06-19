import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { PropertyGroups } from './PropertyGroups';

describe('PropertyGroups', () => {
  test('renders grouped property rows', () => {
    render(
      <PropertyGroups
        groups={[
          {
            title: '节点',
            rows: [
              { label: 'scope', value: 'workflow:fundamentals' },
              { label: 'status', value: 'ready' },
            ],
          },
          {
            title: '运行',
            rows: [{ label: 'run_id', value: 'run_123' }],
          },
        ]}
      />,
    );

    expect(screen.getAllByText('属性')).toHaveLength(2);
    expect(screen.getByText('节点')).toBeInTheDocument();
    expect(screen.getByText('workflow:fundamentals')).toBeInTheDocument();
    expect(screen.getByText('run_123')).toBeInTheDocument();
  });
});
