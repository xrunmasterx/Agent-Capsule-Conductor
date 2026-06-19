import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import type { WorkbenchLiveEvent } from '../../types';
import { LiveOutputViewer } from './RunOverlay';

const events: WorkbenchLiveEvent[] = [
  {
    event_id: 'stdout-1',
    seq: 1,
    timestamp: '2026-06-19T10:00:00Z',
    source: 'run_node',
    type: 'node_log_delta',
    stream: 'stdout',
    text: 'stdout line',
    payload: {},
  },
  {
    event_id: 'stderr-1',
    seq: 2,
    timestamp: '2026-06-19T10:00:01Z',
    source: 'run_node',
    type: 'node_log_delta',
    stream: 'stderr',
    text: 'stderr line',
    payload: {},
  },
  {
    event_id: 'assistant-1',
    seq: 3,
    timestamp: '2026-06-19T10:00:02Z',
    source: 'agent_turn',
    type: 'agent_message',
    stream: 'agent',
    text: '',
    payload: { content: 'assistant summary' },
  },
];

describe('LiveOutputViewer', () => {
  test('renders ACC transcript filters and filters visible lines', () => {
    render(<LiveOutputViewer events={events} status="running" emptyText="no output" />);

    expect(screen.getByText('实时输出')).toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '输出' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '日志' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'raw' })).toBeInTheDocument();
    expect(screen.getByText('assistant summary')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'stdout' }));
    expect(screen.getByText('stdout line')).toBeInTheDocument();
    expect(screen.queryByText('stderr line')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'stderr' }));
    expect(screen.getByText('stderr line')).toBeInTheDocument();
    expect(screen.queryByText('stdout line')).not.toBeInTheDocument();
  });

  test('shows jump-to-latest when the output is not pinned to bottom', () => {
    render(<LiveOutputViewer events={events} status="success" emptyText="no output" />);

    const log = screen.getByRole('log');
    Object.defineProperties(log, {
      scrollHeight: { value: 1000, configurable: true },
      scrollTop: { value: 0, writable: true, configurable: true },
      clientHeight: { value: 200, configurable: true },
    });

    fireEvent.scroll(log);
    const jump = screen.getByRole('button', { name: '跳到最新' });
    expect(jump).toBeInTheDocument();

    fireEvent.click(jump);
    expect(within(screen.getByRole('log')).getByText('assistant summary')).toBeInTheDocument();
  });
});
