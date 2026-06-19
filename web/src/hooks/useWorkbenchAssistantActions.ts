import { useCallback } from 'react';

import { api } from '../api';
import type { AgentSessionRecord, AgentTurnRecord } from '../types';

export type SubmitWorkbenchAssistantTurnPayload = {
  message: string;
  reason: 'workbench_chat' | 'canvas_revision' | 'selected_node_revision';
  canvas_hash: string;
  canvas_snapshot: Record<string, unknown>;
  selection?: Record<string, unknown> | null;
  expected_provider_session_id?: string | null;
};

export type UseWorkbenchAssistantActionsResult = {
  loadWorkbenchAssistantSession: (sessionId: string) => Promise<AgentSessionRecord>;
  submitWorkbenchAssistantTurnRequest: (
    sessionId: string,
    payload: SubmitWorkbenchAssistantTurnPayload,
  ) => Promise<AgentTurnRecord>;
};

export function useWorkbenchAssistantActions(): UseWorkbenchAssistantActionsResult {
  const loadWorkbenchAssistantSession = useCallback(
    (sessionId: string) => api.getAgentSession(sessionId),
    [],
  );
  const submitWorkbenchAssistantTurnRequest = useCallback(
    (sessionId: string, payload: SubmitWorkbenchAssistantTurnPayload) =>
      api.submitWorkbenchAssistantTurn(sessionId, payload),
    [],
  );

  return {
    loadWorkbenchAssistantSession,
    submitWorkbenchAssistantTurnRequest,
  };
}
