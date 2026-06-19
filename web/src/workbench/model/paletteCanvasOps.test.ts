import { describe, expect, test } from 'vitest';

import type { WorkflowContainerModel, WorkflowPortView, WorkspaceCanvasModel } from '../../types/workbench';
import {
  addCallableNodeFromPalette,
  addInternalNodeFromPalette,
  addWorkflowFromPalette,
  nextPaletteSelection,
  slugId,
  uniqueId,
} from './paletteCanvasOps';

function port(id: string, direction: 'input' | 'output'): WorkflowPortView {
  return { id, label: id, direction, cardinality: 'one' };
}

function workflowFixture(overrides: Partial<WorkflowContainerModel> = {}): WorkflowContainerModel {
  return {
    id: 'workflow_a',
    title: 'Workflow A',
    directory: 'workflows/a',
    status: 'not_run',
    inputPorts: [port('main', 'input')],
    outputPorts: [port('main', 'output')],
    internalNodes: [],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 300, height: 220 },
    warnings: [],
    ...overrides,
  };
}

function canvasFixture(workflows = [workflowFixture()]): WorkspaceCanvasModel {
  return {
    id: 'task',
    name: 'Task',
    rootWorkflowId: 'task',
    workflows,
    edges: [],
  };
}

describe('paletteCanvasOps', () => {
  test('creates workflow containers with stable ids and default boundary ports', () => {
    const canvas = addWorkflowFromPalette(
      canvasFixture(),
      { kind: 'workflow', workflowRef: 'workflows/demo/core.accflow.json', label: 'Core Flow' },
      { x: 100, y: 200 },
    );

    const workflow = canvas.workflows.at(-1);
    expect(workflow).toMatchObject({
      id: 'workflows_demo_core_accflow_json',
      title: 'Core Flow',
      sourceKind: 'workflow',
      workflowBodyKind: 'inline_container',
      bindingPath: 'bindings/workflows_demo_core_accflow_json.binding.local.json',
      position: { x: 100, y: 200 },
    });
    expect(workflow?.inputPorts[0]?.id).toBe('main');
    expect(workflow?.outputPorts[0]?.id).toBe('main');
  });

  test('creates root callable nodes from palette items', () => {
    const canvas = addCallableNodeFromPalette(
      canvasFixture([]),
      {
        kind: 'agent',
        callableId: 'stock-researcher.codex',
        label: 'Researcher',
        inputPorts: [port('target', 'input')],
        outputPorts: [port('summary', 'output')],
      },
      { x: 10, y: 20 },
    );

    expect(canvas.workflows[0]).toMatchObject({
      id: 'stock_researcher_codex',
      title: 'Researcher',
      sourceKind: 'agent_session',
      callableId: 'stock-researcher.codex',
      sourceInput: { user_prompt: 'Researcher' },
      position: { x: 10, y: 20 },
    });
    expect(canvas.workflows[0]?.inputPorts.map((item) => item.id)).toEqual(['target']);
    expect(canvas.workflows[0]?.outputPorts.map((item) => item.id)).toEqual(['main', 'summary']);
  });

  test('creates internal callable nodes in workflow scope', () => {
    const canvas = addInternalNodeFromPalette(
      canvasFixture([workflowFixture({ id: 'workflow_a', title: 'Workflow A' })]),
      'workflow_a',
      { kind: 'tool', callableId: 'file-reader.local', label: 'Reader' },
      { x: 40, y: 50 },
    );

    expect(canvas.workflows[0]?.internalNodes[0]).toMatchObject({
      id: 'file_reader_local',
      name: 'Reader',
      kind: 'Tool',
      runtime: 'file-reader.local',
      position: { x: 40, y: 50 },
    });
  });

  test('predicts next selection and unique ids without mutating the canvas', () => {
    const canvas = canvasFixture([workflowFixture({ id: 'agent_a' })]);

    expect(nextPaletteSelection(canvas, { kind: 'agent', callableId: 'agent.a', label: 'Agent A' }, null)).toEqual({
      type: 'workflow',
      id: 'agent_a_2',
    });
    expect(uniqueId('node', new Set(['node', 'node_2']))).toBe('node_3');
    expect(slugId(' / bad id / ')).toBe('bad_id');
  });
});
