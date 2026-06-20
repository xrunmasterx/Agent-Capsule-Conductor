import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { WorkflowGraph } from '../types';
import type { WorkbenchTask, WorkspaceCanvasModel } from '../types/workbench';
import { temporaryResourceIssueForCanvas } from '../workbench/model/authoringProposal';
import { slugId } from '../workbench/model/paletteCanvasOps';
import { reusableWorkflowClassGraph } from '../workbench/model/workflowRuntimeProjection';
import { graphForCurrentView, canvasToWorkflowGraph } from '../workbench/model/workflowGraphProjection';
import { isJsdomRuntime, textArtifact } from '../workbench/model/workflowViewerShell';
import { stripRuntimeStateFromCanvas } from '../components/workflow-viewer/runState';
import type { EvidenceDockState } from './useEvidenceDockActions';
import type {
  SaveWorkflowGraph,
  ValidateWorkflowGraph,
} from './useWorkflowPersistence';

export type WorkflowSaveDialogState = {
  name: string;
  saving: boolean;
  error: string | null;
};

export type SaveGraphOptions = {
  selectSavedWorkflow?: boolean;
  refreshIndex?: boolean;
  requestedName?: string | null;
};

export type UseWorkflowSaveValidationActionsOptions = {
  activeTaskId: string;
  canvas: WorkspaceCanvasModel;
  currentTaskAuthoring: WorkbenchTask['authoring'] | undefined;
  focusedWorkflowId: string | null;
  saveWorkflowDialog: WorkflowSaveDialogState | null;
  setSaveWorkflowDialog: Dispatch<SetStateAction<WorkflowSaveDialogState | null>>;
  graphRef: MutableRefObject<WorkflowGraph>;
  setMessage: Dispatch<SetStateAction<string>>;
  setEvidenceDock: Dispatch<SetStateAction<EvidenceDockState>>;
  saveWorkflowGraph: SaveWorkflowGraph;
  validateWorkflowGraph: ValidateWorkflowGraph;
  validateBoundaryTransfers: (snapshot: Record<string, unknown>) => Promise<unknown>;
  closeEvidenceDock: () => void;
  onSelect: (workflowId: string) => void;
  onChanged?: () => void;
};

export type UseWorkflowSaveValidationActionsResult = {
  currentTemporaryResourceIssue: () => string | null;
  ensureBoundaryTransfersValid: () => Promise<void>;
  reportTemporaryResourceIssue: (issue: string) => void;
  requestSaveWorkflow: () => void;
  confirmSaveWorkflow: () => Promise<void>;
  saveGraph: (options?: SaveGraphOptions) => Promise<void>;
  validateGraph: () => Promise<void>;
};

export function boundaryTransferPreviewSnapshotForCanvas(
  canvas: WorkspaceCanvasModel,
): Record<string, unknown> {
  const strippedCanvas = stripRuntimeStateFromCanvas(canvas);
  return {
    ...strippedCanvas,
    canonical_graph: canvasToWorkflowGraph(strippedCanvas),
  };
}

