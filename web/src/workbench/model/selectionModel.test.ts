import { describe, expect, test } from 'vitest';

import type { InternalNodeView, WorkflowContainerModel } from '../../types/workbench';
import {
  internalInvocationLabel,
  isExecutableNodeWorkflow,
  promptFromInvocationInput,
  shouldDisconnectEdgeOnClick,
  staticInputFromInvocationInput,
  workflowInvocationLabel,
} from './selectionModel';

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
});
