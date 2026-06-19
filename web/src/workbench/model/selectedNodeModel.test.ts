import { describe, expect, test } from 'vitest';

import {
  combinedLogText,
  controlEdgeMainTransferMode,
  effectiveNodeRunDir,
  nodeLiveLogsFor,
  nodeRunForInternalNode,
  nodeRunForWorkflow,
  sameRunDir,
  selectedEntityDetailsModel,
  selectedNodeSettingsModel,
  statusLabel,
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
    expect(sameRunDir('C:\\Runs\\ACC\\Codex\\', 'c:/runs/acc/codex')).toBe(true);
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

  test('builds selected node detail model with live log excerpt and evidence actions', () => {
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
        output_path: 'runs/flow/codex/output.json',
      }),
    ]);
    const settings = selectedNodeSettingsModel({
      canvas,
      selection: { type: 'internal', workflowId, nodeId: 'codex' },
      selectedWorkflow: workflow,
      selectedInternalNode: workflow.internalNodes[0],
      workflowRun: run,
      liveLogs: {
        'flow__internal__codex': {
          stdout: Array.from({ length: 10 }, (_, index) => `line ${index}`).join('\n'),
          stderr: '',
          stdoutOffset: 70,
          stderrOffset: 0,
        },
      },
    });

    const model = selectedEntityDetailsModel({
      canvas,
      selection: { type: 'internal', workflowId, nodeId: 'codex' },
      selectedWorkflow: workflow,
      selectedInternalNode: workflow.internalNodes[0],
      selectedNodeSettings: settings,
      workflowRun: run,
      workflowEvents: [
        { type: 'node_started', node_id: 'codex', node_run_dir: 'runs/flow/codex' },
      ],
      liveLogs: {},
      runtimeConfig: null,
    });

    expect(model.kind).toBe('internal-node');
    expect(model.status).toBe('success');
    expect(model.log.excerpt).toContain('line 9');
    expect(model.log.excerpt).not.toContain('line 0');
    expect(model.events).toHaveLength(1);
    expect(model.evidenceActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'output.json', path: 'runs/flow/codex/output.json' }),
      ]),
    );
    expect(combinedLogText(model.log)).toContain('[stdout]');
  });

  test('builds selected edge detail model without losing explicit data edge priority', () => {
    const controlEdge: WorkflowCanvasEdge = {
      id: 'control_source_target',
      kind: 'control',
      source: { workflowId: 'source_agent' },
      target: { workflowId: 'target_agent' },
    };
    const canvas: WorkspaceCanvasModel = {
      id: 'canvas',
      name: 'Canvas',
      rootWorkflowId: 'source_agent',
      workflows: [rootAgent('source_agent'), rootAgent('target_agent')],
      edges: [
        controlEdge,
        {
          id: 'data_source_target',
          kind: 'data',
          source: { workflowId: 'source_agent', portId: 'main' },
          target: { workflowId: 'target_agent', portId: 'main' },
          materialization: 'copy',
        },
      ],
    };

    expect(controlEdgeMainTransferMode(canvas, null, controlEdge).reason).toContain('Data Edge');

    const model = selectedEntityDetailsModel({
      canvas,
      selection: { type: 'edge', id: controlEdge.id, scopeWorkflowId: null },
      selectedEdge: controlEdge,
      workflowRun: workflowRun([]),
      workflowEvents: [],
      liveLogs: {},
      runtimeConfig: null,
    });
    const rows = model.properties[0].rows;

    expect(model.kind).toBe('edge');
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'source', value: 'source_agent' }),
        expect.objectContaining({ label: 'target', value: 'target_agent' }),
        expect.objectContaining({ label: 'kind', value: 'control' }),
      ]),
    );
  });

  test('builds canvas and workflow detail models from pure run state', () => {
    const workflow = inlineWorkflow('flow');
    const canvas: WorkspaceCanvasModel = {
      id: 'canvas',
      name: 'Canvas',
      rootWorkflowId: 'flow',
      workflows: [workflow],
      edges: [],
    };
    const run = workflowRun([
      nodeRun({ node_id: 'flow', ui_node_id: 'flow', run_dir: 'runs/root/flow' }),
    ]);

    const canvasModel = selectedEntityDetailsModel({
      canvas,
      selection: { type: 'task_canvas', taskId: 'canvas' },
      workflowRun: run,
      workflowEvents: [],
      liveLogs: {},
      runtimeConfig: { real_external_agents_enabled: false } as never,
      currentTask: { taskId: 'canvas', title: 'Task Canvas', status: 'running' } as never,
    });
    const workflowModel = selectedEntityDetailsModel({
      canvas,
      selection: { type: 'workflow', id: 'flow' },
      selectedWorkflow: workflow,
      workflowRun: run,
      workflowEvents: [],
      liveLogs: {},
      runtimeConfig: null,
      binding: { workspace_root: 'F:/workspace' } as never,
    });

    expect(statusLabel('running')).toBe('运行中');
    expect(canvasModel.kind).toBe('canvas');
    expect(canvasModel.title).toBe('Task Canvas');
    expect(workflowModel.kind).toBe('workflow');
    expect(workflowModel.properties[0].rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '目录', value: 'F:/workspace' }),
      ]),
    );
  });
});