export function useWorkflowSaveValidationActions({
  activeTaskId,
  canvas,
  currentTaskAuthoring,
  focusedWorkflowId,
  saveWorkflowDialog,
  setSaveWorkflowDialog,
  graphRef,
  setMessage,
  setEvidenceDock,
  saveWorkflowGraph,
  validateWorkflowGraph,
  validateBoundaryTransfers,
  closeEvidenceDock,
  onSelect,
  onChanged,
}: UseWorkflowSaveValidationActionsOptions): UseWorkflowSaveValidationActionsResult {
  const currentTemporaryResourceIssue = useCallback(
    () => temporaryResourceIssueForCanvas(stripRuntimeStateFromCanvas(canvas), currentTaskAuthoring),
    [canvas, currentTaskAuthoring],
  );

  const ensureBoundaryTransfersValid = useCallback(async () => {
    await validateBoundaryTransfers(boundaryTransferPreviewSnapshotForCanvas(canvas));
  }, [canvas, validateBoundaryTransfers]);

  const reportTemporaryResourceIssue = useCallback(
    (issue: string) => {
      setMessage(issue);
      setEvidenceDock({
        open: true,
        title: 'AI 临时资源阻断',
        content: textArtifact('temporary-resource-blocker.log', issue, 'log'),
        owner: {
          kind: 'validation',
          taskId: activeTaskId,
          createdAt: new Date().toISOString(),
        },
      });
    },
    [activeTaskId, setEvidenceDock, setMessage],
  );

  const saveGraph = useCallback(
    async (options: SaveGraphOptions = {}) => {
      const issue = currentTemporaryResourceIssue();
      if (issue) {
        throw new Error(issue);
      }
      await ensureBoundaryTransfersValid();
      const { selectSavedWorkflow = true, refreshIndex = true, requestedName = null } = options;
      const baseGraph = reusableWorkflowClassGraph(
        graphForCurrentView(stripRuntimeStateFromCanvas(canvas), focusedWorkflowId),
      );
      const graph = requestedName
        ? {
            ...baseGraph,
            id: slugId(requestedName) === 'node' ? `workflow_${Date.now()}` : slugId(requestedName),
            name: requestedName,
          }
        : baseGraph;
      graphRef.current = graph;
      const result = await saveWorkflowGraph(graph, true);
      setMessage(`已保存 ${result.workflow_id}`);
      if (selectSavedWorkflow) {
        onSelect(result.workflow_id);
      }
      if (refreshIndex) {
        closeEvidenceDock();
        onChanged?.();
      }
    },
    [
      canvas,
      closeEvidenceDock,
      currentTemporaryResourceIssue,
      ensureBoundaryTransfersValid,
      focusedWorkflowId,
      graphRef,
      onChanged,
      onSelect,
      saveWorkflowGraph,
      setMessage,
    ],
  );

  const requestSaveWorkflow = useCallback(() => {
    const issue = currentTemporaryResourceIssue();
    if (issue) {
      reportTemporaryResourceIssue(issue);
      return;
    }
    if (isJsdomRuntime()) {
      void saveGraph();
      return;
    }
    const baseGraph = reusableWorkflowClassGraph(
      graphForCurrentView(stripRuntimeStateFromCanvas(canvas), focusedWorkflowId),
    );
    setSaveWorkflowDialog({
      name: baseGraph.name || canvas.name || 'workflow',
      saving: false,
      error: null,
    });
  }, [
    canvas,
    currentTemporaryResourceIssue,
    focusedWorkflowId,
    reportTemporaryResourceIssue,
    saveGraph,
    setSaveWorkflowDialog,
  ]);

  const confirmSaveWorkflow = useCallback(async () => {
    const requestedName = saveWorkflowDialog?.name.trim() || '';
    if (!requestedName) {
      setSaveWorkflowDialog((current) =>
        current ? { ...current, error: 'Workflow 名称不能为空' } : current,
      );
      return;
    }
    setSaveWorkflowDialog((current) =>
      current ? { ...current, saving: true, error: null } : current,
    );
    try {
      await saveGraph({ requestedName });
      setSaveWorkflowDialog(null);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setSaveWorkflowDialog((current) =>
        current ? { ...current, saving: false, error: text } : current,
      );
    }
  }, [saveGraph, saveWorkflowDialog, setSaveWorkflowDialog]);

  const validateGraph = useCallback(async () => {
    const issue = currentTemporaryResourceIssue();
    if (issue) {
      reportTemporaryResourceIssue(issue);
      return;
    }
    try {
      await saveGraph({ selectSavedWorkflow: false, refreshIndex: false });
      const result = await validateWorkflowGraph(graphRef.current.id);
      setMessage(`校验通过: ${result.workflow_id}`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(`校验失败: ${text}`);
      setEvidenceDock({
        open: true,
        title: '校验错误',
        content: textArtifact('validation-error.log', text, 'log'),
        owner: {
          kind: 'validation',
          taskId: activeTaskId,
          createdAt: new Date().toISOString(),
        },
      });
    }
  }, [
    activeTaskId,
    currentTemporaryResourceIssue,
    graphRef,
    reportTemporaryResourceIssue,
    saveGraph,
    setEvidenceDock,
    setMessage,
    validateWorkflowGraph,
  ]);

  return {
    currentTemporaryResourceIssue,
    ensureBoundaryTransfersValid,
    reportTemporaryResourceIssue,
    requestSaveWorkflow,
    confirmSaveWorkflow,
    saveGraph,
    validateGraph,
  };
}
