import { act, render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useRef, useState } from 'react';

import type { WorkflowBindingView, WorkflowGraph } from '../types';
import type { WorkbenchTask, WorkflowContainerModel, WorkspaceCanvasModel } from '../types/workbench';
import {
  useCanvasGraphStateActions,
  type UseCanvasGraphStateActionsResult,
} from './useCanvasGraphStateActions';

let latestActions: UseCanvasGraphStateActionsResult | null = null;
let latestCanvas: WorkspaceCanvasModel | null = null;
let latestTasks: WorkbenchTask[] = [];
let latestGraphRef: { current: WorkflowGraph } | null = null;
let latestMessage = '';

function workflow(id = 'workflow_1'): WorkflowContainerModel {
  return {
    id,
    title: 'Workflow 1',
    directory: '',
    status: 'success',
    inputPorts: [],
    outputPorts: [],
    internalNodes: [
      {
        id: 'agent_1',
        name: 'Agent 1',
        task: 'Agent 1',
        kind: 'Agent',
        status: 'success',
      },
    ],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 320, height: 180 },
    warnings: [],
  };
}

function canvas(partial: Partial<WorkspaceCanvasModel> = {}): WorkspaceCanvasModel {
  return {
    id: 'task_1',
    name: 'Task 1',
    rootWorkflowId: 'task_1',
    workflows: [workflow()],
    edges: [],
    ...partial,
  };
}

function graph(id = 'task_1'): WorkflowGraph {
  return {
    id,
    name: id,
    version: '1.0.0',
    nodes: [],
    edges: [],
    control_edges: [],
    data_edges: [],
  };
}

function task(partial: Partial<WorkbenchTask> = {}): WorkbenchTask {
  return {
    taskId: 'task_1',
    title: 'Task 1',
    canvas: canvas(),
    status: 'not_run',
    ...partial,
  };
}

function binding(partial: Partial<WorkflowBindingView> = {}): WorkflowBindingView {
  return {
    workflow_id: 'workflow_1',
    binding_path: 'bindings/workflow_1',
    workspace_root: 'F:/workspace/workflow_1',
    exists: true,
    status: 'valid',
    ...partial,
  };
}

function Harness() {
  const graphRef = useRef<WorkflowGraph>(graph('initial_ref'));
  const [currentCanvas, setCanvas] = useState<WorkspaceCanvasModel>(canvas());
  const [tasks, setTasks] = useState<WorkbenchTask[]>([task()]);
  const [message, setMessage] = useState('');

  latestActions = useCanvasGraphStateActions({
    activeTaskId: 'task_1',
    graphRef,
    setCanvas,
    setTasks,
    setMessage,
  });
  latestCanvas = currentCanvas;
  latestTasks = tasks;
  latestGraphRef = graphRef;
  latestMessage = message;

  return <output>{message}</output>;
}

describe('useCanvasGraphStateActions', () => {
  test('updates canvas through the canvas owner without writing the task mirror', () => {
    render(<Harness />);

    act(() => {
      latestActions?.updateCanvas((current) => ({
        ...current,
        name: 'Renamed Task',
        workflows: current.workflows.map((item) => ({ ...item, status: 'success' })),
      }));
    });

    expect(latestCanvas?.name).toBe('Renamed Task');
    expect(latestTasks[0].title).toBe('Task 1');
    expect(latestTasks[0].canvas.workflows[0].status).toBe('success');
    expect(latestTasks[0].canvas.workflows[0].internalNodes[0].status).toBe('success');
  });

  test('updates canvas and graph ref together', () => {
    render(<Harness />);

    act(() => {
      latestActions?.updateCanvasAndGraph((current) => ({
        ...current,
        name: 'Graph Backed Task',
      }));
    });

    expect(latestCanvas?.name).toBe('Graph Backed Task');
    expect(latestGraphRef?.current.id).toBe('task_1');
    expect(latestGraphRef?.current.name).toBe('Graph Backed Task');
  });

  test('updates workflow binding metadata and success message', () => {
    render(<Harness />);

    act(() => {
      latestActions?.handleWorkflowBindingSaved('workflow_1', binding());
    });

    expect(latestCanvas?.workflows[0]).toMatchObject({
      bindingPath: 'bindings/workflow_1',
      directory: 'F:/workspace/workflow_1',
    });
    expect(latestMessage).toBe('已保存 workflow_1 workspace binding');
  });

  test('reports opened workflow binding folders', () => {
    render(<Harness />);

    act(() => {
      latestActions?.handleWorkflowBindingFolderOpened('workflow_1');
    });

    expect(latestMessage).toBe('已打开 workflow_1 的 bindings 目录');
  });
});
