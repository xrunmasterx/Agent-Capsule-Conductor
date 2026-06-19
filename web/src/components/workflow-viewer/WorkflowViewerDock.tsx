import type { Dispatch, SetStateAction } from 'react';

import type {
  AgentSessionRecord,
  AgentTurnRecord,
  AuthoringAgentSummary,
  AuthoringRequiredAction,
  RunEvent,
  WorkflowBindingView,
} from '../../types';
import type {
  AssistantChatMessage,
  AssistantGraphOpsReview,
  AssistantTurnReason,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
  CanvasSelection,
  InternalNodeView,
  SelectedEntityDetailsModel,
  TemporaryResourceDraft,
  WorkflowContainerModel,
} from '../../types/workbench';
import type { UseWorkflowBindingsResult } from '../../hooks/useWorkflowBindings';
import type { WorkbenchLiveStreamState } from '../../hooks/useWorkbenchLiveStream';
import { agentEventsLiveText, failedAgentEventsText } from '../../workbench/model/agentEventText';
import { authoringSelectionLabel } from '../../workbench/model/workbenchViewProjection';
import { AssistantDockContent } from '../assistant/AssistantConsole';
import { SelectedNodeRuntimePane } from '../inspector/SelectedNodeRuntimePane';
import { SelectionDetailsDock } from '../inspector/SelectionDetailsDock';
import {
  SaveWorkflowDialog as SaveWorkflowDialogComponent,
  WorkflowBindingDialog as WorkflowBindingDialogComponent,
  type SaveWorkflowDialogState,
} from '../workbench';
import type { EvidenceDockState } from '../../hooks/useEvidenceDockActions';

type WorkflowViewerDockProps = Pick<
  UseWorkflowBindingsResult,
  'saveBinding' | 'validateBinding' | 'openBindingsFolder' | 'selectBindingDirectory'
> & {
  bindingEditorWorkflowId: string | null;
  setBindingEditorWorkflowId: Dispatch<SetStateAction<string | null>>;
  workflowBindings: Record<string, WorkflowBindingView>;
  saveWorkflowDialog: SaveWorkflowDialogState | null;
  setSaveWorkflowDialog: Dispatch<SetStateAction<SaveWorkflowDialogState | null>>;
  confirmSaveWorkflow: () => void;
  blueprintViewActive: boolean;
  evidenceDock: EvidenceDockState;
  setEvidenceDock: Dispatch<SetStateAction<EvidenceDockState>>;
  bottomDockMode: 'evidence' | 'assistant';
  message: string;
  selectedDetailsModel: SelectedEntityDetailsModel;
  currentTaskId?: string;
  selectedRunId: string | null;
  readEvidence: (path: string | null | undefined, title?: string) => void;
  assistantInput: string;
  assistantMessages: AssistantChatMessage[];
  assistantProposal: CanvasAuthoringProposal | null;
  assistantValidation: CanvasAuthoringValidationResult | null;
  temporaryResources: Record<string, TemporaryResourceDraft>;
  authoringAgents: AuthoringAgentSummary[];
  selectedAuthoringAgentId: string;
  assistantSessionId: string | null;
  assistantAgentSession: AgentSessionRecord | null;
  assistantSessionStatus: string;
  assistantPendingTurn: AgentTurnRecord | null;
  assistantEvents: RunEvent[];
  assistantLiveState: WorkbenchLiveStreamState;
  assistantTurnReason: AssistantTurnReason;
  assistantRequiredActions: AuthoringRequiredAction[];
  assistantGraphOpsReview: AssistantGraphOpsReview | null;
  assistantBusy: boolean;
  selection: CanvasSelection;
  selectedWorkflow?: WorkflowContainerModel;
  selectedInternalNode?: InternalNodeView;
  hasSelectedRunNode: boolean;
  canUndoAssistantApply: boolean;
  setSelectedAuthoringAgentId: (agentId: string) => void;
  setAssistantSessionId: (sessionId: string | null) => void;
  setAssistantAgentSession: (session: AgentSessionRecord | null) => void;
  setAssistantPendingTurn: (turn: AgentTurnRecord | null) => void;
  setAssistantEvents: (events: RunEvent[]) => void;
  setAssistantSessionStatus: (status: string) => void;
  setAssistantTurnReason: (reason: AssistantTurnReason) => void;
  setAssistantInput: (value: string) => void;
  generateAssistantProposal: () => void;
  applyAssistantProposal: () => void;
  discardAssistantProposal: () => void;
  undoLastAssistantApply: () => void;
  persistTemporaryResourceDraft: (resourceDraftId: string) => void;
  applyGraphOpsPersistenceReview: (review: AssistantGraphOpsReview) => void;
  setAssistantGraphOpsReview: (review: AssistantGraphOpsReview | null) => void;
};

