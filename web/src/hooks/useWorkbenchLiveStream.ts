import { useEffect, useRef, useState } from 'react';

import { api } from '../api';
import type { NodeRunSummary, RunEvent, WorkbenchLiveEvent } from '../types';
import { effectiveNodeRunDir, sameRunDir } from '../workbench/model/selectedNodeModel';

export type WorkbenchLiveStreamScope =
  | {
      kind: 'run';
      runId: string;
      nodeId?: string;
      uiNodeId?: string;
      nodeRunDir?: string;
    }
  | {
      kind: 'turn';
      sessionId: string;
      turnId: string;
      source?: 'agent_turn' | 'assistant_turn';
    };

export type WorkbenchLiveStreamState = {
  events: WorkbenchLiveEvent[];
  status: 'idle' | 'connecting' | 'live' | 'closed' | 'error';
  error: string;
};

export function useWorkbenchLiveStream(scope: WorkbenchLiveStreamScope | null): WorkbenchLiveStreamState {
  const [state, setState] = useState<WorkbenchLiveStreamState>({
    events: [],
    status: 'idle',
    error: '',
  });
  const latestSeqRef = useRef(0);
  const scopeKey = liveStreamScopeKey(scope);

  useEffect(() => {
    let closed = false;
    let connected = false;
    latestSeqRef.current = 0;
    setState({ events: [], status: scope ? 'connecting' : 'idle', error: '' });
    if (!scope || typeof EventSource === 'undefined') {
      return undefined;
    }
    const url =
      scope.kind === 'run'
        ? api.runStreamUrl(scope.runId, latestSeqRef.current)
        : api.streamAgentTurnEventsUrl(scope.sessionId, scope.turnId, latestSeqRef.current);
    const source = new EventSource(url);
    source.onopen = () => {
      connected = true;
    };
    source.addEventListener('live_event', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as WorkbenchLiveEvent;
        if (scope.kind === 'run' && !liveEventMatchesRunScope(payload, scope)) {
          return;
        }
        if (scope.kind === 'turn' && !liveEventMatchesTurnScope(payload, scope)) {
          return;
        }
        latestSeqRef.current = Math.max(latestSeqRef.current, Number(payload.seq || 0));
        setState((current) => ({
          status: payload.type === 'terminal' ? 'closed' : 'live',
          error: '',
          events: boundedLiveEvents(current.events, [payload]),
        }));
        if (payload.type === 'gap') {
          void refillLiveEvents(scope, latestSeqRef.current)
            .then((events) => {
              if (!closed && events.length) {
                setState((current) => ({
                  ...current,
                  events: boundedLiveEvents(current.events, events),
                }));
              }
            })
            .catch((error) => {
              if (!closed) {
                setState((current) => ({
                  ...current,
                  error: error instanceof Error ? error.message : String(error),
                }));
              }
            });
        }
      } catch (error) {
        setState((current) => ({
          ...current,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    });
    source.addEventListener('terminal', () => {
      setState((current) => ({ ...current, status: 'closed' }));
      source.close();
    });
    source.onerror = () => {
      setState((current) => ({
        ...current,
        status: connected || current.events.length ? 'closed' : 'error',
      }));
      source.close();
    };
    return () => {
      closed = true;
      source.close();
    };
  }, [scopeKey]);

  return state;
}

export function liveStreamScopeKey(scope: WorkbenchLiveStreamScope | null): string {
  if (!scope) {
    return 'none';
  }
  if (scope.kind === 'run') {
    return ['run', scope.runId, scope.nodeId || '', scope.uiNodeId || '', scope.nodeRunDir || ''].join(':');
  }
  return ['turn', scope.sessionId, scope.turnId, scope.source || ''].join(':');
}

export function liveStateForNodeRun(
  events: WorkbenchLiveEvent[],
  nodeRun?: NodeRunSummary,
): WorkbenchLiveStreamState {
  if (!nodeRun) {
    return { events: [], status: 'idle', error: '' };
  }
  const scopedEvents = events.filter((event) => liveEventMatchesNodeRun(event, nodeRun));
  return {
    events: scopedEvents,
    status: scopedEvents.length ? 'live' : 'idle',
    error: '',
  };
}

export function liveEventFromAgentRunEvent(
  event: RunEvent,
  seq: number,
  source: 'agent_turn' | 'assistant_turn',
): WorkbenchLiveEvent {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const eventPayload = { ...payload, event_type: stringValue(payload.event_type) || event.type };
  const content = stringValue(payload.content) || stringValue(payload.delta);
  const type = workbenchLiveEventType(event.type);
  const sessionId = stringValue(event.session_id);
  const turnId = stringValue(event.turn_id);
  return {
    event_id: String(event.event_id || `refill_${sessionId}_${turnId}_${seq}`),
    seq,
    event_seq: typeof event.event_seq === 'number' ? event.event_seq : undefined,
    source,
    run_id: stringValue(event.run_id),
    node_id: stringValue(event.node_id),
    session_id: sessionId,
    turn_id: turnId,
    type,
    stream: 'agent',
    text: event.type === 'agent_message' || event.type === 'agent_message_delta' ? content : '',
    payload: eventPayload,
    projection: event.projection,
    timestamp: stringValue(event.timestamp),
  };
}

export function boundedLiveEvents(
  base: WorkbenchLiveEvent[],
  incoming: WorkbenchLiveEvent[],
  maxEvents = 500,
  maxTextBytes = 1024 * 1024,
): WorkbenchLiveEvent[] {
  const seen = new Set<string>();
  const merged: WorkbenchLiveEvent[] = [];
  for (const event of [...base, ...incoming]) {
    const key = String(event.event_id || event.seq);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(event);
  }
  merged.sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0));
  let textBytes = 0;
  const bounded: WorkbenchLiveEvent[] = [];
  for (const event of merged.slice(-maxEvents).reverse()) {
    textBytes += event.text?.length || 0;
    if (textBytes > maxTextBytes && bounded.length > 0) {
      break;
    }
    bounded.push(event);
  }
  return bounded.reverse();
}

