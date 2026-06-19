import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { EventTimeline } from './EventTimeline';

describe('EventTimeline', () => {
  test('renders empty event state', () => {
    render(<EventTimeline title="运行事件" events={[]} />);

    expect(screen.getByLabelText('运行事件')).toBeInTheDocument();
    expect(screen.getByText('暂无事件')).toBeInTheDocument();
  });

  test('renders latest events in reverse chronological display order', () => {
    render(
      <EventTimeline
        title="运行事件"
        events={[
          { type: 'node_started', node_id: 'agent_a', status: 'running', timestamp: '2026-06-20T00:00:00Z' },
          { type: 'node_finished', node_id: 'agent_a', status: 'success', timestamp: '2026-06-20T00:00:01Z' },
        ]}
      />,
    );

    const eventTypes = screen.getAllByText(/node_/u).map((element) => element.textContent);
    expect(eventTypes).toEqual(['node_finished', 'node_started']);
    expect(screen.getAllByText('node=agent_a')).toHaveLength(2);
    expect(screen.getByText('success')).toBeInTheDocument();
  });
});
