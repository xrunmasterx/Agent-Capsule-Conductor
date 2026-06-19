import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type {
  WorkflowDetail,
  WorkflowGraph,
  WorkflowRunResult,
} from '../types';
import type {
  CanvasSelection,
  WorkspaceCanvasModel,
} from '../types/workbench';
import { normalizeCanvasEdges } from '../workbench/model/canvasEdgeOps';
import { graphToWorkspaceCanvas } from '../workbench/model/canvasProjection';
import { canvasToWorkflowGraph } from '../workbench/model/workflowGraphProjection';
import {
  graphFromLegacyWorkflow,
  normalizeWorkflowGraph,
} from '../workbench/model/workflowRuntimeProjection';
import { useOpenedWorkflowLoader } from './useOpenedWorkflowLoader';

export type UseOpenedWorkflowCanvasOptions = {
  enabled: boolean;
  workflowId: string | null | undefined;
  workflowRun: WorkflowRunResult | null;
  graphRef: MutableRefObject<WorkflowGraph>;
  setSourceGraph: Dispatch<SetStateAction<WorkflowGraph>>;
  setCanvas: Dispatch<SetStateAction<WorkspaceCanvasModel>>;
  setSelection: Dispatch<SetStateAction<CanvasSelection>>;
  setMessage: Dispatch<SetStateAction<string>>;
  closeEvidenceDock: () => void;
  onError?: (error: unknown) => void;
};

export type OpenedWorkflowCanvasProjection = {
  canvas: WorkspaceCanvasModel;
  graph: WorkflowGraph;
  selection: CanvasSelection;
  message: string;
};

export function openedWorkflowCanvasProjection(
  workflow: WorkflowDetail,
  workflowRun: WorkflowRunResult | null,
): OpenedWorkflowCanvasProjection {
  const graph = normalizeWorkflowGraph(workflow.graph || graphFromLegacyWorkflow(workflow));
  const canvas = normalizeCanvasEdges(graphToWorkspaceCanvas(graph, workflowRun));
  const canonicalGraph = canvasToWorkflowGraph(canvas);
  const selection: CanvasSelection = canvas.workflows[0]
    ? { type: 'workflow', id: canvas.workflows[0].id }
    : { type: 'workflow', id: canvas.rootWorkflowId };

  return {
    canvas,
    graph: canonicalGraph,
    selection,
    message: `已打开 ${workflow.workflow_id}`,
  };
}

export function useOpenedWorkflowCanvas({
  enabled,
  workflowId,
  workflowRun,
  graphRef,
  setSourceGraph,
  setCanvas,
  setSelection,
  setMessage,
  closeEvidenceDock,
  onError,
}: UseOpenedWorkflowCanvasOptions): void {
  const handleWorkflowLoaded = useCallback(
    (workflow: WorkflowDetail) => {
      const projection = openedWorkflowCanvasProjection(workflow, workflowRun);
      graphRef.current = projection.graph;
      setSourceGraph(projection.graph);
      setCanvas(projection.canvas);
      setSelection(projection.selection);
      setMessage(projection.message);
      closeEvidenceDock();
    },
    [
      closeEvidenceDock,
      graphRef,
      setCanvas,
      setMessage,
      setSelection,
      setSourceGraph,
      workflowRun,
    ],
  );

  useOpenedWorkflowLoader({
    enabled,
    workflowId,
    onWorkflowLoaded: handleWorkflowLoaded,
    onError,
  });
}
