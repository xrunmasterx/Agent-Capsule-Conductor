import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { AuthoringRequiredAction, CallableSummary, WorkflowGraph, WorkflowSummary } from '../types';
import type {
  AssistantApplyUndoToken,
  AssistantChatMessage,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
  CanvasSelection,
  TemporaryResourceDraft,
  WorkbenchTask,
  WorkspaceCanvasModel,
} from '../types/workbench';
import {
  applyCanvasAuthoringProposal,
  authoringId,
} from '../components/authoring/authoringRuntime';
import { canvasAuthoringHash } from '../workbench/model/authoringProposal';
import { canvasToWorkflowGraph } from '../workbench/model/workflowGraphProjection';
import { stripRuntimeStateFromCanvas } from '../components/workflow-viewer/runState';

export type UseAssistantProposalApplyActionsOptions = {
  activeTaskId: string;
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  assistantProposal: CanvasAuthoringProposal | null;
  assistantApplyUndo: AssistantApplyUndoToken | null;
  canUndoAssistantApply: boolean;
  temporaryResources: Record<string, TemporaryResourceDraft>;
  callables: CallableSummary[];
  workflows: WorkflowSummary[];
  graphRef: MutableRefObject<WorkflowGraph>;
  setCanvas: Dispatch<SetStateAction<WorkspaceCanvasModel>>;
  setTasks: Dispatch<SetStateAction<WorkbenchTask[]>>;
  setSelection: Dispatch<SetStateAction<CanvasSelection>>;
  setAssistantApplyUndo: Dispatch<SetStateAction<AssistantApplyUndoToken | null>>;
  setAssistantProposal: Dispatch<SetStateAction<CanvasAuthoringProposal | null>>;
  setAssistantBackendValidation: Dispatch<SetStateAction<CanvasAuthoringValidationResult | null>>;
  setAssistantRequiredActions: Dispatch<SetStateAction<AuthoringRequiredAction[]>>;
  setAssistantMessages: Dispatch<SetStateAction<AssistantChatMessage[]>>;
  setMessage: Dispatch<SetStateAction<string>>;
};

export type UseAssistantProposalApplyActionsResult = {
  applyAssistantProposal: () => void;
  undoLastAssistantApply: () => void;
  discardAssistantProposal: () => void;
};

export function useAssistantProposalApplyActions({
  activeTaskId,
  canvas,
  selection,
  assistantProposal,
  assistantApplyUndo,
  canUndoAssistantApply,
  temporaryResources,
  callables,
  workflows,
  graphRef,
  setCanvas,
  setTasks,
  setSelection,
  setAssistantApplyUndo,
  setAssistantProposal,
  setAssistantBackendValidation,
  setAssistantRequiredActions,
  setAssistantMessages,
  setMessage,
}: UseAssistantProposalApplyActionsOptions): UseAssistantProposalApplyActionsResult {
  const applyAssistantProposal = useCallback(() => {
    if (!assistantProposal) {
      return;
    }
    const beforeCanvas = stripRuntimeStateFromCanvas(canvas);
    const beforeTemporaryResources = temporaryResources;
    const beforeSelection = selection;
    try {
      const result = applyCanvasAuthoringProposal({
        canvas,
        taskId: activeTaskId,
        proposal: assistantProposal,
        temporaryResources,
        callables,
        workflows,
      });
      const nextGraph = canvasToWorkflowGraph(result.canvas);
      const afterCanvasHash = canvasAuthoringHash(activeTaskId, stripRuntimeStateFromCanvas(result.canvas));
      graphRef.current = nextGraph;
      setCanvas(result.canvas);
      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.taskId === activeTaskId
            ? {
                ...task,
                title: result.canvas.name,
                canvas: stripRuntimeStateFromCanvas(result.canvas),
                authoring: { temporaryResources: result.temporaryResources },
              }
            : task,
        ),
      );
      setSelection(result.selection);
      setAssistantApplyUndo({
        proposalId: assistantProposal.proposal_id,
        taskId: activeTaskId,
        beforeCanvas,
        beforeTemporaryResources,
        beforeSelection,
        afterCanvasHash,
        affectedSelection: result.selection,
      });
      setAssistantProposal(null);
      setAssistantBackendValidation(null);
      setAssistantRequiredActions((current) =>
        current.filter((action) => {
          if (action.kind !== 'approve_resource_persistence' || !action.resource_draft_id) {
            return false;
          }
          return Boolean(result.temporaryResources[String(action.resource_draft_id)]);
        }),
      );
      const text = result.messages.join('\n') || 'Proposal 已应用到当前 task canvas。';
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'system', content: text },
      ]);
      setMessage(text);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'system', content: text },
      ]);
      setMessage(text);
    }
  }, [
    activeTaskId,
    assistantProposal,
    callables,
    canvas,
    graphRef,
    selection,
    setAssistantApplyUndo,
    setAssistantBackendValidation,
    setAssistantMessages,
    setAssistantProposal,
    setAssistantRequiredActions,
    setCanvas,
    setMessage,
    setSelection,
    setTasks,
    temporaryResources,
    workflows,
  ]);

  const undoLastAssistantApply = useCallback(() => {
    if (!assistantApplyUndo || !canUndoAssistantApply) {
      return;
    }
    const nextCanvas = stripRuntimeStateFromCanvas(assistantApplyUndo.beforeCanvas);
    const nextGraph = canvasToWorkflowGraph(nextCanvas);
    graphRef.current = nextGraph;
    setCanvas(nextCanvas);
    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.taskId === activeTaskId
          ? {
              ...task,
              title: nextCanvas.name,
              canvas: nextCanvas,
              authoring: { temporaryResources: assistantApplyUndo.beforeTemporaryResources },
            }
          : task,
      ),
    );
    setSelection(assistantApplyUndo.beforeSelection);
    setAssistantApplyUndo(null);
    const text = '已撤回上一次 AI 应用到画布的修改。';
    setAssistantMessages((current) => [
      ...current,
      { id: authoringId('assistant_msg'), role: 'system', content: text },
    ]);
    setMessage(text);
  }, [
    activeTaskId,
    assistantApplyUndo,
    canUndoAssistantApply,
    graphRef,
    setAssistantApplyUndo,
    setAssistantMessages,
    setCanvas,
    setMessage,
    setSelection,
    setTasks,
  ]);

  const discardAssistantProposal = useCallback(() => {
    setAssistantProposal(null);
    setAssistantBackendValidation(null);
    setAssistantRequiredActions([]);
    setAssistantMessages((current) => [
      ...current,
      { id: authoringId('assistant_msg'), role: 'system', content: '已丢弃当前 proposal。' },
    ]);
  }, [
    setAssistantBackendValidation,
    setAssistantMessages,
    setAssistantProposal,
    setAssistantRequiredActions,
  ]);

  return {
    applyAssistantProposal,
    undoLastAssistantApply,
    discardAssistantProposal,
  };
}
