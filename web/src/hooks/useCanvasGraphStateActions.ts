import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { WorkflowBindingView, WorkflowGraph } from '../types';
import type { WorkbenchTask, WorkspaceCanvasModel } from '../types/workbench';
import { normalizeCanvasEdges } from '../workbench/model/canvasEdgeOps';
import { canvasToWorkflowGraph } from '../workbench/model/workflowGraphProjection';
import { workspaceRootOf } from '../workbench/model/selectedNodeModel';
import { stripRuntimeStateFromCanvas } from '../components/workflow-viewer/runState';
import { bindingPathOf } from './useWorkflowBindings';

export type UseCanvasGraphStateActionsOptions = {
  activeTaskId: string;
  sourceGraph: WorkflowGraph;
  graphRef: MutableRefObject<WorkflowGraph>;
  setCanvas: Dispatch<SetStateAction<WorkspaceCanvasModel>>;
  setTasks: Dispatch<SetStateAction<WorkbenchTask[]>>;
  setSourceGraph: Dispatch<SetStateAction<WorkflowGraph>>;
  setMessage: Dispatch<SetStateAction<string>>;
};

export type UseCanvasGraphStateActionsResult = {
  updateCanvas: (next: SetStateAction<WorkspaceCanvasModel>) => void;
  updateCanvasAndGraph: (next: SetStateAction<WorkspaceCanvasModel>) => void;
  handleWorkflowBindingSaved: (workflowId: string, normalized: WorkflowBindingView) => void;
  handleWorkflowBindingFolderOpened: (workflowId: string) => void;
};

export function useCanvasGraphStateActions({
  activeTaskId,
  sourceGraph,
  graphRef,
  setCanvas,
  setTasks,
  setSourceGraph,
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
        setTasks((currentTasks) =>
          currentTasks.map((task) =>
            task.taskId === activeTaskId
              ? { ...task, title: nextCanvas.name, canvas: stripRuntimeStateFromCanvas(nextCanvas) }
              : task,
          ),
        );
        return nextCanvas;
      });
    },
    [activeTaskId, setCanvas, setTasks],
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
        setSourceGraph(nextGraph);
        setTasks((currentTasks) =>
          currentTasks.map((task) =>
            task.taskId === activeTaskId
              ? { ...task, title: nextCanvas.name, canvas: stripRuntimeStateFromCanvas(nextCanvas) }
              : task,
          ),
        );
        return nextCanvas;
      });
    },
    [activeTaskId, graphRef, setCanvas, setSourceGraph, setTasks],
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

  useEffect(() => {
    graphRef.current = sourceGraph;
  }, [graphRef, sourceGraph]);

  return {
    updateCanvas,
    updateCanvasAndGraph,
    handleWorkflowBindingSaved,
    handleWorkflowBindingFolderOpened,
  };
}
