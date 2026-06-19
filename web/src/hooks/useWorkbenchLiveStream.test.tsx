import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import type { WorkbenchLiveEvent } from '../types';
import {
  boundedLiveEvents,
  liveEventFromAgentRunEvent,
  useWorkbenchLiveStream,
  type WorkbenchLiveStreamScope,
  type WorkbenchLiveStreamState,
} from './useWorkbenchLiveStream';

vi.mock('../api', () => ({
  api: {
    runStreamUrl: vi.fn((runId: string, afterSeq?: number) => `/runs/${runId}/stream?after=${afterSeq || 0}`),
    streamAgentTurnEventsUrl: vi.fn(
      (sessionId: string, turnId: string, afterSeq?: number) =>
        `/sessions/${sessionId}/turns/${turnId}/stream?after=${afterSeq || 0}`,
    ),
    getAgentTurnEvents: vi.fn(),
  },
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener as (event: MessageEvent) => void);
    this.listeners.set(type, listeners);
  }

  emit(type: string, data?: unknown): void {
    const event = { data: typeof data === 'string' ? data : JSON.stringify(data ?? {}) } as MessageEvent;
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }
}

function Harness({
  scope,
  onState,
}: {
  scope: WorkbenchLiveStreamScope | null;
  onState: (state: WorkbenchLiveStreamState) => void;
}) {
  const state = useWorkbenchLiveStream(scope);
  onState(state);
  return <output>{state.status}:{state.events.length}</output>;
}

function liveEvent(partial: Partial<WorkbenchLiveEvent>): WorkbenchLiveEvent {
  return {
    event_id: 'event_1',
    seq: 1,
    source: 'agent_turn',
    type: 'agent_message',
    stream: 'agent',
    text: '',
    payload: {},
    ...partial,
  } as WorkbenchLiveEvent;
}

describe('useWorkbenchLiveStream', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.mocked(api.getAgentTurnEvents).mockResolvedValue({ session_id: 'session', turn_id: 'turn', events: [] });
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test('opens a run stream, filters by run scope, and closes on unmount', async () => {
    const states: WorkbenchLiveStreamState[] = [];
    const { unmount } = render(
      <Harness
        scope={{ kind: 'run', runId: 'run_1', nodeId: 'node_a' }}
        onState={(state) => states.push(state)}
      />,
    );

    expect(FakeEventSource.instances[0].url).toBe('/runs/run_1/stream?after=0');

    await act(async () => {
      FakeEventSource.instances[0].emit('live_event', liveEvent({ event_id: 'wrong', run_id: 'run_2', node_id: 'node_a' }));
      FakeEventSource.instances[0].emit(
        'live_event',
        liveEvent({ event_id: 'right', run_id: 'run_1', node_id: 'node_a', text: 'accepted' }),
      );
    });

    await waitFor(() => {
      expect(states.at(-1)?.events.map((event) => event.event_id)).toEqual(['right']);
    });

    unmount();
    expect(FakeEventSource.instances[0].close).toHaveBeenCalledTimes(1);
  });

  test('refills assistant turn gaps without fabricating run-scope replay', async () => {
    vi.mocked(api.getAgentTurnEvents).mockResolvedValue({
      session_id: 'session_1',
      turn_id: 'turn_1',
      events: [
        { type: 'agent_message', session_id: 'session_1', turn_id: 'turn_1', payload: { content: 'old' } },
        { type: 'agent_message_delta', session_id: 'session_1', turn_id: 'turn_1', payload: { delta: 'new' } },
      ],
    });
    const states: WorkbenchLiveStreamState[] = [];
    render(
      <Harness
        scope={{ kind: 'turn', sessionId: 'session_1', turnId: 'turn_1', source: 'assistant_turn' }}
        onState={(state) => states.push(state)}
      />,
    );

    await act(async () => {
      FakeEventSource.instances[0].emit(
        'live_event',
        liveEvent({
          event_id: 'gap_1',
          seq: 1,
          source: 'assistant_turn',
          session_id: 'session_1',
          turn_id: 'turn_1',
          type: 'gap',
        }),
      );
    });

    await waitFor(() => {
      expect(api.getAgentTurnEvents).toHaveBeenCalledWith('session_1', 'turn_1');
      expect(states.at(-1)?.events.some((event) => event.text === 'new')).toBe(true);
    });
  });

  test('exports deterministic live event helpers', () => {
    const refill = liveEventFromAgentRunEvent(
      { type: 'agent_message', session_id: 'session_1', turn_id: 'turn_1', payload: { content: 'hello' } },
      2,
      'assistant_turn',
    );

    expect(refill).toEqual(
      expect.objectContaining({
        event_id: 'refill_session_1_turn_1_2',
        seq: 2,
        source: 'assistant_turn',
        text: 'hello',
      }),
    );
    expect(
      boundedLiveEvents(
        [liveEvent({ event_id: 'dup', seq: 1, text: 'old' })],
        [liveEvent({ event_id: 'dup', seq: 2, text: 'new' }), liveEvent({ event_id: 'next', seq: 3 })],
      ).map((event) => event.event_id),
    ).toEqual(['dup', 'next']);
  });
});