function liveEventMatchesRunScope(
  event: WorkbenchLiveEvent,
  scope: Extract<WorkbenchLiveStreamScope, { kind: 'run' }>,
): boolean {
  if (event.run_id && event.run_id !== scope.runId) {
    return false;
  }
  if (scope.uiNodeId && event.ui_node_id === scope.uiNodeId) {
    return true;
  }
  if (scope.nodeRunDir && sameRunDir(event.node_run_dir, scope.nodeRunDir)) {
    return true;
  }
  return Boolean(scope.nodeId && event.node_id === scope.nodeId && !event.ui_node_id);
}

function liveEventMatchesNodeRun(event: WorkbenchLiveEvent, nodeRun: NodeRunSummary): boolean {
  if (nodeRun.ui_node_id && event.ui_node_id === nodeRun.ui_node_id) {
    return true;
  }
  const effectiveRunDir = effectiveNodeRunDir(nodeRun);
  if (effectiveRunDir && sameRunDir(event.node_run_dir, effectiveRunDir)) {
    return true;
  }
  if (nodeRun.run_dir && sameRunDir(event.node_run_dir, nodeRun.run_dir)) {
    return true;
  }
  const isRootNodeRun = !nodeRun.ui_node_id && !nodeRun.parent_node_id;
  return Boolean(isRootNodeRun && nodeRun.node_id && event.node_id === nodeRun.node_id && !event.ui_node_id);
}

function liveEventMatchesTurnScope(
  event: WorkbenchLiveEvent,
  scope: Extract<WorkbenchLiveStreamScope, { kind: 'turn' }>,
): boolean {
  return event.session_id === scope.sessionId && event.turn_id === scope.turnId;
}

async function refillLiveEvents(
  scope: WorkbenchLiveStreamScope,
  afterSeq: number,
): Promise<WorkbenchLiveEvent[]> {
  if (scope.kind === 'run') {
    return [];
  }
  const payload = await api.getAgentTurnEvents(scope.sessionId, scope.turnId);
  return (payload.events || [])
    .map((event, index) =>
      liveEventFromAgentRunEvent(event, index + 1, scope.source || 'agent_turn'),
    )
    .filter((event) => event.seq > afterSeq);
}

function workbenchLiveEventType(type: unknown): WorkbenchLiveEvent['type'] {
  if (
    type === 'agent_message' ||
    type === 'agent_message_delta' ||
    type === 'agent_status' ||
    type === 'agent_tool_use' ||
    type === 'agent_tool_result' ||
    type === 'agent_approval_requested' ||
    type === 'agent_usage' ||
    type === 'agent_output_draft' ||
    type === 'agent_output_published' ||
    type === 'agent_turn_failed' ||
    type === 'agent_turn_cancelled' ||
    type === 'artifact_ready'
  ) {
    return type;
  }
  return 'agent_event';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
