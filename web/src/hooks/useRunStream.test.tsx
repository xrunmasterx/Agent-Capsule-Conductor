import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import type { NodeLogDelta, RunEvent, RunSummary, WorkbenchLiveEvent } from '../types';
import type { RunProjection } from '../types/workbench';
import { useRunStream, type RunStreamCallbacks } from './useRunStream';

vi.mock('../api', () => ({
  api: {
    runStreamUrl: vi.fn((runId: string) => `/runs/${runId}/stream`),
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

  emit(type: string, payload: unknown): void {
    const event = { data: JSON.stringify(payload) } as MessageEvent<string>;
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }
}

function Harness({
  runId,
  callbacks,
}: {
  runId: string | null;
  callbacks: RunStreamCallbacks;
}) {
  useRunStream(runId, callbacks);
  return <output>{runId || 'none'}</output>;
}

function runProjection(partial: Partial<RunProjection> = {}): RunProjection {
  return {
    runId: 'run_1',
    taskId: 'task_1',
    status: 'running',
    scope: 'task',
    targetId: 'task_1',
    graph: { id: 'graph', version: '0.4.0', nodes: [], edges: [], metadata: {} },
    runDir: 'runs/run_1',
    run: null,
    events: [],
    overlay: null,
    pollState: 'polling',
    ...partial,
  } as RunProjection;
}

describe('useRunStream', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test('opens run stream and dispatches log, agent, live, and summary frames', async () => {
    const logDeltas: NodeLogDelta[] = [];
    const agentEvents: RunEvent[] = [];
    const liveEvents: WorkbenchLiveEvent[] = [];
    const projectedRuns: RunProjection[] = [];
    const callbacks: RunStreamCallbacks = {
      appendNodeLogDelta: (delta) => logDeltas.push(delta),
      appendRunAgentEvent: (_runId, event) => agentEvents.push(event),
      appendRunLiveEvent: (_runId, event) => liveEvents.push(event),
      updateRunProjection: (_runId, update) => {
        projectedRuns.push(update(runProjection()));
      },
    };

    render(<Harness runId="run_1" callbacks={callbacks} />);
    expect(FakeEventSource.instances[0].url).toBe('/runs/run_1/stream');

    const summary: RunSummary = {
      run_id: 'run_1',
      workflow_id: 'graph',
      status: 'success',
      run_dir: 'runs/run_1',
      node_count: 0,
      failed_nodes: [],
      nodes: [],
    };
    await act(async () => {
      FakeEventSource.instances[0].emit('node_log_delta', {
        type: 'node_log_delta',
        run_id: 'run_1',
        node_id: 'node_1',
        stream: 'stdout',
        text: 'hello',
        next_offset: 5,
      });
      FakeEventSource.instances[0].emit('agent_event', {
        type: 'agent_message',
        event_id: 'agent_1',
        node_id: 'node_1',
      });
      FakeEventSource.instances[0].emit('live_event', {
        event_id: 'live_1',
        seq: 1,
        source: 'run_node',
        run_id: 'run_1',
        type: 'agent_message',
        stream: 'agent',
        text: 'streamed',
        timestamp: '2026-06-19T00:00:00Z',
      });
      FakeEventSource.instances[0].emit('summary', { type: 'summary', summary });
    });

    expect(logDeltas).toEqual([expect.objectContaining({ text: 'hello' })]);
    expect(agentEvents).toEqual([expect.objectContaining({ event_id: 'agent_1' })]);
    expect(liveEvents).toEqual([expect.objectContaining({ event_id: 'live_1', text: 'streamed' })]);
    expect(projectedRuns).toEqual([expect.objectContaining({ status: 'success', summary })]);
  });

  test('does not open without a run id and closes stream on cleanup', () => {
    const callbacks: RunStreamCallbacks = {
      appendNodeLogDelta: () => undefined,
      appendRunAgentEvent: () => undefined,
      appendRunLiveEvent: () => undefined,
      updateRunProjection: (_runId, update) => update(runProjection()),
    };

    const empty = render(<Harness runId={null} callbacks={callbacks} />);
    expect(FakeEventSource.instances).toEqual([]);
    empty.unmount();

    const active = render(<Harness runId="run_1" callbacks={callbacks} />);
    expect(FakeEventSource.instances).toHaveLength(1);
    active.unmount();
    expect(FakeEventSource.instances[0].close).toHaveBeenCalledTimes(1);
  });

  test('malformed chunks are ignored because polling remains durable fallback', async () => {
    const callbacks: RunStreamCallbacks = {
      appendNodeLogDelta: vi.fn(),
      appendRunAgentEvent: vi.fn(),
      appendRunLiveEvent: vi.fn(),
      updateRunProjection: vi.fn(),
    };

    render(<Harness runId="run_1" callbacks={callbacks} />);
    await act(async () => {
      const listener = (FakeEventSource.instances[0] as unknown as { listeners: Map<string, Array<(event: MessageEvent<string>) => void>> })
        .listeners.get('live_event')?.[0];
      listener?.({ data: '{bad json' } as MessageEvent<string>);
    });

    expect(callbacks.appendRunLiveEvent).not.toHaveBeenCalled();
  });
});
