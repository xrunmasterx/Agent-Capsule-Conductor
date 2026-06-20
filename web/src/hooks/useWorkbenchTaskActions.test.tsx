import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useRef, useState } from 'react';

import type { WorkflowGraph } from '../types';
import type { CanvasSelection, WorkbenchTask, WorkspaceCanvasModel } from '../types/workbench';
import { createEmptyTask } from '../workbench/model/taskModel';
import { canvasToWorkflowGraph } from '../workbench/model/workflowGraphProjection';
import {
  useWorkbenchTaskActions,
  type UseWorkbenchTaskActionsOptions,
  type UseWorkbenchTaskActionsResult,
} from './useWorkbenchTaskActions';

type HarnessState = {
  tasks: WorkbenchTask[];
  activeTaskId: string;
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  focusedWorkflowId: string | null;
  openedExternalWorkflow: boolean;
  message: string;
  layoutSyncVersion: number;
};

let latestActions: UseWorkbenchTaskActionsResult | null = null;
let latestState: HarnessState | null = null;
let latestGraphRef: { current: WorkflowGraph } | null = null;

const resetAssistantConversationState = vi.fn();
const closeEvidenceDock = vi.fn();
const createDurableTask = vi.fn();
const deleteDurableTask = vi.fn();
const onSelect = vi.fn();
const clearAssistantProposal = vi.fn();

function buildTask(taskId: string, title: string): WorkbenchTask {
  return createEmptyTask(taskId, title);
}

function Harness({ initialTasks }: { initialTasks: WorkbenchTask[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [activeTaskId, setActiveTaskId] = useState(initialTasks[0].taskId);
  const [canvas, setCanvas] = useState(initialTasks[0].canvas);
  const [selection, setSelection] = useState<CanvasSelection>({
    type: 'task_canvas',
    taskId: initialTasks[0].taskId,
  });
  const [focusedWorkflowId, setFocusedWorkflowId] = useState<string | null>('workflow_1');
  const [openedExternalWorkflow, setOpenedExternalWorkflow] = useState(false);
  const [message, setMessage] = useState('');
  const [layoutSyncVersion, setLayoutSyncVersion] = useState(0);
  const graphRef = useRef(canvasToWorkflowGraph(initialTasks[0].canvas));

  latestActions = useWorkbenchTaskActions({
    tasks,
    activeTaskId,
    graphRef,
    setTasks,
    setActiveTaskId,
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
  } satisfies UseWorkbenchTaskActionsOptions);
  latestState = {
    tasks,
    activeTaskId,
    canvas,
    selection,
    focusedWorkflowId,
    openedExternalWorkflow,
    message,
    layoutSyncVersion,
  };
  latestGraphRef = graphRef;

  return <output>{message}</output>;
}

describe('useWorkbenchTaskActions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T00:00:00Z'));
  });

  afterEach(() => {
    latestActions = null;
    latestState = null;
    latestGraphRef = null;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test('opens external workflows without mutating task state', () => {
    const task = buildTask('task_1', '任务 1');
    render(<Harness initialTasks={[task]} />);

    act(() => {
      latestActions?.openWorkflow('workflow.stock');
    });

    expect(onSelect).toHaveBeenCalledWith('workflow.stock');
    expect(latestState?.openedExternalWorkflow).toBe(true);
    expect(latestState?.activeTaskId).toBe('task_1');
  });

  test('switches the active task and clears transient assistant and evidence state', () => {
    const first = buildTask('task_1', '任务 1');
    const second = buildTask('task_2', '任务 2');
    render(<Harness initialTasks={[first, second]} />);

    act(() => {
      latestActions?.switchTask('task_2');
    });

    expect(latestState?.activeTaskId).toBe('task_2');
    expect(latestState?.canvas.id).toBe('task_2');
    expect(latestGraphRef?.current.id).toBe('task_2');
    expect(latestState?.selection).toEqual({ type: 'task_canvas', taskId: 'task_2' });
    expect(latestState?.focusedWorkflowId).toBeNull();
    expect(resetAssistantConversationState).toHaveBeenCalledTimes(1);
    expect(closeEvidenceDock).toHaveBeenCalledTimes(1);
  });

  test('creates a durable task after registering and activating its canvas', () => {
    const first = buildTask('task_1', '任务 1');
    render(<Harness initialTasks={[first]} />);

    act(() => {
      latestActions?.newTask();
    });

    const createdTaskId = 'task_canvas_1781913600000';
    expect(latestState?.activeTaskId).toBe(createdTaskId);
    expect(latestState?.canvas.id).toBe(createdTaskId);
    expect(latestState?.tasks.map((task) => task.taskId)).toEqual(['task_1', createdTaskId]);
    expect(createDurableTask).toHaveBeenCalledWith(createdTaskId, '任务 2');
    expect(resetAssistantConversationState).toHaveBeenCalledTimes(1);
    expect(closeEvidenceDock).toHaveBeenCalledTimes(1);
  });

  test('guards deletion of active running tasks', () => {
    const running = { ...buildTask('task_1', '任务 1'), status: 'running' as const };
    render(<Harness initialTasks={[running]} />);

    act(() => {
      latestActions?.deleteTask('task_1');
    });

    expect(latestState?.tasks).toHaveLength(1);
    expect(latestState?.message).toBe('任务正在运行，请先停止后再删除。');
    expect(deleteDurableTask).not.toHaveBeenCalled();
  });

  test('deletes tasks and falls back to the default task when the last task is removed', () => {
    const onlyTask = buildTask('task_1', '任务 1');
    render(<Harness initialTasks={[onlyTask]} />);

    act(() => {
      latestActions?.deleteTask('task_1');
    });

    expect(latestState?.tasks.map((task) => task.taskId)).toEqual(['task_canvas_default']);
    expect(latestState?.activeTaskId).toBe('task_canvas_default');
    expect(latestState?.canvas.name).toBe('任务 1');
    expect(latestState?.message).toBe('已删除任务 task_1');
    expect(deleteDurableTask).toHaveBeenCalledWith('task_1');
  });

  test('loads the demo canvas and clears stale assistant proposal state', () => {
    const task = buildTask('task_1', '任务 1');
    render(<Harness initialTasks={[task]} />);

    act(() => {
      latestActions?.createDemo();
    });

    expect(latestState?.message).toBe('已加载 Core v2 股票调研示例');
    expect(latestState?.openedExternalWorkflow).toBe(false);
    expect(latestState?.selection).toEqual({ type: 'task_canvas', taskId: latestState?.canvas.id });
    expect(latestState?.tasks[0].canvas.id).toBe(latestState?.canvas.id);
    expect(clearAssistantProposal).toHaveBeenCalledTimes(1);
  });

  test('auto layout refreshes graph and bumps the layout sync version', () => {
    const task = buildTask('task_1', '任务 1');
    render(<Harness initialTasks={[task]} />);
    const beforeGraph = latestGraphRef?.current;

    act(() => {
      latestActions?.autoLayout();
    });

    expect(latestState?.layoutSyncVersion).toBe(1);
    expect(latestState?.message).toBe('已按连接关系重新布局整个任务');
    expect(latestGraphRef?.current).not.toBe(beforeGraph);
  });
});
