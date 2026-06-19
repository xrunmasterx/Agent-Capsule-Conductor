import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useRef, useState } from 'react';

import { api } from '../api';
import type { WorkflowDetail, WorkflowGraph } from '../types';
import type { CanvasSelection, WorkspaceCanvasModel } from '../types/workbench';
import {
  openedWorkflowCanvasProjection,
  useOpenedWorkflowCanvas,
} from './useOpenedWorkflowCanvas';

vi.mock('../api', () => ({
  api: {
    workflow: vi.fn(),
  },
}));

type HarnessState = {
  canvas: WorkspaceCanvasModel;
  sourceGraph: WorkflowGraph;
  selection: CanvasSelection;
  message: string;
};

let latestState: HarnessState | null = null;
let latestGraphRef: { current: WorkflowGraph } | null = null;
const closeEvidenceDock = vi.fn();

function workflowGraph(id = 'workflow_a'): WorkflowGraph {
  return {
    id,
    version: '0.4.0',
    name: 'Workflow A',
    nodes: [
      {
        id: 'agent_a',
        callable_ref: { kind: 'agent_class', id: 'agent-a.codex' },
        kind: 'agent_session',
        label: 'Agent A',
        input: { user_prompt: 'Analyze' },
        input_mapping: {},
        input_ports: [{ id: 'main', direction: 'input' }],
        output_ports: [{ id: 'main', direction: 'output' }],
        metadata: { ui_label: 'Agent A' },
      },
    ],
    edges: [],
    control_edges: [],
    data_edges: [],
    metadata: { layout: 'workspace-canvas', root_workflow_id: 'agent_a' },
  };
}

function workflowDetail(id = 'workflow_a'): WorkflowDetail {
  return {
    workflow_id: id,
    file_id: `${id}.accflow.json`,
    path: `workflows/${id}.accflow.json`,
    workflow: {},
    graph: workflowGraph(id),
  };
}

function emptyGraph(): WorkflowGraph {
  return {
    id: 'empty',
    version: '0.4.0',
    nodes: [],
    edges: [],
  };
}

function emptyCanvas(): WorkspaceCanvasModel {
  return {
    id: 'empty',
    name: 'Empty',
    layout: 'workspace-canvas',
    rootWorkflowId: 'empty',
    workflows: [],
    edges: [],
  };
}

function Harness({
  enabled = true,
  workflowId = 'workflow_a',
}: {
  enabled?: boolean;
  workflowId?: string;
}) {
  const [sourceGraph, setSourceGraph] = useState<WorkflowGraph>(emptyGraph);
  const [canvas, setCanvas] = useState<WorkspaceCanvasModel>(emptyCanvas);
  const [selection, setSelection] = useState<CanvasSelection>({
    type: 'task_canvas',
    taskId: 'task_canvas',
  });
  const [message, setMessage] = useState('');
  const graphRef = useRef(sourceGraph);

  useOpenedWorkflowCanvas({
    enabled,
    workflowId,
    workflowRun: null,
    graphRef,
    setSourceGraph,
    setCanvas,
    setSelection,
    setMessage,
    closeEvidenceDock,
  });

  latestState = { canvas, sourceGraph, selection, message };
  latestGraphRef = graphRef;

  return <output>{message}</output>;
}

describe('useOpenedWorkflowCanvas', () => {
  beforeEach(() => {
    vi.mocked(api.workflow).mockImplementation(async (workflowId) => workflowDetail(workflowId));
  });

  afterEach(() => {
    latestState = null;
    latestGraphRef = null;
    vi.clearAllMocks();
  });

  test('projects loaded workflow details into graph, canvas, selection, and message state', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(latestState?.message).toBe('已打开 workflow_a');
    });

    expect(api.workflow).toHaveBeenCalledWith('workflow_a');
    expect(latestState?.sourceGraph.id).toBe('workflow_a');
    expect(latestGraphRef?.current.id).toBe('workflow_a');
    expect(latestState?.canvas.workflows.map((workflow) => workflow.id)).toEqual(['agent_a']);
    expect(latestState?.selection).toEqual({ type: 'workflow', id: 'agent_a' });
    expect(closeEvidenceDock).toHaveBeenCalledTimes(1);
  });

  test('does not load when disabled', () => {
    render(<Harness enabled={false} />);

    expect(api.workflow).not.toHaveBeenCalled();
    expect(latestState?.message).toBe('');
  });

  test('pure projection selects the first projected workflow node for empty focus graphs', () => {
    const projection = openedWorkflowCanvasProjection(
      {
        ...workflowDetail('empty_workflow'),
        graph: { ...emptyGraph(), id: 'empty_workflow', name: 'Empty Workflow' },
      },
      null,
    );

    expect(projection.canvas.id).toBe('empty_workflow');
    expect(projection.selection).toEqual({
      type: 'workflow',
      id: 'empty_workflow__workflow_inputs',
    });
    expect(projection.message).toBe('已打开 empty_workflow');
  });
});
