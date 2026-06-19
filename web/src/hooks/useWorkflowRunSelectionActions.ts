import { useCallback } from 'react';

import type {
  CanvasSelection,
  InternalNodeView,
  WorkflowContainerModel,
  WorkspaceCanvasModel,
} from '../types/workbench';
import { internalNodeFromExecutableWorkflow } from '../components/canvas/canvasMutation';
import {
  graphForCurrentView,
  internalWorkflowToGraph,
} from '../workbench/model/workflowGraphProjection';
import {
  singleNodeWorkflowGraph,
} from '../workbench/model/workflowRuntimeProjection';
import { isExecutableNodeWorkflow } from '../workbench/model/workflowNodeModel';
import {
  stripRuntimeStateFromCanvas,
  stripRuntimeStateFromWorkflow,
} from '../components/workflow-viewer/runState';
import type { RunWorkflowGraph } from './useWorkflowRunSubmitActions';

export type UseWorkflowRunSelectionActionsOptions = {
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  selectedWorkflow: WorkflowContainerModel | null | undefined;
  selectedInternalNode: InternalNodeView | null | undefined;
  currentTemporaryResourceIssue: () => string | null;
  ensureBoundaryTransfersValid: () => Promise<void>;
  reportTemporaryResourceIssue: (issue: string) => void;
  runWorkflowGraph: RunWorkflowGraph;
  setMessage: (message: string) => void;
};

export type UseWorkflowRunSelectionActionsResult = {
  canRunSelectedWorkflow: boolean;
  canRunSelectedNode: boolean;
  runGraph: () => Promise<void>;
  runSelectedWorkflow: () => Promise<void>;
  runSelectedNode: () => Promise<void>;
};

export function useWorkflowRunSelectionActions({
  canvas,
  selection,
  selectedWorkflow,
  selectedInternalNode,
  currentTemporaryResourceIssue,
  ensureBoundaryTransfersValid,
  reportTemporaryResourceIssue,
  runWorkflowGraph,
  setMessage,
}: UseWorkflowRunSelectionActionsOptions): UseWorkflowRunSelectionActionsResult {
  const canRunSelectedWorkflow = Boolean(selectedWorkflow && !isExecutableNodeWorkflow(selectedWorkflow));
  const canRunSelectedNode = Boolean(
    selectedInternalNode ||
      (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)),
  );

  const guardTemporaryResources = useCallback(() => {
    const issue = currentTemporaryResourceIssue();
    if (issue) {
      reportTemporaryResourceIssue(issue);
      return false;
    }
    return true;
  }, [currentTemporaryResourceIssue, reportTemporaryResourceIssue]);

  const runGraph = useCallback(async () => {
    if (!guardTemporaryResources()) {
      return;
    }
    await runWorkflowGraph(graphForCurrentView(stripRuntimeStateFromCanvas(canvas), null), 'task', canvas.id);
  }, [canvas, guardTemporaryResources, runWorkflowGraph]);

  const runSelectedWorkflow = useCallback(async () => {
    if (!guardTemporaryResources()) {
      return;
    }
    if (!selectedWorkflow || isExecutableNodeWorkflow(selectedWorkflow)) {
      return;
    }
    try {
      await ensureBoundaryTransfersValid();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(`运行失败: ${text}`);
      return;
    }
    await runWorkflowGraph(
      internalWorkflowToGraph(stripRuntimeStateFromWorkflow(selectedWorkflow)),
      'workflow',
      selectedWorkflow.id,
    );
  }, [
    ensureBoundaryTransfersValid,
    guardTemporaryResources,
    runWorkflowGraph,
    selectedWorkflow,
    setMessage,
  ]);

  const runSelectedNode = useCallback(async () => {
    if (!guardTemporaryResources()) {
      return;
    }
    const node =
      selectedInternalNode ||
      (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)
        ? internalNodeFromExecutableWorkflow(selectedWorkflow, { x: 0, y: 0 })
        : null);
    if (!node) {
      return;
    }
    await runWorkflowGraph(singleNodeWorkflowGraph(node, selectedWorkflow?.id || canvas.id), 'node', node.id);
  }, [
    canvas.id,
    guardTemporaryResources,
    runWorkflowGraph,
    selectedInternalNode,
    selectedWorkflow,
    selection,
  ]);

  return {
    canRunSelectedWorkflow,
    canRunSelectedNode,
    runGraph,
    runSelectedWorkflow,
    runSelectedNode,
  };
}
