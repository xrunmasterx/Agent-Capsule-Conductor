import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { WorkflowBindingView, WorkflowGraph } from '../types';
import type { WorkbenchTask, WorkspaceCanvasModel } from '../types/workbench';
import { normalizeCanvasEdges } from '../workbench/model/canvasEdgeOps';
import { canvasToWorkflowGraph } from '../workbench/model/workflowGraphProjection';
import { workspaceRootOf } from '../workbench/model/selectedNodeModel';
import { bindingPathOf } from './useWorkflowBindings';

export type UseCanvasGraphStateActionsOptions = {
  activeTaskId: string;
  graphRef: MutableRefObject<WorkflowGraph>;
  setCanvas: Dispatch<SetStateAction<WorkspaceCanvasModel>>;
  setTasks: Dispatch<SetStateAction<WorkbenchTask[]>>;
  setMessage: Dispatch<SetStateAction<string>>;
};

export type UseCanvasGraphStateActionsResult = {
  updateCanvas: (next: SetStateAction<WorkspaceCanvasModel>) => void;
  updateCanvasAndGraph: (next: SetStateAction<WorkspaceCanvasModel>) => void;
  handleWorkflowBindingSaved: (workflowId: string, normalized: WorkflowBindingView) => void;
  handleWorkflowBindingFolderOpened: (workflowId: string) => void;
};

export function useCanvasGraphStateActions({
  graphRef,
  setCanvas,
  setMessage,
}: UseCanvasGraphStateActionsOptions): UseCanvasGraphStateActionsResult {
  const updateCanvas = useCallback(
    (next: SetStateAction<WorkspaceCanvasModel>) => {
      setCanvas((current) => {
        const nextCanvas = normalizeCanvasEdges(
          typeof next === 'function'
            ? (next as (current: WorkspaceCanvasModel) => WorkspaceCanvasModel)(current)
            : next,
        );
        return nextCanvas;
      });
    },
    [setCanvas],
  );

  const updateCanvasAndGraph = useCallback(
    (next: SetStateAction<WorkspaceCanvasModel>) => {
      setCanvas((current) => {
        const nextCanvas = normalizeCanvasEdges(
          typeof next === 'function'
            ? (next as (current: WorkspaceCanvasModel) => WorkspaceCanvasModel)(current)
            : next,
        );
        const nextGraph = canvasToWorkflowGraph(nextCanvas);
        graphRef.current = nextGraph;
        return nextCanvas;
      });
    },
    [graphRef, setCanvas],
  );

  const handleWorkflowBindingSaved = useCallback(
    (workflowId: string, normalized: WorkflowBindingView) => {
      updateCanvas((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === workflowId
            ? {
                ...workflow,
                bindingPath: bindingPathOf(normalized),
                directory: workspaceRootOf(normalized),
              }
            : workflow,
        ),
      }));
      setMessage(`已保存 ${workflowId} workspace binding`);
    },
    [setMessage, updateCanvas],
  );

  const handleWorkflowBindingFolderOpened = useCallback(
    (workflowId: string) => {
      setMessage(`已打开 ${workflowId} 的 bindings 目录`);
    },
    [setMessage],
  );

  return {
    updateCanvas,
    updateCanvasAndGraph,
    handleWorkflowBindingSaved,
    handleWorkflowBindingFolderOpened,
  };
}
