/**
 * SSE streaming hook for AI assistant agent turns.
 *
 * Extracted from WorkflowViewer.tsx lines 2490-2602.
 * Manages the EventSource connection to the assistant turn stream, polling
 * fallback, and canonical state refresh on terminal events.
 */

import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { AgentSessionRecord, AgentTurnRecord, RunEvent } from '../types';

// ---------------------------------------------------------------------------
// Re-exported local types consumed by the assistant components.
// ---------------------------------------------------------------------------

export type AssistantChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type AssistantTurnReason = 'workbench_chat' | 'canvas_revision' | 'selected_node_revision';

export type CanvasAuthoringValidationResult = {
  status: 'valid' | 'invalid';
  errors: string[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authoringId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

function agentMessagesToAssistantMessages(
  messages: Array<{ role: string; content: string; turn_id?: string }>,
): AssistantChatMessage[] {
  return messages.map((item, index) => ({
    id: `agent_msg_${item.turn_id || index}`,
    role: item.role === 'user' ? 'user' : item.role === 'system' ? 'system' : 'assistant',
    content: item.content,
  }));
}

// ---------------------------------------------------------------------------
// Hook: useAssistantTurnStream
// ---------------------------------------------------------------------------

export type AssistantTurnStreamCallbacks = {
  setAgentSession: (session: AgentSessionRecord | null) => void;
  setSessionStatus: (status: string) => void;
  setMessages: (messages: AssistantChatMessage[]) => void;
  setEvents: React.Dispatch<React.SetStateAction<RunEvent[]>>;
  setProposal: (proposal: unknown | null) => void;
  setBackendValidation: (validation: CanvasAuthoringValidationResult | null) => void;
  setRequiredActions: (actions: unknown[]) => void;
  setPendingTurn: (turn: AgentTurnRecord | null) => void;
  setBusy: (busy: boolean) => void;
  addSystemMessage: (content: string) => void;
};

/**
 * Connects to the assistant turn SSE stream and polls for canonical state.
 *
 * The hook is keyed on `sessionId + pendingTurn.turn_id`. While a turn is
 * pending it opens an EventSource, appends live agent_event frames, and polls
 * every second as a fallback.  When the turn becomes terminal it fetches the
 * final session state and clears the pending turn.
 */
export function useAssistantTurnStream(
  sessionId: string | null,
  pendingTurn: AgentTurnRecord | null,
  turnReason: AssistantTurnReason,
  callbacks: AssistantTurnStreamCallbacks,
): void {
  // Stable ref so the effect closure does not depend on callback identity.
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    if (!sessionId || !pendingTurn) {
      return undefined;
    }
    let cancelled = false;
    let source: EventSource | undefined;

    async function refreshAssistantTurn(terminal = false) {
      if (!sessionId || !pendingTurn || cancelled) {
        return;
      }
      const cb = cbRef.current;
      const [session, messages, eventPayload] = await Promise.all([
        api.getAgentSession(sessionId),
        api.getAgentSessionMessages(sessionId),
        api.getAgentTurnEvents(sessionId, pendingTurn.turn_id),
      ]);
      if (cancelled) {
        return;
      }
      cb.setAgentSession(session);
      cb.setSessionStatus(session.status || pendingTurn.status || 'running');
      cb.setMessages(agentMessagesToAssistantMessages(messages.messages || []));
      cb.setEvents((current: RunEvent[]) => mergeAgentEvents(current, eventPayload.events || []));

      const draftTurnId =
        typeof session.current_output_turn_id === 'string' ? session.current_output_turn_id : '';
      if (draftTurnId) {
        try {
          const draft = await (api as any).validateAssistantDraft(session.session_id, draftTurnId);
          if (!cancelled) {
            cb.setProposal(draft.proposal || null);
            cb.setBackendValidation({
              status: draft.status as 'valid' | 'invalid',
              errors: [],
              warnings: [],
            });
            cb.setRequiredActions(draft.required_actions || []);
          }
        } catch (error) {
          if (!cancelled) {
            cb.setBackendValidation({
              status: 'invalid',
              errors: [error instanceof Error ? error.message : String(error)],
              warnings: [],
            });
          }
        }
      }

      const isTerminal =
        terminal ||
        !['queued', 'running'].includes(
          String(session.status || pendingTurn.status || ''),
        );
      if (isTerminal) {
        cb.setPendingTurn(null);
        cb.setBusy(false);
      }
    }

    if (typeof window.EventSource === 'function') {
      source = new window.EventSource(
        api.streamAgentTurnEventsUrl(sessionId, pendingTurn.turn_id),
      );
      source.addEventListener('agent_event', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as RunEvent;
          cbRef.current.setEvents((current: RunEvent[]) =>
            mergeAgentEvents(current, [payload]),
          );
        } catch {
          // Polling below refreshes canonical state if an SSE frame is malformed.
        }
      });
      source.addEventListener('terminal', () => {
        void refreshAssistantTurn(true).catch((error) => {
          cbRef.current.addSystemMessage(
            error instanceof Error ? error.message : String(error),
          );
          cbRef.current.setBusy(false);
        });
        source?.close();
      });
      source.onerror = () => {
        source?.close();
      };
    }

    const interval = window.setInterval(() => {
      void refreshAssistantTurn().catch((error) => {
        cbRef.current.addSystemMessage(
          error instanceof Error ? error.message : String(error),
        );
        cbRef.current.setPendingTurn(null);
        cbRef.current.setBusy(false);
      });
    }, 1000);
    void refreshAssistantTurn().catch(() => {
      // The interval retries while the background turn is settling.
    });

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      source?.close();
    };
  }, [pendingTurn, sessionId]);
}
