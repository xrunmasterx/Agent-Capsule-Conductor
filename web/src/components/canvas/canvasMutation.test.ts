import { describe, expect, it } from 'vitest';
import type { WorkspaceCanvasModel } from '../../types/workbench';
import {
  commitDraggedNodeToCanvas,
  internalNodeFromExecutableWorkflow,
  moveInternalNode,
  resizeWorkflowContainer,
  resolvePaletteDropTarget,
} from './canvasMutation';
import type { CanvasFlowNode } from './NodeRenderer';

function canvasFixture(): WorkspaceCanvasModel {
  return {
    id: 'task-a',
    name: 'Task A',
    rootWorkflowId: 'workflow-a',
    workflows: [
      {
        id: 'workflow-a',
        title: 'Workflow A',
        directory: 'workflows/a',
        sourceKind: 'workflow',
        status: 'not_run',
        inputPorts: [{ id: 'main', label: 'Main', direction: 'input' }],
        outputPorts: [{ id: 'main', label: 'Main', direction: 'output' }],
        internalNodes: [
          {
            id: 'agent-a',
            name: 'Agent A',
            task: 'agent',
            kind: 'Agent',
            status: 'not_run',
            callableId: 'agent.a',
            position: { x: 80, y: 90 },
          },
        ],
        internalEdges: [],
        position: { x: 100, y: 100 },
        size: { width: 500, height: 320 },
        warnings: [],
      },
      {
        id: 'root-agent',
        title: 'Root Agent',
        directory: '',
        sourceKind: 'agent',
        status: 'not_run',
        callableId: 'agent.root',
        inputPorts: [{ id: 'main', label: 'Main', direction: 'input' }],
        outputPorts: [{ id: 'main', label: 'Main', direction: 'output' }],
        internalNodes: [],
        internalEdges: [],
        position: { x: 720, y: 120 },
        size: { width: 276, height: 132 },
        warnings: [],
      },
    ],
    edges: [],
  };
}

describe('canvasMutation', () => {
  it('resizes workflow containers with minimum dimensions', () => {
    const canvas = resizeWorkflowContainer(canvasFixture(), 'workflow-a', { width: 120, height: 80 });

    expect(canvas.workflows[0].size).toEqual({ width: 260, height: 190 });
  });

  it('moves internal nodes inside a workflow', () => {
    const canvas = moveInternalNode(canvasFixture(), 'workflow-a', 'agent-a', { x: 180, y: 210 });

    expect(canvas.workflows[0].internalNodes[0].position).toEqual({ x: 180, y: 210 });
  });

  it('resolves palette drops into workflow internals from DOM scope', () => {
    const dropTarget = document.createElement('div');
    dropTarget.dataset.dropScope = 'workflow-internal';
    dropTarget.dataset.workflowId = 'workflow-a';

    expect(
      resolvePaletteDropTarget(
        canvasFixture(),
        { kind: 'agent', callableId: 'agent.b', label: 'Agent B' },
        dropTarget,
        { x: 180, y: 220 },
      ),
    ).toEqual({
      kind: 'workflow_internal',
      workflowId: 'workflow-a',
      position: { x: 80, y: 120 },
    });
  });

  it('converts executable root workflows into internal nodes', () => {
    const rootAgent = canvasFixture().workflows[1];

    expect(internalNodeFromExecutableWorkflow(rootAgent, { x: 12, y: 34 })).toEqual(
      expect.objectContaining({
        id: 'root-agent',
        name: 'Root Agent',
        kind: 'Agent',
        callableId: 'agent.root',
        position: { x: 12, y: 34 },
      }),
    );
  });

  it('commits root workflow node drags to canvas position', () => {
    const node = {
      id: 'workflow-a',
      type: 'workflowContainer',
      position: { x: 240, y: 260 },
    } as CanvasFlowNode;

    const canvas = commitDraggedNodeToCanvas(canvasFixture(), [node], node);

    expect(canvas.workflows[0].position).toEqual({ x: 240, y: 260 });
  });
});
