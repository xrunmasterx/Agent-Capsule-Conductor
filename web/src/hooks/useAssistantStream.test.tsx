import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import type { AgentSessionRecord, AgentTurnRecord, RunEvent } from '../types';
import type { CanvasAuthoringValidationResult } from '../types/workbench';
import { useAssistantTurnStream, type AssistantTurnStreamCallbacks } from './useAssistantStream';

vi.mock('../api', () => ({
  api: {
    getAgentSession: vi.fn(),
    getAgentSessionMessages: vi.fn(),
    getAgentTurnEvents: vi.fn(),
    streamAgentTurnEventsUrl: vi.fn((sessionId: string, turnId: string) => (
      `/agent-sessions/${sessionId}/turns/${turnId}/stream`
    )),
    validateAssistantDraft: vi.fn(),
  },
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onerror: (() => void) | null = null;
  close = vi.fn();
  private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener as (event: MessageEvent<string>) => void);
    this.listeners.set(type, listeners);
  }

  emit(type: string, payload: unknown = {}): void {
    const event = { data: JSON.stringify(payload) } as MessageEvent<string>;
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }
}

function pendingTurn(partial: Partial<AgentTurnRecord> = {}): AgentTurnRecord {
  return {
    session_id: 'session_1',
    turn_id: 'turn_1',
    reason: 'workbench_chat',
    status: 'running',
    ...partial,
  };
}

function agentSession(partial: Partial<AgentSessionRecord> = {}): AgentSessionRecord {
  return {
    session_id: 'session_1',
    status: 'running',
    current_output_turn_id: null,
    ...partial,
  };
}

function mockRefreshResponses(session: AgentSessionRecord): void {
  vi.mocked(api.getAgentSession).mockResolvedValue(session);
  vi.mocked(api.getAgentSessionMessages).mockResolvedValue({
    session_id: session.session_id,
    messages: [{ role: 'assistant', content: 'ready', turn_id: 'turn_1' }],
  });
  vi.mocked(api.getAgentTurnEvents).mockResolvedValue({
    session_id: session.session_id,
    turn_id: 'turn_1',
    events: [{ event_id: 'event_1', type: 'agent_message' } as RunEvent],
  });
}

function makeCallbacks() {
  let events: RunEvent[] = [];
  const callbacks: AssistantTurnStreamCallbacks = {
    setAgentSession: vi.fn(),
    setSessionStatus: vi.fn(),
    setMessages: vi.fn(),
    setEvents: vi.fn((updater) => {
      events = typeof updater === 'function' ? updater(events) : updater;
    }),
    setProposal: vi.fn(),
    setBackendValidation: vi.fn(),
    setRequiredActions: vi.fn(),
    setPendingTurn: vi.fn(),
    setBusy: vi.fn(),
    addSystemMessage: vi.fn(),
  };
  return { callbacks, getEvents: () => events };
}

function Harness({
  turn,
  callbacks,
}: {
  turn: AgentTurnRecord | null;
  callbacks: AssistantTurnStreamCallbacks;
}) {
  useAssistantTurnStream('session_1', turn, 'workbench_chat', callbacks);
  return <output>{turn?.turn_id || 'none'}</output>;
}

describe('useAssistantTurnStream', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    mockRefreshResponses(agentSession());
    vi.mocked(api.validateAssistantDraft).mockResolvedValue({
      session_id: 'session_1',
      turn_id: 'turn_1',
      status: 'valid',
      proposal: { proposal_id: 'proposal_1' },
      required_actions: [{ kind: 'confirm_canvas_apply' }],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test('opens assistant turn stream and refreshes canonical messages and events', async () => {
    const { callbacks, getEvents } = makeCallbacks();

    render(<Harness turn={pendingTurn()} callbacks={callbacks} />);

    expect(FakeEventSource.instances[0].url).toBe('/agent-sessions/session_1/turns/turn_1/stream');
    await waitFor(() => expect(callbacks.setAgentSession).toHaveBeenCalled());
    expect(callbacks.setMessages).toHaveBeenCalledWith([
      { id: 'turn_1_0', role: 'assistant', content: 'ready', turnId: 'turn_1' },
    ]);
    expect(getEvents()).toEqual([expect.objectContaining({ event_id: 'event_1' })]);
  });

  test('does not validate draft output for ordinary workbench chat turns', async () => {
    const { callbacks } = makeCallbacks();
    mockRefreshResponses(agentSession({ current_output_turn_id: 'turn_1' }));

    render(<Harness turn={pendingTurn({ reason: 'workbench_chat' })} callbacks={callbacks} />);

    await waitFor(() => expect(callbacks.setAgentSession).toHaveBeenCalled());
    expect(api.validateAssistantDraft).not.toHaveBeenCalled();
    expect(callbacks.setProposal).not.toHaveBeenCalled();
  });

  test('validates draft output for authoring turns when the output turn matches', async () => {
    const { callbacks } = makeCallbacks();
    mockRefreshResponses(agentSession({ current_output_turn_id: 'turn_1' }));

    render(
      <Harness turn={pendingTurn({ reason: 'canvas_revision' })} callbacks={callbacks} />,
    );

    await waitFor(() => expect(api.validateAssistantDraft).toHaveBeenCalledWith('session_1', 'turn_1'));
    expect(callbacks.setProposal).toHaveBeenCalledWith({ proposal_id: 'proposal_1' });
    expect(callbacks.setBackendValidation).toHaveBeenCalledWith({
      status: 'valid',
      errors: [],
      warnings: [],
    } satisfies CanvasAuthoringValidationResult);
    expect(callbacks.setRequiredActions).toHaveBeenCalledWith([{ kind: 'confirm_canvas_apply' }]);
  });

  test('does not validate draft output when the output turn belongs to another turn', async () => {
    const { callbacks } = makeCallbacks();
    mockRefreshResponses(agentSession({ current_output_turn_id: 'turn_other' }));

    render(
      <Harness turn={pendingTurn({ reason: 'canvas_revision' })} callbacks={callbacks} />,
    );

    await waitFor(() => expect(callbacks.setAgentSession).toHaveBeenCalled());
    expect(api.validateAssistantDraft).not.toHaveBeenCalled();
  });

  test('terminal frames refresh final state and clear pending/busy state', async () => {
    const { callbacks } = makeCallbacks();
    mockRefreshResponses(agentSession({ status: 'running' }));
    render(<Harness turn={pendingTurn()} callbacks={callbacks} />);
    await waitFor(() => expect(callbacks.setAgentSession).toHaveBeenCalled());
    vi.mocked(api.getAgentSession).mockResolvedValue(agentSession({ status: 'success' }));

    await act(async () => {
      FakeEventSource.instances[0].emit('terminal');
    });

    await waitFor(() => expect(callbacks.setPendingTurn).toHaveBeenCalledWith(null));
    expect(callbacks.setBusy).toHaveBeenCalledWith(false);
    expect(FakeEventSource.instances[0].close).toHaveBeenCalled();
  });

  test('closes stream on cleanup', () => {
    const { callbacks } = makeCallbacks();

    const view = render(<Harness turn={pendingTurn()} callbacks={callbacks} />);
    view.unmount();

    expect(FakeEventSource.instances[0].close).toHaveBeenCalledTimes(1);
  });
});
