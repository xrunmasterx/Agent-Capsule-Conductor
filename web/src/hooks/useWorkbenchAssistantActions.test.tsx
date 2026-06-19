import { render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import { useWorkbenchAssistantActions } from './useWorkbenchAssistantActions';

vi.mock('../api', () => ({
  api: {
    getAgentSession: vi.fn(),
    submitWorkbenchAssistantTurn: vi.fn(),
  },
}));

let latestActions: ReturnType<typeof useWorkbenchAssistantActions> | null = null;

function Harness() {
  latestActions = useWorkbenchAssistantActions();
  return <output>workbench-assistant-actions</output>;
}

describe('useWorkbenchAssistantActions', () => {
  afterEach(() => {
    latestActions = null;
    vi.clearAllMocks();
  });

  test('loads workbench assistant sessions by session id', async () => {
    vi.mocked(api.getAgentSession).mockResolvedValue({
      session_id: 'session_1',
      status: 'running',
    });
    render(<Harness />);

    const result = await latestActions?.loadWorkbenchAssistantSession('session_1');

    expect(api.getAgentSession).toHaveBeenCalledWith('session_1');
    expect(result?.session_id).toBe('session_1');
  });

  test('submits workbench assistant turns without rewriting payloads', async () => {
    vi.mocked(api.submitWorkbenchAssistantTurn).mockResolvedValue({
      session_id: 'session_1',
      turn_id: 'turn_1',
      status: 'queued',
    });
    const payload = {
      message: 'revise canvas',
      reason: 'canvas_revision' as const,
      canvas_hash: 'hash_1',
      canvas_snapshot: { id: 'task_1' },
      selection: { type: 'task_canvas', taskId: 'task_1' },
      expected_provider_session_id: 'provider_1',
    };
    render(<Harness />);

    const result = await latestActions?.submitWorkbenchAssistantTurnRequest('session_1', payload);

    expect(api.submitWorkbenchAssistantTurn).toHaveBeenCalledWith('session_1', payload);
    expect(result?.turn_id).toBe('turn_1');
  });
});
