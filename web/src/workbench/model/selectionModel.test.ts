import { describe, expect, test } from 'vitest';

import type { InternalNodeView, WorkflowCanvasEdge, WorkflowContainerModel, WorkspaceCanvasModel } from '../../types/workbench';
import {
  deleteSelectionFromCanvas,
  edgeAddressForScope,
  findCanvasEdgeByAddress,
  internalInvocationLabel,
  isExecutableNodeWorkflow,
  normalizeSelectionIntent,
  normalizeWorkbenchSelection,
  promptFromInvocationInput,
  mergeInvocationInput,
  selectionCanBeDeleted,
  selectionEdgeAddress,
  selectionForEdgeAddress,
  shouldDisconnectEdgeOnClick,
  staticInputFromInvocationInput,
  workflowInvocationLabel,
} from './selectionModel';
import { internalFlowNodeId } from './workflowNodeModel';

function workflow(overrides: Partial<WorkflowContainerModel>): WorkflowContainerModel {
  return {
    id: 'workflow_1',
    title: 'Workflow 1',
    directory: 'Root',
    status: 'not_run',
    inputPorts: [],
    outputPorts: [],
    internalNodes: [],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    warnings: [],
    ...overrides,
  };
}

function dataEdge(id: string, source: string, target: string): WorkflowCanvasEdge {
  return {
    id,
    kind: 'data',
    source: { workflowId: source, portId: 'main' },
    target: { workflowId: target, portId: 'main' },
    materialization: 'copy',
  };
}

function controlEdge(id: string, source: string, target: string): WorkflowCanvasEdge {
  return {
    id,
    kind: 'control',
    source: { workflowId: source },
    target: { workflowId: target },
  };
}

function canvas(overrides: Partial<WorkspaceCanvasModel> = {}): WorkspaceCanvasModel {
  return {
    id: 'task_1',
    name: 'Task 1',
    rootWorkflowId: 'task_1',
    workflows: [],
    edges: [],
    ...overrides,
  };
}

