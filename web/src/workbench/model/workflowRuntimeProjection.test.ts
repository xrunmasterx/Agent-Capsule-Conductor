import { describe, expect, test } from 'vitest';

import type { NodeRunSummary, WorkflowDetail, WorkflowGraph } from '../../types';
import type { InternalNodeView } from '../../types/workbench';
import {
  graphFromLegacyWorkflow,
  nodeRunProjectionKey,
  reusableWorkflowClassGraph,
  singleNodeWorkflowGraph,
  workflowRunFromRunStateSnapshot,
  workflowRunFromRunSummary,
} from './workflowRuntimeProjection';

function graphFixture(): WorkflowGraph {
  return {
    id: 'flow',
    version: '0.4.0',
    nodes: [
      {
        id: 'agent',
        callable_ref: { kind: 'agent_class', id: 'fake-agent.generic' },
        relative_cwd: 'runs/agent',
        ui: {
          binding_ref: 'bindings/agent.json',
          internal_nodes: [
            {
              id: 'child',
              status: 'success',
              runId: 'run_1',
              event_log: 'events.jsonl',
              output_path: 'output.json',
              keep: true,
            },
          ],
        },
      },
    ],
    edges: [{ id: 'edge_a_b', from: 'a', to: 'b' }],
    metadata: { binding_ref: 'bindings/flow.json', owner: 'test' },
  };
}

describe('workflowRuntimeProjection', () => {
  test('projects reusable workflow classes without runtime bindings', () => {
    const projected = reusableWorkflowClassGraph(graphFixture());

    expect(projected.workspace_policy).toMatchObject({
      save_mode: 'stateless_template',
      default_state_mode: 'stateless',
    });
    expect(projected.metadata).toEqual({ canonical_format: 'accflow', owner: 'test' });
    expect(projected.nodes[0].relative_cwd).toBeUndefined();
    expect(projected.nodes[0].cwd_policy).toBe('inherit_environment');
    expect(projected.nodes[0].ui?.binding_ref).toBeUndefined();
    expect(projected.nodes[0].ui?.internal_nodes).toEqual([{ id: 'child', keep: true }]);
  });

  test('converts legacy workflow tasks into a deterministic graph', () => {
    const workflow: WorkflowDetail = {
      workflow_id: 'legacy',
      file_id: 'legacy',
      path: 'legacy.yaml',
      workflow: {
        version: '0.2.0',
        tasks: [
          { name: 'collect', command: ['acc', 'run', 'collector.codex'] },
          { name: 'summarize', depends_on: ['collect'], command: ['acc', 'run', 'summary.codex'] },
        ],
      },
    };

    const graph = graphFromLegacyWorkflow(workflow);

    expect(graph.nodes.map((node) => node.id)).toEqual(['collect', 'summarize']);
    expect(graph.nodes[0].callable_ref.id).toBe('collector.codex');
    expect(graph.edges).toEqual([
      { id: 'edge_collect_summarize', from: 'collect', to: 'summarize', label: '依赖', mapping: {}, condition: null },
    ]);
  });

  test('projects run summaries and state snapshots onto the current graph edges', () => {
    const graph = graphFixture();
    const node: NodeRunSummary = {
      node_id: 'agent',
      callable_id: 'fake-agent.generic',
      status: 'success',
      run_dir: 'runs/agent',
    };

    expect(
      workflowRunFromRunSummary(
        {
          run_id: 'run_1',
          workflow_id: '',
          status: 'success',
          run_dir: 'runs/run_1',
          node_count: 1,
          failed_nodes: [],
          nodes: [node],
        },
        graph,
      ),
    ).toMatchObject({ workflow_id: 'flow', edges: graph.edges, nodes: [node] });

    expect(
      workflowRunFromRunStateSnapshot(
        {
          workflow_id: '',
          status: 'success',
          run_dir: 'runs/run_1',
          nodes: [],
          edges: [],
        },
        graph,
      ),
    ).toMatchObject({ workflow_id: 'flow', edges: graph.edges, nodes: [] });
  });

  test('builds single-node graphs and node projection keys', () => {
    const node: InternalNodeView = {
      id: 'agent',
      name: 'Agent',
      task: 'Run agent',
      kind: 'Agent',
      status: 'success',
      callableId: 'fake-agent.generic',
    };

    const graph = singleNodeWorkflowGraph(node, 'owner');

    expect(graph.id).toBe('owner_agent_single_node');
    expect(graph.nodes[0]).toMatchObject({ id: 'agent', kind: 'agent_session' });
    expect(graph.nodes[0].metadata?.status).toBeUndefined();
    expect(nodeRunProjectionKey({ node_id: 'agent', callable_id: 'fake', status: 'success', run_dir: '' })).toBe('agent');
    expect(
      nodeRunProjectionKey({
        node_id: 'agent',
        parent_node_id: 'flow',
        callable_id: 'fake',
        status: 'success',
        run_dir: '',
      }),
    ).toBe('flow__internal__agent');
  });
});
