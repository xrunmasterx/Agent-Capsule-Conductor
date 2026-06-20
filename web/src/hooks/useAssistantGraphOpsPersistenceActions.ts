import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type {
  AuthoringRequiredAction,
  WorkflowGraph,
} from '../types';
import type {
  AssistantChatMessage,
  AssistantGraphOpsReview,
  TemporaryResourceDraft,
  WorkbenchTask,
  WorkspaceCanvasModel,
} from '../types/workbench';
import {
  graphOpsTransactionForTemporaryAgent,
  persistentCallableIdForDraft,
} from '../workbench/model/graphOpsProposal';
import {
  emptyWorkbenchAuthoringState,
} from '../workbench/model/taskModel';
import {
  replaceTemporaryResourceWithCallable,
} from '../workbench/model/authoringProposal';
import {
  normalizeCanvasEdges,
} from '../workbench/model/canvasEdgeOps';
import { canvasToWorkflowGraph } from '../workbench/model/workflowGraphProjection';
import { stripRuntimeStateFromCanvas } from '../components/workflow-viewer/runState';
import { authoringId } from '../components/authoring/authoringRuntime';
import type {
  ApproveGraphOpsProposalPayload,
  UseGraphOpsPersistenceResult,
} from './useGraphOpsPersistence';

export type UseAssistantGraphOpsPersistenceActionsOptions = {
  activeTaskId: string;
  canvas: WorkspaceCanvasModel;
  temporaryResources: Record<string, TemporaryResourceDraft>;
  graphRef: MutableRefObject<WorkflowGraph>;
  graphOps: UseGraphOpsPersistenceResult;
  setCanvas: Dispatch<SetStateAction<WorkspaceCanvasModel>>;
  setTasks: Dispatch<SetStateAction<WorkbenchTask[]>>;
  setAssistantRequiredActions: Dispatch<SetStateAction<AuthoringRequiredAction[]>>;
  setAssistantGraphOpsReview: Dispatch<SetStateAction<AssistantGraphOpsReview | null>>;
  setAssistantMessages: Dispatch<SetStateAction<AssistantChatMessage[]>>;
  setAssistantBusy: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string>>;
  onChanged?: () => void;
};

export type UseAssistantGraphOpsPersistenceActionsResult = {
  persistTemporaryResourceDraft: (resourceDraftId: string) => Promise<void>;
  applyGraphOpsPersistenceReview: (review: AssistantGraphOpsReview) => Promise<void>;
};