describe('selection model helpers', () => {
  test('extracts prompt and static input from invocation input', () => {
    expect(promptFromInvocationInput({ user_prompt: 'User prompt', prompt: 'Legacy' })).toBe('User prompt');
    expect(promptFromInvocationInput({ prompt: 'Legacy prompt' })).toBe('Legacy prompt');
    expect(promptFromInvocationInput({ topic: 'Topic prompt' })).toBe('Topic prompt');
    expect(promptFromInvocationInput({ topic: 42 })).toBe('');
    expect(
      staticInputFromInvocationInput({
        user_prompt: 'User prompt',
        prompt: 'Legacy prompt',
        topic: 'Topic',
        target: 'NVDA',
      }),
    ).toEqual({ target: 'NVDA' });
  });

  test('merges invocation prompt with static input and removes empty legacy prompt keys', () => {
    expect(
      mergeInvocationInput(
        { prompt: 'Legacy prompt', topic: 'Old topic', target: 'NVDA' },
        'Updated prompt',
        { target: 'AAPL', verified_data: true },
      ),
    ).toEqual({ target: 'AAPL', verified_data: true, user_prompt: 'Updated prompt' });

    expect(
      mergeInvocationInput(
        { user_prompt: 'User prompt', prompt: 'Legacy prompt', topic: 'Old topic', target: 'NVDA' },
        '',
        { target: 'AAPL' },
      ),
    ).toEqual({ target: 'AAPL' });
  });

  test('computes invocation labels with stable fallback order', () => {
    expect(workflowInvocationLabel(workflow({ invocationLabel: 'Explicit', title: 'Title' }))).toBe('Explicit');
    expect(workflowInvocationLabel(workflow({ invocationLabel: undefined, title: 'Title' }))).toBe('Title');
    expect(
      internalInvocationLabel({
        id: 'node_1',
        name: 'Node name',
        task: 'Task',
        kind: 'Agent',
        status: 'not_run',
        invocationLabel: 'Node label',
      } satisfies InternalNodeView),
    ).toBe('Node label');
  });

  test('distinguishes executable root nodes from workflow shells and boundaries', () => {
    expect(isExecutableNodeWorkflow(workflow({ sourceKind: 'agent_session' }))).toBe(true);
    expect(isExecutableNodeWorkflow(workflow({ sourceKind: 'tool' }))).toBe(true);
    expect(isExecutableNodeWorkflow(workflow({ sourceKind: 'workflow' }))).toBe(false);
    expect(isExecutableNodeWorkflow(workflow({ sourceKind: 'agent_session', boundaryKind: 'workflow_input' }))).toBe(false);
    expect(isExecutableNodeWorkflow(workflow({ sourceKind: undefined }))).toBe(false);
  });

  test('only alt-left-click disconnects an edge', () => {
    expect(shouldDisconnectEdgeOnClick({ altKey: true, button: 0 })).toBe(true);
    expect(shouldDisconnectEdgeOnClick({ altKey: false, button: 0 })).toBe(false);
    expect(shouldDisconnectEdgeOnClick({ altKey: true, button: 2 })).toBe(false);
  });

  test('normalizes scoped edge selection and rejects ambiguous legacy edge ids', () => {
    const workflowA = workflow({
      id: 'workflow_a',
      internalNodes: [],
      internalEdges: [controlEdge('shared_edge', 'input', 'agent')],
    });
    const model = canvas({
      workflows: [workflowA],
      edges: [controlEdge('shared_edge', 'root_a', 'root_b')],
    });

    expect(selectionEdgeAddress(model, { type: 'edge', id: 'shared_edge' })).toBeNull();
    expect(selectionEdgeAddress(model, { type: 'edge', id: 'shared_edge', scopeWorkflowId: null })).toEqual({
      edgeId: 'shared_edge',
      scopeWorkflowId: null,
    });
    expect(
      findCanvasEdgeByAddress(model, edgeAddressForScope('workflow_a', 'shared_edge')),
    ).toEqual(workflowA.internalEdges[0]);
    expect(selectionForEdgeAddress(edgeAddressForScope('workflow_a', 'shared_edge'))).toEqual({
      type: 'edge',
      id: 'shared_edge',
      scopeWorkflowId: 'workflow_a',
    });
  });

  test('normalizes selection intent for workflow focus internal node projection', () => {
    const model = canvas({
      layout: 'workflow-focus',
      focusedWorkflowId: 'workflow_a',
      workflows: [
        workflow({
          id: 'workflow_a',
          internalNodes: [
            {
              id: 'agent_a',
              name: 'Agent A',
              task: 'Run A',
              kind: 'Agent',
              status: 'not_run',
            },
          ],
        }),
      ],
    });

    expect(
      normalizeSelectionIntent(
        model,
        model,
        { kind: 'react-flow-node', flowNodeId: internalFlowNodeId('workflow_a', 'agent_a') },
        'workflow_a',
      ),
    ).toEqual({ type: 'internal', workflowId: 'workflow_a', nodeId: 'agent_a' });
    expect(
      normalizeSelectionIntent(model, model, { kind: 'react-flow-node', flowNodeId: 'agent_a' }, 'workflow_a'),
    ).toEqual({ type: 'internal', workflowId: 'workflow_a', nodeId: 'agent_a' });
  });

  test('validates deletion eligibility and removes selected graph objects', () => {
    const model = canvas({
      workflows: [
        workflow({
          id: 'workflow_a',
          internalNodes: [
            {
              id: 'agent_a',
              name: 'Agent A',
              task: 'Run A',
              kind: 'Agent',
              status: 'not_run',
              position: { x: 20, y: 20 },
            },
            {
              id: 'agent_b',
              name: 'Agent B',
              task: 'Run B',
              kind: 'Agent',
              status: 'running',
              position: { x: 220, y: 20 },
            },
          ],
          internalEdges: [dataEdge('internal_data', 'agent_a', 'agent_b')],
        }),
      ],
      edges: [controlEdge('root_control', 'workflow_a', 'root_agent')],
    });

    expect(selectionCanBeDeleted(model, { type: 'internal', workflowId: 'workflow_a', nodeId: 'agent_b' }, false)).toEqual({
      ok: false,
      reason: '该节点正在运行，不能删除。',
    });
    expect(selectionCanBeDeleted(model, { type: 'edge', id: 'root_control', scopeWorkflowId: null }, true)).toEqual({
      ok: false,
      reason: '任务运行中，不能删除画布节点或连接。',
    });

    const withoutInternal = deleteSelectionFromCanvas(model, {
      type: 'internal',
      workflowId: 'workflow_a',
      nodeId: 'agent_a',
    });
    expect(withoutInternal.workflows[0].internalNodes.map((node) => node.id)).toEqual(['agent_b']);
    expect(withoutInternal.workflows[0].internalEdges).toEqual([]);

    const withoutWorkflow = deleteSelectionFromCanvas(model, { type: 'workflow', id: 'workflow_a' });
    expect(withoutWorkflow.workflows).toEqual([]);
    expect(withoutWorkflow.edges).toEqual([]);
  });

  test('normalizes missing selected objects back to task canvas', () => {
    const model = canvas({
      workflows: [
        workflow({
          id: 'workflow_a',
          inputPorts: [{ id: 'target', label: 'target', direction: 'input' }],
          outputPorts: [{ id: 'main', label: 'main', direction: 'output' }],
        }),
      ],
    });

    expect(normalizeWorkbenchSelection(model, { type: 'workflow', id: 'missing' }, null)).toEqual({
      type: 'task_canvas',
      taskId: 'task_1',
    });
    expect(
      normalizeWorkbenchSelection(
        model,
        { type: 'port', workflowId: 'workflow_a', portId: 'target', direction: 'input' },
        null,
      ),
    ).toEqual({ type: 'port', workflowId: 'workflow_a', portId: 'target', direction: 'input' });
    expect(
      normalizeWorkbenchSelection(
        model,
        { type: 'port', workflowId: 'workflow_a', portId: 'missing', direction: 'input' },
        null,
      ),
    ).toEqual({ type: 'task_canvas', taskId: 'task_1' });
  });
});
