import { useCallback, type SetStateAction } from 'react';

import type {
  AgentSessionRecord,
  AgentTurnRecord,
  AuthoringAgentSummary,
  AuthoringRequiredAction,
  RunEvent,
} from '../types';
import type {
  AssistantApplyUndoToken,
  AssistantChatMessage,
  AssistantGraphOpsReview,
  AssistantTurnReason,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
} from '../types/workbench';
import {
  emptyAssistantTaskState,
  useAssistantStore,
  type AssistantTaskState,
} from '../stores/assistantStore';

export type AssistantTaskStoreBindings = {
  assistantTaskState: AssistantTaskState;
  authoringAgents: AuthoringAgentSummary[];
  setAuthoringAgents: (next: SetStateAction<AuthoringAgentSummary[]>) => void;
  setAssistantInput: (next: SetStateAction<string>) => void;
  setAssistantMessages: (next: SetStateAction<AssistantChatMessage[]>) => void;
  setAssistantProposal: (next: SetStateAction<CanvasAuthoringProposal | null>) => void;
  setSelectedAuthoringAgentId: (next: SetStateAction<string>) => void;
  setAssistantSessionId: (next: SetStateAction<string | null>) => void;
  setAssistantAgentSession: (next: SetStateAction<AgentSessionRecord | null>) => void;
  setAssistantPendingTurn: (next: SetStateAction<AgentTurnRecord | null>) => void;
  setAssistantEvents: (next: SetStateAction<RunEvent[]>) => void;
  setAssistantTurnReason: (next: SetStateAction<AssistantTurnReason>) => void;
  setAssistantSessionStatus: (next: SetStateAction<string>) => void;
  setAssistantBackendValidation: (next: SetStateAction<CanvasAuthoringValidationResult | null>) => void;
  setAssistantRequiredActions: (next: SetStateAction<AuthoringRequiredAction[]>) => void;
  setAssistantGraphOpsReview: (next: SetStateAction<AssistantGraphOpsReview | null>) => void;
  setAssistantBusy: (next: SetStateAction<boolean>) => void;
  setAssistantApplyUndo: (next: SetStateAction<AssistantApplyUndoToken | null>) => void;
};

function resolveSetState<T>(current: T, next: SetStateAction<T>): T {
  return typeof next === 'function' ? (next as (value: T) => T)(current) : next;
}

const emptyAssistantTaskStateSnapshot = emptyAssistantTaskState();

function currentAssistantTaskState(taskId: string): AssistantTaskState {
  return useAssistantStore.getState().assistantByTaskId[taskId] || emptyAssistantTaskStateSnapshot;
}