export function useAssistantGraphOpsPersistenceActions({
  activeTaskId,
  canvas,
  temporaryResources,
  graphRef,
  graphOps,
  setCanvas,
  setTasks,
  setAssistantRequiredActions,
  setAssistantGraphOpsReview,
  setAssistantMessages,
  setAssistantBusy,
  setMessage,
  onChanged,
}: UseAssistantGraphOpsPersistenceActionsOptions): UseAssistantGraphOpsPersistenceActionsResult {
  const appendSystemMessage = useCallback(
    (content: string) => {
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'system', content },
      ]);
    },
    [setAssistantMessages],
  );

  const reportResourceIssue = useCallback(
    (resourceDraftId: string) => {
      const text = `临时资源不存在或已丢弃: ${resourceDraftId}`;
      setMessage(text);
      appendSystemMessage(text);
    },
    [appendSystemMessage, setMessage],
  );

  const persistTemporaryResourceDraft = useCallback(
    async (resourceDraftId: string) => {
      const draft = temporaryResources[resourceDraftId];
      if (!draft || draft.status === 'discarded') {
        reportResourceIssue(resourceDraftId);
        return;
      }
      const transaction = graphOpsTransactionForTemporaryAgent(draft);
      const callableId = persistentCallableIdForDraft(draft);
      setAssistantBusy(true);
      try {
        await graphOps.createGraphOpsProposalRequest(transaction);
        const validation = await graphOps.validateGraphOpsProposalRequest(transaction.proposal_id);
        if (validation.status !== 'valid') {
          throw new Error(`GraphOps validate failed: ${JSON.stringify(validation)}`);
        }
        const dryRun = await graphOps.dryRunGraphOpsProposalRequest(transaction.proposal_id);
        setAssistantGraphOpsReview({
          resourceDraftId,
          callableId,
          proposal: transaction,
          validation,
          dryRun,
        });
        const text = [
          `GraphOps dry-run 已准备: ${transaction.proposal_id}`,
          `Files: ${dryRun.target_paths.join(', ')}`,
          '请检查预览后再批准写入。',
        ].join('\n');
        appendSystemMessage(text);
        setMessage(`GraphOps proposal 已预览: ${transaction.proposal_id}`);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        appendSystemMessage(text);
        setMessage(text);
      } finally {
        setAssistantBusy(false);
      }
    },
    [
      appendSystemMessage,
      graphOps,
      reportResourceIssue,
      setAssistantBusy,
      setAssistantGraphOpsReview,
      setMessage,
      temporaryResources,
    ],
  );

  const applyGraphOpsPersistenceReview = useCallback(
    async (review: AssistantGraphOpsReview) => {
      const draft = temporaryResources[review.resourceDraftId];
      if (!draft || draft.status === 'discarded') {
        reportResourceIssue(review.resourceDraftId);
        return;
      }
      setAssistantBusy(true);
      try {
        const approval: ApproveGraphOpsProposalPayload = {
          target_paths: review.dryRun.target_paths,
          base_hashes: review.proposal.base.content_hashes,
          dry_run_digest: review.dryRun.dry_run_digest,
        };
        await graphOps.approveGraphOpsProposalRequest(review.proposal.proposal_id, approval);
        const manifest = await graphOps.applyGraphOpsProposalRequest(review.proposal.proposal_id);
        const nextCanvas = normalizeCanvasEdges(
          replaceTemporaryResourceWithCallable(
            stripRuntimeStateFromCanvas(canvas),
            review.resourceDraftId,
            review.callableId,
          ),
        );
        const nextGraph = canvasToWorkflowGraph(nextCanvas);
        graphRef.current = nextGraph;
        setCanvas(nextCanvas);
        setTasks((currentTasks) =>
          currentTasks.map((task) =>
            task.taskId === activeTaskId
              ? {
                  ...task,
                  canvas: stripRuntimeStateFromCanvas(nextCanvas),
                  authoring: {
                    temporaryResources: {
                      ...(task.authoring || emptyWorkbenchAuthoringState()).temporaryResources,
                      [review.resourceDraftId]: {
                        ...draft,
                        status: 'discarded',
                      },
                    },
                  },
                }
              : task,
          ),
        );
        setAssistantRequiredActions((current) =>
          current.filter((action) => action.resource_draft_id !== review.resourceDraftId),
        );
        setAssistantGraphOpsReview(null);
        const text = [
          `GraphOps 已持久化 ${review.callableId}`,
          `Proposal: ${review.proposal.proposal_id}`,
          `Files: ${manifest.created_files.join(', ')}`,
        ].join('\n');
        appendSystemMessage(text);
        setMessage(`已保存临时资源为 ${review.callableId}`);
        onChanged?.();
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        appendSystemMessage(text);
        setMessage(text);
      } finally {
        setAssistantBusy(false);
      }
    },
    [
      activeTaskId,
      appendSystemMessage,
      canvas,
      graphOps,
      graphRef,
      onChanged,
      reportResourceIssue,
      setAssistantBusy,
      setAssistantGraphOpsReview,
      setAssistantRequiredActions,
      setCanvas,
      setMessage,
      setTasks,
      temporaryResources,
    ],
  );

  return {
    persistTemporaryResourceDraft,
    applyGraphOpsPersistenceReview,
  };
}
