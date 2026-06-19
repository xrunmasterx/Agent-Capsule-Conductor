import { describe, expect, test } from 'vitest';

import type { InternalNodeView, WorkflowCanvasEdge, WorkflowContainerModel, WorkspaceCanvasModel } from '../../types/workbench';
import {
  clamp,
  defaultInternalNodePosition,
  expandWorkflowToFitChildren,
  expandWorkflowToFitChildrenCenterLocked,
  finiteNumber,
  finitePosition,
  layoutCanvasForSelection,
  layoutWorkflowInternalNodes,
  layoutWorkspaceCanvas,
  nextRootPalettePosition,
} from './canvasLayout';

function internalNode(id: string, position = { x: 0, y: 0 }): InternalNodeView {
  return {
    id,
    name: id,
    task: id,
    kind: 'Agent',
    status: 'not_run',
    callableId: 'fake-agent.generic',
    inputPorts: [{ id: 'main', label: 'main', direction: 'input' }],
    outputPorts: [{ id: 'main', label: 'main', direction: 'output' }],
    position,
  };
}

function workflow(
  id: string,
  position = { x: 0, y: 0 },
  internalNodes: InternalNodeView[] = [],
  internalEdges: WorkflowCanvasEdge[] = [],
): WorkflowContainerModel {
  return {
    id,
    title: id,
    directory: `workflows/${id}`,
    status: 'not_run',
    inputPorts: [{ id: 'main', label: 'main', direction: 'input' }],
    outputPorts: [{ id: 'main', label: 'main', direction: 'output' }],
    internalNodes,
    internalEdges,
    position,
    size: { width: 430, height: 328 },
    warnings: [],
  };
}

function executableWorkflow(id: string, position = { x: 0, y: 0 }): WorkflowContainerModel {
  return {
    ...workflow(id, position),
    sourceKind: 'agent_session',
    callableId: 'fake-agent.generic',
    size: { width: 276, height: 132 },
  };
}

function controlEdge(source: string, target: string): WorkflowCanvasEdge {
  return {
    id: `control_${source}_${target}`,
    kind: 'control',
    source: { workflowId: source },
    target: { workflowId: target },
    condition: null,
    context: 'none',
  };
}

describe('canvasLayout', () => {
  test('lays out root workflows left to right from control edges', () => {
    const canvas: WorkspaceCanvasModel = {
      id: 'task',
      name: 'Task',
      rootWorkflowId: 'task',
      workflows: [
        executableWorkflow('source', { x: 900, y: 900 }),
        executableWorkflow('target', { x: 20, y: 20 }),
      ],
      edges: [controlEdge('source', 'target')],
    };

    const laidOut = layoutWorkspaceCanvas(canvas);
    const source = laidOut.workflows.find((item) => item.id === 'source');
    const target = laidOut.workflows.find((item) => item.id === 'target');

    expect(source?.position.x).toBeLessThan(target?.position.x ?? 0);
    expect(source?.position).not.toEqual({ x: 900, y: 900 });
  });

  test('lays out selected inline workflow internals without moving other root workflows', () => {
    const inline = workflow(
      'inline',
      { x: 300, y: 100 },
      [internalNode('extract'), internalNode('summarize')],
      [controlEdge('extract', 'summarize')],
    );
    const peer = executableWorkflow('peer', { x: 10, y: 20 });
    const canvas: WorkspaceCanvasModel = {
      id: 'task',
      name: 'Task',
      rootWorkflowId: 'task',
      workflows: [inline, peer],
      edges: [],
    };

    const laidOut = layoutCanvasForSelection(canvas, { type: 'workflow', id: 'inline' });
    const laidOutInline = laidOut.workflows.find((item) => item.id === 'inline');
    const laidOutPeer = laidOut.workflows.find((item) => item.id === 'peer');

    expect(laidOutPeer?.position).toEqual(peer.position);
    expect(laidOutInline?.internalNodes[0].position?.x).toBeLessThan(
      laidOutInline?.internalNodes[1].position?.x ?? 0,
    );
  });

  test('internal workflow layout ranks boundary data edges before inner nodes', () => {
    const inline = workflow(
      'inline',
      { x: 0, y: 0 },
      [internalNode('extract'), internalNode('summarize')],
      [
        {
          id: 'data_input_extract',
          kind: 'data',
          source: { workflowId: 'inline__workflow_inputs', portId: 'main' },
          target: { workflowId: 'extract', portId: 'main' },
          materialization: 'copy',
        },
        controlEdge('extract', 'summarize'),
        {
          id: 'data_summarize_output',
          kind: 'data',
          source: { workflowId: 'summarize', portId: 'main' },
          target: { workflowId: 'inline__workflow_outputs', portId: 'main' },
          materialization: 'copy',
        },
      ],
    );

    const laidOut = layoutWorkflowInternalNodes(inline);
    const extract = laidOut.internalNodes.find((node) => node.id === 'extract');
    const summarize = laidOut.internalNodes.find((node) => node.id === 'summarize');

    expect(extract?.position?.x).toBeLessThan(summarize?.position?.x ?? 0);
    expect(laidOut.size.width).toBeGreaterThanOrEqual(430);
    expect(laidOut.size.height).toBeGreaterThanOrEqual(328);
  });

  test('expands workflow to fit children by shifting negative local positions into safe padding', () => {
    const inline = workflow(
      'inline',
      { x: 100, y: 100 },
      [internalNode('extract', { x: -40, y: -24 })],
    );

    const expanded = expandWorkflowToFitChildren(inline);

    expect(expanded.position.x).toBeLessThan(inline.position.x);
    expect(expanded.position.y).toBeLessThan(inline.position.y);
    expect(expanded.internalNodes[0].position).toEqual({ x: 8, y: 8 });
  });

  test('center-locked expansion keeps workflow center stable', () => {
    const inline = workflow(
      'inline',
      { x: 100, y: 80 },
      [internalNode('extract', { x: -120, y: 20 }), internalNode('summarize', { x: 700, y: 260 })],
    );
    const beforeCenter = {
      x: inline.position.x + inline.size.width / 2,
      y: inline.position.y + inline.size.height / 2,
    };

    const expanded = expandWorkflowToFitChildrenCenterLocked(inline);
    const afterCenter = {
      x: expanded.position.x + expanded.size.width / 2,
      y: expanded.position.y + expanded.size.height / 2,
    };

    expect(afterCenter).toEqual(beforeCenter);
    expect(expanded.size.width).toBeGreaterThan(inline.size.width);
  });

  test('nextRootPalettePosition places new nodes after existing executable roots', () => {
    expect(nextRootPalettePosition({ id: 'task', name: 'Task', rootWorkflowId: 'task', workflows: [], edges: [] })).toEqual({
      x: 620,
      y: 180,
    });
    expect(
      nextRootPalettePosition({
        id: 'task',
        name: 'Task',
        rootWorkflowId: 'task',
        workflows: [executableWorkflow('first'), workflow('inline_container')],
        edges: [],
      }),
    ).toEqual({ x: 620, y: 340 });
  });

  test('numeric helpers clamp and sanitize transient UI values', () => {
    expect(clamp(20, 0, 10)).toBe(10);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(finiteNumber(Number.NaN, 7)).toBe(7);
    expect(finitePosition({ x: Number.POSITIVE_INFINITY, y: 0 }, { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
    expect(defaultInternalNodePosition(2)).toEqual({ x: 12, y: 168 });
  });
});
