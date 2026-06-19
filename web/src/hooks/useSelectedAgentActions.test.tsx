import { render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import { useSelectedAgentActions } from './useSelectedAgentActions';

vi.mock('../api', () => ({
  api: {
    submitAgentTurn: vi.fn(),
    publishAgentOutput: vi.fn(),
    answerInteraction: vi.fn(),
  },
}));

let latestActions: ReturnType<typeof useSelectedAgentActions> | null = null;

function Harness() {
  latestActions = useSelectedAgentActions();
  return <output>selected-agent-actions</output>;
}

describe('useSelectedAgentActions', () => {
  afterEach(() => {
    latestActions = null;
    vi.clearAllMocks();
  });

  test('submits selected agent turns with expected provider session guard', async () => {
    vi.mocked(api.submitAgentTurn).mockResolvedValue({
      session_id: 'session_1',
      turn_id: 'turn_1',
      status: 'queued',
    });
    const payload = {
      message: 'revise output',
      reason: 'output_revision' as const,
      expected_provider_session_id: 'provider_1',
    };
    render(<Harness />);

    const result = await latestActions?.submitSelectedAgentTurnRequest('session_1', payload);

    expect(api.submitAgentTurn).toHaveBeenCalledWith('session_1', payload);
    expect(result?.turn_id).toBe('turn_1');
  });

  test('publishes selected agent output by expected turn id', async () => {
    vi.mocked(api.publishAgentOutput).mockResolvedValue({
      session_id: 'session_1',
      status: 'published',
      published_output_path: 'outbox/output.json',
    });
    render(<Harness />);

    const result = await latestActions?.publishSelectedAgentOutputRequest('session_1', 'turn_1');

    expect(api.publishAgentOutput).toHaveBeenCalledWith('session_1', 'turn_1');
    expect(result?.status).toBe('published');
  });

  test('answers selected agent interactions by run id and interaction id', async () => {
    vi.mocked(api.answerInteraction).mockResolvedValue({
      interaction_id: 'interaction_1',
      run_id: 'run_1',
      kind: 'approval',
      status: 'answered',
      prompt: 'Approve?',
      created_at: '2026-06-19T00:00:00Z',
    });
    const answer = { decision: 'approve' };
    render(<Harness />);

    await latestActions?.answerSelectedAgentInteractionRequest('run_1', 'interaction_1', answer);

    expect(api.answerInteraction).toHaveBeenCalledWith('run_1', 'interaction_1', answer);
  });
});
