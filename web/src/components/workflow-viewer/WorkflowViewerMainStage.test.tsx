import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type {
  CanvasSelection,
  WorkbenchTask,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { WorkflowViewerMainStage } from './WorkflowViewerMainStage';

vi.mock('../canvas/WorkspaceCanvas', () => ({
  WorkspaceCanvas: ({
    onConfigureWorkflow,
    onNotice,
  }: {
    onConfigureWorkflow: (workflowId: string) => void;
    onNotice: (message: string) => void;
  }) => (
    <div data-testid="workspace-canvas">
      <button type="button" onClick={() => onConfigureWorkflow('workflow_1')}>
        configure workflow
      </button>
      <button type="button" onClick={() => onNotice('canvas notice')}>
        notice
      </button>
    </div>
  ),
}));

vi.mock('../execution', () => ({
  ExecutionDock: ({
    onRunTask,
    onRunWorkflow,
    onRunNode,
  }: {
    onRunTask: () => void;
    onRunWorkflow: () => void;
    onRunNode: () => void;
  }) => (
    <div data-testid="execution-dock">
      <button type="button" onClick={onRunTask}>
        run task
      </button>
      <button type="button" onClick={onRunWorkflow}>
        run workflow
      </button>
      <button type="button" onClick={onRunNode}>
        run node
      </button>
    </div>
  ),
}));

vi.mock('../workbench', () => ({
  TaskWorkspaceSwitcher: ({
    value,
    onChange,
  }: {
    value: 'overview' | 'blueprint';
    onChange: (value: 'overview' | 'blueprint') => void;
  }) => (
    <div data-testid="task-workspace-switcher" data-value={value}>
      <button type="button" onClick={() => onChange('overview')}>
        switch overview
      </button>
      <button type="button" onClick={() => onChange('blueprint')}>
        switch blueprint
      </button>
    </div>
  ),
  TaskOverviewPage: ({
    onSelectTask,
    onOpenBlueprint,
    onNewTask,
    onDeleteTask,
  }: {
    onSelectTask: (taskId: string) => void;
    onOpenBlueprint: () => void;
    onNewTask: () => void;
    onDeleteTask: (taskId: string) => void;
  }) => (
    <div data-testid="task-overview-page">
      <button type="button" onClick={() => onSelectTask('task_2')}>
        select task
      </button>
      <button type="button" onClick={onOpenBlueprint}>
        open blueprint
      </button>
      <button type="button" onClick={onNewTask}>
        new task
      </button>
      <button type="button" onClick={() => onDeleteTask('task_2')}>
        delete task
      </button>
    </div>
  ),
}));

function canvas(): WorkspaceCanvasModel {
  return {
    id: 'task_1',
    name: 'Task 1',
    rootWorkflowId: 'workflow_1',
    workflows: [],
    edges: [],
  };
}

function tasks(): WorkbenchTask[] {
  return [
    {
      taskId: 'task_1',
      title: 'Task 1',
      canvas: canvas(),
      status: 'not_run',
    },
    {
      taskId: 'task_2',
      title: 'Task 2',
      canvas: canvas(),
      status: 'success',
    },
  ];
}

function props() {
  const selection: CanvasSelection = { type: 'task_canvas', taskId: 'task_1' };
  return {
    taskWorkspaceView: 'overview' as const,
    onTaskWorkspaceViewChange: vi.fn(),
    tasks: tasks(),
    activeTaskId: 'task_1',
    onSelectTask: vi.fn(),
    onNewTask: vi.fn(),
    onDeleteTask: vi.fn(),
    canvas: canvas(),
    layoutSyncVersion: 0,
    selection,
    connectionMode: 'data' as const,
    edgeViewMode: 'all' as const,
    workflowRun: null,
    focusedWorkflowId: null,
    callables: [],
    workflows: [],
    workflowBindings: {},
    onFocusedWorkflow: vi.fn(),
    onCanvasChange: vi.fn(),
    onSelectCanvasObject: vi.fn(),
    onOpenNodeDetails: vi.fn(),
    onDeleteSelection: vi.fn(),
    onConnectionMode: vi.fn(),
    onEdgeViewMode: vi.fn(),
    onNotice: vi.fn(),
    onConfigureWorkflow: vi.fn(),
    isRunning: false,
    runtimeConfig: null,
    canRunWorkflow: true,
    canRunNode: true,
    onRunTask: vi.fn(),
    onRunWorkflow: vi.fn(),
    onRunNode: vi.fn(),
  };
}

describe('WorkflowViewerMainStage', () => {
  test('renders overview mode and forwards task actions', () => {
    const stageProps = props();
    render(<WorkflowViewerMainStage {...stageProps} />);

    expect(screen.getByTestId('task-workspace-switcher')).toHaveAttribute('data-value', 'overview');
    expect(screen.getByTestId('task-overview-page')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'switch blueprint' }));
    fireEvent.click(screen.getByRole('button', { name: 'select task' }));
    fireEvent.click(screen.getByRole('button', { name: 'open blueprint' }));
    fireEvent.click(screen.getByRole('button', { name: 'new task' }));
    fireEvent.click(screen.getByRole('button', { name: 'delete task' }));

    expect(stageProps.onTaskWorkspaceViewChange).toHaveBeenCalledWith('blueprint');
    expect(stageProps.onSelectTask).toHaveBeenCalledWith('task_2');
    expect(stageProps.onTaskWorkspaceViewChange).toHaveBeenCalledWith('blueprint');
    expect(stageProps.onNewTask).toHaveBeenCalledTimes(1);
    expect(stageProps.onDeleteTask).toHaveBeenCalledWith('task_2');
  });

  test('renders blueprint mode and forwards canvas and execution actions', () => {
    const stageProps = { ...props(), taskWorkspaceView: 'blueprint' as const };
    render(<WorkflowViewerMainStage {...stageProps} />);

    expect(screen.getByTestId('workspace-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('execution-dock')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'configure workflow' }));
    fireEvent.click(screen.getByRole('button', { name: 'notice' }));
    fireEvent.click(screen.getByRole('button', { name: 'run task' }));
    fireEvent.click(screen.getByRole('button', { name: 'run workflow' }));
    fireEvent.click(screen.getByRole('button', { name: 'run node' }));

    expect(stageProps.onConfigureWorkflow).toHaveBeenCalledWith('workflow_1');
    expect(stageProps.onNotice).toHaveBeenCalledWith('canvas notice');
    expect(stageProps.onRunTask).toHaveBeenCalledTimes(1);
    expect(stageProps.onRunWorkflow).toHaveBeenCalledTimes(1);
    expect(stageProps.onRunNode).toHaveBeenCalledTimes(1);
  });
});
