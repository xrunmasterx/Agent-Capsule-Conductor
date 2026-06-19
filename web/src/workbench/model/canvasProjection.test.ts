import { describe, expect, test } from 'vitest';

import { graphToWorkspaceCanvas } from './canvasProjection';
import { canvasToWorkflowGraph } from './workflowGraphProjection';
import { workflowInputBoundaryId, workflowOutputBoundaryId } from './workflowNodeModel';
import type { WorkflowGraph } from '../../types';

describe('canvasProjection', () => {
  test('roundtrips workspace graph data and control edges through canvas projection', () => {
    const graph: WorkflowGraph = {
      id: 'root_canvas',
      version: '0.4.0',
      name: 'Root Canvas',
      nodes: [
        {
          id: 'source_agent',
          callable_ref: { kind: 'agent_class', id: 'fake-agent.generic' },
          kind: 'agent_session',
          label: 'Source Agent',
          input: { user_prompt: 'Collect data' },
          input_mapping: {},
          input_ports: [{ id: 'main', direction: 'input' }],
          output_ports: [{ id: 'main', direction: 'output', required: true }],
          metadata: { ui_label: 'Source Agent' },
        },
        {
          id: 'target_agent',
          callable_ref: { kind: 'agent_class', id: 'fake-agent.generic' },
          kind: 'agent_session',
          label: 'Target Agent',
          input: { user_prompt: 'Analyze data' },
          input_mapping: {},
          input_ports: [{ id: 'main', direction: 'input' }],
          output_ports: [{ id: 'main', direction: 'output', required: true }],
          metadata: { ui_label: 'Target Agent' },
        },
      ],
      edges: [],
      control_edges: [
        {
          id: 'control_source_target',
          from: 'source_agent',
          to: 'target_agent',
          label: 'control',
          condition: null,
          mapping: {},
        },
      ],
      data_edges: [
        {
          id: 'data_source_target_main',
          from: { node: 'source_agent', port: 'main' },
          to: { node: 'target_agent', port: 'main' },
          materialization: 'copy',
          required: true,
        },
      ],
      metadata: { layout: 'workspace-canvas', root_workflow_id: 'target_agent' },
    };

    const canvas = graphToWorkspaceCanvas(graph, null);
    const roundtrip = canvasToWorkflowGraph(canvas);

    expect(canvas.layout).toBe('workspace-canvas');
    expect(canvas.rootWorkflowId).toBe('target_agent');
    expect(canvas.edges).toEqual([
      expect.objectContaining({ id: 'data_source_target_main', kind: 'data' }),
      expect.objectContaining({ id: 'control_source_target', kind: 'control' }),
    ]);
    expect(roundtrip.control_edges).toEqual([
      expect.objectContaining({ id: 'control_source_target', from: 'source_agent', to: 'target_agent' }),
    ]);
    expect(roundtrip.data_edges).toEqual([
      expect.objectContaining({
        id: 'data_source_target_main',
        from: { node: 'source_agent', port: 'main' },
        to: { node: 'target_agent', port: 'main' },
      }),
    ]);
  });

  test('preserves focused workflow exposed ports and boundary metadata without runtime control edges', () => {
    const workflowId = 'focused_workflow';
    const graph: WorkflowGraph = {
      id: workflowId,
      version: '0.4.0',
      name: 'Focused Workflow',
      exposed_inputs: [
        { id: 'target', direction: 'input', required: true },
        { id: 'verified_data', direction: 'input' },
      ],
      exposed_outputs: [
        { id: 'main', direction: 'output', required: true },
        { id: 'evidence_pack', direction: 'output' },
      ],
      nodes: [
        {
          id: 'analysis_agent',
          callable_ref: { kind: 'agent_class', id: 'fake-agent.generic' },
          kind: 'agent_session',
          label: 'Analysis Agent',
          input: { user_prompt: 'Analyze' },
          input_mapping: {},
          input_ports: [
            { id: 'target', direction: 'input' },
            { id: 'verified_data', direction: 'input' },
          ],
          output_ports: [{ id: 'main', direction: 'output' }],
          metadata: { ui_label: 'Analysis Agent' },
        },
      ],
      edges: [],
      control_edges: [],
      data_edges: [],
      metadata: {
        layout: 'workflow-focus',
        workflow_port_edges: [
          {
            id: 'control_inputs_analysis',
            from: workflowInputBoundaryId(workflowId),
            to: 'analysis_agent',
            label: 'control',
            condition: null,
            mapping: {},
          },
          {
            id: 'control_analysis_outputs',
            from: 'analysis_agent',
            to: workflowOutputBoundaryId(workflowId),
            label: 'control',
            condition: null,
            mapping: {},
            boundary_transfer: {
              schema: 'acc.workbench.boundary_transfer.v1',
              direction: 'workflow_output',
              materialization: 'copy',
              inference: 'explicit',
              mappings: [{ source_port: 'main', target_port: 'evidence_pack' }],
            },
          },
        ],
      },
    };

    const canvas = graphToWorkspaceCanvas(graph, null);
    const roundtrip = canvasToWorkflowGraph(canvas);

    expect(canvas.layout).toBe('workflow-focus');
    expect(canvas.workflows.find((workflow) => workflow.boundaryKind === 'workflow_input')?.outputPorts.map((port) => port.id)).toEqual([
      'target',
      'verified_data',
    ]);
    expect(canvas.edges).toEqual([
      expect.objectContaining({ id: 'control_inputs_analysis', kind: 'control' }),
      expect.objectContaining({
        id: 'control_analysis_outputs',
        kind: 'control',
        boundaryTransfer: expect.objectContaining({
          mappings: [{ sourcePort: 'main', targetPort: 'evidence_pack' }],
        }),
      }),
    ]);
    expect(roundtrip.control_edges).toEqual([]);
    expect(roundtrip.workflow_input_bindings).toEqual([
      expect.objectContaining({ source_port: 'target', target: { node: 'analysis_agent', port: 'target' } }),
      expect.objectContaining({ source_port: 'verified_data', target: { node: 'analysis_agent', port: 'verified_data' } }),
    ]);
    expect(roundtrip.workflow_output_bindings).toEqual([
      expect.objectContaining({
        source: { node: 'analysis_agent', port: 'main' },
        target_port: 'evidence_pack',
      }),
    ]);
  });

  test('schema-derived output ports override stale snapshot ports for executable nodes', () => {
    const graph: WorkflowGraph = {
      id: 'root_canvas',
      version: '0.4.0',
      name: 'Root Canvas',
      nodes: [
        {
          id: 'schema_agent',
          callable_ref: { kind: 'agent_class', id: 'fake-agent.generic' },
          kind: 'agent_session',
          label: 'Schema Agent',
          input: { user_prompt: 'Run' },
          input_mapping: {},
          input_ports: [{ id: 'main', direction: 'input' }],
          output_ports: [{ id: 'stale_port', direction: 'output' }],
          output_schema: {
            type: 'object',
            properties: {
              outputs: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  evidence: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
          metadata: { ui_label: 'Schema Agent' },
        },
      ],
      edges: [],
      metadata: { layout: 'workspace-canvas' },
    };

    const canvas = graphToWorkspaceCanvas(graph, null);

    expect(canvas.workflows[0].outputPorts.map((port) => port.id)).toEqual(['main', 'summary', 'evidence']);
    expect(canvas.workflows[0].outputPorts.some((port) => port.id === 'stale_port')).toBe(false);
    expect(
      canvas.workflows[0].outputPorts
        .filter((port) => port.id !== 'main')
        .every((port) => port.projectionSource === 'output_schema'),
    ).toBe(true);
  });
});
