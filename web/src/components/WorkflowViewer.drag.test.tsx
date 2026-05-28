import { act, render, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { __workflowViewerTestables } from './WorkflowViewer';
import { liveWorkflowRunFromEvents } from './workflow-viewer/runState';

const flowMock = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');
  const react = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    ReactFlow: vi.fn((props: Record<string, unknown>) => {
      flowMock.props = props;
      return react.createElement('div', { 'data-testid': 'react-flow' }, props.children as ReactNode);
    }),
    MiniMap: () => react.createElement('div', { 'data-testid': 'mini-map' }),
    Controls: () => react.createElement('div', { 'data-testid': 'controls' }),
    Background: () => react.createElement('div', { 'data-testid': 'background' }),
    Handle: (props: Record<string, unknown>) => react.createElement('div', props),
    NodeResizer: () => null,
  };
});

const WorkspaceCanvas = __workflowViewerTestables.WorkspaceCanvas as unknown as ComponentType<Record<string, unknown>>;

function workflow(id: string, x: number, y: number, internalNodes: unknown[] = []) {
  return {
    id,
    title: id,
    directory: `workflows/${id}`,
    status: 'not_run',
    inputPorts: [{ id: 'main', label: 'input', direction: 'input' }],
    outputPorts: [{ id: 'main', label: 'output', direction: 'output' }],
    internalNodes,
    internalEdges: [],
    position: { x, y },
    size: { width: 360, height: 260 },
    warnings: [],
  };
}

function agentWorkflow(id: string, x: number, y: number) {
  return {
    ...workflow(id, x, y),
    sourceKind: 'agent',
    capsuleId: 'fake-agent.generic',
    inputPorts: [{ id: 'main', label: 'input', direction: 'input' }],
    outputPorts: [{ id: 'main', label: 'output', direction: 'output' }],
  };
}

function canvasFixture() {
  return {
    id: 'acc_workspace_canvas',
    name: 'ACC Workspace',
    rootWorkflowId: 'source_flow',
    workflows: [
      workflow('source_flow', 100, 100, [
        {
          id: 'codex',
          name: 'Codex CLI',
          task: 'agent',
          kind: 'Agent',
          status: 'not_run',
          capsuleId: 'fake-agent.generic',
          position: { x: 40, y: 72 },
        },
      ]),
      workflow('target_flow', 620, 120),
      agentWorkflow('source_agent', 120, 450),
    ],
    edges: [],
  };
}

function renderCanvas(
  canvas = canvasFixture(),
  selection: Record<string, unknown> = { type: 'workflow', id: 'source_flow' },
) {
  const onCanvasChange = vi.fn();
  const onSelect = vi.fn();
  const view = render(
    <WorkspaceCanvas
      canvas={canvas}
      selection={selection}
      connectionMode="control"
      workflowRun={null}
      focusedWorkflowId={null}
      capsules={[]}
      workflows={[]}
      bindings={{}}
      onFocusedWorkflow={vi.fn()}
      onCanvasChange={onCanvasChange}
      onSelect={onSelect}
      onBlankCanvas={vi.fn()}
      onConfigureWorkflow={vi.fn()}
    />,
  );
  return { canvas, onCanvasChange, onSelect, rerender: view.rerender };
}

async function waitForFlowNodes() {
  await waitFor(() => {
    expect(flowMock.props?.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'source_flow' })]));
  });
  return flowMock.props?.nodes as Array<{ id: string; position: { x: number; y: number }; parentId?: string }>;
}

function currentNode(id: string) {
  const nodes = flowMock.props?.nodes as Array<{ id: string; position: { x: number; y: number }; parentId?: string }>;
  const node = nodes.find((item) => item.id === id);
  expect(node).toBeTruthy();
  return node!;
}

afterEach(() => {
  flowMock.props = null;
});

