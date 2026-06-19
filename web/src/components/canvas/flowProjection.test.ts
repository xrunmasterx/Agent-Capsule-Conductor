import { describe, expect, test } from 'vitest';

import { canvasEdgeToFlowEdge, toFlowEdges, toFlowNodes } from './flowProjection';
import type {
  CanvasSelection,
  WorkflowCanvasEdge,
  WorkspaceCanvasModel,
} from '../../types/workbench';

const taskSelection: CanvasSelection = {
  type: 'task_canvas',
  taskId: 'acc_workspace_canvas',
};

function canvasFixture(edges: WorkflowCanvasEdge[] = []): WorkspaceCanvasModel {
  return {
    id: 'acc_workspace_canvas',
    name: 'ACC Workspace',
    rootWorkflowId: 'source_flow',
    workflows: [
      {
        id: 'source_flow',
        title: 'Source Flow',
        directory: 'workflows/source',
        sourceKind: 'workflow',
        status: 'not_run',
        inputPorts: [{ id: 'main', label: 'input', direction: 'input' }],
        outputPorts: [{ id: 'main', label: 'output', direction: 'output' }],
        internalNodes: [
          {
            id: 'codex',
            name: 'Codex',
            task: 'agent',
            kind: 'Agent',
            status: 'not_run',
            callableId: 'fake-agent.generic',
            position: { x: 40, y: 72 },
          },
          {
            id: 'reviewer',
            name: 'Reviewer',
            task: 'agent',
            kind: 'Agent',
            status: 'not_run',
            callableId: 'fake-agent.generic',
            position: { x: 280, y: 72 },
          },
        ],
        internalEdges: [],
        position: { x: 100, y: 100 },
        size: { width: 500, height: 320 },
        warnings: [],
      },
      {
        id: 'target_flow',
        title: 'Target Flow',
        directory: 'workflows/target',
        sourceKind: 'workflow',
        status: 'not_run',
        inputPorts: [
          { id: 'main', label: 'input', direction: 'input' },
          { id: 'evidence', label: 'evidence', direction: 'input' },
        ],
        outputPorts: [{ id: 'main', label: 'output', direction: 'output' }],
        internalNodes: [],
        internalEdges: [],
        position: { x: 720, y: 100 },
        size: { width: 420, height: 280 },
        warnings: [],
      },
      {
        id: 'source_agent',
        title: 'Source Agent',
        directory: 'agents/source',
        sourceKind: 'agent',
        callableId: 'fake-agent.generic',
        status: 'not_run',
        inputPorts: [{ id: 'main', label: 'input', direction: 'input' }],
        outputPorts: [{ id: 'main', label: 'output', direction: 'output' }],
        internalNodes: [],
        internalEdges: [],
        position: { x: 100, y: 520 },
        size: { width: 220, height: 120 },
        warnings: [],
      },
      {
        id: 'target_agent',
        title: 'Target Agent',
        directory: 'agents/target',
        sourceKind: 'agent',
        callableId: 'fake-agent.generic',
        status: 'not_run',
        inputPorts: [{ id: 'main', label: 'input', direction: 'input' }],
        outputPorts: [{ id: 'main', label: 'output', direction: 'output' }],
        internalNodes: [],
        internalEdges: [],
        position: { x: 420, y: 520 },
        size: { width: 220, height: 120 },
        warnings: [],
      },
    ],
    edges,
  };
}

