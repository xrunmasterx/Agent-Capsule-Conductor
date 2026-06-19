import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import {
  useAssistantSession,
  type AssistantSessionSnapshotPayload,
  type UseAssistantSessionOptions,
} from './useAssistantSession';

vi.mock('../api', () => ({
  api: {
    authoringAgents: vi.fn(),
    createWorkbenchAssistantSession: vi.fn(),
    getAgentSessionMessages: vi.fn(),
  },
}));

let latestEnsure: ((snapshot: AssistantSessionSnapshotPayload) => Promise<string>) | null = null;

function snapshot(): AssistantSessionSnapshotPayload {
  return {
    taskId: 'task_1',
    canvasHash: 'hash_1',
    canvasSnapshot: { id: 'task_1' },
    selection: { type: 'task_canvas' },
  };
}

function baseOptions(overrides: Partial<UseAssistantSessionOptions> = {}): UseAssistantSessionOptions {
  return {
    sessionId: null,
    selectedAuthoringAgentId: '',
    setAuthoringAgents: vi.fn(),
    setSelectedAuthoringAgentId: vi.fn(),
    setSessionId: vi.fn(),
    setAgentSession: vi.fn(),
    setSessionStatus: vi.fn(),
    setMessages: vi.fn(),
    setBusy: vi.fn(),
    addSystemMessage: vi.fn(),
    ...overrides,
  };
}

function Harness(options: UseAssistantSessionOptions) {
  latestEnsure = useAssistantSession(options);
  return <output>assistant-session</output>;
}

describe('useAssistantSession', () => {
  beforeEach(() => {
    latestEnsure = null;
    vi.mocked(api.authoringAgents).mockResolvedValue({
      agents: [{
        id: 'agent_a',
        version: '0.1.0',
        kind: 'agent_class',
        runtime: 'generic_cli',
        backend: 'native',
        source_id: 'agent_a',
        name: 'Agent A',
        default_permissions: {},
      }],
    });
    vi.mocked(api.createWorkbenchAssistantSession).mockResolvedValue({
      session_id: 'session_1',
      status: 'ready',
    });
    vi.mocked(api.getAgentSessionMessages).mockResolvedValue({
      session_id: 'session_1',
      messages: [{ role: 'assistant', content: 'hello', turn_id: 'turn_1' }],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('reuses an existing assistant session without touching the backend', async () => {
    const options = baseOptions({ sessionId: 'session_existing' });
    render(<Harness {...options} />);

    await expect(latestEnsure?.(snapshot())).resolves.toBe('session_existing');

    expect(api.authoringAgents).not.toHaveBeenCalled();
    expect(options.setBusy).not.toHaveBeenCalled();
  });

  test('creates a session with the first available authoring agent when none is selected', async () => {
    const options = baseOptions();
    render(<Harness {...options} />);

    await act(async () => {
      await latestEnsure?.(snapshot());
    });

    expect(options.setBusy).toHaveBeenNthCalledWith(1, true);
    expect(options.setSessionStatus).toHaveBeenCalledWith('connecting');
    expect(options.setAuthoringAgents).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'agent_a', name: 'Agent A' }),
    ]);
    expect(options.setSelectedAuthoringAgentId).toHaveBeenCalledWith('agent_a');
    expect(api.createWorkbenchAssistantSession).toHaveBeenCalledWith({
      agent_id: 'agent_a',
      task_id: 'task_1',
      canvas_hash: 'hash_1',
      canvas_snapshot: { id: 'task_1' },
      selection: { type: 'task_canvas' },
    });
    expect(options.setSessionId).toHaveBeenCalledWith('session_1');
    expect(options.setAgentSession).toHaveBeenCalledWith({ session_id: 'session_1', status: 'ready' });
    expect(options.setMessages).toHaveBeenCalledWith([
      { id: 'turn_1_0', role: 'assistant', content: 'hello', turnId: 'turn_1' },
    ]);
    expect(options.setBusy).toHaveBeenLastCalledWith(false);
  });

  test('preserves an explicitly selected authoring agent', async () => {
    const options = baseOptions({ selectedAuthoringAgentId: 'agent_selected' });
    render(<Harness {...options} />);

    await act(async () => {
      await latestEnsure?.(snapshot());
    });

    expect(options.setSelectedAuthoringAgentId).not.toHaveBeenCalled();
    expect(api.createWorkbenchAssistantSession).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'agent_selected' }),
    );
  });

  test('reports creation errors through assistant state callbacks', async () => {
    vi.mocked(api.createWorkbenchAssistantSession).mockRejectedValue(new Error('create failed'));
    const options = baseOptions();
    render(<Harness {...options} />);

    await expect(latestEnsure?.(snapshot())).rejects.toThrow('create failed');

    expect(options.setSessionStatus).toHaveBeenCalledWith('error');
    expect(options.addSystemMessage).toHaveBeenCalledWith('create failed');
    expect(options.setBusy).toHaveBeenLastCalledWith(false);
  });
});
