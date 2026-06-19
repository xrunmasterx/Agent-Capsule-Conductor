import { describe, expect, test } from 'vitest';

import type { WorkflowContainerModel, WorkflowPortView, WorkspaceCanvasModel } from '../../types/workbench';
import { buildDataConnectionsModel } from './inspectorActions';

function port(
  id: string,
  direction: 'input' | 'output',
  overrides: Partial<WorkflowPortView> = {},
): WorkflowPortView {
  return {
    id,
    label: id,
    direction,
    cardinality: 'one',
    ...overrides,
  };
}

function node(
  id: string,
  inputPorts: WorkflowPortView[] = [port('main', 'input')],
  outputPorts: WorkflowPortView[] = [port('main', 'output')],
): WorkflowContainerModel {
  return {
    id,
    title: id,
    directory: `workflows/${id}`,
    status: 'not_run',
    inputPorts,
    outputPorts,
    internalNodes: [],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 240, height: 120 },
    warnings: [],
  };
}

function canvasFixture(): WorkspaceCanvasModel {
  return {
    id: 'task',
    name: 'Task',
    layout: 'workspace-canvas',
    rootWorkflowId: 'task',
    workflows: [
      node('source_agent', [port('main', 'input')], [
        port('summary', 'output'),
        port('schema_value', 'output', { projectionSource: 'output_schema' }),
      ]),
      node('target_agent', [port('main', 'input'), port('evidence', 'input', { cardinality: 'many' })]),
    ],
    edges: [
      {
        id: 'data_source_target',
        kind: 'data',
        source: { workflowId: 'source_agent', portId: 'summary' },
        target: { workflowId: 'target_agent', portId: 'main' },
        materialization: 'copy',
      },
    ],
  };
}

describe('inspectorActions data connections model', () => {
  test('projects incoming, outgoing, targets, conflicts, and readonly ports', () => {
    const model = buildDataConnectionsModel({
      canvas: canvasFixture(),
      scopeWorkflowId: null,
      nodeId: 'source_agent',
      inputPorts: [port('main', 'input')],
      outputPorts: [
        port('summary', 'output'),
        port('schema_value', 'output', { projectionSource: 'output_schema' }),
      ],
      dataConnectionDraft: {
        scopeWorkflowId: null,
        sourceNodeId: 'source_agent',
        sourceNodeLabel: 'Source',
        sourcePortId: 'summary',
        materialization: 'copy',
      },
    });

    expect(model.sourceScopeMatches).toBe(true);
    expect(model.outgoing.map((edge) => edge.id)).toEqual(['data_source_target']);
    expect(model.outputPorts.find((item) => item.port.id === 'summary')?.relatedEdges).toHaveLength(1);
    expect(model.outputPorts.find((item) => item.port.id === 'schema_value')?.readonly).toBe(true);
    expect(model.targets.map((target) => target.nodeId)).toEqual(['target_agent']);
    expect(model.targets[0]?.inputPorts.find((item) => item.port.id === 'main')?.hasOneCardinalityConflict).toBe(true);
    expect(model.targets[0]?.inputPorts.find((item) => item.port.id === 'evidence')?.hasOneCardinalityConflict).toBe(false);
    expect(model.targets[0]?.inputPorts[0]?.requestedPortId).toBe('source_agent_input');
  });

  test('marks draft as scope-mismatched without hiding current node edges', () => {
    const model = buildDataConnectionsModel({
      canvas: canvasFixture(),
      scopeWorkflowId: 'inline_workflow',
      nodeId: 'source_agent',
      inputPorts: [port('main', 'input')],
      outputPorts: [port('summary', 'output')],
      dataConnectionDraft: {
        scopeWorkflowId: null,
        sourceNodeId: 'source_agent',
        sourceNodeLabel: 'Source',
        sourcePortId: 'summary',
        materialization: 'copy',
      },
    });

    expect(model.sourceScopeMatches).toBe(false);
    expect(model.incoming).toEqual([]);
    expect(model.outgoing).toEqual([]);
  });
});
