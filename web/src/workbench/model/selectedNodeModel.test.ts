import { describe, expect, test } from 'vitest';

import {
  effectiveNodeRunDir,
  nodeLiveLogsFor,
  nodeRunForInternalNode,
  nodeRunForWorkflow,
  selectedNodeSettingsModel,
  workflowMainInputBindingState,
} from './selectedNodeModel';
import { port } from './workflowGraphProjection';
import { workflowInputBoundaryId } from './workflowNodeModel';
import type { NodeRunSummary, WorkflowRunResult } from '../../types';
import type {
  InternalNodeView,
  WorkflowCanvasEdge,
  WorkflowContainerModel,
  WorkspaceCanvasModel,
} from '../../types/workbench';

function nodeRun(partial: Partial<NodeRunSummary>): NodeRunSummary {
  return {
    node_id: 'node',
    status: 'success',
    run_dir: '',
    ...partial,
  } as NodeRunSummary;
}

function workflowRun(nodes: NodeRunSummary[]): WorkflowRunResult {
  return {
    workflow_id: 'canvas',
    status: 'success',
    run_dir: 'runs/root',
    nodes,
    edges: [],
    errors: [],
  };
}

function rootAgent(id: string): WorkflowContainerModel {
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

function internalAgent(id: string): InternalNodeView {
  return {
    id,
    name: id,
    task: `Run ${id}`,
    kind: 'Agent',
    status: 'not_run',
    callableId: 'fake-agent.generic',
    inputPorts: [port('main', 'input', 'input')],
    outputPorts: [port('main', 'output', 'output', true)],
  };
}

function inlineWorkflow(id: string, edges: WorkflowCanvasEdge[] = []): WorkflowContainerModel {
  return {
    id,
    title: id,
    directory: `workflows/${id}`,
    sourceKind: 'workflow',
    workflowBodyKind: 'inline_container',
    status: 'not_run',
    inputPorts: [port('main', 'input', 'input')],
    outputPorts: [port('main', 'output', 'output', true)],
    internalNodes: [internalAgent('codex')],
    internalEdges: edges,
    position: { x: 0, y: 0 },
    size: { width: 480, height: 320 },
    warnings: [],
  };
}

describe('selectedNodeModel', () => {
  test('matches root and internal node runs deterministically', () => {
    const root = rootAgent('source_agent');
    const run = workflowRun([
      nodeRun({ node_id: 'source_agent', ui_node_id: 'source_agent', run_dir: 'runs/root/source' }),
      nodeRun({
        node_id: 'codex',
        ui_node_id: 'flow__internal__codex',
        parent_node_id: 'flow',
        run_dir: 'runs/root/flow/codex',
      }),
    ]);

    expect(nodeRunForWorkflow(run, root)?.run_dir).toBe('runs/root/source');
    expect(nodeRunForInternalNode(run, 'flow', 'codex')?.run_dir).toBe('runs/root/flow/codex');
  });

  test('matches node run by node scope fallback context', () => {
    const run = workflowRun([
      nodeRun({ node_id: 'codex', run_dir: 'runs/node-only/codex' }),
    ]);

    expect(
      nodeRunForInternalNode(run, 'flow', 'codex', {
        scope: 'node',
        targetId: 'codex',
        parentWorkflowId: 'flow',
      })?.run_dir,
    ).toBe('runs/node-only/codex');
  });

  test('normalizes run directory keys when finding live logs', () => {
    const run = nodeRun({
      node_id: 'codex',
      run_dir: 'C:\\Runs\\ACC\\Codex\\',
    }) as NodeRunSummary & { effective_run_dir?: string };
    run.effective_run_dir = 'C:\\Runs\\ACC\\Codex\\';

    expect(effectiveNodeRunDir(run)).toBe('C:\\Runs\\ACC\\Codex\\');
    expect(
      nodeLiveLogsFor(
        {
          'c:/runs/acc/codex': {
            stdout: 'ok',
            stderr: '',
            stdoutOffset: 2,
            stderrOffset: 0,
          },
        },
        run,
      )?.stdout,
    ).toBe('ok');
  });

  test('reports workflow main input binding state for boundary control and data edges', () => {
    const workflowId = 'flow';
    const inputBoundaryId = workflowInputBoundaryId(workflowId);
    const controlCanvas: WorkspaceCanvasModel = {
      id: 'canvas',
      name: 'Canvas',
      rootWorkflowId: workflowId,
      workflows: [
        inlineWorkflow(workflowId, [
          {
            id: 'control_inputs_codex',
            kind: 'control',
            source: { workflowId: inputBoundaryId },
            target: { workflowId: 'codex' },
          },
        ]),
      ],
      edges: [],
    };
    const dataCanvas: WorkspaceCanvasModel = {
      ...controlCanvas,
      workflows: [
        inlineWorkflow(workflowId, [
          {
            id: 'data_inputs_codex',
            kind: 'data',
            source: { workflowId: inputBoundaryId, portId: 'main' },
            target: { workflowId: 'codex', portId: 'main' },
            materialization: 'copy',
          },
        ]),
      ],
    };

    expect(workflowMainInputBindingState(controlCanvas, workflowId, 'codex')).toEqual(
      expect.objectContaining({ status: 'bound', edgeId: 'control_inputs_codex' }),
    );
    expect(workflowMainInputBindingState(dataCanvas, workflowId, 'codex')).toEqual(
      expect.objectContaining({ status: 'bound', edgeId: 'data_inputs_codex' }),
    );
  });

  test('builds selected internal node settings with run, logs, and workflow input binding', () => {
    const workflowId = 'flow';
    const workflow = inlineWorkflow(workflowId, [
      {
        id: 'control_inputs_codex',
        kind: 'control',
        source: { workflowId: workflowInputBoundaryId(workflowId) },
        target: { workflowId: 'codex' },
      },
    ]);
    const canvas: WorkspaceCanvasModel = {
      id: 'canvas',
      name: 'Canvas',
      rootWorkflowId: workflowId,
      workflows: [workflow],
      edges: [],
    };
    const run = workflowRun([
      nodeRun({
        node_id: 'codex',
        ui_node_id: 'flow__internal__codex',
        parent_node_id: workflowId,
        run_dir: 'runs/flow/codex',
      }),
    ]);

    const model = selectedNodeSettingsModel({
      canvas,
      selection: { type: 'internal', workflowId, nodeId: 'codex' },
      selectedWorkflow: workflow,
      selectedInternalNode: workflow.internalNodes[0],
      workflowRun: run,
      liveLogs: {
        'flow__internal__codex': {
          stdout: 'hello',
          stderr: '',
          stdoutOffset: 5,
          stderrOffset: 0,
        },
      },
    });

    expect(model).toEqual(
      expect.objectContaining({
        nodeId: 'codex',
        status: 'success',
        logs: expect.objectContaining({ stdout: 'hello' }),
        workflowMainInputBinding: expect.objectContaining({ edgeId: 'control_inputs_codex' }),
      }),
    );
    expect(model?.preview).toEqual(expect.objectContaining({ input_bindings: {} }));
  });
});
