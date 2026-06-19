import { useCallback, type Dispatch, type FormEvent, type SetStateAction } from 'react';

import type { AgentSessionRecord, AgentTurnRecord } from '../types';
import type {
  AssistantChatMessage,
  AssistantTurnReason,
  BottomDockMode,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
  CanvasSelection,
} from '../types/workbench';
import {
  authoringBackendCanvasSnapshot,
  authoringSelectionPayload,
  effectiveAssistantTurnReason,
} from '../workbench/model/authoringProposal';
import { authoringId } from '../components/authoring/authoringRuntime';
import type { AuthoringContextSnapshot } from '../types/workbench';
import type { EvidenceDockState } from './useEvidenceDockActions';
import type { UseWorkbenchAssistantActionsResult } from './useWorkbenchAssistantActions';

export type EnsureAssistantSession = (snapshot: AuthoringContextSnapshot) => Promise<string>;

export type UseAssistantProposalGenerateActionsOptions = {
  assistantInput: string;
  assistantTurnReason: AssistantTurnReason;
  selection: CanvasSelection;
  assistantAgentSession: AgentSessionRecord | null;
  currentAuthoringSnapshot: () => AuthoringContextSnapshot;
  ensureAssistantSession: EnsureAssistantSession;
  loadWorkbenchAssistantSession: UseWorkbenchAssistantActionsResult['loadWorkbenchAssistantSession'];
  submitWorkbenchAssistantTurnRequest: UseWorkbenchAssistantActionsResult['submitWorkbenchAssistantTurnRequest'];
  setAssistantMessages: Dispatch<SetStateAction<AssistantChatMessage[]>>;
  setAssistantBusy: Dispatch<SetStateAction<boolean>>;
  setAssistantAgentSession: Dispatch<SetStateAction<AgentSessionRecord | null>>;
  setAssistantPendingTurn: Dispatch<SetStateAction<AgentTurnRecord | null>>;
  setAssistantSessionStatus: Dispatch<SetStateAction<string>>;
  setAssistantInput: Dispatch<SetStateAction<string>>;
  setAssistantProposal: Dispatch<SetStateAction<CanvasAuthoringProposal | null>>;
  setAssistantBackendValidation: Dispatch<SetStateAction<CanvasAuthoringValidationResult | null>>;
  setBottomDockMode: (mode: BottomDockMode) => void;
  setEvidenceDock: Dispatch<SetStateAction<EvidenceDockState>>;
  setMessage: Dispatch<SetStateAction<string>>;
};

export type UseAssistantProposalGenerateActionsResult = {
  generateAssistantProposal: (event?: FormEvent<HTMLFormElement>) => Promise<void>;
};

export function useAssistantProposalGenerateActions({
  assistantInput,
  assistantTurnReason,
  selection,
  assistantAgentSession,
  currentAuthoringSnapshot,
  ensureAssistantSession,
  loadWorkbenchAssistantSession,
  submitWorkbenchAssistantTurnRequest,
  setAssistantMessages,
  setAssistantBusy,
  setAssistantAgentSession,
  setAssistantPendingTurn,
  setAssistantSessionStatus,
  setAssistantInput,
  setAssistantProposal,
  setAssistantBackendValidation,
  setBottomDockMode,
  setEvidenceDock,
  setMessage,
}: UseAssistantProposalGenerateActionsOptions): UseAssistantProposalGenerateActionsResult {
  const generateAssistantProposal = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const snapshot = currentAuthoringSnapshot();
      const userText = assistantInput.trim();
      const effectiveTurnReason = effectiveAssistantTurnReason(assistantTurnReason, selection);
      if (!userText) {
        const text = 'Please enter a requirement.';
        setAssistantMessages((current) => [
          ...current,
          { id: authoringId('assistant_msg'), role: 'assistant', content: text },
        ]);
        setMessage(text);
        return;
      }
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'user', content: userText },
      ]);
      setAssistantBusy(true);
      try {
        const sessionId = await ensureAssistantSession(snapshot);
        const currentSession =
          assistantAgentSession && assistantAgentSession.session_id === sessionId
            ? assistantAgentSession
            : await loadWorkbenchAssistantSession(sessionId);
        setAssistantAgentSession(currentSession);
        const turn = await submitWorkbenchAssistantTurnRequest(sessionId, {
          message: userText,
          reason: effectiveTurnReason,
          canvas_hash: snapshot.snapshot_id,
          canvas_snapshot: authoringBackendCanvasSnapshot(snapshot),
          selection: authoringSelectionPayload(snapshot.selection),
          expected_provider_session_id:
            typeof currentSession.provider_session_id === 'string'
              ? currentSession.provider_session_id
              : undefined,
        });
        setAssistantPendingTurn(turn);
        setAssistantSessionStatus(turn.status || 'queued');
        setAssistantInput('');
        setBottomDockMode('assistant');
        setEvidenceDock((current) => ({ ...current, open: true }));
        setMessage(`AI 助手 turn ${turn.turn_id}: ${turn.status || 'queued'}`);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        setAssistantProposal(null);
        setAssistantBackendValidation(null);
        setAssistantMessages((current) => [
          ...current,
          { id: authoringId('assistant_msg'), role: 'system', content: text },
        ]);
        setMessage(text);
        setAssistantBusy(false);
      }
    },
    [
      assistantAgentSession,
      assistantInput,
      assistantTurnReason,
      currentAuthoringSnapshot,
      ensureAssistantSession,
      loadWorkbenchAssistantSession,
      selection,
      setAssistantAgentSession,
      setAssistantBackendValidation,
      setAssistantBusy,
      setAssistantInput,
      setAssistantMessages,
      setAssistantPendingTurn,
      setAssistantProposal,
      setAssistantSessionStatus,
      setBottomDockMode,
      setEvidenceDock,
      setMessage,
      submitWorkbenchAssistantTurnRequest,
    ],
  );

  return { generateAssistantProposal };
}
