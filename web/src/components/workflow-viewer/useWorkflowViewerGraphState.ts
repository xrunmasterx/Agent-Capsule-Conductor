import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { WorkflowGraph } from '../../types';
import type { WorkspaceCanvasModel } from '../../types/workbench';
import { canvasToWorkflowGraph } from '../../workbench/model/workflowGraphProjection';

export type WorkflowViewerGraphState = {
  sourceGraph: WorkflowGraph;
  graphRef: MutableRefObject<WorkflowGraph>;
  layoutSyncVersion: number;
  setLayoutSyncVersion: Dispatch<SetStateAction<number>>;
};

export function useWorkflowViewerGraphState(
  canvas: WorkspaceCanvasModel,
  canvasRevision: number,
): WorkflowViewerGraphState {
  const sourceGraph = useMemo(() => canvasToWorkflowGraph(canvas), [canvas, canvasRevision]);
  const graphRef = useRef(sourceGraph);
  const [layoutSyncVersion, setLayoutSyncVersion] = useState(0);

  useEffect(() => {
    graphRef.current = sourceGraph;
  }, [sourceGraph]);

  return {
    sourceGraph,
    graphRef,
    layoutSyncVersion,
    setLayoutSyncVersion,
  };
}