export function useAssistantTaskStoreBindings(activeTaskId: string): AssistantTaskStoreBindings {
  const assistantTaskState = useAssistantStore(
    (state) => state.assistantByTaskId[activeTaskId] || emptyAssistantTaskStateSnapshot,
  );
  const authoringAgents = useAssistantStore((state) => state.authoringAgents);

  const setAuthoringAgents = useCallback((next: SetStateAction<AuthoringAgentSummary[]>) => {
    const store = useAssistantStore.getState();
    store.setAuthoringAgents(resolveSetState(store.authoringAgents, next));
  }, []);

  const setAssistantInput = useCallback((next: SetStateAction<string>) => {
    const current = currentAssistantTaskState(activeTaskId);
    useAssistantStore.getState().setAssistantInput(activeTaskId, resolveSetState(current.assistantInput, next));
  }, [activeTaskId]);

  const setAssistantMessages = useCallback((next: SetStateAction<AssistantChatMessage[]>) => {
    const current = currentAssistantTaskState(activeTaskId);
    useAssistantStore.getState().setAssistantMessages(
      activeTaskId,
      resolveSetState(current.assistantMessages, next),
    );
  }, [activeTaskId]);

  const setAssistantProposal = useCallback((next: SetStateAction<CanvasAuthoringProposal | null>) => {
    const current = currentAssistantTaskState(activeTaskId);
    useAssistantStore.getState().setAssistantProposal(
      activeTaskId,
      resolveSetState(current.assistantProposal, next),
    );
  }, [activeTaskId]);

  const setSelectedAuthoringAgentId = useCallback((next: SetStateAction<string>) => {
    const current = currentAssistantTaskState(activeTaskId);
    useAssistantStore.getState().setSelectedAuthoringAgentId(
      activeTaskId,
      resolveSetState(current.selectedAuthoringAgentId, next),
    );
  }, [activeTaskId]);

  const setAssistantSessionId = useCallback((next: SetStateAction<string | null>) => {
    const current = currentAssistantTaskState(activeTaskId);
    useAssistantStore.getState().setAssistantSessionId(
      activeTaskId,
      resolveSetState(current.assistantSessionId, next),
    );
  }, [activeTaskId]);

  const setAssistantAgentSession = useCallback((next: SetStateAction<AgentSessionRecord | null>) => {
    const current = currentAssistantTaskState(activeTaskId);
    useAssistantStore.getState().setAssistantAgentSession(
      activeTaskId,
      resolveSetState(current.assistantAgentSession, next),
    );
  }, [activeTaskId]);

  const setAssistantPendingTurn = useCallback((next: SetStateAction<AgentTurnRecord | null>) => {
    const current = currentAssistantTaskState(activeTaskId);
    useAssistantStore.getState().setAssistantPendingTurn(
      activeTaskId,
      resolveSetState(current.assistantPendingTurn, next),
    );
  }, [activeTaskId]);

  const setAssistantEvents = useCallback((next: SetStateAction<RunEvent[]>) => {
    const current = currentAssistantTaskState(activeTaskId);
    useAssistantStore.getState().setAssistantEvents(activeTaskId, resolveSetState(current.assistantEvents, next));
  }, [activeTaskId]);

  const setAssistantTurnReason = useCallback((next: SetStateAction<AssistantTurnReason>) => {
    const current = currentAssistantTaskState(activeTaskId);
    useAssistantStore.getState().setAssistantTurnReason(
      activeTaskId,
      resolveSetState(current.assistantTurnReason, next),
    );
  }, [activeTaskId]);

  const setAssistantSessionStatus = useCallback((next: SetStateAction<string>) => {
    const current = currentAssistantTaskState(activeTaskId);
    useAssistantStore.getState().setAssistantSessionStatus(
      activeTaskId,
      resolveSetState(current.assistantSessionStatus, next),
    );
  }, [activeTaskId]);

  const setAssistantBackendValidation = useCallback((next: SetStateAction<CanvasAuthoringValidationResult | null>) => {
    const current = currentAssistantTaskState(activeTaskId);
    useAssistantStore.getState().setAssistantBackendValidation(
      activeTaskId,
      resolveSetState(current.assistantBackendValidation, next),
    );
  }, [activeTaskId]);

  const setAssistantRequiredActions = useCallback((next: SetStateAction<AuthoringRequiredAction[]>) => {
    const current = currentAssistantTaskState(activeTaskId);
    useAssistantStore.getState().setAssistantRequiredActions(
      activeTaskId,
      resolveSetState(current.assistantRequiredActions, next),
    );
  }, [activeTaskId]);

  const setAssistantGraphOpsReview = useCallback((next: SetStateAction<AssistantGraphOpsReview | null>) => {
    const current = currentAssistantTaskState(activeTaskId);
    useAssistantStore.getState().setAssistantGraphOpsReview(
      activeTaskId,
      resolveSetState(current.assistantGraphOpsReview, next),
    );
  }, [activeTaskId]);

  const setAssistantBusy = useCallback((next: SetStateAction<boolean>) => {
    const current = currentAssistantTaskState(activeTaskId);
    useAssistantStore.getState().setAssistantBusy(activeTaskId, resolveSetState(current.assistantBusy, next));
  }, [activeTaskId]);

  const setAssistantApplyUndo = useCallback((next: SetStateAction<AssistantApplyUndoToken | null>) => {
    const current = currentAssistantTaskState(activeTaskId);
    useAssistantStore.getState().setAssistantApplyUndo(
      activeTaskId,
      resolveSetState(current.assistantApplyUndo, next),
    );
  }, [activeTaskId]);

  return {
    assistantTaskState,
    authoringAgents,
    setAuthoringAgents,
    setAssistantInput,
    setAssistantMessages,
    setAssistantProposal,
    setSelectedAuthoringAgentId,
    setAssistantSessionId,
    setAssistantAgentSession,
    setAssistantPendingTurn,
    setAssistantEvents,
    setAssistantTurnReason,
    setAssistantSessionStatus,
    setAssistantBackendValidation,
    setAssistantRequiredActions,
    setAssistantGraphOpsReview,
    setAssistantBusy,
    setAssistantApplyUndo,
  };
}
