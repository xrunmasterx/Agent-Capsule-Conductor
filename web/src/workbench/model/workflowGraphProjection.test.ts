import { describe, expect, test } from 'vitest';

import {
  canvasToWorkflowGraph,
  edgeCanonicalPreview,
  internalWorkflowToGraph,
  port,
  workflowInvocationPreview,
} from './workflowGraphProjection';
import {
  workflowInputBoundaryId,
  workflowOutputBoundaryId,
} from './workflowNodeModel';
import type {
  InternalNodeView,
  WorkflowCanvasEdge,
  WorkflowContainerModel,
  WorkspaceCanvasModel,
} from '../../types/workbench';

function agentWorkflow(id: string): WorkflowContainerModel {
  return {
    id,
    title: id,
    directory: `agents/${id}`,
    sourceKind: 'agent_session',
    callableId: 'fake-agent.generic',
    status: 'not_run',
    sourceInput: { user_prompt: `Run ${id}` },
    inputPorts: [port('main', 'input', 'input')],
    outputPorts: [port('main', 'output', 'output', true)],
    internalNodes: [],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 220, height: 120 },
    warnings: [],
  };
}

function internalAgent(id: string, inputPortIds = ['main'], outputPortIds = ['main']): InternalNodeView {
  return {
    id,
    name: id,
    task: `Run ${id}`,
    kind: 'Agent',
    status: 'not_run',
    callableId: 'fake-agent.generic',
    inputPorts: inputPortIds.map((portId) => port(portId, portId, 'input')),
    outputPorts: outputPortIds.map((portId) => port(portId, portId, 'output', true)),
  };
}

function inlineWorkflow(
  id: string,
  internalEdges: WorkflowCanvasEdge[],
  internalNodes: InternalNodeView[] = [internalAgent('analysis_agent')],
): WorkflowContainerModel {
  return {
    id,
    title: id,
    directory: `workflows/${id}`,
    sourceKind: 'workflow',
    workflowBodyKind: 'inline_container',
    status: 'not_run',
    inputPorts: [port('target', 'target', 'input'), port('verified_data', 'verified data', 'input')],
    outputPorts: [port('main', 'main', 'output', true), port('evidence_pack', 'evidence', 'output', true)],
    internalNodes,
    internalEdges,
    position: { x: 320, y: 0 },
    size: { width: 640, height: 420 },
    warnings: [],
  };
}

