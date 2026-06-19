import { describe, expect, test } from 'vitest';

import type { WorkflowContainerModel, WorkflowPortView, WorkspaceCanvasModel } from '../../types/workbench';
import {
  addPortToDataConnectNode,
  canvasEdgesAreEquivalent,
  commitResolvedConnection,
  connectionCandidatesFromPendingEndpoint,
  connectionFromPendingEndpoint,
  createDataEdgeCommand,
  dataConnectEdges,
  deletePortFromDataConnectNode,
  edgeDiagnosticsForCanvasEdge,
  renamePortOnDataConnectNode,
  resolveScopedConnection,
  reverseConnection,
} from './canvasEdgeOps';
import { internalFlowNodeId } from './workflowNodeModel';

function port(id: string, direction: 'input' | 'output', cardinality = 'one'): WorkflowPortView {
  return {
    id,
    label: id,
    direction,
    cardinality,
    required: id === 'main',
    artifactTypes: ['artifact'],
  };
}

function rootNode(
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

function rootAgent(id: string): WorkflowContainerModel {
  return {
    ...rootNode(id),
    sourceKind: 'agent_session',
    callableId: 'fake-agent.generic',
  };
}

function canvasFixture(): WorkspaceCanvasModel {
  return {
    id: 'task',
    name: 'Task',
    layout: 'workspace-canvas',
    rootWorkflowId: 'task',
    workflows: [
      rootAgent('source_agent'),
      rootNode('source_flow'),
      rootNode('target_flow', [port('main', 'input'), port('evidence', 'input')]),
      rootAgent('target_agent'),
      {
        ...rootNode('inline_flow', [port('main', 'input')], [port('main', 'output')]),
        internalNodes: [
          {
            id: 'codex',
            name: 'Codex',
            task: 'agent',
            kind: 'Agent',
            status: 'not_run',
            inputPorts: [port('main', 'input')],
            outputPorts: [port('main', 'output')],
          },
          {
            id: 'reviewer',
            name: 'Reviewer',
            task: 'agent',
            kind: 'Agent',
            status: 'not_run',
            inputPorts: [port('main', 'input')],
            outputPorts: [port('main', 'output')],
          },
        ],
      },
    ],
    edges: [],
  };
}

describe('canvasEdgeOps', () => {
  test('rejects newly-created non-boundary main-to-main data edges', () => {
    expect(() =>
      createDataEdgeCommand(canvasFixture(), {
        scopeWorkflowId: null,
        sourceNodeId: 'source_agent',
        sourcePortId: 'main',
        targetNodeId: 'target_flow',
        targetPortId: 'main',
        materialization: 'copy',
      }),
    ).toThrow(/Data Edge/u);
  });

  test('keeps imported explicit main-to-main data edges visible to model projections', () => {
    const importedEdge = {
      id: 'data_imported_main',
      kind: 'data' as const,
      source: { workflowId: 'source_agent', portId: 'main' },
      target: { workflowId: 'target_flow', portId: 'main' },
      materialization: 'copy' as const,
    };
    const canvas = { ...canvasFixture(), edges: [importedEdge] };

    expect(dataConnectEdges(canvas, null)).toContain(importedEdge);
    expect(canvasEdgesAreEquivalent(importedEdge, { ...importedEdge, id: 'different_id' })).toBe(true);
  });

  test('creates data edge to explicit target port and auto-adds control dependency', () => {
    const result = createDataEdgeCommand(canvasFixture(), {
      scopeWorkflowId: null,
      sourceNodeId: 'source_agent',
      sourcePortId: 'main',
      targetNodeId: 'target_flow',
      targetPortId: 'evidence',
      materialization: 'copy',
    });

    expect(result.autoAddedControlEdge).toBe(true);
    expect(result.canvas.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'data',
          source: { workflowId: 'source_agent', portId: 'main' },
          target: { workflowId: 'target_flow', portId: 'evidence' },
        }),
        expect.objectContaining({
          kind: 'control',
          source: { workflowId: 'source_agent' },
          target: { workflowId: 'target_flow' },
        }),
      ]),
    );
  });

  test('allows workflow input boundary main fan-out without runtime control fallback', () => {
    const first = createDataEdgeCommand(canvasFixture(), {
      scopeWorkflowId: 'inline_flow',
      sourceNodeId: 'inline_flow__workflow_inputs',
      sourcePortId: 'main',
      targetNodeId: 'codex',
      targetPortId: 'main',
      materialization: 'copy',
    });
    const second = createDataEdgeCommand(first.canvas, {
      scopeWorkflowId: 'inline_flow',
      sourceNodeId: 'inline_flow__workflow_inputs',
      sourcePortId: 'main',
      targetNodeId: 'reviewer',
      targetPortId: 'main',
      materialization: 'copy',
    });
    const workflow = second.canvas.workflows.find((item) => item.id === 'inline_flow');

    expect(first.autoAddedControlEdge).toBe(false);
    expect(second.autoAddedControlEdge).toBe(false);
    expect(workflow?.internalEdges.filter((edge) => edge.kind === 'data')).toHaveLength(2);
    expect(workflow?.internalEdges.some((edge) => edge.kind === 'control')).toBe(false);
  });

  test('reuses duplicate workflow output binding from the same source node', () => {
    const first = createDataEdgeCommand(canvasFixture(), {
      scopeWorkflowId: 'inline_flow',
      sourceNodeId: 'codex',
      sourcePortId: 'main',
      targetNodeId: 'inline_flow__workflow_outputs',
      targetPortId: 'main',
      materialization: 'copy',
    });
    const second = createDataEdgeCommand(first.canvas, {
      scopeWorkflowId: 'inline_flow',
      sourceNodeId: 'codex',
      sourcePortId: 'main',
      targetNodeId: 'inline_flow__workflow_outputs',
      targetPortId: 'main',
      materialization: 'copy',
    });
    const workflow = second.canvas.workflows.find((item) => item.id === 'inline_flow');

    expect(second.edge).toEqual(first.edge);
    expect(workflow?.internalEdges).toHaveLength(1);
  });

  test('rejects one-cardinality target conflicts unless replaceExisting is set', () => {
    const first = createDataEdgeCommand(canvasFixture(), {
      scopeWorkflowId: null,
      sourceNodeId: 'source_agent',
      sourcePortId: 'main',
      targetNodeId: 'target_flow',
      targetPortId: 'evidence',
      materialization: 'copy',
    });

    expect(() =>
      createDataEdgeCommand(first.canvas, {
        scopeWorkflowId: null,
        sourceNodeId: 'source_flow',
        sourcePortId: 'main',
        targetNodeId: 'target_flow',
        targetPortId: 'evidence',
        materialization: 'copy',
      }),
    ).toThrow(/已有 data edge/u);

    const replaced = createDataEdgeCommand(first.canvas, {
      scopeWorkflowId: null,
      sourceNodeId: 'source_flow',
      sourcePortId: 'main',
      targetNodeId: 'target_flow',
      targetPortId: 'evidence',
      materialization: 'copy',
      replaceExisting: true,
    });
    expect(replaced.canvas.edges.filter((edge) => edge.kind === 'data')).toHaveLength(1);
    expect(replaced.edge.source.workflowId).toBe('source_flow');
  });

  test('renames ports through connected data edges and blocks deleting connected ports', () => {
    const withSourcePort = addPortToDataConnectNode(canvasFixture(), null, 'source_agent', 'output', 'summary');
    const withTargetPort = addPortToDataConnectNode(withSourcePort, null, 'target_flow', 'input', 'research_input');
    const connected = createDataEdgeCommand(withTargetPort, {
      scopeWorkflowId: null,
      sourceNodeId: 'source_agent',
      sourcePortId: 'summary',
      targetNodeId: 'target_flow',
      targetPortId: 'research_input',
      materialization: 'copy',
    });

    const renamed = renamePortOnDataConnectNode(
      connected.canvas,
      null,
      'source_agent',
      'output',
      'summary',
      'final_summary',
    );
    expect(renamed.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'data',
          source: { workflowId: 'source_agent', portId: 'final_summary' },
        }),
      ]),
    );
    expect(() =>
      deletePortFromDataConnectNode(renamed, null, 'source_agent', 'output', 'final_summary'),
    ).toThrow(/仍有 data edge/u);
  });

  test('reports dangling data edge source and target diagnostics', () => {
    const diagnostics = edgeDiagnosticsForCanvasEdge(canvasFixture(), null, {
      id: 'data_missing',
      kind: 'data',
      source: { workflowId: 'source_agent', portId: 'missing_output' },
      target: { workflowId: 'target_flow', portId: 'missing_input' },
      materialization: 'copy',
    });

    expect(diagnostics.map((item) => item.code)).toEqual([
      'dangling_data_edge_source',
      'dangling_data_edge_target',
    ]);
  });

  test('resolves root control connections and rejects slot overflow while preserving equivalent edges', () => {
    const targets = Array.from({ length: 11 }, (_value, index) => rootAgent(`target_${index + 1}`));
    const canvas = {
      ...canvasFixture(),
      workflows: [rootAgent('source_agent'), ...targets],
      edges: targets.slice(0, 10).map((target) => ({
        id: `control_source_agent_${target.id}`,
        kind: 'control' as const,
        source: { workflowId: 'source_agent' },
        target: { workflowId: target.id },
      })),
    };

    expect(
      resolveScopedConnection(
        canvas,
        {
          source: 'source_agent',
          target: 'target_11',
          sourceToken: 'source_agent:control:source',
          targetToken: 'target_11:control:target',
        },
        'control',
      ),
    ).toEqual({ accepted: false, reason: expect.stringContaining('slot 已满') });

    expect(
      resolveScopedConnection(
        canvas,
        {
          source: 'source_agent',
          target: 'target_10',
          sourceToken: 'source_agent:control:source',
          targetToken: 'target_10:control:target',
        },
        'control',
      ),
    ).toEqual(expect.objectContaining({ accepted: true }));
  });

  test('resolves workflow input inner control to internal boundary binding', () => {
    const resolved = resolveScopedConnection(
      canvasFixture(),
      {
        source: 'inline_flow',
        target: internalFlowNodeId('inline_flow', 'codex'),
        sourceToken: 'inline_flow:workflow-input-inner-source',
        targetToken: null,
      },
      'control',
    );

    expect(resolved).toEqual(
      expect.objectContaining({
        accepted: true,
        semantic: 'workflow_input_main_binding',
        scopeWorkflowId: 'inline_flow',
        edge: expect.objectContaining({
          kind: 'control',
          source: { workflowId: 'inline_flow__workflow_inputs' },
          target: { workflowId: 'codex' },
        }),
      }),
    );
  });

  test('recovers reversed pending workflow input connection candidates', () => {
    const candidates = connectionCandidatesFromPendingEndpoint(
      {
        nodeId: 'inline_flow',
        handleId: 'inline_flow:workflow-input-inner-source',
        mode: 'control',
        side: 'target',
        endpoint: {
          view: 'root-shell',
          role: 'workflow_inner_input',
          nodeId: 'inline_flow',
          workflowId: 'inline_flow',
          portId: 'main',
          handleId: 'inline_flow:workflow-input-inner-source',
        },
      },
      {
        source: internalFlowNodeId('inline_flow', 'codex'),
        sourceToken: null,
        target: 'inline_flow',
        targetToken: 'inline_flow:workflow-input-inner-source',
      },
    );
    const accepted = candidates
      .map((candidate) => resolveScopedConnection(canvasFixture(), candidate, 'control'))
      .find((candidate) => candidate.accepted);

    expect(connectionFromPendingEndpoint(
      {
        nodeId: 'inline_flow',
        handleId: 'inline_flow:workflow-input-inner-source',
        mode: 'control',
        side: 'source',
      },
      {
        nodeId: internalFlowNodeId('inline_flow', 'codex'),
        handleId: null,
        side: 'target',
      },
    )).toEqual({
      source: 'inline_flow',
      sourceToken: 'inline_flow:workflow-input-inner-source',
      target: internalFlowNodeId('inline_flow', 'codex'),
      targetToken: null,
    });
    expect(accepted).toEqual(
      expect.objectContaining({
        accepted: true,
        semantic: 'workflow_input_main_binding',
        scopeWorkflowId: 'inline_flow',
      }),
    );
  });

  test('rejects cross-scope data connections and commits accepted scoped control edges', () => {
    expect(
      resolveScopedConnection(
        canvasFixture(),
        {
          source: internalFlowNodeId('inline_flow', 'codex'),
          sourceToken: 'codex:output:main',
          target: 'target_agent',
          targetToken: 'target_agent:input:main',
        },
        'data',
      ),
    ).toEqual({ accepted: false, reason: 'Data Edge 必须连接同一层级内的节点' });

    const reversed = reverseConnection({
      source: internalFlowNodeId('inline_flow', 'codex'),
      sourceToken: null,
      target: 'inline_flow',
      targetToken: 'inline_flow:workflow-input-inner-source',
    });
    const resolved = resolveScopedConnection(canvasFixture(), reversed || {}, 'control');
    expect(resolved).toEqual(expect.objectContaining({ accepted: true }));
    if (!resolved.accepted) {
      throw new Error('expected accepted scoped connection');
    }
    const committed = commitResolvedConnection(canvasFixture(), resolved);
    const workflow = committed.canvas.workflows.find((item) => item.id === 'inline_flow');

    expect(workflow?.internalEdges).toEqual([
      expect.objectContaining({
        kind: 'control',
        source: { workflowId: 'inline_flow__workflow_inputs' },
        target: { workflowId: 'codex' },
      }),
    ]);
  });
});
