import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';

import type { AgentSessionRecord, AgentTurnRecord } from '../types';
import type { AgentSessionUiState, SelectedAgentSessionContext } from './useSelectedAgentSession';
import {
  useSelectedAgentTurnActions,
  type UseSelectedAgentTurnActionsResult,
} from './useSelectedAgentTurnActions';

let latestActions: UseSelectedAgentTurnActionsResult | null = null;
let latestMessage = '';
let latestPendingTurn: AgentTurnRecord | null = null;

const submitSelectedAgentTurnRequest = vi.fn();
const publishSelectedAgentOutputRequest = vi.fn();
const answerSelectedAgentInteractionRequest = vi.fn();
const refreshAgentSession = vi.fn();
const refreshRunProjection = vi.fn();
const onChanged = vi.fn();

function sessionRecord(overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord {
  return {
    session_id: 'session_1',
    provider_session_id: 'provider_1',
    status: 'ready',
    ...overrides,
  };
}

function agentSessionState(session: AgentSessionRecord | null): AgentSessionUiState {
  return {
    status: session ? 'ready' : 'idle',
    session,
    messages: [],
    events: [],
    pendingTurn: null,
    interactions: [],
    error: '',
  };
}

function Harness({
  session = sessionRecord(),
  context = { runId: 'run_1', nodeId: 'node_1' },
  selectedRunId = 'run_1',
}: {
  session?: AgentSessionRecord | null;
  context?: SelectedAgentSessionContext | null;
  selectedRunId?: string | null;
}) {
  const [message, setMessage] = useState('');
  const [pendingTurn, setPendingTurn] = useState<AgentTurnRecord | null>(null);

  latestActions = useSelectedAgentTurnActions({
    agentSessionState: agentSessionState(session),
    selectedAgentSessionContext: context,
    selectedRunId,
    submitSelectedAgentTurnRequest,
    publishSelectedAgentOutputRequest,
    answerSelectedAgentInteractionRequest,
    setAgentSessionPendingTurn: setPendingTurn,
    setMessage,
    refreshAgentSession,
    refreshRunProjection,
    onChanged,
  });
  latestMessage = message;
  latestPendingTurn = pendingTurn;

  return <output>{message}</output>;
}

describe('useSelectedAgentTurnActions', () => {
  afterEach(() => {
    latestActions = null;
    latestMessage = '';
    latestPendingTurn = null;
    vi.clearAllMocks();
  });

  test('submits selected agent turns with provider session guard and refreshes the session', async () => {
    submitSelectedAgentTurnRequest.mockResolvedValue({
      session_id: 'session_1',
      turn_id: 'turn_1',
      status: 'queued',
    });
    render(<Harness />);

    await act(async () => {
      await latestActions?.submitSelectedAgentTurn('revise output', 'output_revision');
    });

    expect(submitSelectedAgentTurnRequest).toHaveBeenCalledWith('session_1', {
      message: 'revise output',
      reason: 'output_revision',
      expected_provider_session_id: 'provider_1',
    });
    expect(latestPendingTurn).toMatchObject({ turn_id: 'turn_1' });
    expect(latestMessage).toBe('Agent turn turn_1: queued');
    expect(refreshAgentSession).toHaveBeenCalledTimes(1);
  });

  test('publishes selected agent output and refreshes the active run projection', async () => {
    publishSelectedAgentOutputRequest.mockResolvedValue({
      session_id: 'session_1',
      status: 'published',
      published_output_path: 'outbox/output.json',
    });
    render(<Harness />);

    await act(async () => {
      await latestActions?.publishSelectedAgentOutput('turn_1');
    });

    expect(publishSelectedAgentOutputRequest).toHaveBeenCalledWith('session_1', 'turn_1');
    expect(refreshRunProjection).toHaveBeenCalledWith('run_1');
    expect(refreshAgentSession).toHaveBeenCalledTimes(1);
    expect(latestMessage).toBe('已发布 turn_1 为当前节点 output.json');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test('answers selected agent interactions using the bound run id', async () => {
    answerSelectedAgentInteractionRequest.mockResolvedValue({ status: 'answered' });
    const answer = { decision: 'approve' };
    render(<Harness />);

    await act(async () => {
      await latestActions?.answerSelectedAgentInteraction('interaction_1', answer);
    });

    expect(answerSelectedAgentInteractionRequest).toHaveBeenCalledWith(
      'run_1',
      'interaction_1',
      answer,
    );
    expect(refreshAgentSession).toHaveBeenCalledTimes(1);
  });

  test('rejects actions when the selected node has no agent session or run context', async () => {
    render(<Harness session={null} context={null} selectedRunId={null} />);

    await expect(
      latestActions?.submitSelectedAgentTurn('hello', 'node_chat'),
    ).rejects.toThrow('当前节点还没有可用的 Agent Session');
    await expect(
      latestActions?.publishSelectedAgentOutput('turn_1'),
    ).rejects.toThrow('当前节点还没有可用的 Agent Session');
    await expect(
      latestActions?.answerSelectedAgentInteraction('interaction_1', {}),
    ).rejects.toThrow('当前节点没有绑定 run，无法处理审批');
  });
});
