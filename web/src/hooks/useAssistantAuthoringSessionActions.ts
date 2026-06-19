import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type {
  AgentSessionRecord,
  AgentTurnRecord,
  AuthoringAgentSummary,
  AuthoringRequiredAction,
  CallableSummary,
  RunEvent,
  WorkflowSummary,
} from '../types';
import type {
  AssistantApplyUndoToken,
  AssistantChatMessage,
  AssistantGraphOpsReview,
  AssistantTurnReason,
  AuthoringContextSnapshot,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
  CanvasSelection,
  WorkspaceCanvasModel,
} from '../types/workbench';
import {
  authoringBackendCanvasSnapshot,
  authoringSelectionPayload,
} from '../workbench/model/authoringProposal';
import {
  authoringId,
  captureAuthoringSnapshot,
} from '../components/authoring/authoringRuntime';
import { useAssistantSession } from './useAssistantSession';
import {
  useWorkbenchAssistantActions,
  type UseWorkbenchAssistantActionsResult,
} from './useWorkbenchAssistantActions';

export type UseAssistantAuthoringSessionActionsOptions = {
  activeTaskId: string;
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  callables: CallableSummary[];
  workflows: WorkflowSummary[];
  assistantSessionId: string | null;
  selectedAuthoringAgentId: string;
  setAuthoringAgents: (agents: AuthoringAgentSummary[]) => void;
  setSelectedAuthoringAgentId: (agentId: string) => void;
  setAssistantInput: Dispatch<SetStateAction<string>>;
  setAssistantMessages: Dispatch<SetStateAction<AssistantChatMessage[]>>;
  setAssistantProposal: Dispatch<SetStateAction<CanvasAuthoringProposal | null>>;
  setAssistantApplyUndo: Dispatch<SetStateAction<AssistantApplyUndoToken | null>>;
  setAssistantTurnReason: Dispatch<SetStateAction<AssistantTurnReason>>;
  setAssistantBackendValidation: Dispatch<SetStateAction<CanvasAuthoringValidationResult | null>>;
  setAssistantRequiredActions: Dispatch<SetStateAction<AuthoringRequiredAction[]>>;
  setAssistantGraphOpsReview: Dispatch<SetStateAction<AssistantGraphOpsReview | null>>;
  setAssistantSessionId: Dispatch<SetStateAction<string | null>>;
  setAssistantAgentSession: Dispatch<SetStateAction<AgentSessionRecord | null>>;
  setAssistantPendingTurn: Dispatch<SetStateAction<AgentTurnRecord | null>>;
  setAssistantEvents: Dispatch<SetStateAction<RunEvent[]>>;
  setAssistantSessionStatus: Dispatch<SetStateAction<string>>;
  setAssistantBusy: Dispatch<SetStateAction<boolean>>;
};

export type UseAssistantAuthoringSessionActionsResult = UseWorkbenchAssistantActionsResult & {
  resetAssistantConversationState: () => void;
  currentAuthoringSnapshot: () => AuthoringContextSnapshot;
  addAssistantSystemMessage: (content: string) => void;
  ensureAssistantSession: (snapshot?: AuthoringContextSnapshot) => Promise<string>;
};

export function useAssistantAuthoringSessionActions({
  activeTaskId,
  canvas,
  selection,
  callables,
  workflows,
  assistantSessionId,
  selectedAuthoringAgentId,
  setAuthoringAgents,
  setSelectedAuthoringAgentId,
  setAssistantInput,
  setAssistantMessages,
  setAssistantProposal,
  setAssistantApplyUndo,
  setAssistantTurnReason,
  setAssistantBackendValidation,
  setAssistantRequiredActions,
  setAssistantGraphOpsReview,
  setAssistantSessionId,
  setAssistantAgentSession,
  setAssistantPendingTurn,
  setAssistantEvents,
  setAssistantSessionStatus,
  setAssistantBusy,
}: UseAssistantAuthoringSessionActionsOptions): UseAssistantAuthoringSessionActionsResult {
  const resetAssistantConversationState = useCallback(() => {
    setAssistantInput('');
    setAssistantMessages([]);
    setAssistantProposal(null);
    setAssistantApplyUndo(null);
    setAssistantTurnReason('workbench_chat');
    setAssistantBackendValidation(null);
    setAssistantRequiredActions([]);
    setAssistantGraphOpsReview(null);
    setAssistantSessionId(null);
    setAssistantAgentSession(null);
    setAssistantPendingTurn(null);
    setAssistantEvents([]);
    setAssistantSessionStatus('disconnected');
    setAssistantBusy(false);
  }, [
    setAssistantAgentSession,
    setAssistantApplyUndo,
    setAssistantBackendValidation,
    setAssistantBusy,
    setAssistantEvents,
    setAssistantGraphOpsReview,
    setAssistantInput,
    setAssistantMessages,
    setAssistantPendingTurn,
    setAssistantProposal,
    setAssistantRequiredActions,
    setAssistantSessionId,
    setAssistantSessionStatus,
    setAssistantTurnReason,
  ]);

  const currentAuthoringSnapshot = useCallback(
    (): AuthoringContextSnapshot =>
      captureAuthoringSnapshot({
        taskId: activeTaskId,
        canvas,
        selection,
        callables,
        workflows,
      }),
    [activeTaskId, callables, canvas, selection, workflows],
  );

  const addAssistantSystemMessage = useCallback(
    (content: string) => {
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'system', content },
      ]);
    },
    [setAssistantMessages],
  );

  const ensureAssistantSessionFromPayload = useAssistantSession({
    sessionId: assistantSessionId,
    selectedAuthoringAgentId,
    setAuthoringAgents,
    setSelectedAuthoringAgentId,
    setSessionId: setAssistantSessionId,
    setAgentSession: setAssistantAgentSession,
    setSessionStatus: setAssistantSessionStatus,
    setMessages: setAssistantMessages,
    setBusy: setAssistantBusy,
    addSystemMessage: addAssistantSystemMessage,
  });

  const {
    loadWorkbenchAssistantSession,
    submitWorkbenchAssistantTurnRequest,
  } = useWorkbenchAssistantActions();

  const ensureAssistantSession = useCallback(
    (snapshot = currentAuthoringSnapshot()): Promise<string> =>
      ensureAssistantSessionFromPayload({
        taskId: snapshot.task_id,
        canvasHash: snapshot.snapshot_id,
        canvasSnapshot: authoringBackendCanvasSnapshot(snapshot),
        selection: authoringSelectionPayload(snapshot.selection),
      }),
    [currentAuthoringSnapshot, ensureAssistantSessionFromPayload],
  );

  return {
    resetAssistantConversationState,
    currentAuthoringSnapshot,
    addAssistantSystemMessage,
    ensureAssistantSession,
    loadWorkbenchAssistantSession,
    submitWorkbenchAssistantTurnRequest,
  };
}
