import { useCallback, useEffect, useState } from 'react';

import { api } from '../api';
import type {
  AgentMessage,
  AgentSessionRecord,
  AgentTurnRecord,
  InteractionRequest,
  RunEvent,
} from '../types';

export type SelectedAgentSessionContext = {
  runId: string;
  nodeId: string;
  uiNodeId?: string;
  parentNodeId?: string;
  nodeRunDir?: string;
};

export type AgentSessionUiState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  session: AgentSessionRecord | null;
  messages: AgentMessage[];
  events: RunEvent[];
  pendingTurn: AgentTurnRecord | null;
  interactions: InteractionRequest[];
  error: string;
};

function emptyAgentSessionState(): AgentSessionUiState {
  return {
    status: 'idle',
    session: null,
    messages: [],
    events: [],
    pendingTurn: null,
    interactions: [],
    error: '',
  };
}

function mergeAgentEvents(base: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const seen = new Set<string>();
  const merged: RunEvent[] = [];
  for (const event of [...base, ...incoming]) {
    const key = String(event.event_id || event.type || event.event || 'e') + ':' + String(event.timestamp || merged.length);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(event);
  }
  return merged;
}

export function useSelectedAgentSession(context: SelectedAgentSessionContext | null): {
  state: AgentSessionUiState;
  refresh: () => Promise<void>;
  setPendingTurn: (turn: AgentTurnRecord | null) => void;
  appendEvent: (runId: string, event: RunEvent) => void;
} {
  const [state, setState] = useState<AgentSessionUiState>(() => emptyAgentSessionState());

  const refresh = useCallback(async () => {
    if (!context) {
      setState(emptyAgentSessionState());
      return;
    }
    const { runId, nodeId, nodeRunDir, uiNodeId, parentNodeId } = context;
    setState((current) => ({
      ...current,
      status: current.session ? 'ready' : 'loading',
      error: '',
    }));
    try {
      const session = await api.createAgentSessionFromRunNode(runId, nodeId, {
        nodeRunDir,
        uiNodeId,
        parentNodeId,
      });
      const [messages, nodeEvents, interactions] = await Promise.all([
        api.getAgentSessionMessages(session.session_id).catch(() => ({ messages: [] as AgentMessage[] })),
        api.nodeEvents(runId, nodeId, 200, { nodeRunDir }).catch(() => ({ events: [] as RunEvent[] })),
        api.runInteractions(runId).catch(() => ({ interactions: [] as InteractionRequest[] })),
      ]);
      setState((current) => {
        const pendingTurn =
          current.pendingTurn &&
          current.pendingTurn.turn_id === session.last_turn_id &&
          ['queued', 'running'].includes(String(session.status || ''))
            ? current.pendingTurn
            : null;
        return {
          status: 'ready',
          session,
          messages: messages.messages || [],
          events: nodeEvents.events || [],
          pendingTurn,
          interactions: (interactions.interactions || []).filter(
            (item) => item.status === 'pending' && (!item.node_id || item.node_id === nodeId),
          ),
          error: '',
        };
      });
    } catch (error) {
      setState({
        status: 'error',
        session: null,
        messages: [],
        events: [],
        pendingTurn: null,
        interactions: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [context]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const pendingTurn = state.pendingTurn;
    const session = state.session;
    if (!pendingTurn || !session) {
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      void Promise.all([
        api.getAgentSession(session.session_id),
        api.getAgentSessionMessages(session.session_id).catch(() => ({ messages: [] as AgentMessage[] })),
        api.getAgentTurnEvents(session.session_id, pendingTurn.turn_id).catch(() => ({ events: [] as RunEvent[] })),
      ])
        .then(([nextSession, messages, turnEvents]) => {
          setState((current) => ({
            ...current,
            status: 'ready',
            session: nextSession,
            messages: messages.messages || [],
            events: mergeAgentEvents(current.events, turnEvents.events || []),
            pendingTurn: ['queued', 'running'].includes(String(nextSession.status || ''))
              ? pendingTurn
              : null,
            error: '',
          }));
        })
        .catch(() => {
          void refresh();
        });
    }, 1000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [refresh, state.pendingTurn, state.session]);

  const setPendingTurn = useCallback((turn: AgentTurnRecord | null) => {
    setState((current) => ({ ...current, pendingTurn: turn }));
  }, []);

  const appendEvent = useCallback((runId: string, event: RunEvent) => {
    const eventNodeId = typeof event.node_id === 'string' ? event.node_id : '';
    setState((current) => {
      const session = current.session;
      if (!session) {
        return current;
      }
      const matchesSession = event.session_id && event.session_id === session.session_id;
      const matchesBoundNode =
        session.bound_run_id === runId &&
        (!eventNodeId || session.bound_node_id === eventNodeId);
      if (!matchesSession && !matchesBoundNode) {
        return current;
      }
      return {
        ...current,
        events: mergeAgentEvents(current.events, [event]),
      };
    });
  }, []);

  return { state, refresh, setPendingTurn, appendEvent };
}
