import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { WorkflowGraph } from '../types';
import type {
  CanvasSelection,
  InternalNodeView,
  WorkflowContainerModel,
  WorkspaceCanvasModel,
} from '../types/workbench';
import { emptyWorkspaceCanvas } from '../workbench/model/taskModel';
import {
  useWorkflowRunSelectionActions,
  type UseWorkflowRunSelectionActionsResult,
} from './useWorkflowRunSelectionActions';
import type { RunWorkflowGraph } from './useWorkflowRunSubmitActions';

let latestActions: UseWorkflowRunSelectionActionsResult | null = null;
const runWorkflowGraph = vi.fn<RunWorkflowGraph>();
const currentTemporaryResourceIssue = vi.fn<() => string | null>();
const ensureBoundaryTransfersValid = vi.fn<() => Promise<void>>();
const reportTemporaryResourceIssue = vi.fn<(issue: string) => void>();
const setMessage = vi.fn<(message: string) => void>();

function workflowShell(id = 'workflow_1'): WorkflowContainerModel {
  return {
    id,
    title: 'Workflow 1',
    sourceKind: 'workflow',
    directory: 'workflows/workflow_1',
    status: 'not_run',
    inputPorts: [],
    outputPorts: [],
    internalNodes: [internalNode('internal_1')],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 320, height: 200 },
    warnings: [],
  };
}

function executableWorkflow(id = 'agent_1'): WorkflowContainerModel {
  return {
    id,
    title: 'Agent 1',
    sourceKind: 'agent_session',
    callableId: 'agent_class_1',
    directory: 'Root canvas environment',
    status: 'not_run',
    inputPorts: [{ id: 'main', label: 'main', direction: 'input' }],
    outputPorts: [{ id: 'main', label: 'main', direction: 'output' }],
    internalNodes: [],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 260, height: 180 },
    warnings: [],
  };
}

function internalNode(id = 'internal_1'): InternalNodeView {
  return {
    id,
    name: 'Internal Agent',
    task: 'agent_class_1',
    kind: 'Agent',
    status: 'not_run',
    callableId: 'agent_class_1',
    inputPorts: [{ id: 'main', label: 'main', direction: 'input' }],
    outputPorts: [{ id: 'main', label: 'main', direction: 'output' }],
    position: { x: 10, y: 20 },
  };
}

function canvas(workflows: WorkflowContainerModel[] = [workflowShell()]): WorkspaceCanvasModel {
  return {
    ...emptyWorkspaceCanvas('task_1', 'Task Canvas'),
    workflows,
  };
}

function Harness({
  currentCanvas = canvas(),
  selection = { type: 'task_canvas', taskId: 'task_1' } as CanvasSelection,
  selectedWorkflow = null,
  selectedInternalNode = null,
}: {
  currentCanvas?: WorkspaceCanvasModel;
  selection?: CanvasSelection;
  selectedWorkflow?: WorkflowContainerModel | null;
  selectedInternalNode?: InternalNodeView | null;
}) {
  latestActions = useWorkflowRunSelectionActions({
    canvas: currentCanvas,
    selection,
    selectedWorkflow,
    selectedInternalNode,
    currentTemporaryResourceIssue,
    ensureBoundaryTransfersValid,
    reportTemporaryResourceIssue,
    runWorkflowGraph,
    setMessage,
  });

  return <output>{String(latestActions.canRunSelectedWorkflow)}</output>;
}

describe('useWorkflowRunSelectionActions', () => {
  afterEach(() => {
    latestActions = null;
    vi.clearAllMocks();
    currentTemporaryResourceIssue.mockReturnValue(null);
    ensureBoundaryTransfersValid.mockResolvedValue();
  });

  test('runs the full task canvas when no temporary resource blocks execution', async () => {
    currentTemporaryResourceIssue.mockReturnValue(null);
    render(<Harness currentCanvas={canvas([workflowShell('workflow_1'), executableWorkflow('agent_1')])} />);

    await act(async () => {
      await latestActions?.runGraph();
    });

    expect(runWorkflowGraph).toHaveBeenCalledWith(
      expect.objectContaining<Partial<WorkflowGraph>>({
        id: 'task_1',
        name: 'Task Canvas',
      }),
      'task',
      'task_1',
    );
  });

  test('blocks task runs when a temporary resource issue is present', async () => {
    currentTemporaryResourceIssue.mockReturnValue('temporary resource blocks run');
    render(<Harness />);

    await act(async () => {
      await latestActions?.runGraph();
    });

    expect(reportTemporaryResourceIssue).toHaveBeenCalledWith('temporary resource blocks run');
    expect(runWorkflowGraph).not.toHaveBeenCalled();
  });

  test('runs a selected workflow only after boundary transfer validation passes', async () => {
    const selectedWorkflow = workflowShell('workflow_1');
    render(<Harness currentCanvas={canvas([selectedWorkflow])} selectedWorkflow={selectedWorkflow} />);

    expect(latestActions?.canRunSelectedWorkflow).toBe(true);

    await act(async () => {
      await latestActions?.runSelectedWorkflow();
    });

    expect(ensureBoundaryTransfersValid).toHaveBeenCalledTimes(1);
    expect(runWorkflowGraph).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workflow_1' }),
      'workflow',
      'workflow_1',
    );
  });

  test('reports boundary transfer validation failures without submitting workflow runs', async () => {
    ensureBoundaryTransfersValid.mockRejectedValueOnce(new Error('boundary mapping missing'));
    const selectedWorkflow = workflowShell('workflow_1');
    render(<Harness currentCanvas={canvas([selectedWorkflow])} selectedWorkflow={selectedWorkflow} />);

    await act(async () => {
      await latestActions?.runSelectedWorkflow();
    });

    expect(setMessage).toHaveBeenCalledWith('运行失败: boundary mapping missing');
    expect(runWorkflowGraph).not.toHaveBeenCalled();
  });

  test('runs a selected internal node inside its workflow scope', async () => {
    const selectedWorkflow = workflowShell('workflow_1');
    const node = internalNode('internal_1');
    render(
      <Harness
        currentCanvas={canvas([selectedWorkflow])}
        selectedWorkflow={selectedWorkflow}
        selectedInternalNode={node}
      />,
    );

    expect(latestActions?.canRunSelectedNode).toBe(true);

    await act(async () => {
      await latestActions?.runSelectedNode();
    });

    expect(runWorkflowGraph).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workflow_1_internal_1_single_node' }),
      'node',
      'internal_1',
    );
  });

  test('runs a selected executable workflow as a single node', async () => {
    const selectedWorkflow = executableWorkflow('agent_1');
    render(
      <Harness
        currentCanvas={canvas([selectedWorkflow])}
        selection={{ type: 'workflow', id: 'agent_1' }}
        selectedWorkflow={selectedWorkflow}
      />,
    );

    expect(latestActions?.canRunSelectedWorkflow).toBe(false);
    expect(latestActions?.canRunSelectedNode).toBe(true);

    await act(async () => {
      await latestActions?.runSelectedNode();
    });

    expect(runWorkflowGraph).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent_1_agent_1_single_node' }),
      'node',
      'agent_1',
    );
  });
});
