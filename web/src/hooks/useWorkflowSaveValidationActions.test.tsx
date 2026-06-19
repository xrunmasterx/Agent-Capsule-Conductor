import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useRef, useState } from 'react';

import type { WorkflowGraph } from '../types';
import type { WorkspaceCanvasModel } from '../types/workbench';
import {
  boundaryTransferPreviewSnapshotForCanvas,
  useWorkflowSaveValidationActions,
  type UseWorkflowSaveValidationActionsResult,
  type WorkflowSaveDialogState,
} from './useWorkflowSaveValidationActions';
import type { EvidenceDockState } from './useEvidenceDockActions';

let latestActions: UseWorkflowSaveValidationActionsResult | null = null;
let latestMessage = '';
let latestEvidenceDock: EvidenceDockState | null = null;
let latestDialog: WorkflowSaveDialogState | null = null;
let latestGraphRef: { current: WorkflowGraph } | null = null;
let latestSourceGraph: WorkflowGraph | null = null;

const saveWorkflowGraph = vi.fn();
const validateWorkflowGraph = vi.fn();
const validateBoundaryTransfers = vi.fn();
const closeEvidenceDock = vi.fn();
const onSelect = vi.fn();
const onChanged = vi.fn();

function canvasModel(overrides: Partial<WorkspaceCanvasModel> = {}): WorkspaceCanvasModel {
  return {
    id: 'task_1',
    name: 'Task Canvas',
    rootWorkflowId: 'task_1',
    workflows: [],
    edges: [],
    ...overrides,
  };
}

function workflowGraph(): WorkflowGraph {
  return {
    id: 'initial_graph',
    name: 'Initial Graph',
    version: '1.0.0',
    nodes: [],
    edges: [],
  };
}

function Harness({
  initialDialog = null,
}: {
  initialDialog?: WorkflowSaveDialogState | null;
}) {
  const graphRef = useRef<WorkflowGraph>(workflowGraph());
  const [message, setMessage] = useState('');
  const [sourceGraph, setSourceGraph] = useState<WorkflowGraph>(workflowGraph());
  const [dialog, setDialog] = useState<WorkflowSaveDialogState | null>(initialDialog);
  const [evidenceDock, setEvidenceDock] = useState<EvidenceDockState>({
    open: false,
    title: '运行证据',
    content: null,
  });

  latestActions = useWorkflowSaveValidationActions({
    activeTaskId: 'task_1',
    canvas: canvasModel(),
    currentTaskAuthoring: undefined,
    focusedWorkflowId: null,
    saveWorkflowDialog: dialog,
    setSaveWorkflowDialog: setDialog,
    graphRef,
    setSourceGraph,
    setMessage,
    setEvidenceDock,
    saveWorkflowGraph,
    validateWorkflowGraph,
    validateBoundaryTransfers,
    closeEvidenceDock,
    onSelect,
    onChanged,
  });
  latestMessage = message;
  latestEvidenceDock = evidenceDock;
  latestDialog = dialog;
  latestGraphRef = graphRef;
  latestSourceGraph = sourceGraph;

  return <output>{message}</output>;
}

describe('useWorkflowSaveValidationActions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T00:00:00Z'));
    validateBoundaryTransfers.mockResolvedValue(undefined);
    saveWorkflowGraph.mockResolvedValue({
      status: 'saved',
      workflow_id: 'saved_workflow',
    });
    validateWorkflowGraph.mockResolvedValue({
      status: 'valid',
      workflow_id: 'saved_workflow',
    });
  });

  afterEach(() => {
    latestActions = null;
    latestMessage = '';
    latestEvidenceDock = null;
    latestDialog = null;
    latestGraphRef = null;
    latestSourceGraph = null;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test('saves reusable workflow graphs with boundary validation and selection refresh', async () => {
    render(<Harness />);

    await act(async () => {
      await latestActions?.saveGraph({ requestedName: 'Saved Workflow' });
    });

    expect(validateBoundaryTransfers).toHaveBeenCalledWith(
      expect.objectContaining({ canonical_graph: expect.any(Object) }),
    );
    expect(saveWorkflowGraph).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'Saved_Workflow', name: 'Saved Workflow' }),
      true,
    );
    expect(latestGraphRef?.current).toMatchObject({ id: 'Saved_Workflow' });
    expect(latestSourceGraph).toMatchObject({ id: 'Saved_Workflow' });
    expect(latestMessage).toBe('已保存 saved_workflow');
    expect(onSelect).toHaveBeenCalledWith('saved_workflow');
    expect(closeEvidenceDock).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test('keeps confirm dialog open with an error when requested name is blank', async () => {
    render(<Harness initialDialog={{ name: '   ', saving: false, error: null }} />);

    await act(async () => {
      await latestActions?.confirmSaveWorkflow();
    });

    expect(saveWorkflowGraph).not.toHaveBeenCalled();
    expect(latestDialog).toMatchObject({
      saving: false,
      error: 'Workflow 名称不能为空',
    });
  });

  test('reports validation errors in the evidence dock', async () => {
    validateWorkflowGraph.mockRejectedValueOnce(new Error('invalid graph'));
    render(<Harness />);

    await act(async () => {
      await latestActions?.validateGraph();
    });

    expect(saveWorkflowGraph).toHaveBeenCalledTimes(1);
    expect(validateWorkflowGraph).toHaveBeenCalledWith('task_1');
    expect(latestMessage).toBe('校验失败: invalid graph');
    expect(latestEvidenceDock).toMatchObject({
      open: true,
      title: '校验错误',
      content: {
        path: 'validation-error.log',
        type: 'log',
        content: 'invalid graph',
      },
      owner: {
        kind: 'validation',
        taskId: 'task_1',
        createdAt: '2026-06-20T00:00:00.000Z',
      },
    });
  });

  test('projects boundary transfer preview snapshots from runtime-stripped canvas', () => {
    const snapshot = boundaryTransferPreviewSnapshotForCanvas(canvasModel());

    expect(snapshot).toMatchObject({
      id: 'task_1',
      canonical_graph: {
        id: 'task_1',
        nodes: [],
      },
    });
  });
});
