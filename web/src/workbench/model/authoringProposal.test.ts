import { describe, expect, test } from 'vitest';

import type {
  CanvasAuthoringValidationResult,
  WorkbenchAuthoringState,
  WorkflowContainerModel,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import {
  authoringOperationSummary,
  authoringTargetFromSelection,
  canvasAuthoringHash,
  effectiveAssistantTurnReason,
  mergeAuthoringValidation,
  replaceTemporaryResourceWithCallable,
  temporaryResourceIssueForCanvas,
  temporaryResourceIssueForGraph,
} from './authoringProposal';

function workflow(overrides: Partial<WorkflowContainerModel> = {}): WorkflowContainerModel {
  return {
    id: 'agent_a',
    title: 'Agent A',
    directory: 'root',
    sourceKind: 'agent_session',
    callableId: 'agent.a',
    status: 'not_run',
    inputPorts: [],
    outputPorts: [],
    internalNodes: [],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 240, height: 120 },
    warnings: [],
    ...overrides,
  };
}

function canvas(workflows = [workflow()]): WorkspaceCanvasModel {
  return {
    id: 'task',
    name: 'Task',
    rootWorkflowId: 'task',
    workflows,
    edges: [],
  };
}

describe('authoringProposal support model', () => {
  test('hashes canvases deterministically regardless of object key order', () => {
    const first = canvasAuthoringHash('task', canvas());
    const second = canvasAuthoringHash('task', {
      edges: [],
      workflows: [workflow()],
      rootWorkflowId: 'task',
      name: 'Task',
      id: 'task',
    });

    expect(second).toBe(first);
  });

  test('projects selection targets and assistant turn reason fallback', () => {
    expect(authoringTargetFromSelection({ type: 'workflow', id: 'agent_a' }, 'task')).toEqual({
      kind: 'workflow',
      workflow_id: 'agent_a',
    });
    expect(effectiveAssistantTurnReason('canvas_revision', { type: 'workflow', id: 'agent_a' })).toBe(
      'selected_node_revision',
    );
    expect(effectiveAssistantTurnReason('canvas_revision', { type: 'task_canvas', taskId: 'task' })).toBe(
      'canvas_revision',
    );
    expect(effectiveAssistantTurnReason('workbench_chat', { type: 'workflow', id: 'agent_a' })).toBe(
      'workbench_chat',
    );
  });

  test('merges backend and local validation without duplicate messages', () => {
    const localValidation: CanvasAuthoringValidationResult = {
      status: 'valid',
      errors: ['local-only'],
      warnings: ['shared-warning', 'local-warning'],
    };
    const backendValidation: CanvasAuthoringValidationResult = {
      status: 'invalid',
      errors: ['backend-error'],
      warnings: ['shared-warning'],
    };

    expect(mergeAuthoringValidation(localValidation, backendValidation)).toEqual({
      status: 'invalid',
      errors: ['backend-error', 'local-only'],
      warnings: ['shared-warning', 'local-warning'],
    });
  });

  test('reports and replaces temporary callable references in canvas and graph projections', () => {
    const authoring: WorkbenchAuthoringState = {
      temporaryResources: {
        tmp_agent_a: {
          draft_id: 'tmp_agent_a',
          kind: 'agent_template',
          status: 'approved_for_canvas',
          agent_draft: { id: 'tmp_agent_a', name: 'Draft A' },
          referenced_by: ['agent_a'],
        },
      },
    };
    const withTemporary = canvas([workflow({ callableId: 'tmp_agent_a', temporaryResourceId: 'tmp_agent_a' })]);

    expect(temporaryResourceIssueForCanvas(withTemporary, authoring)).toMatch(/临时 agent template/u);
    expect(
      temporaryResourceIssueForGraph({
        id: 'graph',
        version: '0.4.0',
        name: 'Graph',
        nodes: [{ id: 'agent_a', label: 'Agent A', kind: 'agent', callable_ref: { id: 'tmp_agent_a' } }],
        edges: [],
      } as never),
    ).toMatch(/临时 callable/u);

    const replaced = replaceTemporaryResourceWithCallable(withTemporary, 'tmp_agent_a', 'agent.real');
    expect(replaced.workflows[0]).toMatchObject({
      callableId: 'agent.real',
      temporaryResourceId: undefined,
      warnings: [],
    });
  });

  test('summarizes authoring operations for assistant proposal UI', () => {
    expect(
      authoringOperationSummary({
        op: 'add_data_edge',
        scope_workflow_id: null,
        from: { node: 'a', port: 'summary' },
        to: { node: 'b', port: 'main' },
        materialization: 'copy',
      }),
    ).toBe('Data Edge a.summary -> b.main');
  });
});
