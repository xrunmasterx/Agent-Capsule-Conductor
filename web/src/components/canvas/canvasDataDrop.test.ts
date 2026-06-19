import { describe, expect, it } from 'vitest';
import type { PendingCanvasConnection } from '../../workbench/model/canvasEdgeOps';
import type { WorkspaceCanvasModel } from '../../types/workbench';
import {
  createDataEdgeToNodeBodyCommand,
  inputPortIdForDataBodyPreview,
  prepareDataEdgeToNodeBodyCommand,
} from './canvasDataDrop';

function canvasFixture(): WorkspaceCanvasModel {
  return {
    id: 'task-a',
    name: 'Task A',
    rootWorkflowId: 'source',
    workflows: [
      {
        id: 'source',
        title: 'Source',
        directory: '',
        sourceKind: 'agent',
        status: 'not_run',
        callableId: 'agent.source',
        inputPorts: [{ id: 'main', label: 'Main', direction: 'input' }],
        outputPorts: [{ id: 'main', label: 'Main', direction: 'output' }],
        internalNodes: [],
        internalEdges: [],
        position: { x: 40, y: 80 },
        size: { width: 276, height: 132 },
        warnings: [],
      },
      {
        id: 'target',
        title: 'Target',
        directory: '',
        sourceKind: 'agent',
        status: 'not_run',
        callableId: 'agent.target',
        inputPorts: [{ id: 'main', label: 'Main', direction: 'input' }],
        outputPorts: [{ id: 'main', label: 'Main', direction: 'output' }],
        internalNodes: [],
        internalEdges: [],
        position: { x: 420, y: 80 },
        size: { width: 276, height: 132 },
        warnings: [],
      },
    ],
    edges: [],
  };
}

function pendingSourceMain(): PendingCanvasConnection {
  return {
    nodeId: 'source',
    handleId: 'source:output:main',
    mode: 'data',
    side: 'source',
    endpoint: {
      view: 'root-shell',
      role: 'root_executable_output',
      nodeId: 'source',
      workflowId: null,
      portId: 'main',
      handleId: 'source:output:main',
    },
  };
}

describe('canvasDataDrop', () => {
  it('previews a generated target input port for body drops', () => {
    expect(inputPortIdForDataBodyPreview(canvasFixture(), canvasFixture(), pendingSourceMain(), 'target')).toBe('source_main');
  });

  it('prepares a body-drop data edge command and creates the missing target port', () => {
    const plan = prepareDataEdgeToNodeBodyCommand(canvasFixture(), canvasFixture(), pendingSourceMain(), 'target');

    expect(plan).toEqual(
      expect.objectContaining({
        targetPortId: 'source_main',
        createdTargetPort: true,
        request: {
          scopeWorkflowId: null,
          sourceNodeId: 'source',
          sourcePortId: 'main',
          targetNodeId: 'target',
          targetPortId: 'source_main',
          materialization: 'copy',
        },
      }),
    );
    expect(plan.canvasWithTargetPort.workflows[1].inputPorts.map((port) => port.id)).toContain('source_main');
  });

  it('creates a data edge for a body drop', () => {
    const result = createDataEdgeToNodeBodyCommand(canvasFixture(), canvasFixture(), pendingSourceMain(), 'target');

    expect(result.targetPortId).toBe('source_main');
    expect(result.edge).toEqual(
      expect.objectContaining({
        kind: 'data',
        source: { workflowId: 'source', portId: 'main' },
        target: { workflowId: 'target', portId: 'source_main' },
      }),
    );
  });
});