describe('workflowGraphProjection', () => {
  test('keeps explicit root data edges as runtime data_edges', () => {
    const canvas: WorkspaceCanvasModel = {
      id: 'canvas',
      name: 'Canvas',
      rootWorkflowId: 'target_agent',
      workflows: [agentWorkflow('source_agent'), agentWorkflow('target_agent')],
      edges: [
        {
          id: 'control_source_target',
          kind: 'control',
          source: { workflowId: 'source_agent' },
          target: { workflowId: 'target_agent' },
        },
        {
          id: 'data_source_target_main',
          kind: 'data',
          source: { workflowId: 'source_agent', portId: 'main' },
          target: { workflowId: 'target_agent', portId: 'main' },
          materialization: 'copy',
        },
      ],
    };

    const graph = canvasToWorkflowGraph(canvas);

    expect(graph.control_edges).toEqual([
      expect.objectContaining({ id: 'control_source_target', from: 'source_agent', to: 'target_agent' }),
    ]);
    expect(graph.data_edges).toEqual([
      expect.objectContaining({
        id: 'data_source_target_main',
        from: { node: 'source_agent', port: 'main' },
        to: { node: 'target_agent', port: 'main' },
      }),
    ]);
  });

  test('compiles workflow boundary control edges into boundary bindings', () => {
    const workflowId = 'fundamentals';
    const inputBoundaryId = workflowInputBoundaryId(workflowId);
    const outputBoundaryId = workflowOutputBoundaryId(workflowId);
    const workflow = inlineWorkflow(
      workflowId,
      [
        {
          id: 'control_inputs_analysis',
          kind: 'control',
          source: { workflowId: inputBoundaryId },
          target: { workflowId: 'analysis_agent' },
        },
        {
          id: 'control_analysis_outputs',
          kind: 'control',
          source: { workflowId: 'analysis_agent' },
          target: { workflowId: outputBoundaryId },
          boundaryTransfer: {
            direction: 'workflow_output',
            materialization: 'copy',
            inference: 'explicit',
            mappings: [{ sourcePort: 'main', targetPort: 'evidence_pack' }],
          },
        },
      ],
      [internalAgent('analysis_agent', ['target', 'verified_data'], ['main'])],
    );

    const graph = internalWorkflowToGraph(workflow);

    expect(graph.control_edges).toEqual([]);
    expect(graph.workflow_input_bindings).toEqual([
      expect.objectContaining({
        source_port: 'target',
        target: { node: 'analysis_agent', port: 'target' },
      }),
      expect.objectContaining({
        source_port: 'verified_data',
        target: { node: 'analysis_agent', port: 'verified_data' },
      }),
    ]);
    expect(graph.workflow_output_bindings).toEqual([
      expect.objectContaining({
        source: { node: 'analysis_agent', port: 'main' },
        target_port: 'evidence_pack',
      }),
    ]);
    expect(graph.metadata?.workflow_port_edges).toHaveLength(2);
  });

  test('edge preview treats data edge control dependencies and boundary controls separately', () => {
    const dataEdge: WorkflowCanvasEdge = {
      id: 'data_source_target_main',
      kind: 'data',
      source: { workflowId: 'source_agent', portId: 'main' },
      target: { workflowId: 'target_agent', portId: 'main' },
      materialization: 'copy',
    };
    const canvas: WorkspaceCanvasModel = {
      id: 'canvas',
      name: 'Canvas',
      rootWorkflowId: 'target_agent',
      workflows: [agentWorkflow('source_agent'), agentWorkflow('target_agent')],
      edges: [
        {
          id: 'control_source_target',
          kind: 'control',
          source: { workflowId: 'source_agent' },
          target: { workflowId: 'target_agent' },
        },
        dataEdge,
      ],
    };

    expect(edgeCanonicalPreview(dataEdge, canvas)).toEqual(
      expect.objectContaining({
        auto_added_control_edge: false,
        data_edge: expect.objectContaining({
          source: { node: 'source_agent', port: 'main' },
          target: { node: 'target_agent', port: 'main' },
        }),
      }),
    );

    const boundaryEdge: WorkflowCanvasEdge = {
      id: 'control_inputs_target',
      kind: 'control',
      source: { workflowId: workflowInputBoundaryId('workflow') },
      target: { workflowId: 'target_agent' },
    };
    const boundaryCanvas: WorkspaceCanvasModel = {
      id: 'workflow',
      name: 'Workflow',
      layout: 'workflow-focus',
      focusedWorkflowId: 'workflow',
      rootWorkflowId: 'workflow',
      workflows: [
        {
          ...agentWorkflow(workflowInputBoundaryId('workflow')),
          boundaryKind: 'workflow_input',
          outputPorts: [port('main', 'main', 'output')],
        },
        agentWorkflow('target_agent'),
        {
          ...agentWorkflow(workflowOutputBoundaryId('workflow')),
          boundaryKind: 'workflow_output',
          inputPorts: [port('main', 'main', 'input')],
          outputPorts: [],
        },
      ],
      edges: [boundaryEdge],
    };

    expect(edgeCanonicalPreview(boundaryEdge, boundaryCanvas)).toEqual(
      expect.objectContaining({
        runtime_control_edge: false,
        workflow_input_bindings: [
          expect.objectContaining({
            source_port: 'main',
            target: { node: 'target_agent', port: 'main' },
          }),
        ],
      }),
    );
  });

  test('workflow invocation preview separates prompt and static input', () => {
    const workflow = {
      ...agentWorkflow('source_agent'),
      sourceInput: {
        user_prompt: 'Research NVDA',
        ticker: 'NVDA',
      },
      sourceInputMapping: { target: 'upstream.target' },
      codexExecutionMode: 'danger_full_access' as const,
    };

    expect(workflowInvocationPreview(workflow)).toEqual(
      expect.objectContaining({
        prompt_policy: { user_prompt: 'Research NVDA' },
        overrides: { static_input: { ticker: 'NVDA' } },
        input_bindings: { target: 'upstream.target' },
        invocation_policy: expect.objectContaining({
          permission_profile: expect.objectContaining({ workspace_access: 'writes_workspace' }),
        }),
      }),
    );
  });
});
