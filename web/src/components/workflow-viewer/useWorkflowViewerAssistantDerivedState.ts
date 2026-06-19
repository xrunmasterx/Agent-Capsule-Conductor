import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';

import type { CallableSummary, WorkflowSummary } from '../../types';
import type {
  AssistantApplyUndoToken,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
  TemporaryResourceDraft,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { validateCanvasAuthoringProposal } from '../authoring/authoringRuntime';
import {
  canvasAuthoringHash,
  mergeAuthoringValidation,
} from '../../workbench/model/authoringProposal';
import { stripRuntimeStateFromCanvas } from './runState';

export type WorkflowViewerAssistantDerivedStateOptions = {
  activeTaskId: string;
  canvas: WorkspaceCanvasModel;
  temporaryResources: Record<string, TemporaryResourceDraft>;
  callables: CallableSummary[];
  workflows: WorkflowSummary[];
  assistantProposal: CanvasAuthoringProposal | null;
  assistantBackendValidation: CanvasAuthoringValidationResult | null;
  assistantApplyUndo: AssistantApplyUndoToken | null;
  isRunning: boolean;
  hasAssistantPendingTurn: boolean;
  setAssistantProposal: Dispatch<SetStateAction<CanvasAuthoringProposal | null>>;
};

export type WorkflowViewerAssistantDerivedState = {
  assistantValidation: CanvasAuthoringValidationResult | null;
  currentAuthoringCanvasHash: string;
  canUndoAssistantApply: boolean;
  clearAssistantProposal: () => void;
};

export function useWorkflowViewerAssistantDerivedState({
  activeTaskId,
  canvas,
  temporaryResources,
  callables,
  workflows,
  assistantProposal,
  assistantBackendValidation,
  assistantApplyUndo,
  isRunning,
  hasAssistantPendingTurn,
  setAssistantProposal,
}: WorkflowViewerAssistantDerivedStateOptions): WorkflowViewerAssistantDerivedState {
  const assistantLocalValidation = useMemo(
    () =>
      assistantProposal
        ? validateCanvasAuthoringProposal(assistantProposal, {
            canvas,
            taskId: activeTaskId,
            temporaryResources,
            callables,
            workflows,
          })
        : null,
    [activeTaskId, assistantProposal, callables, canvas, temporaryResources, workflows],
  );
  const assistantValidation = useMemo(
    () => mergeAuthoringValidation(assistantLocalValidation, assistantBackendValidation),
    [assistantBackendValidation, assistantLocalValidation],
  );
  const currentAuthoringCanvasHash = useMemo(
    () => canvasAuthoringHash(activeTaskId, stripRuntimeStateFromCanvas(canvas)),
    [activeTaskId, canvas],
  );
  const clearAssistantProposal = useCallback(() => {
    setAssistantProposal(null);
  }, [setAssistantProposal]);
  const canUndoAssistantApply =
    Boolean(assistantApplyUndo) &&
    assistantApplyUndo?.taskId === activeTaskId &&
    assistantApplyUndo.afterCanvasHash === currentAuthoringCanvasHash &&
    !isRunning &&
    !hasAssistantPendingTurn;

  return {
    assistantValidation,
    currentAuthoringCanvasHash,
    canUndoAssistantApply,
    clearAssistantProposal,
  };
}
