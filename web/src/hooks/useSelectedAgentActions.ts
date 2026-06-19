import { useCallback } from 'react';

import { api } from '../api';
import type { AgentOutputPublishResult, AgentTurnRecord } from '../types';

export type SubmitSelectedAgentTurnPayload = {
  message: string;
  reason: 'node_chat' | 'output_revision';
  expected_provider_session_id?: string | null;
};

export type UseSelectedAgentActionsResult = {
  submitSelectedAgentTurnRequest: (
    sessionId: string,
    payload: SubmitSelectedAgentTurnPayload,
  ) => Promise<AgentTurnRecord>;
  publishSelectedAgentOutputRequest: (
    sessionId: string,
    expectedTurnId: string,
  ) => Promise<AgentOutputPublishResult>;
  answerSelectedAgentInteractionRequest: (
    runId: string,
    interactionId: string,
    answer: Record<string, unknown>,
  ) => Promise<unknown>;
};

export function useSelectedAgentActions(): UseSelectedAgentActionsResult {
  const submitSelectedAgentTurnRequest = useCallback(
    (sessionId: string, payload: SubmitSelectedAgentTurnPayload) =>
      api.submitAgentTurn(sessionId, payload),
    [],
  );
  const publishSelectedAgentOutputRequest = useCallback(
    (sessionId: string, expectedTurnId: string) =>
      api.publishAgentOutput(sessionId, expectedTurnId),
    [],
  );
  const answerSelectedAgentInteractionRequest = useCallback(
    (runId: string, interactionId: string, answer: Record<string, unknown>) =>
      api.answerInteraction(runId, interactionId, answer),
    [],
  );

  return {
    submitSelectedAgentTurnRequest,
    publishSelectedAgentOutputRequest,
    answerSelectedAgentInteractionRequest,
  };
}
