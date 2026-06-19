import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { AgentTurnRecord } from '../types';
import type {
  AgentSessionUiState,
  SelectedAgentSessionContext,
} from './useSelectedAgentSession';
import type { UseSelectedAgentActionsResult } from './useSelectedAgentActions';

export type UseSelectedAgentTurnActionsOptions = {
  agentSessionState: AgentSessionUiState;
  selectedAgentSessionContext: SelectedAgentSessionContext | null;
  selectedRunId: string | null;
  submitSelectedAgentTurnRequest: UseSelectedAgentActionsResult['submitSelectedAgentTurnRequest'];
  publishSelectedAgentOutputRequest: UseSelectedAgentActionsResult['publishSelectedAgentOutputRequest'];
  answerSelectedAgentInteractionRequest: UseSelectedAgentActionsResult['answerSelectedAgentInteractionRequest'];
  setAgentSessionPendingTurn: (turn: AgentTurnRecord | null) => void;
  setMessage: Dispatch<SetStateAction<string>>;
  refreshAgentSession: () => Promise<void>;
  refreshRunProjection: (runId: string) => Promise<void>;
  onChanged?: () => void;
};

export type UseSelectedAgentTurnActionsResult = {
  submitSelectedAgentTurn: (
    messageText: string,
    reason: 'node_chat' | 'output_revision',
  ) => Promise<void>;
  publishSelectedAgentOutput: (expectedTurnId: string) => Promise<void>;
  answerSelectedAgentInteraction: (
    interactionId: string,
    answer: Record<string, unknown>,
  ) => Promise<void>;
};

export function useSelectedAgentTurnActions({
  agentSessionState,
  selectedAgentSessionContext,
  selectedRunId,
  submitSelectedAgentTurnRequest,
  publishSelectedAgentOutputRequest,
  answerSelectedAgentInteractionRequest,
  setAgentSessionPendingTurn,
  setMessage,
  refreshAgentSession,
  refreshRunProjection,
  onChanged,
}: UseSelectedAgentTurnActionsOptions): UseSelectedAgentTurnActionsResult {
  const submitSelectedAgentTurn = useCallback(
    async (messageText: string, reason: 'node_chat' | 'output_revision') => {
      const session = agentSessionState.session;
      if (!session) {
        throw new Error('当前节点还没有可用的 Agent Session');
      }
      const turn = await submitSelectedAgentTurnRequest(session.session_id, {
        message: messageText,
        reason,
        expected_provider_session_id:
          typeof session.provider_session_id === 'string' ? session.provider_session_id : undefined,
      });
      setAgentSessionPendingTurn(turn);
      setMessage(`Agent turn ${turn.turn_id}: ${turn.status || 'queued'}`);
      await refreshAgentSession();
    },
    [
      agentSessionState.session,
      refreshAgentSession,
      setAgentSessionPendingTurn,
      setMessage,
      submitSelectedAgentTurnRequest,
    ],
  );

  const publishSelectedAgentOutput = useCallback(
    async (expectedTurnId: string) => {
      const session = agentSessionState.session;
      if (!session) {
        throw new Error('当前节点还没有可用的 Agent Session');
      }
      await publishSelectedAgentOutputRequest(session.session_id, expectedTurnId);
      if (selectedRunId) {
        await refreshRunProjection(selectedRunId);
      }
      await refreshAgentSession();
      setMessage(`已发布 ${expectedTurnId} 为当前节点 output.json`);
      onChanged?.();
    },
    [
      agentSessionState.session,
      onChanged,
      publishSelectedAgentOutputRequest,
      refreshAgentSession,
      refreshRunProjection,
      selectedRunId,
      setMessage,
    ],
  );

  const answerSelectedAgentInteraction = useCallback(
    async (interactionId: string, answer: Record<string, unknown>) => {
      const runId = selectedAgentSessionContext?.runId;
      if (!runId) {
        throw new Error('当前节点没有绑定 run，无法处理审批');
      }
      await answerSelectedAgentInteractionRequest(runId, interactionId, answer);
      await refreshAgentSession();
    },
    [answerSelectedAgentInteractionRequest, refreshAgentSession, selectedAgentSessionContext?.runId],
  );

  return {
    submitSelectedAgentTurn,
    publishSelectedAgentOutput,
    answerSelectedAgentInteraction,
  };
}