describe('WorkspaceCanvas drag buffer', () => {
  test('live events expose nested workflow node status through ui node ids', () => {
    const liveRun = liveWorkflowRunFromEvents(
      {
        id: 'task_run',
        version: '1.0',
        nodes: [{ id: 'New_Workflow', capsule_id: '', kind: 'workflow' }],
        edges: [],
      },
      'runs/task_run',
      [
        { type: 'workflow_started', status: 'running' },
        { type: 'node_started', node_id: 'New_Workflow', status: 'running' },
        {
          type: 'node_started',
          node_id: 'inner_agent',
          ui_node_id: 'New_Workflow__internal__inner_agent',
          parent_node_id: 'New_Workflow',
          capsule_id: 'fake-agent.generic',
          status: 'running',
        },
      ],
    );

    expect(liveRun.status).toBe('running');
    expect(liveRun.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_id: 'inner_agent',
          ui_node_id: 'New_Workflow__internal__inner_agent',
          parent_node_id: 'New_Workflow',
          status: 'running',
        }),
      ]),
    );
  });

  test('dragging position changes update local flow nodes without committing canvas', async () => {
    const { onCanvasChange } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        { id: 'source_flow', type: 'position', position: { x: 260, y: 340 }, dragging: true },
      ]);
    });

    expect(currentNode('source_flow').position).toEqual({ x: 260, y: 340 });
    expect(onCanvasChange).not.toHaveBeenCalled();
  });

  test('drag end commits only once and uses the final buffered position', async () => {
    const { canvas, onCanvasChange, rerender } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        { id: 'source_agent', type: 'position', position: { x: 210, y: 480 }, dragging: true },
      ]);
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        { id: 'source_agent', type: 'position', position: { x: 360, y: 540 }, dragging: true },
      ]);
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        { id: 'source_agent', type: 'position', position: { x: 480, y: 620 }, dragging: false },
      ]);
    });

    expect(currentNode('source_agent').position).toEqual({ x: 480, y: 620 });
    expect(onCanvasChange).toHaveBeenCalledTimes(1);

    act(() => {
      (flowMock.props?.onNodeDragStop as (event: unknown, node: unknown) => void)(
        {},
        { id: 'source_agent', position: { x: 120, y: 450 } },
      );
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    expect(nextCanvas.workflows.find((item) => item.id === 'source_agent')?.position).toEqual({
      x: 480,
      y: 620,
    });
  });

  test('internal node dragging only moves the node before release', async () => {
    const { canvas, onCanvasChange } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: -80, y: -60 },
          dragging: true,
        },
      ]);
    });

    const internalNode = currentNode('source_flow__internal__codex');
    expect(currentNode('source_flow').position).toEqual({ x: 100, y: 100 });
    expect(internalNode.position).toEqual({ x: -80, y: -60 });
    expect(internalNode.parentId).toBe('source_flow');
    expect((canvas.workflows[0].internalNodes[0] as { position: { x: number; y: number } }).position).toEqual({
      x: 40,
      y: 72,
    });
    expect(onCanvasChange).not.toHaveBeenCalled();
  });

  test('internal node drag end expands workflow around its center without moving the child visually', async () => {
    const { canvas, onCanvasChange, rerender } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: -80, y: -60 },
          dragging: true,
        },
      ]);
    });
    expect(onCanvasChange).not.toHaveBeenCalled();

    act(() => {
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: -80, y: -60 },
          dragging: false,
        },
      ]);
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    const codex = sourceFlow?.internalNodes.find((item) => (item as { id: string }).id === 'codex') as
      | { position: { x: number; y: number } }
      | undefined;

    expect(sourceFlow?.position).toEqual({ x: 20, y: 40 });
    expect(codex?.position).toEqual({ x: 0, y: 0 });
    expect((sourceFlow?.position.x || 0) + (codex?.position?.x || 0)).toBe(20);
    expect((sourceFlow?.position.y || 0) + (codex?.position?.y || 0)).toBe(40);

    rerender(
      <WorkspaceCanvas
        canvas={nextCanvas}
        selection={{ type: 'workflow', id: 'source_flow' }}
        connectionMode="control"
        workflowRun={null}
        focusedWorkflowId={null}
        capsules={[]}
        workflows={[]}
        bindings={{}}
        onFocusedWorkflow={vi.fn()}
        onCanvasChange={onCanvasChange}
        onSelect={vi.fn()}
        onBlankCanvas={vi.fn()}
        onConfigureWorkflow={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(currentNode('source_flow').position).toEqual({ x: 20, y: 40 });
      expect(currentNode('source_flow__internal__codex').position).toEqual({ x: 0, y: 0 });
    });

    act(() => {
      (flowMock.props?.onNodeDragStop as (event: unknown, node: unknown) => void)(
        {},
        { id: 'source_flow__internal__codex', position: { x: 40, y: 72 } },
      );
    });
    expect(onCanvasChange).toHaveBeenCalledTimes(1);
  });

  test('internal node released inside another workflow reparents and preserves executable fields', async () => {
    const { canvas, onCanvasChange } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: 550, y: 50 },
          dragging: false,
        },
      ]);
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    const targetFlow = nextCanvas.workflows.find((item) => item.id === 'target_flow');
    const moved = targetFlow?.internalNodes.find((item) => (item as { id: string }).id === 'codex') as
      | { name: string; capsuleId?: string; runtime?: string; position: { x: number; y: number } }
      | undefined;

    expect(sourceFlow?.internalNodes.some((item) => (item as { id: string }).id === 'codex')).toBe(false);
    expect(moved).toEqual(
      expect.objectContaining({
        name: 'Codex CLI',
        capsuleId: 'fake-agent.generic',
        position: { x: 30, y: 30 },
      }),
    );
  });

  test('internal node drag through a partial-outside position does not move empty source workflow when reparenting', async () => {
    const { canvas, onCanvasChange } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: -80, y: -60 },
          dragging: true,
        },
      ]);
    });
    expect(currentNode('source_flow').position).toEqual({ x: 100, y: 100 });

    act(() => {
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: 638, y: 118 },
          dragging: false,
        },
      ]);
    });

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    const targetFlow = nextCanvas.workflows.find((item) => item.id === 'target_flow');
    const moved = targetFlow?.internalNodes.find((item) => (item as { id: string }).id === 'codex') as
      | { position: { x: number; y: number }; capsuleId?: string }
      | undefined;

    expect(sourceFlow?.position).toEqual({ x: 100, y: 100 });
    expect(sourceFlow?.internalNodes).toHaveLength(0);
    expect((targetFlow?.position.x || 0) + (moved?.position.x || 0)).toBe(738);
    expect((targetFlow?.position.y || 0) + (moved?.position.y || 0)).toBe(218);
    expect(moved?.capsuleId).toBe('fake-agent.generic');
  });

  test('internal node drag through a partial-outside position does not move empty source workflow when dragging to root', async () => {
    const { canvas, onCanvasChange } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: -80, y: -60 },
          dragging: true,
        },
      ]);
    });
    expect(currentNode('source_flow').position).toEqual({ x: 100, y: 100 });

    act(() => {
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: 920, y: 500 },
          dragging: false,
        },
      ]);
    });

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    const rootNode = nextCanvas.workflows.find((item) => item.id === 'codex') as
      | { position: { x: number; y: number }; sourceKind?: string; capsuleId?: string }
      | undefined;

    expect(sourceFlow?.position).toEqual({ x: 100, y: 100 });
    expect(sourceFlow?.internalNodes).toHaveLength(0);
    expect(rootNode?.position).toEqual({ x: 1020, y: 600 });
    expect(rootNode?.sourceKind).toBe('agent_session');
    expect(rootNode?.capsuleId).toBe('fake-agent.generic');
  });

  test('root executable dragged into workflow is selected as an internal node', async () => {
    const { onCanvasChange, onSelect } = renderCanvas(canvasFixture(), {
      type: 'workflow',
      id: 'source_agent',
    });
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_agent',
          type: 'position',
          position: { x: 650, y: 150 },
          dragging: false,
        },
      ]);
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({
      type: 'internal',
      workflowId: 'target_flow',
      nodeId: 'source_agent',
    });
  });

  test('internal node released outside every workflow becomes a root executable node', async () => {
    const { canvas, onCanvasChange } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: 920, y: 500 },
          dragging: false,
        },
      ]);
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    const rootNode = nextCanvas.workflows.find((item) => item.id === 'codex') as
      | { title: string; sourceKind?: string; capsuleId?: string; position: { x: number; y: number } }
      | undefined;

    expect(sourceFlow?.internalNodes.some((item) => (item as { id: string }).id === 'codex')).toBe(false);
    expect(rootNode).toEqual(
      expect.objectContaining({
        title: 'Codex CLI',
        sourceKind: 'agent_session',
        capsuleId: 'fake-agent.generic',
        position: { x: 1020, y: 600 },
      }),
    );
  });
});