export function WorkflowViewerDock({
  bindingEditorWorkflowId,
  setBindingEditorWorkflowId,
  workflowBindings,
  validateBinding,
  saveBinding,
  openBindingsFolder,
  selectBindingDirectory,
  saveWorkflowDialog,
  setSaveWorkflowDialog,
  confirmSaveWorkflow,
  blueprintViewActive,
  evidenceDock,
  setEvidenceDock,
  bottomDockMode,
  message,
  selectedDetailsModel,
  currentTaskId,
  selectedRunId,
  readEvidence,
  assistantInput,
  assistantMessages,
  assistantProposal,
  assistantValidation,
  temporaryResources,
  authoringAgents,
  selectedAuthoringAgentId,
  assistantSessionId,
  assistantAgentSession,
  assistantSessionStatus,
  assistantPendingTurn,
  assistantEvents,
  assistantLiveState,
  assistantTurnReason,
  assistantRequiredActions,
  assistantGraphOpsReview,
  assistantBusy,
  selection,
  selectedWorkflow,
  selectedInternalNode,
  hasSelectedRunNode,
  canUndoAssistantApply,
  setSelectedAuthoringAgentId,
  setAssistantSessionId,
  setAssistantAgentSession,
  setAssistantPendingTurn,
  setAssistantEvents,
  setAssistantSessionStatus,
  setAssistantTurnReason,
  setAssistantInput,
  generateAssistantProposal,
  applyAssistantProposal,
  discardAssistantProposal,
  undoLastAssistantApply,
  persistTemporaryResourceDraft,
  applyGraphOpsPersistenceReview,
  setAssistantGraphOpsReview,
}: WorkflowViewerDockProps) {
  return (
    <>
      {bindingEditorWorkflowId ? (
        <WorkflowBindingDialogComponent
          workflowId={bindingEditorWorkflowId}
          binding={workflowBindings[bindingEditorWorkflowId]}
          onClose={() => setBindingEditorWorkflowId(null)}
          onValidate={validateBinding}
          onSave={saveBinding}
          onOpenFolder={openBindingsFolder}
          onSelectDirectory={selectBindingDirectory}
        />
      ) : null}
      {saveWorkflowDialog ? (
        <SaveWorkflowDialogComponent
          state={saveWorkflowDialog}
          onName={(name) =>
            setSaveWorkflowDialog((current) => (current ? { ...current, name } : current))
          }
          onCancel={() => setSaveWorkflowDialog(null)}
          onConfirm={confirmSaveWorkflow}
        />
      ) : null}
      {blueprintViewActive ? (
        <SelectionDetailsDock
          state={evidenceDock}
          mode={bottomDockMode}
          message={message}
          model={selectedDetailsModel}
          currentTaskId={currentTaskId}
          selectedRunId={selectedRunId}
          onToggle={() => setEvidenceDock((current) => ({ ...current, open: !current.open }))}
          onReadEvidence={readEvidence}
          assistantContent={
            <AssistantDockContent
              input={assistantInput}
              messages={assistantMessages}
              proposal={assistantProposal}
              validation={assistantValidation}
              temporaryResources={temporaryResources}
              authoringAgents={authoringAgents}
              selectedAuthoringAgentId={selectedAuthoringAgentId}
              sessionId={assistantSessionId}
              agentSession={assistantAgentSession}
              sessionStatus={assistantSessionStatus}
              pendingTurn={assistantPendingTurn}
              assistantEvents={assistantEvents}
              liveState={assistantLiveState}
              turnReason={assistantTurnReason}
              requiredActions={assistantRequiredActions}
              graphOpsReview={assistantGraphOpsReview}
              busy={assistantBusy}
              targetLabel={authoringSelectionLabel(selection, selectedWorkflow, selectedInternalNode)}
              hasSelectedRunNode={hasSelectedRunNode}
              canShowNodeContext={
                selectedDetailsModel.kind !== 'canvas' && selectedDetailsModel.kind !== 'empty'
              }
              runtimePane={
                <SelectedNodeRuntimePane
                  model={selectedDetailsModel}
                  agentEventText={agentEventsLiveText(selectedDetailsModel.events)}
                  failedEventText={failedAgentEventsText(selectedDetailsModel.events)}
                />
              }
              canUndoApply={canUndoAssistantApply}
              onAgentChange={(agentId) => {
                setSelectedAuthoringAgentId(agentId);
                setAssistantSessionId(null);
                setAssistantAgentSession(null);
                setAssistantPendingTurn(null);
                setAssistantEvents([]);
                setAssistantSessionStatus('disconnected');
              }}
              onTurnReasonChange={setAssistantTurnReason}
              onInput={setAssistantInput}
              onSubmit={generateAssistantProposal}
              onApply={applyAssistantProposal}
              onDiscard={discardAssistantProposal}
              onUndoApply={undoLastAssistantApply}
              onPersistTemporaryResource={persistTemporaryResourceDraft}
              onApplyGraphOpsReview={applyGraphOpsPersistenceReview}
              onDiscardGraphOpsReview={() => setAssistantGraphOpsReview(null)}
            />
          }
        />
      ) : null}
    </>
  );
}
