import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { WorkflowGraph } from '../../types';
import type { WorkspaceCanvasModel } from '../../types/workbench';
import { canvasToWorkflowGraph } from '../../workbench/model/workflowGraphProjection';

export type WorkflowViewerGraphState = {
  sourceGraph: WorkflowGraph;
  setSourceGraph: Dispatch<SetStateAction<WorkflowGraph>>;
  graphRef: MutableRefObject<WorkflowGraph>;
  layoutSyncVersion: number;
  setLayoutSyncVersion: Dispatch<SetStateAction<number>>;
};

export function useWorkflowViewerGraphState(initialCanvas: WorkspaceCanvasModel): WorkflowViewerGraphState {
  const [sourceGraph, setSourceGraph] = useState<WorkflowGraph>(() => canvasToWorkflowGraph(initialCanvas));
  const graphRef = useRef(sourceGraph);
  const [layoutSyncVersion, setLayoutSyncVersion] = useState(0);

  return {
    sourceGraph,
    setSourceGraph,
    graphRef,
    layoutSyncVersion,
    setLayoutSyncVersion,
  };
}
