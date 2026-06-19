import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { WorkflowGraph } from '../types';
import type { CanvasSelection, WorkbenchTask, WorkspaceCanvasModel } from '../types/workbench';
import { DEFAULT_TASK_ID } from '../workbench/constants';
import { normalizeCanvasEdges } from '../workbench/model/canvasEdgeOps';
import { layoutWorkspaceCanvas } from '../workbench/model/canvasLayout';
import { workspaceDemoCanvas } from '../workbench/model/workspaceDemoCanvas';
import { canvasToWorkflowGraph } from '../workbench/model/workflowGraphProjection';
import {
  createEmptyTask,
  emptyWorkbenchAuthoringState,
  isActiveTaskStatus,
  nextTaskTitle,
} from '../workbench/model/taskModel';
import { stripRuntimeStateFromCanvas } from '../components/workflow-viewer/runState';

export type UseWorkbenchTaskActionsOptions = {
  tasks: WorkbenchTask[];
  activeTaskId: string;
  graphRef: MutableRefObject<WorkflowGraph>;
  setTasks: Dispatch<SetStateAction<WorkbenchTask[]>>;
  setActiveTaskId: (taskId: string) => void;
  setSourceGraph: Dispatch<SetStateAction<WorkflowGraph>>;
  setCanvas: Dispatch<SetStateAction<WorkspaceCanvasModel>>;
  setSelection: Dispatch<SetStateAction<CanvasSelection>>;
  setFocusedWorkflowId: Dispatch<SetStateAction<string | null>>;
  setOpenedExternalWorkflow: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setLayoutSyncVersion: Dispatch<SetStateAction<number>>;
  clearAssistantProposal: () => void;
  resetAssistantConversationState: () => void;
  closeEvidenceDock: () => void;
  createDurableTask: (taskId: string, title: string) => void;
  deleteDurableTask: (taskId: string) => void;
  onSelect: (workflowId: string) => void;
};

export type UseWorkbenchTaskActionsResult = {
  createDemo: () => void;
  openWorkflow: (workflowId: string) => void;
  switchTask: (taskId: string) => void;
  newTask: () => void;
  deleteTask: (taskId: string) => void;
  autoLayout: () => void;
};

export function useWorkbenchTaskActions({
  tasks,
  activeTaskId,
  graphRef,
  setTasks,
  setActiveTaskId,
  setSourceGraph,
  setCanvas,
  setSelection,
  setFocusedWorkflowId,
  setOpenedExternalWorkflow,
  setMessage,
  setLayoutSyncVersion,
  clearAssistantProposal,
  resetAssistantConversationState,
  closeEvidenceDock,
  createDurableTask,
  deleteDurableTask,
  onSelect,
}: UseWorkbenchTaskActionsOptions): UseWorkbenchTaskActionsResult {
  const syncCanvasGraph = useCallback(
    (canvas: WorkspaceCanvasModel): WorkspaceCanvasModel => {
      const normalizedCanvas = normalizeCanvasEdges(canvas);
      const nextGraph = canvasToWorkflowGraph(normalizedCanvas);
      graphRef.current = nextGraph;
      setSourceGraph(nextGraph);
      setCanvas(normalizedCanvas);
      return normalizedCanvas;
    },
    [graphRef, setCanvas, setSourceGraph],
  );

  const createDemo = useCallback(() => {
    const nextCanvas = syncCanvasGraph(layoutWorkspaceCanvas(workspaceDemoCanvas()));
    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.taskId === activeTaskId
          ? {
              ...task,
              title: nextCanvas.name,
              canvas: stripRuntimeStateFromCanvas(nextCanvas),
              authoring: emptyWorkbenchAuthoringState(),
            }
          : task,
      ),
    );
    clearAssistantProposal();
    setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
    setOpenedExternalWorkflow(false);
    setMessage('已加载 Core v2 股票调研示例');
  }, [
    activeTaskId,
    clearAssistantProposal,
    setMessage,
    setOpenedExternalWorkflow,
    setSelection,
    setTasks,
    syncCanvasGraph,
  ]);

  const openWorkflow = useCallback(
    (workflowId: string) => {
      setOpenedExternalWorkflow(true);
      onSelect(workflowId);
    },
    [onSelect, setOpenedExternalWorkflow],
  );

  const switchTask = useCallback(
    (taskId: string) => {
      const task = tasks.find((item) => item.taskId === taskId);
      if (!task) {
        return;
      }
      setActiveTaskId(task.taskId);
      const nextCanvas = syncCanvasGraph(task.canvas);
      setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
      resetAssistantConversationState();
      setFocusedWorkflowId(null);
      closeEvidenceDock();
    },
    [
      closeEvidenceDock,
      resetAssistantConversationState,
      setActiveTaskId,
      setFocusedWorkflowId,
      setSelection,
      syncCanvasGraph,
      tasks,
    ],
  );

  const newTask = useCallback(() => {
    const taskId = `task_canvas_${Date.now()}`;
    const task = createEmptyTask(taskId, nextTaskTitle(tasks));
    const normalizedCanvas = normalizeCanvasEdges(task.canvas);
    setTasks((current) => [...current, { ...task, canvas: normalizedCanvas }]);
    setActiveTaskId(task.taskId);
    const nextCanvas = syncCanvasGraph(normalizedCanvas);
    setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
    setFocusedWorkflowId(null);
    resetAssistantConversationState();
    closeEvidenceDock();
    createDurableTask(task.taskId, task.title);
  }, [
    closeEvidenceDock,
    createDurableTask,
    resetAssistantConversationState,
    setActiveTaskId,
    setFocusedWorkflowId,
    setSelection,
    setTasks,
    syncCanvasGraph,
    tasks,
  ]);

  const deleteTask = useCallback(
    (taskId: string) => {
      const targetTask = tasks.find((task) => task.taskId === taskId);
      if (targetTask && isActiveTaskStatus(targetTask.status)) {
        setMessage('任务正在运行，请先停止后再删除。');
        return;
      }
      const remaining = tasks.filter((task) => task.taskId !== taskId);
      const nextTasks = remaining.length > 0 ? remaining : [createEmptyTask(DEFAULT_TASK_ID, '任务 1')];
      const nextActiveTask =
        taskId === activeTaskId
          ? nextTasks[0]
          : nextTasks.find((task) => task.taskId === activeTaskId) || nextTasks[0];
      setTasks(nextTasks);
      setActiveTaskId(nextActiveTask.taskId);
      const nextCanvas = syncCanvasGraph(nextActiveTask.canvas);
      setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
      resetAssistantConversationState();
      setMessage(`已删除任务 ${taskId}`);
      deleteDurableTask(taskId);
    },
    [
      activeTaskId,
      deleteDurableTask,
      resetAssistantConversationState,
      setActiveTaskId,
      setMessage,
      setSelection,
      setTasks,
      syncCanvasGraph,
      tasks,
    ],
  );

  const autoLayout = useCallback(() => {
    setCanvas((current) => {
      const nextCanvas = normalizeCanvasEdges(layoutWorkspaceCanvas(current));
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
    setLayoutSyncVersion((current) => current + 1);
    setMessage('已按连接关系重新布局整个任务');
  }, [activeTaskId, graphRef, setCanvas, setLayoutSyncVersion, setMessage, setSourceGraph, setTasks]);

  return {
    createDemo,
    openWorkflow,
    switchTask,
    newTask,
    deleteTask,
    autoLayout,
  };
}