describe('flowProjection', () => {
  test('projects explicit data edges to data port handles', () => {
    const edge: WorkflowCanvasEdge = {
      id: 'data_source_agent_target_flow',
      kind: 'data',
      source: { workflowId: 'source_agent', portId: 'main' },
      target: { workflowId: 'target_flow', portId: 'evidence' },
      materialization: 'copy',
    };

    const [flowEdge] = canvasEdgeToFlowEdge(edge, null, taskSelection, 'data');

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_agent',
        target: 'target_flow',
        type: 'step',
        sourceHandle: 'source_agent:output:main',
        targetHandle: 'target_flow:input:evidence',
        className: 'workflow-edge-data',
        markerEnd: expect.objectContaining({ type: 'arrowclosed' }),
      }),
    );
  });

  test('keeps explicit main-to-main data edges visible', () => {
    const edge: WorkflowCanvasEdge = {
      id: 'data_source_agent_main_target_agent_main',
      kind: 'data',
      source: { workflowId: 'source_agent', portId: 'main' },
      target: { workflowId: 'target_agent', portId: 'main' },
      materialization: 'copy',
    };

    const [flowEdge] = canvasEdgeToFlowEdge(edge, null, taskSelection, 'data');

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_agent',
        target: 'target_agent',
        sourceHandle: 'source_agent:output:main',
        targetHandle: 'target_agent:input:main',
        className: 'workflow-edge-data',
      }),
    );
  });

  test('projects control edges with arrow markers', () => {
    const edge: WorkflowCanvasEdge = {
      id: 'control_source_agent_target_agent',
      kind: 'control',
      source: { workflowId: 'source_agent' },
      target: { workflowId: 'target_agent' },
    };

    const [flowEdge] = canvasEdgeToFlowEdge(edge, null, taskSelection, 'control');

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_agent',
        target: 'target_agent',
        sourceHandle: 'source_agent:control:source',
        targetHandle: 'target_agent:control:target',
        className: 'workflow-edge-control',
        markerEnd: expect.objectContaining({ type: 'arrowclosed' }),
      }),
    );
  });

  test('projects internal data edges into scoped flow node ids', () => {
    const edge: WorkflowCanvasEdge = {
      id: 'data_codex_reviewer',
      kind: 'data',
      source: { workflowId: 'codex', portId: 'main' },
      target: { workflowId: 'reviewer', portId: 'main' },
      materialization: 'copy',
    };

    const [flowEdge] = canvasEdgeToFlowEdge(
      edge,
      'source_flow',
      taskSelection,
      'data',
      'source_flow',
    );

    expect(flowEdge).toEqual(
      expect.objectContaining({
        id: 'workflow:source_flow::data_codex_reviewer',
        source: 'source_flow__internal__codex',
        target: 'source_flow__internal__reviewer',
        sourceHandle: 'source_flow__internal__codex:output:main',
        targetHandle: 'source_flow__internal__reviewer:input:main',
      }),
    );
  });

  test('projects workflow input boundary control through the visible shell handle', () => {
    const edge: WorkflowCanvasEdge = {
      id: 'control_inputs_codex',
      kind: 'control',
      source: { workflowId: 'source_flow__workflow_inputs' },
      target: { workflowId: 'codex' },
    };

    const [flowEdge] = canvasEdgeToFlowEdge(
      edge,
      'source_flow',
      taskSelection,
      'control',
      'source_flow',
    );

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_flow',
        target: 'source_flow__internal__codex',
        sourceHandle: 'source_flow:workflow-input-inner-source',
        targetHandle: 'source_flow__internal__codex:control:target',
        className: 'workflow-edge-control workflow-edge-boundary-main',
      }),
    );
  });

  test('keeps focused workflow boundary control on boundary nodes', () => {
    const edge: WorkflowCanvasEdge = {
      id: 'control_inputs_codex',
      kind: 'control',
      source: { workflowId: 'source_flow__workflow_inputs' },
      target: { workflowId: 'codex' },
    };

    const [flowEdge] = canvasEdgeToFlowEdge(edge, 'source_flow', taskSelection, 'control');

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_flow__workflow_inputs',
        target: 'codex',
        sourceHandle: 'source_flow__workflow_inputs:workflow-input-inner-source',
        targetHandle: 'codex:control:target',
        className: 'workflow-edge-control workflow-edge-boundary-main',
      }),
    );
  });

  test('deduplicates canvas-equivalent edges before building React Flow edges', () => {
    const edge: WorkflowCanvasEdge = {
      id: 'control_source_agent_target_agent',
      kind: 'control',
      source: { workflowId: 'source_agent' },
      target: { workflowId: 'target_agent' },
    };
    const duplicate: WorkflowCanvasEdge = {
      ...edge,
      id: 'control_duplicate_id',
    };

    const flowEdges = toFlowEdges(canvasFixture([edge, duplicate]), taskSelection, 'control', 'all', false);

    expect(flowEdges).toHaveLength(1);
    expect(flowEdges[0]).toEqual(expect.objectContaining({ id: 'root::control_source_agent_target_agent' }));
  });

  test('projects workflow containers and internal nodes for React Flow', () => {
    const nodes = toFlowNodes(
      canvasFixture(),
      taskSelection,
      {},
      () => {},
      () => {},
      () => {},
      () => {},
      () => {},
      () => {},
      true,
      true,
      false,
      () => {},
      () => {},
      () => {},
      'control',
      'all',
      null,
      () => {},
    );

    expect(nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        'source_flow',
        'source_flow__internal__codex',
        'source_flow__internal__reviewer',
        'target_flow',
      ]),
    );
    expect(nodes.find((node) => node.id === 'source_flow')).toEqual(
      expect.objectContaining({ type: 'workflowContainer', position: { x: 100, y: 100 } }),
    );
    expect(nodes.find((node) => node.id === 'source_flow__internal__codex')).toEqual(
      expect.objectContaining({
        type: 'agentToolNode',
        parentId: 'source_flow',
        extent: 'parent',
        position: { x: 40, y: 72 },
      }),
    );
  });

  test('projects executable root agent workflows as agent tool nodes', () => {
    const canvas: WorkspaceCanvasModel = {
      ...canvasFixture(),
      workflows: [
        {
          id: 'root_agent',
          title: 'Root Agent',
          directory: '',
          sourceKind: 'agent',
          status: 'not_run',
          callableId: 'fake-agent.generic',
          inputPorts: [{ id: 'main', label: 'main', direction: 'input' }],
          outputPorts: [{ id: 'main', label: 'main', direction: 'output' }],
          internalNodes: [],
          internalEdges: [],
          position: { x: 24, y: 32 },
          size: { width: 276, height: 132 },
          warnings: [],
        },
      ],
    };

    const [node] = toFlowNodes(
      canvas,
      { type: 'workflow', id: 'root_agent' },
      {},
      () => {},
      () => {},
      () => {},
      () => {},
      () => {},
      () => {},
      true,
      true,
      true,
      () => {},
      () => {},
      () => {},
      'data',
      'all',
      null,
      () => {},
    );

    expect(node).toEqual(
      expect.objectContaining({
        id: 'root_agent',
        type: 'agentToolNode',
        position: { x: 24, y: 32 },
        selected: true,
      }),
    );
    expect(node.data).toEqual(
      expect.objectContaining({
        id: 'root_agent',
        kind: 'Agent',
        callableId: 'fake-agent.generic',
        selected: true,
        showDataPorts: true,
        showDataPortLabels: true,
      }),
    );
  });
});
