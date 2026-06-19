import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import type { AgentSessionRecord, AgentTurnRecord, RunEvent } from '../types';
import {
  useSelectedAgentSession,
  type AgentSessionUiState,
  type SelectedAgentSessionContext,
} from './useSelectedAgentSession';

vi.mock('../api', () => ({
  api: {
    createAgentSessionFromRunNode: vi.fn(),
    getAgentSessionMessages: vi.fn(),
    nodeEvents: vi.fn(),
    runInteractions: vi.fn(),
    getAgentSession: vi.fn(),
    getAgentTurnEvents: vi.fn(),
  },
}));

let latestState: AgentSessionUiState | null = null;
let latestRefresh: (() => Promise<void>) | null = null;
let latestSetPendingTurn: ((turn: AgentTurnRecord | null) => void) | null = null;

function session(partial: Partial<AgentSessionRecord> = {}): AgentSessionRecord {
  return {
    session_id: 'session_1',
    status: 'ready',
    last_turn_id: 'turn_1',
    ...partial,
  };
}

function Harness({ context }: { context: SelectedAgentSessionContext | null }) {
  const result = useSelectedAgentSession(context);
  latestState = result.state;
  latestRefresh = result.refresh;
  latestSetPendingTurn = result.setPendingTurn;
  return <output>{result.state.status}</output>;
}

const context: SelectedAgentSessionContext = {
  runId: 'run_1',
  nodeId: 'node_1',
  uiNodeId: 'ui_node_1',
  parentNodeId: 'workflow_1',
  nodeRunDir: 'runs/run_1/node_1',
};

describe('useSelectedAgentSession', () => {
  beforeEach(() => {
    latestState = null;
    latestRefresh = null;
    latestSetPendingTurn = null;
    vi.mocked(api.createAgentSessionFromRunNode).mockResolvedValue(session());
    vi.mocked(api.getAgentSessionMessages).mockResolvedValue({
      session_id: 'session_1',
      messages: [{ role: 'assistant', content: 'hello', turn_id: 'turn_1' }],
    });
    vi.mocked(api.nodeEvents).mockResolvedValue({
      run_id: 'run_1',
      node_id: 'node_1',
      event_log: 'events.jsonl',
      events: [{ event_id: 'event_1', type: 'agent_message' } as RunEvent],
    });
    vi.mocked(api.runInteractions).mockResolvedValue({
      run_id: 'run_1',
      interactions: [
        {
          interaction_id: 'ix_1',
          run_id: 'run_1',
          kind: 'approval',
          status: 'pending',
          node_id: 'node_1',
          prompt: 'approve',
          created_at: '2026-06-19T00:00:00Z',
        },
        {
          interaction_id: 'ix_2',
          run_id: 'run_1',
          kind: 'approval',
          status: 'pending',
          node_id: 'other_node',
          prompt: 'approve',
          created_at: '2026-06-19T00:00:00Z',
        },
        {
          interaction_id: 'ix_3',
          run_id: 'run_1',
          kind: 'approval',
          status: 'answered',
          node_id: 'node_1',
          prompt: 'approve',
          created_at: '2026-06-19T00:00:00Z',
        },
      ],
    });
    vi.mocked(api.getAgentSession).mockResolvedValue(session());
    vi.mocked(api.getAgentTurnEvents).mockResolvedValue({
      session_id: 'session_1',
      turn_id: 'turn_1',
      events: [{ event_id: 'turn_event_1', type: 'agent_message' } as RunEvent],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test('resets to idle when there is no selected agent context', async () => {
    render(<Harness context={null} />);

    await waitFor(() => expect(latestState?.status).toBe('idle'));
    expect(api.createAgentSessionFromRunNode).not.toHaveBeenCalled();
  });

  test('loads session messages node events and pending interactions for the selected node', async () => {
    render(<Harness context={context} />);

    await waitFor(() => expect(latestState?.status).toBe('ready'));
    expect(api.createAgentSessionFromRunNode).toHaveBeenCalledWith('run_1', 'node_1', {
      nodeRunDir: 'runs/run_1/node_1',
      uiNodeId: 'ui_node_1',
      parentNodeId: 'workflow_1',
    });
    expect(latestState?.messages).toEqual([expect.objectContaining({ content: 'hello' })]);
    expect(latestState?.events).toEqual([expect.objectContaining({ event_id: 'event_1' })]);
    expect(latestState?.interactions).toEqual([
      expect.objectContaining({ interaction_id: 'ix_1' }),
    ]);
  });

  test('reports load errors without keeping stale session state', async () => {
    vi.mocked(api.createAgentSessionFromRunNode).mockRejectedValue(new Error('load failed'));

    render(<Harness context={context} />);

    await waitFor(() => expect(latestState?.status).toBe('error'));
    expect(latestState?.session).toBeNull();
    expect(latestState?.error).toBe('load failed');
  });

  test('polls pending turns and clears them when the session leaves running state', async () => {
    vi.mocked(api.getAgentSession).mockResolvedValue(session({ status: 'success' }));
    render(<Harness context={context} />);
    await waitFor(() => expect(latestState?.status).toBe('ready'));

    vi.useFakeTimers();
    act(() => {
      latestSetPendingTurn?.({
        session_id: 'session_1',
        turn_id: 'turn_1',
        status: 'running',
      });
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(api.getAgentTurnEvents).toHaveBeenCalledWith('session_1', 'turn_1');
    expect(latestState?.pendingTurn).toBeNull();
    expect(latestState?.events).toEqual([
      expect.objectContaining({ event_id: 'event_1' }),
      expect.objectContaining({ event_id: 'turn_event_1' }),
    ]);
  });

  test('exposes refresh for explicit reload actions', async () => {
    render(<Harness context={context} />);
    await waitFor(() => expect(latestState?.status).toBe('ready'));

    await act(async () => {
      await latestRefresh?.();
    });

    expect(api.createAgentSessionFromRunNode).toHaveBeenCalledTimes(2);
  });
});
