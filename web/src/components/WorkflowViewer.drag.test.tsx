import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { AgentToolNode as _AgentToolNode } from './canvas/NodeRenderer';
import { WorkspaceCanvas as _WorkspaceCanvas } from './canvas/WorkspaceCanvas';
import { canvasEdgeToFlowEdge as _canvasEdgeToFlowEdge } from './canvas/flowProjection';
import { canvasToWorkflowGraph as _canvasToWorkflowGraph } from '../workbench/model/workflowGraphProjection';
import { edgeCanonicalPreview as _edgeCanonicalPreview } from '../workbench/model/workflowGraphProjection';
import {
  addPortToDataConnectNode as _addPortToDataConnectNode,
  connectionCandidatesFromPendingEndpoint as _connectionCandidatesFromPendingEndpoint,
  connectionFromPendingEndpoint as _connectionFromPendingEndpoint,
  createDataEdgeCommand as _createDataEdgeCommand,
  resolveScopedConnection as _resolveScopedConnection,
  reverseConnection as _reverseConnection,
} from '../workbench/model/canvasEdgeOps';
import { isConnectionHandleForMode as _isConnectionHandleForMode } from './canvas/connectionDom';
import { outputPortsFromSchema as _outputPortsFromSchema } from '../workbench/model/schemaPorts';
import {
  deleteSelectionFromCanvas as _deleteSelectionFromCanvas,
  normalizeSelectionIntent as _normalizeSelectionIntent,
} from '../workbench/model/selectionModel';
import {
  nodeRunHasWorkflowInputBinding as _nodeRunHasWorkflowInputBinding,
  workflowMainInputBindingState as _workflowMainInputBindingState,
} from '../workbench/model/selectedNodeModel';
import {
  temporaryResourceIssueForCanvas as _temporaryResourceIssueForCanvas,
  temporaryResourceIssueForGraph as _temporaryResourceIssueForGraph,
} from '../workbench/model/authoringProposal';
import {
  applyRunOverlayToCanvas,
  liveWorkflowRunFromEvents,
  mergeWorkflowRunWithEvents,
  runOverlayFromRun,
} from './workflow-viewer/runState';
import {
  applyCanvasAuthoringProposal as _applyCanvasAuthoringProposal,
  buildDeterministicCanvasAuthoringProposal as _buildDeterministicCanvasAuthoringProposal,
  captureAuthoringSnapshot as _captureAuthoringSnapshot,
  validateCanvasAuthoringProposal as _validateCanvasAuthoringProposal,
} from './authoring/authoringRuntime';

const flowMock = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');
  const react = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    ReactFlow: vi.fn((props: Record<string, unknown>) => {
      flowMock.props = props;
      return react.createElement('div', { 'data-testid': 'react-flow' }, props.children as ReactNode);
    }),
    MiniMap: () => react.createElement('div', { 'data-testid': 'mini-map' }),
    Controls: () => react.createElement('div', { 'data-testid': 'controls' }),
    Background: () => react.createElement('div', { 'data-testid': 'background' }),
    Handle: ({ position, ...props }: Record<string, unknown>) =>
      react.createElement('div', { ...props, 'data-position': position }),
    NodeResizer: () => null,
  };
});

const WorkspaceCanvas = _WorkspaceCanvas as unknown as ComponentType<Record<string, unknown>>;
const AgentToolNode = _AgentToolNode as unknown as ComponentType<Record<string, unknown>>;
const createDataEdgeCommand = _createDataEdgeCommand as unknown as (
  canvas: ReturnType<typeof canvasFixture>,
  request: Record<string, unknown>,
) => { canvas: ReturnType<typeof canvasFixture>; edge: Record<string, unknown>; autoAddedControlEdge: boolean };
const canvasEdgeToFlowEdge = _canvasEdgeToFlowEdge as unknown as (
  edge: Record<string, unknown>,
  scopeWorkflowId: string | null,
  selection: Record<string, unknown>,
  connectionMode: string,
  parentWorkflowId?: string,
  edgeViewMode?: string,
  showDataPorts?: boolean,
  workflowContainerIds?: Set<string>,
) => Array<Record<string, unknown>>;
const resolveScopedConnection = _resolveScopedConnection as unknown as (
  canvas: ReturnType<typeof canvasFixture>,
  connection: Record<string, unknown>,
  connectionMode: string,
) => Record<string, unknown>;
const connectionCandidatesFromPendingEndpoint = _connectionCandidatesFromPendingEndpoint as unknown as (
  pending: Record<string, unknown>,
  connection: Record<string, unknown>,
) => Array<Record<string, unknown>>;
const connectionFromPendingEndpoint = _connectionFromPendingEndpoint as unknown as (
  pending: Record<string, unknown>,
  target: Record<string, unknown> | null,
) => Record<string, unknown> | null;
const reverseConnection = _reverseConnection as unknown as (
  connection: Record<string, unknown>,
) => Record<string, unknown> | null;
const canvasToWorkflowGraph = _canvasToWorkflowGraph as unknown as (
  canvas: Record<string, unknown>,
) => Record<string, unknown>;
const captureAuthoringSnapshot = _captureAuthoringSnapshot as unknown as (input: {
  taskId: string;
  canvas: Record<string, unknown>;
  selection: Record<string, unknown>;
  callables: Array<Record<string, unknown>>;
  workflows: Array<Record<string, unknown>>;
}) => Record<string, unknown>;
const buildDeterministicCanvasAuthoringProposal = _buildDeterministicCanvasAuthoringProposal as unknown as (
  input: { message: string; snapshot: Record<string, unknown> },
) => { proposal: Record<string, unknown> | null; errors: string[]; warnings: string[] };
const applyCanvasAuthoringProposal = _applyCanvasAuthoringProposal as unknown as (input: {
  canvas: Record<string, unknown>;
  taskId: string;
  proposal: Record<string, unknown>;
  temporaryResources: Record<string, unknown>;
  callables: Array<Record<string, unknown>>;
  workflows: Array<Record<string, unknown>>;
}) => { canvas: Record<string, unknown>; temporaryResources: Record<string, unknown>; selection: Record<string, unknown> };
const validateCanvasAuthoringProposal = _validateCanvasAuthoringProposal as unknown as (
  proposal: Record<string, unknown>,
  context: {
    canvas: Record<string, unknown>;
    taskId: string;
    temporaryResources: Record<string, unknown>;
    callables: Array<Record<string, unknown>>;
    workflows: Array<Record<string, unknown>>;
  },
) => { status: string; errors: string[]; warnings: string[] };
const temporaryResourceIssueForCanvas = _temporaryResourceIssueForCanvas as unknown as (
  canvas: Record<string, unknown>,
  authoring?: Record<string, unknown>,
) => string | null;
const temporaryResourceIssueForGraph = _temporaryResourceIssueForGraph as unknown as (
  graph: Record<string, unknown>,
) => string | null;
const deleteSelectionFromCanvas = _deleteSelectionFromCanvas as unknown as (
  canvas: ReturnType<typeof canvasFixture>,
  selection: Record<string, unknown>,
) => ReturnType<typeof canvasFixture>;
const normalizeSelectionIntent = _normalizeSelectionIntent as unknown as (
  visibleCanvas: Record<string, unknown>,
  baseCanvas: Record<string, unknown>,
  intent: Record<string, unknown>,
  focusedWorkflowId: string | null,
) => Record<string, unknown> | null;
const isConnectionHandleForMode = _isConnectionHandleForMode as unknown as (
  handle: HTMLElement,
  mode: string,
) => boolean;
const outputPortsFromSchema = _outputPortsFromSchema as unknown as (
  outputSchema: Record<string, unknown> | undefined,
  fallbackPorts: Array<Record<string, unknown>>,
) => Array<Record<string, unknown>>;
const addPortToDataConnectNode = _addPortToDataConnectNode as unknown as (
  canvas: ReturnType<typeof canvasFixture>,
  scopeWorkflowId: string | null,
  nodeId: string,
  direction: string,
  requestedPortId: string,
) => ReturnType<typeof canvasFixture>;
const workflowMainInputBindingState = _workflowMainInputBindingState as unknown as (
  canvas: ReturnType<typeof canvasFixture>,
  workflowId: string,
  nodeId: string,
) => Record<string, unknown> | undefined;
const nodeRunHasWorkflowInputBinding = _nodeRunHasWorkflowInputBinding as unknown as (
  nodeRun?: Record<string, unknown>,
) => boolean;
const edgeCanonicalPreview = _edgeCanonicalPreview as unknown as (
  edge: Record<string, unknown>,
  canvas?: Record<string, unknown>,
) => Record<string, unknown>;

function workflow(id: string, x: number, y: number, internalNodes: unknown[] = []) {
  return {
    id,
    title: id,
    directory: `workflows/${id}`,
    status: 'not_run',
    inputPorts: [{ id: 'main', label: 'input', direction: 'input' }],
    outputPorts: [{ id: 'main', label: 'output', direction: 'output' }],
    internalNodes,
    internalEdges: [],
    position: { x, y },
    size: { width: 360, height: 260 },
    warnings: [],
  };
}

function agentWorkflow(id: string, x: number, y: number) {
  return {
    ...workflow(id, x, y),
    sourceKind: 'agent',
    callableId: 'fake-agent.generic',
    inputPorts: [{ id: 'main', label: 'input', direction: 'input' }],
    outputPorts: [{ id: 'main', label: 'output', direction: 'output' }],
  };
}

function canvasFixture() {
  return {
    id: 'acc_workspace_canvas',
    name: 'ACC Workspace',
    rootWorkflowId: 'source_flow',
    workflows: [
      workflow('source_flow', 100, 100, [
        {
          id: 'codex',
          name: 'Codex CLI',
          task: 'agent',
          kind: 'Agent',
          status: 'not_run',
          callableId: 'fake-agent.generic',
          position: { x: 40, y: 72 },
        },
      ]),
      workflow('target_flow', 620, 120),
      agentWorkflow('source_agent', 120, 450),
    ],
    edges: [],
  };
}

function focusedWorkflowCanvasFixture(internalEdges: unknown[] = []) {
  return {
    id: 'source_flow',
    name: 'Source Flow',
    layout: 'workflow-focus',
    focusedWorkflowId: 'source_flow',
    rootWorkflowId: 'source_flow',
    workflows: [
      {
        id: 'source_flow__workflow_inputs',
        title: 'Workflow Inputs',
        boundaryKind: 'workflow_input',
        directory: 'Workflow boundary',
        status: 'not_run',
        inputPorts: [],
        outputPorts: [{ id: 'main', label: 'input', direction: 'output' }],
        internalNodes: [],
        internalEdges: [],
        position: { x: 40, y: 250 },
        size: { width: 120, height: 140 },
        warnings: [],
      },
      agentWorkflow('codex', 260, 250),
      {
        id: 'source_flow__workflow_outputs',
        title: 'Workflow Outputs',
        boundaryKind: 'workflow_output',
        directory: 'Workflow boundary',
        status: 'not_run',
        inputPorts: [{ id: 'main', label: 'output', direction: 'input' }],
        outputPorts: [],
        internalNodes: [],
        internalEdges: [],
        position: { x: 560, y: 250 },
        size: { width: 120, height: 140 },
        warnings: [],
      },
    ],
    edges: internalEdges,
  };
}

function canvasWithTargetEvidencePort() {
  const canvas = canvasFixture();
  return {
    ...canvas,
    workflows: canvas.workflows.map((item) =>
      item.id === 'target_flow'
        ? {
            ...item,
            inputPorts: [
              { id: 'main', label: 'input', direction: 'input' },
              { id: 'evidence', label: 'evidence', direction: 'input' },
            ],
          }
        : item,
    ),
  };
}

function callableFixture(id: string, kind = 'agent_class') {
  return {
    id,
    version: '0.1.0',
    kind,
    backend: 'template',
    source_id: id,
    name: id,
    input_ports: { main: { type: 'artifact', required: false } },
    output_ports: { main: { type: 'artifact', required: true } },
    artifact_contract: {
      output_schema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
    },
  };
}

function renderCanvas(
  canvas = canvasFixture(),
  selection: Record<string, unknown> = { type: 'workflow', id: 'source_flow' },
  connectionMode = 'control',
  onNotice = vi.fn(),
  focusedWorkflowId: string | null = null,
) {
  const onCanvasChange = vi.fn();
  const onSelect = vi.fn();
  const view = render(
    <WorkspaceCanvas
      canvas={canvas}
      selection={selection}
      connectionMode={connectionMode}
      workflowRun={null}
      focusedWorkflowId={focusedWorkflowId}
      callables={[]}
      workflows={[]}
      bindings={{}}
      onFocusedWorkflow={vi.fn()}
      onCanvasChange={onCanvasChange}
      onSelect={onSelect}
      onBlankCanvas={vi.fn()}
      onNotice={onNotice}
      onConfigureWorkflow={vi.fn()}
    />,
  );
  return { canvas, onCanvasChange, onSelect, onNotice, rerender: view.rerender };
}

async function waitForFlowNodes() {
  await waitFor(() => {
    expect(flowMock.props?.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'source_flow' })]));
  });
  return flowMock.props?.nodes as Array<{ id: string; position: { x: number; y: number }; parentId?: string; extent?: string }>;
}

function currentNode(id: string) {
  const nodes = flowMock.props?.nodes as Array<{ id: string; position: { x: number; y: number }; parentId?: string; extent?: string }>;
  const node = nodes.find((item) => item.id === id);
  expect(node).toBeTruthy();
  return node!;
}

afterEach(() => {
  flowMock.props = null;
});

describe('WorkspaceCanvas data edges', () => {
  test('output schema outputs properties generate schema-derived output ports', () => {
    const ports = outputPortsFromSchema(
      {
        type: 'object',
        properties: {
          outputs: {
            type: 'object',
            properties: {
              alpha: { type: 'string', description: 'Alpha signal' },
              beta: { type: 'array', items: { type: 'string' } },
              gamma: { type: 'object', title: 'Gamma view' },
            },
            required: ['alpha', 'gamma'],
            additionalProperties: false,
          },
        },
        required: ['outputs'],
        additionalProperties: false,
      },
      [{ id: 'stale', label: 'stale', direction: 'output' }],
    );

    expect(ports.map((port) => port.id)).toEqual(['main', 'alpha', 'beta', 'gamma']);
    expect(ports.find((port) => port.id === 'alpha')).toMatchObject({
      required: true,
      jsonPath: '/outputs/alpha',
      projectionSource: 'output_schema',
      readonly: true,
    });
    expect(ports.find((port) => port.id === 'beta')).toMatchObject({
      cardinality: 'many',
      schemaType: 'array',
    });
  });

  test('canvas projection and save payload use schema-derived output ports over stale snapshots', async () => {
    const base = canvasFixture();
    const canvas = {
      ...base,
      workflows: base.workflows.map((workflowValue) =>
        workflowValue.id === 'source_agent'
          ? {
              ...workflowValue,
              outputPorts: [{ id: 'stale_report', label: 'stale', direction: 'output' }],
              outputSchema: {
                type: 'object',
                properties: {
                  outputs: {
                    type: 'object',
                    properties: {
                      report: { type: 'string', description: 'Final report' },
                    },
                    required: ['report'],
                    additionalProperties: false,
                  },
                },
                required: ['outputs'],
                additionalProperties: false,
              },
            }
          : workflowValue,
      ),
    };

    renderCanvas(canvas, { type: 'workflow', id: 'source_agent' }, 'data');
    await waitForFlowNodes();
    const nodes = flowMock.props?.nodes as Array<{ id: string; data: { outputPorts?: Array<Record<string, unknown>> } }>;
    const sourceNode = nodes.find((item) => item.id === 'source_agent');
    expect(sourceNode?.data.outputPorts?.map((port) => port.id)).toEqual(['main', 'report']);

    const graph = canvasToWorkflowGraph(canvas) as { nodes: Array<Record<string, unknown>> };
    const savedSource = graph.nodes.find((node) => node.id === 'source_agent') as {
      output_ports: Array<{ id: string }>;
    };
    expect(savedSource.output_ports.map((port) => port.id)).toEqual(['main', 'report']);
  });

  test('CanvasAuthoringProposal adds existing callable nodes and serializes output_schema', () => {
    const canvas = { ...canvasFixture(), workflows: [], edges: [] };
    const callables = [callableFixture('research.codex'), callableFixture('review.generic', 'tool_class')];
    const snapshot = captureAuthoringSnapshot({
      taskId: canvas.id,
      canvas,
      selection: { type: 'task_canvas', taskId: canvas.id },
      callables,
      workflows: [],
    });
    const generated = buildDeterministicCanvasAuthoringProposal({
      message: 'Create a research workflow',
      snapshot,
    });

    expect(generated.errors).toEqual([]);
    expect(generated.proposal).toBeTruthy();
    const proposal = JSON.parse(JSON.stringify(generated.proposal)) as Record<string, unknown>;
    const operations = proposal.operations as Array<Record<string, unknown>>;
    operations[0].node_id = 'explicit_research_node';
    operations[0].output_schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        ticker: { type: 'string', description: 'Ticker symbol' },
        company_name: { type: 'string', description: 'Company name' },
        sources: { type: 'array', items: { type: 'string' } },
      },
      required: ['ticker', 'company_name', 'sources'],
    };
    operations[1].node_id = 'explicit_review_node';
    operations[2].from = 'explicit_research_node';
    operations[2].to = 'explicit_review_node';

    const applied = applyCanvasAuthoringProposal({
      canvas,
      taskId: canvas.id,
      proposal,
      temporaryResources: {},
      callables,
      workflows: [],
    });
    const graph = canvasToWorkflowGraph(applied.canvas) as { nodes: Array<Record<string, unknown>>; control_edges: unknown[] };

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.map((node) => node.id)).toEqual(['explicit_research_node', 'explicit_review_node']);
    expect(graph.nodes[0].callable_ref).toEqual({ kind: 'agent_class', id: 'research.codex' });
    expect(graph.nodes[0].input).toEqual({ user_prompt: 'Create a research workflow' });
    expect(graph.nodes[0].output_schema).toEqual(operations[0].output_schema);
    expect(graph.control_edges).toHaveLength(1);
  });

  test('CanvasAuthoringProposal can create a workflow container and scoped internal nodes in order', () => {
    const canvas = { ...canvasFixture(), workflows: [], edges: [] };
    const callables = [callableFixture('fake-agent.generic')];
    const snapshot = captureAuthoringSnapshot({
      taskId: canvas.id,
      canvas,
      selection: { type: 'task_canvas', taskId: canvas.id },
      callables,
      workflows: [],
    });
    const proposal = {
      proposal_id: 'proposal_scoped_workflow_container',
      base_task_id: canvas.id,
      base_canvas_hash: snapshot.snapshot_id,
      target: snapshot.target,
      rationale: 'Create an inline workflow container with internal fan-out and fan-in.',
      operations: [
        {
          op: 'add_workflow_container',
          scope_workflow_id: null,
          node_id: 'workflow_tech_plan_review',
          label: 'Tech Plan Review',
          workflow_ref: null,
          position: { x: 80, y: 80 },
        },
        ...[
          ['node_requirement_clarification', 120, 120],
          ['node_architecture_fit_analysis', 460, 40],
          ['node_risk_boundary_analysis', 460, 200],
          ['node_test_acceptance_analysis', 460, 360],
          ['node_engineering_plan_synthesis', 800, 200],
          ['node_final_plan_review', 1140, 200],
        ].map(([nodeId, x, y]) => ({
          op: 'add_existing_callable_node',
          scope_workflow_id: 'workflow_tech_plan_review',
          node_id: nodeId,
          callable_id: 'fake-agent.generic',
          callable_kind: 'agent_class',
          label: String(nodeId),
          position: { x, y },
          input: { user_prompt: String(nodeId) },
        })),
        {
          op: 'add_control_edge',
          scope_workflow_id: 'workflow_tech_plan_review',
          from: 'node_requirement_clarification',
          to: 'node_architecture_fit_analysis',
        },
        {
          op: 'add_control_edge',
          scope_workflow_id: 'workflow_tech_plan_review',
          from: 'node_requirement_clarification',
          to: 'node_risk_boundary_analysis',
        },
        {
          op: 'add_control_edge',
          scope_workflow_id: 'workflow_tech_plan_review',
          from: 'node_requirement_clarification',
          to: 'node_test_acceptance_analysis',
        },
        {
          op: 'add_control_edge',
          scope_workflow_id: 'workflow_tech_plan_review',
          from: 'node_architecture_fit_analysis',
          to: 'node_engineering_plan_synthesis',
        },
        {
          op: 'add_control_edge',
          scope_workflow_id: 'workflow_tech_plan_review',
          from: 'node_risk_boundary_analysis',
          to: 'node_engineering_plan_synthesis',
        },
        {
          op: 'add_control_edge',
          scope_workflow_id: 'workflow_tech_plan_review',
          from: 'node_test_acceptance_analysis',
          to: 'node_engineering_plan_synthesis',
        },
        {
          op: 'add_control_edge',
          scope_workflow_id: 'workflow_tech_plan_review',
          from: 'node_engineering_plan_synthesis',
          to: 'node_final_plan_review',
        },
      ],
    };

    const validation = validateCanvasAuthoringProposal(proposal as Record<string, unknown>, {
      canvas,
      taskId: canvas.id,
      temporaryResources: {},
      callables,
      workflows: [],
    });
    expect(validation).toEqual({ status: 'valid', errors: [], warnings: [] });

    const applied = applyCanvasAuthoringProposal({
      canvas,
      taskId: canvas.id,
      proposal: proposal as Record<string, unknown>,
      temporaryResources: {},
      callables,
      workflows: [],
    });
    const container = (applied.canvas.workflows as Array<Record<string, unknown>>).find(
      (workflow) => workflow.id === 'workflow_tech_plan_review',
    );
    expect(container?.internalNodes).toHaveLength(6);
    expect(container?.internalEdges).toHaveLength(7);
    const nodes = new Map(
      ((container?.internalNodes || []) as Array<{ id: string; position: { x: number; y: number } }>).map((node) => [
        node.id,
        node.position,
      ]),
    );
    const requirement = nodes.get('node_requirement_clarification');
    const architecture = nodes.get('node_architecture_fit_analysis');
    const risk = nodes.get('node_risk_boundary_analysis');
    const test = nodes.get('node_test_acceptance_analysis');
    const synthesis = nodes.get('node_engineering_plan_synthesis');
    const finalReview = nodes.get('node_final_plan_review');
    expect(requirement?.x).toBeLessThan(architecture?.x || 0);
    expect(requirement?.x).toBeLessThan(risk?.x || 0);
    expect(requirement?.x).toBeLessThan(test?.x || 0);
    expect(Math.abs((architecture?.x || 0) - (risk?.x || 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((risk?.x || 0) - (test?.x || 0))).toBeLessThanOrEqual(1);
    expect(synthesis?.x).toBeGreaterThan(architecture?.x || 0);
    expect(finalReview?.x).toBeGreaterThan(synthesis?.x || 0);
    expect(requirement?.y).toBeGreaterThanOrEqual(154);
  });

  test('CanvasAuthoringProposal rejects scoped operations before the workflow container exists', () => {
    const canvas = { ...canvasFixture(), workflows: [], edges: [] };
    const callables = [callableFixture('fake-agent.generic')];
    const snapshot = captureAuthoringSnapshot({
      taskId: canvas.id,
      canvas,
      selection: { type: 'task_canvas', taskId: canvas.id },
      callables,
      workflows: [],
    });
    const proposal = {
      proposal_id: 'proposal_forward_scope_reference',
      base_task_id: canvas.id,
      base_canvas_hash: snapshot.snapshot_id,
      target: snapshot.target,
      rationale: 'Forward scope references should be rejected.',
      operations: [
        {
          op: 'add_existing_callable_node',
          scope_workflow_id: 'workflow_future',
          node_id: 'node_a',
          callable_id: 'fake-agent.generic',
          callable_kind: 'agent_class',
          label: 'A',
          position: { x: 100, y: 100 },
        },
        {
          op: 'add_workflow_container',
          scope_workflow_id: null,
          node_id: 'workflow_future',
          label: 'Future',
          workflow_ref: null,
          position: { x: 80, y: 80 },
        },
      ],
    };

    const validation = validateCanvasAuthoringProposal(proposal as Record<string, unknown>, {
      canvas,
      taskId: canvas.id,
      temporaryResources: {},
      callables,
      workflows: [],
    });
    expect(validation.status).toBe('invalid');
    expect(validation.errors.join('\n')).toMatch(/Authoring scope 不存在: workflow_future/u);
  });

  test('CanvasAuthoringProposal scopes internal node ids and internal edge endpoints by container', () => {
    const canvas = { ...canvasFixture(), workflows: [], edges: [] };
    const callables = [callableFixture('fake-agent.generic')];
    const snapshot = captureAuthoringSnapshot({
      taskId: canvas.id,
      canvas,
      selection: { type: 'task_canvas', taskId: canvas.id },
      callables,
      workflows: [],
    });
    const baseProposal = {
      proposal_id: 'proposal_scoped_duplicate_ids',
      base_task_id: canvas.id,
      base_canvas_hash: snapshot.snapshot_id,
      target: snapshot.target,
      rationale: 'Internal ids are scoped by workflow container.',
      operations: [
        {
          op: 'add_workflow_container',
          scope_workflow_id: null,
          node_id: 'workflow_a',
          label: 'A',
          workflow_ref: null,
          position: { x: 80, y: 80 },
        },
        {
          op: 'add_workflow_container',
          scope_workflow_id: null,
          node_id: 'workflow_b',
          label: 'B',
          workflow_ref: null,
          position: { x: 520, y: 80 },
        },
        {
          op: 'add_existing_callable_node',
          scope_workflow_id: 'workflow_a',
          node_id: 'shared_node',
          callable_id: 'fake-agent.generic',
          callable_kind: 'agent_class',
          label: 'Shared A',
          position: { x: 100, y: 100 },
        },
        {
          op: 'add_existing_callable_node',
          scope_workflow_id: 'workflow_b',
          node_id: 'shared_node',
          callable_id: 'fake-agent.generic',
          callable_kind: 'agent_class',
          label: 'Shared B',
          position: { x: 100, y: 100 },
        },
      ],
    };

    expect(
      validateCanvasAuthoringProposal(baseProposal as Record<string, unknown>, {
        canvas,
        taskId: canvas.id,
        temporaryResources: {},
        callables,
        workflows: [],
      }).status,
    ).toBe('valid');

    const duplicateInSameScope = {
      ...baseProposal,
      proposal_id: 'proposal_duplicate_internal_id',
      operations: [
        ...baseProposal.operations,
        {
          op: 'add_existing_callable_node',
          scope_workflow_id: 'workflow_a',
          node_id: 'shared_node',
          callable_id: 'fake-agent.generic',
          callable_kind: 'agent_class',
          label: 'Duplicate',
          position: { x: 240, y: 100 },
        },
      ],
    };
    const crossScopeEdge = {
      ...baseProposal,
      proposal_id: 'proposal_cross_scope_edge',
      operations: [
        ...baseProposal.operations,
        {
          op: 'add_control_edge',
          scope_workflow_id: 'workflow_a',
          from: 'shared_node',
          to: 'node_only_in_workflow_b',
        },
      ],
    };

    expect(
      validateCanvasAuthoringProposal(duplicateInSameScope as Record<string, unknown>, {
        canvas,
        taskId: canvas.id,
        temporaryResources: {},
        callables,
        workflows: [],
      }).errors.join('\n'),
    ).toMatch(/节点 id 已存在: workflow_a.shared_node/u);
    expect(
      validateCanvasAuthoringProposal(crossScopeEdge as Record<string, unknown>, {
        canvas,
        taskId: canvas.id,
        temporaryResources: {},
        callables,
        workflows: [],
      }).errors.join('\n'),
    ).toMatch(/控制线目标节点不存在: node_only_in_workflow_b/u);
  });

  test('CanvasAuthoringProposal rejects stale canvas hash', () => {
    const canvas = { ...canvasFixture(), workflows: [], edges: [] };
    const callables = [callableFixture('research.codex')];
    const snapshot = captureAuthoringSnapshot({
      taskId: canvas.id,
      canvas,
      selection: { type: 'task_canvas', taskId: canvas.id },
      callables,
      workflows: [],
    });
    const generated = buildDeterministicCanvasAuthoringProposal({
      message: 'Create one node',
      snapshot,
    });
    const changedCanvas = {
      ...canvas,
      workflows: [agentWorkflow('other_agent', 100, 100)],
    };
    const validation = validateCanvasAuthoringProposal(generated.proposal as Record<string, unknown>, {
      canvas: changedCanvas,
      taskId: canvas.id,
      temporaryResources: {},
      callables,
      workflows: [],
    });

    expect(validation.status).toBe('invalid');
    expect(validation.errors.join('\n')).toMatch(/过期|stale|变化/u);
  });

  test('CanvasAuthoringProposal rejects duplicate node ids and missing edge removal', () => {
    const canvas = {
      ...canvasFixture(),
      workflows: [agentWorkflow('existing_node', 100, 100)],
      edges: [],
    };
    const snapshot = captureAuthoringSnapshot({
      taskId: canvas.id,
      canvas,
      selection: { type: 'task_canvas', taskId: canvas.id },
      callables: [callableFixture('fake-agent.generic')],
      workflows: [],
    });
    const duplicateNodeProposal = {
      proposal_id: 'proposal_duplicate_node',
      base_task_id: canvas.id,
      base_canvas_hash: snapshot.snapshot_id,
      target: snapshot.target,
      rationale: 'Duplicate node ids should be rejected.',
      operations: [
        {
          op: 'add_existing_callable_node',
          scope_workflow_id: null,
          node_id: 'existing_node',
          callable_id: 'fake-agent.generic',
          callable_kind: 'agent_class',
          label: 'Existing Node',
          position: { x: 300, y: 100 },
        },
      ],
    };
    const missingEdgeProposal = {
      ...duplicateNodeProposal,
      proposal_id: 'proposal_missing_edge',
      rationale: 'Missing edge removal should be rejected.',
      operations: [
        {
          op: 'remove_edge',
          scope_workflow_id: null,
          edge_id: 'missing_edge',
        },
      ],
    };

    expect(
      validateCanvasAuthoringProposal(duplicateNodeProposal as Record<string, unknown>, {
        canvas,
        taskId: canvas.id,
        temporaryResources: {},
        callables: [callableFixture('fake-agent.generic')],
        workflows: [],
      }).errors.join('\n'),
    ).toMatch(/节点 id 已存在/u);
    expect(() =>
      applyCanvasAuthoringProposal({
        canvas,
        taskId: canvas.id,
        proposal: missingEdgeProposal as Record<string, unknown>,
        temporaryResources: {},
        callables: [callableFixture('fake-agent.generic')],
        workflows: [],
      }),
    ).toThrow(/连线不存在/u);
  });

  test('CanvasAuthoringProposal rejects invalid control edge endpoints and cycles', () => {
    const canvas = {
      ...canvasFixture(),
      workflows: [agentWorkflow('node_a', 100, 100), agentWorkflow('node_b', 520, 100)],
      edges: [
        {
          id: 'control_node_b_node_a',
          kind: 'control',
          source: { workflowId: 'node_b' },
          target: { workflowId: 'node_a' },
          condition: null,
          context: 'none',
        },
      ],
    };
    const snapshot = captureAuthoringSnapshot({
      taskId: canvas.id,
      canvas,
      selection: { type: 'task_canvas', taskId: canvas.id },
      callables: [callableFixture('fake-agent.generic')],
      workflows: [],
    });
    const missingEndpointProposal = {
      proposal_id: 'proposal_missing_endpoint',
      base_task_id: canvas.id,
      base_canvas_hash: snapshot.snapshot_id,
      target: snapshot.target,
      rationale: 'Bad endpoint should be rejected.',
      operations: [
        {
          op: 'add_control_edge',
          scope_workflow_id: null,
          from: 'missing_node',
          to: 'node_a',
        },
      ],
    };
    const cycleProposal = {
      ...missingEndpointProposal,
      proposal_id: 'proposal_cycle',
      rationale: 'Cycle should be rejected.',
      operations: [
        {
          op: 'add_control_edge',
          scope_workflow_id: null,
          from: 'node_a',
          to: 'node_b',
        },
      ],
    };

    expect(() =>
      applyCanvasAuthoringProposal({
        canvas,
        taskId: canvas.id,
        proposal: missingEndpointProposal as Record<string, unknown>,
        temporaryResources: {},
        callables: [callableFixture('fake-agent.generic')],
        workflows: [],
      }),
    ).toThrow(/来源节点不存在|端点不存在/u);
    expect(() =>
      applyCanvasAuthoringProposal({
        canvas,
        taskId: canvas.id,
        proposal: cycleProposal as Record<string, unknown>,
        temporaryResources: {},
        callables: [callableFixture('fake-agent.generic')],
        workflows: [],
      }),
    ).toThrow(/循环/u);
  });

  test('selected node proposal updates invocation input and output_schema without output.json', () => {
    const canvas = canvasFixture();
    const callables = [callableFixture('fake-agent.generic')];
    const snapshot = captureAuthoringSnapshot({
      taskId: canvas.id,
      canvas,
      selection: { type: 'workflow', id: 'source_agent' },
      callables,
      workflows: [],
    });
    const generated = buildDeterministicCanvasAuthoringProposal({
      message: 'Rewrite the selected node prompt',
      snapshot,
    });
    const applied = applyCanvasAuthoringProposal({
      canvas,
      taskId: canvas.id,
      proposal: generated.proposal as Record<string, unknown>,
      temporaryResources: {},
      callables,
      workflows: [],
    });
    const graph = canvasToWorkflowGraph(applied.canvas) as { nodes: Array<Record<string, unknown>> };
    const node = graph.nodes.find((item) => item.id === 'source_agent');

    expect(node?.input).toEqual({ user_prompt: 'Rewrite the selected node prompt' });
    expect(node?.output_schema).toEqual(expect.objectContaining({ required: ['summary'] }));
    expect(JSON.stringify(node)).not.toContain('output.json');
  });

  test('temporary agent template stays canvas-local and blocks run/save graph submission', () => {
    const canvas = { ...canvasFixture(), workflows: [], edges: [] };
    const snapshot = captureAuthoringSnapshot({
      taskId: canvas.id,
      canvas,
      selection: { type: 'task_canvas', taskId: canvas.id },
      callables: [],
      workflows: [],
    });
    const generated = buildDeterministicCanvasAuthoringProposal({
      message: '创建一个新的 agent 模板处理报告',
      snapshot,
    });
    const applied = applyCanvasAuthoringProposal({
      canvas,
      taskId: canvas.id,
      proposal: generated.proposal as Record<string, unknown>,
      temporaryResources: {},
      callables: [],
      workflows: [],
    });
    const graph = canvasToWorkflowGraph(applied.canvas);

    expect(Object.keys(applied.temporaryResources)[0]).toMatch(/^tmp_agent_/u);
    expect(temporaryResourceIssueForCanvas(applied.canvas, { temporaryResources: applied.temporaryResources })).toMatch(
      /临时 agent template/u,
    );
    expect(temporaryResourceIssueForGraph(graph)).toMatch(/临时 callable/u);
  });

  test('temporary replacement operation cannot target a real callable node', () => {
    const canvas = canvasFixture();
    const snapshot = captureAuthoringSnapshot({
      taskId: canvas.id,
      canvas,
      selection: { type: 'workflow', id: 'source_agent' },
      callables: [callableFixture('review.generic')],
      workflows: [],
    });
    const proposal = {
      proposal_id: 'proposal_replace_real_node',
      base_task_id: canvas.id,
      base_canvas_hash: snapshot.snapshot_id,
      target: snapshot.target,
      rationale: 'Real nodes must not be replaceable through the temporary replacement op.',
      operations: [
        {
          op: 'replace_temporary_template_with_existing_callable',
          scope_workflow_id: null,
          node_id: 'source_agent',
          temporary_resource_id: 'tmp_agent_missing',
          callable_id: 'review.generic',
          callable_kind: 'agent_class',
        },
      ],
    };

    const validation = validateCanvasAuthoringProposal(proposal as Record<string, unknown>, {
      canvas,
      taskId: canvas.id,
      temporaryResources: {},
      callables: [callableFixture('review.generic')],
      workflows: [],
    });

    expect(validation.status).toBe('invalid');
    expect(validation.errors.join('\n')).toMatch(/不是临时 agent template/u);
  });

  test('normalizeSelectionIntent maps root and internal node clicks to scoped selection', () => {
    const canvas = canvasFixture();

    expect(
      normalizeSelectionIntent(
        canvas,
        canvas,
        { kind: 'react-flow-node', flowNodeId: 'source_agent' },
        null,
      ),
    ).toEqual({ type: 'workflow', id: 'source_agent' });

    expect(
      normalizeSelectionIntent(
        canvas,
        canvas,
        { kind: 'internal-node', workflowId: 'source_flow', nodeId: 'codex' },
        null,
      ),
    ).toEqual({ type: 'internal', workflowId: 'source_flow', nodeId: 'codex' });
  });

  test('normalizeSelectionIntent preserves focused workflow internal node scope', () => {
    const canvas = canvasFixture();
    const focusedCanvas = {
      ...canvas,
      layout: 'workflow-focus',
      focusedWorkflowId: 'source_flow',
      workflows: [
        agentWorkflow('codex', 40, 72),
      ],
      edges: [],
    };

    expect(
      normalizeSelectionIntent(
        focusedCanvas,
        canvas,
        { kind: 'react-flow-node', flowNodeId: 'codex' },
        'source_flow',
      ),
    ).toEqual({ type: 'internal', workflowId: 'source_flow', nodeId: 'codex' });
  });

  test('normalizeSelectionIntent requires scoped edge addresses', () => {
    const rootEdge = {
      id: 'control_codex_target',
      kind: 'control',
      source: { workflowId: 'source_agent', portId: 'main' },
      target: { workflowId: 'target_flow', portId: 'main' },
    };
    const childEdge = {
      id: 'control_codex_target',
      kind: 'control',
      source: { workflowId: 'codex', portId: 'main' },
      target: { workflowId: 'review', portId: 'main' },
    };
    const base = canvasFixture();
    const canvas = {
      ...base,
      edges: [rootEdge],
      workflows: base.workflows.map((item) =>
        item.id === 'source_flow'
          ? {
              ...item,
              internalNodes: [
                ...item.internalNodes,
                {
                  id: 'review',
                  name: 'Review',
                  task: 'agent',
                  kind: 'Agent',
                  status: 'not_run',
                  callableId: 'fake-agent.generic',
                  position: { x: 260, y: 72 },
                },
              ],
              internalEdges: [childEdge],
            }
          : item,
      ),
    };

    expect(
      normalizeSelectionIntent(
        canvas,
        canvas,
        { kind: 'edge', address: { scopeWorkflowId: null, edgeId: 'control_codex_target' } },
        null,
      ),
    ).toEqual({ type: 'edge', id: 'control_codex_target', scopeWorkflowId: null });
    expect(
      normalizeSelectionIntent(
        canvas,
        canvas,
        { kind: 'edge', address: { scopeWorkflowId: 'source_flow', edgeId: 'control_codex_target' } },
        null,
      ),
    ).toEqual({ type: 'edge', id: 'control_codex_target', scopeWorkflowId: 'source_flow' });
  });

  test('createDataEdgeCommand rejects explicit main-to-main data edge', () => {
    const canvas = canvasWithTargetEvidencePort();
    expect(() =>
      createDataEdgeCommand(canvas, {
        scopeWorkflowId: null,
        sourceNodeId: 'source_agent',
        sourcePortId: 'main',
        targetNodeId: 'target_flow',
        targetPortId: 'main',
        materialization: 'copy',
      }),
    ).toThrow(/Data Edge/u);
  });

  test('createDataEdgeCommand allows workflow input boundary main fan-out', () => {
    const base = canvasFixture();
    const canvas = {
      ...base,
      workflows: base.workflows.map((item) =>
        item.id === 'source_flow'
          ? {
              ...item,
              internalNodes: [
                ...item.internalNodes,
                {
                  id: 'reviewer',
                  name: 'Reviewer',
                  task: 'agent',
                  kind: 'Agent',
                  status: 'not_run',
                  callableId: 'fake-agent.generic',
                  position: { x: 400, y: 72 },
                },
              ],
            }
          : item,
      ),
    };
    const first = createDataEdgeCommand(canvas, {
      scopeWorkflowId: 'source_flow',
      sourceNodeId: 'source_flow__workflow_inputs',
      sourcePortId: 'main',
      targetNodeId: 'codex',
      targetPortId: 'main',
      materialization: 'copy',
    });
    const second = createDataEdgeCommand(first.canvas, {
      scopeWorkflowId: 'source_flow',
      sourceNodeId: 'source_flow__workflow_inputs',
      sourcePortId: 'main',
      targetNodeId: 'reviewer',
      targetPortId: 'main',
      materialization: 'copy',
    });
    const sourceFlow = second.canvas.workflows.find((item) => item.id === 'source_flow');

    expect(first.autoAddedControlEdge).toBe(false);
    expect(second.autoAddedControlEdge).toBe(false);
    expect(sourceFlow?.internalEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'data',
          source: { workflowId: 'source_flow__workflow_inputs', portId: 'main' },
          target: { workflowId: 'codex', portId: 'main' },
        }),
        expect.objectContaining({
          kind: 'data',
          source: { workflowId: 'source_flow__workflow_inputs', portId: 'main' },
          target: { workflowId: 'reviewer', portId: 'main' },
        }),
      ]),
    );
  });

  test('createDataEdgeCommand allows workflow output boundary aggregation', () => {
    const base = canvasFixture();
    const canvas = {
      ...base,
      workflows: base.workflows.map((item) =>
        item.id === 'source_flow'
          ? {
              ...item,
              internalNodes: [
                ...item.internalNodes,
                {
                  id: 'reviewer',
                  name: 'Reviewer',
                  task: 'agent',
                  kind: 'Agent',
                  status: 'not_run',
                  callableId: 'fake-agent.generic',
                  position: { x: 400, y: 72 },
                },
              ],
            }
          : item,
      ),
    };

    const first = createDataEdgeCommand(canvas, {
      scopeWorkflowId: 'source_flow',
      sourceNodeId: 'codex',
      sourcePortId: 'main',
      targetNodeId: 'source_flow__workflow_outputs',
      targetPortId: 'main',
      materialization: 'copy',
    });
    const second = createDataEdgeCommand(first.canvas, {
      scopeWorkflowId: 'source_flow',
      sourceNodeId: 'reviewer',
      sourcePortId: 'main',
      targetNodeId: 'source_flow__workflow_outputs',
      targetPortId: 'main',
      materialization: 'copy',
    });
    const sourceFlow = second.canvas.workflows.find((item) => item.id === 'source_flow');

    expect(first.autoAddedControlEdge).toBe(false);
    expect(second.autoAddedControlEdge).toBe(false);
    expect(sourceFlow?.internalEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'data',
          source: { workflowId: 'codex', portId: 'main' },
          target: { workflowId: 'source_flow__workflow_outputs', portId: 'main' },
        }),
        expect.objectContaining({
          kind: 'data',
          source: { workflowId: 'reviewer', portId: 'main' },
          target: { workflowId: 'source_flow__workflow_outputs', portId: 'main' },
        }),
      ]),
    );
  });

  test('createDataEdgeCommand reuses duplicate workflow output binding from the same source node', () => {
    const canvas = canvasFixture();

    const first = createDataEdgeCommand(canvas, {
      scopeWorkflowId: 'source_flow',
      sourceNodeId: 'codex',
      sourcePortId: 'main',
      targetNodeId: 'source_flow__workflow_outputs',
      targetPortId: 'main',
      materialization: 'copy',
    });
    const second = createDataEdgeCommand(first.canvas, {
      scopeWorkflowId: 'source_flow',
      sourceNodeId: 'codex',
      sourcePortId: 'main',
      targetNodeId: 'source_flow__workflow_outputs',
      targetPortId: 'main',
      materialization: 'copy',
    });
    const sourceFlow = second.canvas.workflows.find((item) => item.id === 'source_flow');

    expect(second.edge).toEqual(first.edge);
    expect(sourceFlow?.internalEdges).toHaveLength(1);
    expect(sourceFlow?.internalEdges[0]).toEqual(
      expect.objectContaining({
        kind: 'data',
        source: { workflowId: 'codex', portId: 'main' },
        target: { workflowId: 'source_flow__workflow_outputs', portId: 'main' },
      }),
    );
  });

  test('createDataEdgeCommand keeps two upstream outputs separate on explicit target ports', () => {
    const canvas = {
      ...canvasFixture(),
      workflows: [
        agentWorkflow('news_research', 120, 120),
        agentWorkflow('sentiment_research', 120, 300),
        {
          ...agentWorkflow('cleaner', 520, 180),
          inputPorts: [
            { id: 'news_research', label: 'news_research', direction: 'input' },
            { id: 'sentiment_research', label: 'sentiment_research', direction: 'input' },
          ],
        },
      ],
    };

    const first = createDataEdgeCommand(canvas, {
      scopeWorkflowId: null,
      sourceNodeId: 'news_research',
      sourcePortId: 'main',
      targetNodeId: 'cleaner',
      targetPortId: 'news_research',
      materialization: 'copy',
    });
    const second = createDataEdgeCommand(first.canvas, {
      scopeWorkflowId: null,
      sourceNodeId: 'sentiment_research',
      sourcePortId: 'main',
      targetNodeId: 'cleaner',
      targetPortId: 'sentiment_research',
      materialization: 'copy',
    });

    expect(second.canvas.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'data',
          source: { workflowId: 'news_research', portId: 'main' },
          target: { workflowId: 'cleaner', portId: 'news_research' },
        }),
        expect.objectContaining({
          kind: 'data',
          source: { workflowId: 'sentiment_research', portId: 'main' },
          target: { workflowId: 'cleaner', portId: 'sentiment_research' },
        }),
      ]),
    );
  });

  test('createDataEdgeCommand rejects one-cardinality target conflicts unless replaced', () => {
    const canvas = canvasWithTargetEvidencePort();
    const first = createDataEdgeCommand(canvas, {
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
  });

  test('data mode creates a data edge from node handles and auto-adds control dependency', async () => {
    const { canvas, onCanvasChange } = renderCanvas(
      canvasWithTargetEvidencePort(),
      { type: 'workflow', id: 'source_agent' },
      'data',
    );
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onConnect as (connection: unknown) => void)({
        source: 'source_agent',
        target: 'target_flow',
        sourceHandle: 'source_agent:output:main',
        targetHandle: 'target_flow:input:evidence',
      });
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    expect(nextCanvas.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'data',
          source: expect.objectContaining({ workflowId: 'source_agent', portId: 'main' }),
          target: expect.objectContaining({ workflowId: 'target_flow', portId: 'evidence' }),
        }),
        expect.objectContaining({
          kind: 'control',
          source: expect.objectContaining({ workflowId: 'source_agent' }),
          target: expect.objectContaining({ workflowId: 'target_flow' }),
        }),
      ]),
    );
  });

  test('control mode maps external node to workflow outer input as root control', async () => {
    const { canvas, onCanvasChange } = renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'control');
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onConnect as (connection: unknown) => void)({
        source: 'source_agent',
        target: 'source_flow',
        sourceHandle: null,
        targetHandle: 'source_flow:workflow-input-outer-target',
      });
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    expect(nextCanvas.edges).toEqual([
      expect.objectContaining({
        kind: 'control',
        source: { workflowId: 'source_agent' },
        target: { workflowId: 'source_flow' },
      }),
    ]);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    expect(sourceFlow?.internalEdges).toEqual([]);
  });

  test('control mode rejects the eleventh new output slot but allows an existing equivalent edge', () => {
    const base = canvasFixture();
    const targets = Array.from({ length: 11 }, (_value, index) =>
      agentWorkflow(`target_${index + 1}`, 420 + index * 20, 420),
    );
    const canvas = {
      ...base,
      workflows: [...base.workflows, ...targets],
      edges: targets.slice(0, 10).map((target) => ({
        id: `control_source_agent_${target.id}`,
        kind: 'control',
        source: { workflowId: 'source_agent' },
        target: { workflowId: target.id },
      })),
    } as unknown as ReturnType<typeof canvasFixture>;

    expect(
      resolveScopedConnection(
        canvas,
        {
          source: 'source_agent',
          target: 'target_11',
          sourceHandle: 'source_agent:control:source',
          targetHandle: 'target_11:control:target',
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
          sourceHandle: 'source_agent:control:source',
          targetHandle: 'target_10:control:target',
        },
        'control',
      ),
    ).toEqual(expect.objectContaining({ accepted: true }));
  });

  test('control mode maps workflow outer output to workflow outer input as root workflow control', async () => {
    const { canvas, onCanvasChange } = renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'control');
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onConnect as (connection: unknown) => void)({
        source: 'source_flow',
        target: 'target_flow',
        sourceHandle: 'source_flow:workflow-output-outer-source',
        targetHandle: 'target_flow:workflow-input-outer-target',
      });
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    expect(nextCanvas.edges).toEqual([
      expect.objectContaining({
        kind: 'control',
        source: { workflowId: 'source_flow' },
        target: { workflowId: 'target_flow' },
      }),
    ]);
    expect(nextCanvas.workflows.find((item) => item.id === 'source_flow')?.internalEdges).toEqual([]);
    expect(nextCanvas.workflows.find((item) => item.id === 'target_flow')?.internalEdges).toEqual([]);
  });

  test('control fallback hit-test ignores hidden data port handles', () => {
    const workflowControlHandle = document.createElement('div');
    workflowControlHandle.className = 'react-flow__handle workflow-control-handle target';
    const agentControlHandle = document.createElement('div');
    agentControlHandle.className = 'react-flow__handle agent-control-handle source';
    const hiddenDataHandle = document.createElement('div');
    hiddenDataHandle.className = 'react-flow__handle workflow-port-handle hidden input target';

    expect(isConnectionHandleForMode(workflowControlHandle, 'control')).toBe(true);
    expect(isConnectionHandleForMode(agentControlHandle, 'control')).toBe(true);
    expect(isConnectionHandleForMode(hiddenDataHandle, 'control')).toBe(false);
    expect(isConnectionHandleForMode(hiddenDataHandle, 'data')).toBe(true);
  });

  test('React Flow click-to-connect stays disabled while Workbench owns click state', async () => {
    renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'control');
    await waitForFlowNodes();

    expect(flowMock.props?.connectOnClick).toBe(false);
  });

  test('document release fallback commits root agent to workflow outer input', async () => {
    const { canvas, onCanvasChange } = renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'control');
    await waitForFlowNodes();

    const sourceHandle = document.createElement('div');
    sourceHandle.className = 'react-flow__handle workflow-control-handle output agent-control-handle source';
    sourceHandle.setAttribute('data-nodeid', 'source_agent');
    sourceHandle.setAttribute('data-handleid', 'source_agent:control:source');
    const targetHandle = document.createElement('div');
    targetHandle.className = 'react-flow__handle workflow-control-handle input workflow-shell-outer-input target';
    targetHandle.setAttribute('data-nodeid', 'source_flow');
    targetHandle.setAttribute('data-handleid', 'source_flow:workflow-input-outer-target');
    document.body.append(sourceHandle, targetHandle);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => targetHandle),
    });

    try {
      fireEvent.pointerDown(sourceHandle, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(targetHandle, { button: 0, clientX: 20, clientY: 20 });

      await waitFor(() => expect(onCanvasChange).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      sourceHandle.remove();
      targetHandle.remove();
    }

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    expect(nextCanvas.edges).toEqual([
      expect.objectContaining({
        kind: 'control',
        source: { workflowId: 'source_agent' },
        target: { workflowId: 'source_flow' },
      }),
    ]);
  });

  test('document release fallback creates target input port when data output is dropped on node body', async () => {
    const base = canvasFixture();
    const canvas = {
      ...base,
      workflows: base.workflows.map((workflowValue) =>
        workflowValue.id === 'source_agent'
          ? {
              ...workflowValue,
              outputPorts: [{ id: 'main', label: 'output', direction: 'output' }],
              outputSchema: {
                type: 'object',
                properties: {
                  outputs: {
                    type: 'object',
                    properties: {
                      alpha_signal: { type: 'string', description: 'Alpha signal' },
                    },
                    required: ['alpha_signal'],
                    additionalProperties: false,
                  },
                },
                required: ['outputs'],
                additionalProperties: false,
              },
            }
          : workflowValue,
      ),
    };
    const { onCanvasChange, onNotice } = renderCanvas(canvas, { type: 'workflow', id: 'source_agent' }, 'data');
    await waitForFlowNodes();

    const sourceHandle = document.createElement('div');
    sourceHandle.className = 'react-flow__handle workflow-port-handle output source';
    sourceHandle.setAttribute('data-nodeid', 'source_agent');
    sourceHandle.setAttribute('data-handleid', 'source_agent:output:alpha_signal');
    sourceHandle.setAttribute('data-acc-connection-mode', 'data');
    sourceHandle.setAttribute('data-acc-connection-side', 'source');
    const targetNodeBody = document.createElement('div');
    targetNodeBody.className = 'react-flow__node';
    targetNodeBody.setAttribute('data-id', 'target_flow');
    document.body.append(sourceHandle, targetNodeBody);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => targetNodeBody),
    });

    try {
      fireEvent.pointerDown(sourceHandle, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(targetNodeBody, { button: 0, clientX: 200, clientY: 120 });

      await waitFor(() => expect(onCanvasChange).toHaveBeenCalledTimes(2));
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      sourceHandle.remove();
      targetNodeBody.remove();
    }

    const addPortUpdater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const addEdgeUpdater = onCanvasChange.mock.calls[1][0] as (current: typeof canvas) => typeof canvas;
    const canvasWithInputPort = addPortUpdater(canvas);
    const nextCanvas = addEdgeUpdater(canvasWithInputPort);
    const target = nextCanvas.workflows.find((item) => item.id === 'target_flow');
    expect(target?.inputPorts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'alpha_signal' })]),
    );
    expect(nextCanvas.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'data',
          source: { workflowId: 'source_agent', portId: 'alpha_signal' },
          target: { workflowId: 'target_flow', portId: 'alpha_signal' },
        }),
        expect.objectContaining({
          kind: 'control',
          source: { workflowId: 'source_agent' },
          target: { workflowId: 'target_flow' },
        }),
      ]),
    );
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('已创建输入端口 target_flow.alpha_signal'));
  });

  test('schema-derived data ports expand node height in data connection mode', async () => {
    const outputFields = Object.fromEntries(
      Array.from({ length: 7 }, (_, index) => [
        `field_${index + 1}`,
        { type: 'string', description: `Field ${index + 1}` },
      ]),
    );
    const base = canvasFixture();
    const canvas = {
      ...base,
      workflows: base.workflows.map((workflowValue) =>
        workflowValue.id === 'source_agent'
          ? {
              ...workflowValue,
              outputSchema: {
                type: 'object',
                properties: {
                  outputs: {
                    type: 'object',
                    properties: outputFields,
                    required: ['field_1'],
                    additionalProperties: false,
                  },
                },
                required: ['outputs'],
                additionalProperties: false,
              },
            }
          : workflowValue,
      ),
    };

    renderCanvas(canvas, { type: 'workflow', id: 'source_agent' }, 'data');
    await waitForFlowNodes();

    const source = (flowMock.props?.nodes as Array<{ id: string; data?: { size?: { height?: number } } }>).find(
      (node) => node.id === 'source_agent',
    );
    expect(source?.data?.size?.height).toBeGreaterThan(132);
  });

  test('visible control handles start control connections even when global mode is data', async () => {
    const { canvas, onCanvasChange } = renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'data');
    await waitForFlowNodes();

    const sourceHandle = document.createElement('div');
    sourceHandle.className = 'react-flow__handle workflow-control-handle output agent-control-handle source';
    sourceHandle.setAttribute('data-nodeid', 'source_agent');
    sourceHandle.setAttribute('data-handleid', 'source_agent:control:source');
    const targetHandle = document.createElement('div');
    targetHandle.className = 'react-flow__handle workflow-control-handle input workflow-shell-outer-input target';
    targetHandle.setAttribute('data-nodeid', 'source_flow');
    targetHandle.setAttribute('data-handleid', 'source_flow:workflow-input-outer-target');
    document.body.append(sourceHandle, targetHandle);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => targetHandle),
    });

    try {
      fireEvent.pointerDown(sourceHandle, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(targetHandle, { button: 0, clientX: 20, clientY: 20 });

      await waitFor(() => expect(onCanvasChange).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      sourceHandle.remove();
      targetHandle.remove();
    }

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    expect(nextCanvas.edges).toEqual([
      expect.objectContaining({
        kind: 'control',
        source: { workflowId: 'source_agent' },
        target: { workflowId: 'source_flow' },
      }),
    ]);
  });

  test('document release fallback commits from release target handle when coordinates miss', async () => {
    const { canvas, onCanvasChange } = renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'control');
    await waitForFlowNodes();

    const sourceHandle = document.createElement('div');
    sourceHandle.className = 'react-flow__handle workflow-control-handle output agent-control-handle source';
    sourceHandle.setAttribute('data-nodeid', 'source_agent');
    sourceHandle.setAttribute('data-handleid', 'source_agent:control:source');
    const targetHandle = document.createElement('div');
    targetHandle.className = 'react-flow__handle workflow-control-handle input workflow-shell-outer-input target';
    targetHandle.setAttribute('data-nodeid', 'source_flow');
    targetHandle.setAttribute('data-handleid', 'source_flow:workflow-input-outer-target');
    document.body.append(sourceHandle, targetHandle);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => document.body),
    });

    try {
      fireEvent.pointerDown(sourceHandle, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(targetHandle, { button: 0, clientX: -200, clientY: -200 });

      await waitFor(() => expect(onCanvasChange).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      sourceHandle.remove();
      targetHandle.remove();
    }

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    expect(nextCanvas.edges).toEqual([
      expect.objectContaining({
        kind: 'control',
        source: { workflowId: 'source_agent' },
        target: { workflowId: 'source_flow' },
      }),
    ]);
  });

  test('ACC control hitboxes commit root agent to workflow outer input', async () => {
    const { canvas, onCanvasChange } = renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'control');
    await waitForFlowNodes();

    const sourceHandle = document.createElement('div');
    sourceHandle.className = 'acc-connect-hitbox agent-control-hitbox';
    sourceHandle.setAttribute('data-nodeid', 'source_agent');
    sourceHandle.setAttribute('data-handleid', 'source_agent:control:source');
    const targetHandle = document.createElement('div');
    targetHandle.className = 'acc-connect-hitbox workflow-shell-outer-input';
    targetHandle.setAttribute('data-nodeid', 'source_flow');
    targetHandle.setAttribute('data-handleid', 'source_flow:workflow-input-outer-target');
    document.body.append(sourceHandle, targetHandle);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => targetHandle),
    });

    try {
      fireEvent.pointerDown(sourceHandle, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(targetHandle, { button: 0, clientX: 20, clientY: 20 });

      await waitFor(() => expect(onCanvasChange).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      sourceHandle.remove();
      targetHandle.remove();
    }

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    expect(nextCanvas.edges).toEqual([
      expect.objectContaining({
        kind: 'control',
        source: { workflowId: 'source_agent' },
        target: { workflowId: 'source_flow' },
      }),
    ]);
  });

  test('visible workflow control handles commit workflow to workflow root control', async () => {
    const { canvas, onCanvasChange } = renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'control');
    await waitForFlowNodes();

    const sourceHandle = document.createElement('div');
    sourceHandle.className = 'react-flow__handle workflow-control-handle output workflow-shell-outer-output';
    sourceHandle.setAttribute('data-nodeid', 'source_flow');
    sourceHandle.setAttribute('data-handleid', 'source_flow:workflow-output-outer-source');
    sourceHandle.setAttribute('data-acc-connection-mode', 'control');
    sourceHandle.setAttribute('data-acc-connection-side', 'source');
    const targetHandle = document.createElement('div');
    targetHandle.className = 'react-flow__handle workflow-control-handle input workflow-shell-outer-input';
    targetHandle.setAttribute('data-nodeid', 'target_flow');
    targetHandle.setAttribute('data-handleid', 'target_flow:workflow-input-outer-target');
    targetHandle.setAttribute('data-acc-connection-mode', 'control');
    targetHandle.setAttribute('data-acc-connection-side', 'target');
    document.body.append(sourceHandle, targetHandle);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => targetHandle),
    });

    try {
      fireEvent.pointerDown(sourceHandle, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(targetHandle, { button: 0, clientX: 20, clientY: 20 });

      await waitFor(() => expect(onCanvasChange).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      sourceHandle.remove();
      targetHandle.remove();
    }

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    expect(nextCanvas.edges).toEqual([
      expect.objectContaining({
        kind: 'control',
        source: { workflowId: 'source_flow' },
        target: { workflowId: 'target_flow' },
      }),
    ]);
  });

  test('visible workflow control handles commit workflow control when drag starts from target side', async () => {
    const { canvas, onCanvasChange } = renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'control');
    await waitForFlowNodes();

    const sourceHandle = document.createElement('div');
    sourceHandle.className = 'react-flow__handle workflow-control-handle output workflow-shell-outer-output';
    sourceHandle.setAttribute('data-nodeid', 'source_flow');
    sourceHandle.setAttribute('data-handleid', 'source_flow:workflow-output-outer-source');
    sourceHandle.setAttribute('data-acc-connection-mode', 'control');
    sourceHandle.setAttribute('data-acc-connection-side', 'source');
    const targetHandle = document.createElement('div');
    targetHandle.className = 'react-flow__handle workflow-control-handle input workflow-shell-outer-input';
    targetHandle.setAttribute('data-nodeid', 'target_flow');
    targetHandle.setAttribute('data-handleid', 'target_flow:workflow-input-outer-target');
    targetHandle.setAttribute('data-acc-connection-mode', 'control');
    targetHandle.setAttribute('data-acc-connection-side', 'target');
    document.body.append(sourceHandle, targetHandle);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => sourceHandle),
    });

    try {
      fireEvent.pointerDown(targetHandle, { button: 0, clientX: 20, clientY: 20 });
      fireEvent.pointerUp(sourceHandle, { button: 0, clientX: 10, clientY: 10 });

      await waitFor(() => expect(onCanvasChange).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      sourceHandle.remove();
      targetHandle.remove();
    }

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    expect(nextCanvas.edges).toEqual([
      expect.objectContaining({
        kind: 'control',
        source: { workflowId: 'source_flow' },
        target: { workflowId: 'target_flow' },
      }),
    ]);
  });

  test('document release fallback uses the release-time pending snapshot after connect end clears refs', async () => {
    const { canvas, onCanvasChange } = renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'control');
    await waitForFlowNodes();

    const sourceHandle = document.createElement('div');
    sourceHandle.className = 'react-flow__handle workflow-control-handle output agent-control-handle source';
    sourceHandle.setAttribute('data-nodeid', 'source_agent');
    sourceHandle.setAttribute('data-handleid', 'source_agent:control:source');
    const targetHandle = document.createElement('div');
    targetHandle.className = 'react-flow__handle workflow-control-handle input workflow-shell-outer-input target';
    targetHandle.setAttribute('data-nodeid', 'source_flow');
    targetHandle.setAttribute('data-handleid', 'source_flow:workflow-input-outer-target');
    document.body.append(sourceHandle, targetHandle);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => targetHandle),
    });

    try {
      fireEvent.pointerDown(sourceHandle, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(targetHandle, { button: 0, clientX: 20, clientY: 20 });
      act(() => {
        (flowMock.props?.onConnectEnd as (event: unknown) => void)({
          target: targetHandle,
          clientX: 20,
          clientY: 20,
        });
      });

      await waitFor(() => expect(onCanvasChange).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      sourceHandle.remove();
      targetHandle.remove();
    }

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    expect(nextCanvas.edges).toEqual([
      expect.objectContaining({
        kind: 'control',
        source: { workflowId: 'source_agent' },
        target: { workflowId: 'source_flow' },
      }),
    ]);
  });

  test('node drag start cannot clear an active handle connection', async () => {
    const { canvas, onCanvasChange } = renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'control');
    await waitForFlowNodes();

    const targetHandle = document.createElement('div');
    targetHandle.className = 'react-flow__handle workflow-control-handle input workflow-shell-outer-input target';
    targetHandle.setAttribute('data-nodeid', 'source_flow');
    targetHandle.setAttribute('data-handleid', 'source_flow:workflow-input-outer-target');
    document.body.append(targetHandle);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => targetHandle),
    });

    try {
      act(() => {
        (flowMock.props?.onConnectStart as (event: unknown, params: unknown) => void)(
          { target: document.createElement('div') },
          {
            nodeId: 'source_agent',
            handleId: 'source_agent:control:source',
            handleType: 'source',
          },
        );
        (flowMock.props?.onNodeDragStart as (event: unknown, node: unknown) => void)(
          { target: document.createElement('div') },
          { id: 'source_agent', position: { x: 120, y: 450 } },
        );
        (flowMock.props?.onConnectEnd as (event: unknown) => void)({
          target: document.createElement('div'),
          clientX: 20,
          clientY: 20,
        });
      });

      await waitFor(() => expect(onCanvasChange).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      targetHandle.remove();
    }

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    expect(nextCanvas.edges).toEqual([
      expect.objectContaining({
        kind: 'control',
        source: { workflowId: 'source_agent' },
        target: { workflowId: 'source_flow' },
      }),
    ]);
  });

  test('document release fallback commits workflow inner input to internal agent', async () => {
    const { canvas, onCanvasChange } = renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'control');
    await waitForFlowNodes();

    const sourceHandle = document.createElement('div');
    sourceHandle.className = 'react-flow__handle workflow-control-handle input workflow-shell-inner-input source';
    sourceHandle.setAttribute('data-nodeid', 'source_flow');
    sourceHandle.setAttribute('data-handleid', 'source_flow:workflow-input-inner-source');
    const targetHandle = document.createElement('div');
    targetHandle.className = 'react-flow__handle workflow-control-handle input agent-control-handle target';
    targetHandle.setAttribute('data-nodeid', 'source_flow__internal__codex');
    targetHandle.setAttribute('data-handleid', 'source_flow__internal__codex:control:target');
    document.body.append(sourceHandle, targetHandle);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => targetHandle),
    });

    try {
      fireEvent.pointerDown(sourceHandle, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(targetHandle, { button: 0, clientX: 20, clientY: 20 });

      await waitFor(() => expect(onCanvasChange).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      sourceHandle.remove();
      targetHandle.remove();
    }

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    expect(sourceFlow?.internalEdges).toEqual([
      expect.objectContaining({
        kind: 'control',
        source: { workflowId: 'source_flow__workflow_inputs' },
        target: { workflowId: 'codex' },
      }),
    ]);
  });

  test('ACC control hitboxes commit workflow inner input without React Flow source target classes', async () => {
    const { canvas, onCanvasChange } = renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'control');
    await waitForFlowNodes();

    const sourceHandle = document.createElement('div');
    sourceHandle.className = 'acc-connect-hitbox workflow-shell-inner-input';
    sourceHandle.setAttribute('data-nodeid', 'source_flow');
    sourceHandle.setAttribute('data-handleid', 'source_flow:workflow-input-inner-source');
    const targetHandle = document.createElement('div');
    targetHandle.className = 'acc-connect-hitbox agent-control-hitbox';
    targetHandle.setAttribute('data-nodeid', 'source_flow__internal__codex');
    targetHandle.setAttribute('data-handleid', 'source_flow__internal__codex:control:target');
    document.body.append(sourceHandle, targetHandle);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => targetHandle),
    });

    try {
      fireEvent.pointerDown(sourceHandle, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(targetHandle, { button: 0, clientX: 20, clientY: 20 });

      await waitFor(() => expect(onCanvasChange).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      sourceHandle.remove();
      targetHandle.remove();
    }

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    expect(sourceFlow?.internalEdges).toEqual([
      expect.objectContaining({
        kind: 'control',
        source: { workflowId: 'source_flow__workflow_inputs' },
        target: { workflowId: 'codex' },
      }),
    ]);
  });

  test('visible workflow inner control handle connects to internal agent even when global mode is data', async () => {
    const { canvas, onCanvasChange } = renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'data');
    await waitForFlowNodes();

    const sourceHandle = document.createElement('div');
    sourceHandle.className = 'react-flow__handle workflow-control-handle input workflow-shell-inner-input source';
    sourceHandle.setAttribute('data-nodeid', 'source_flow');
    sourceHandle.setAttribute('data-handleid', 'source_flow:workflow-input-inner-source');
    const targetHandle = document.createElement('div');
    targetHandle.className = 'react-flow__handle workflow-control-handle input agent-control-handle target';
    targetHandle.setAttribute('data-nodeid', 'source_flow__internal__codex');
    targetHandle.setAttribute('data-handleid', 'source_flow__internal__codex:control:target');
    document.body.append(sourceHandle, targetHandle);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => targetHandle),
    });

    try {
      fireEvent.pointerDown(sourceHandle, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(targetHandle, { button: 0, clientX: 20, clientY: 20 });

      await waitFor(() => expect(onCanvasChange).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
      sourceHandle.remove();
      targetHandle.remove();
    }

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    expect(sourceFlow?.internalEdges).toEqual([
      expect.objectContaining({
        kind: 'control',
        source: { workflowId: 'source_flow__workflow_inputs' },
        target: { workflowId: 'codex' },
      }),
    ]);
  });

  test('root graph compilation preserves external caller, workflow node, and shell control edge', () => {
    const canvas = {
      ...canvasFixture(),
      edges: [
        {
          id: 'control_source_agent_source_flow',
          kind: 'control' as const,
          source: { workflowId: 'source_agent' },
          target: { workflowId: 'source_flow' },
        },
      ],
    };

    const graph = canvasToWorkflowGraph(canvas);

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'source_agent' }),
        expect.objectContaining({ id: 'source_flow' }),
      ]),
    );
    expect(graph.control_edges).toEqual([
      expect.objectContaining({
        from: 'source_agent',
        to: 'source_flow',
      }),
    ]);
  });

  test('control mode maps workflow inner input to workflow input boundary binding', async () => {
    const { canvas, onCanvasChange } = renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'control');
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onConnect as (connection: unknown) => void)({
        source: 'source_flow',
        target: 'source_flow__internal__codex',
        sourceHandle: 'source_flow:workflow-input-inner-source',
        targetHandle: null,
      });
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    expect(sourceFlow?.internalEdges).toEqual([
      expect.objectContaining({
        kind: 'control',
        source: { workflowId: 'source_flow__workflow_inputs' },
        target: { workflowId: 'codex' },
      }),
    ]);
    expect(nextCanvas.edges).toEqual([]);
  });

  test('state machine accepts workflow inner input to internal agent input', () => {
    const resolved = resolveScopedConnection(
      canvasFixture(),
      {
        source: 'source_flow',
        target: 'source_flow__internal__codex',
        sourceHandle: 'source_flow:workflow-input-inner-source',
        targetHandle: null,
      },
      'control',
    );

    expect(resolved).toEqual(
      expect.objectContaining({
        accepted: true,
        semantic: 'workflow_input_main_binding',
        scopeWorkflowId: 'source_flow',
        edge: expect.objectContaining({
          kind: 'control',
          source: { workflowId: 'source_flow__workflow_inputs' },
          target: { workflowId: 'codex' },
        }),
      }),
    );
  });

  test('focused workflow graph compiles boundary control main bindings without runtime edges', () => {
    const graph = canvasToWorkflowGraph(
      focusedWorkflowCanvasFixture([
        {
          id: 'control_source_flow_workflow_inputs_codex',
          kind: 'control',
          source: { workflowId: 'source_flow__workflow_inputs' },
          target: { workflowId: 'codex' },
        },
        {
          id: 'control_codex_source_flow_workflow_outputs',
          kind: 'control',
          source: { workflowId: 'codex' },
          target: { workflowId: 'source_flow__workflow_outputs' },
        },
      ]) as unknown as ReturnType<typeof canvasFixture>,
    );

    expect(graph.workflow_input_bindings).toEqual([
      {
        source_port: 'main',
        target: { node: 'codex', port: 'main' },
        materialization: 'copy',
        required: false,
      },
    ]);
    expect(graph.workflow_output_bindings).toEqual([
      {
        source: { node: 'codex', port: 'main' },
        target_port: 'main',
        materialization: 'copy',
        required: true,
      },
    ]);
    expect(graph.control_edges).toEqual([]);
    expect(graph.data_edges).toEqual([]);
  });

  test('focused workflow graph expands boundary input control bindings by matching ports', () => {
    const canvas = focusedWorkflowCanvasFixture([
      {
        id: 'control_source_flow_workflow_inputs_codex',
        kind: 'control',
        source: { workflowId: 'source_flow__workflow_inputs' },
        target: { workflowId: 'codex' },
      },
    ]) as unknown as ReturnType<typeof canvasFixture>;
    canvas.workflows = canvas.workflows.map((workflowValue) => {
      if (workflowValue.id === 'source_flow__workflow_inputs') {
        return {
          ...workflowValue,
          outputPorts: [
            { id: 'target', label: 'target', direction: 'output' },
            { id: 'verified_data', label: 'verified data', direction: 'output' },
          ],
        };
      }
      if (workflowValue.id === 'codex') {
        return {
          ...workflowValue,
          inputPorts: [
            { id: 'target', label: 'target', direction: 'input' },
            { id: 'verified_data', label: 'verified data', direction: 'input' },
          ],
        };
      }
      return workflowValue;
    });

    const graph = canvasToWorkflowGraph(canvas);

    expect(graph.workflow_input_bindings).toEqual([
      {
        source_port: 'target',
        target: { node: 'codex', port: 'target' },
        materialization: 'copy',
        required: false,
      },
      {
        source_port: 'verified_data',
        target: { node: 'codex', port: 'verified_data' },
        materialization: 'copy',
        required: false,
      },
    ]);
    expect(graph.control_edges).toEqual([]);
  });

  test('focused workflow graph uses explicit boundary output control mapping', () => {
    const graph = canvasToWorkflowGraph(
      focusedWorkflowCanvasFixture([
        {
          id: 'control_codex_source_flow_workflow_outputs',
          kind: 'control',
          source: { workflowId: 'codex' },
          target: { workflowId: 'source_flow__workflow_outputs' },
          boundaryTransfer: {
            direction: 'workflow_output',
            materialization: 'copy',
            inference: 'explicit',
            mappings: [{ sourcePort: 'main', targetPort: 'evidence_pack' }],
          },
        },
      ]) as unknown as ReturnType<typeof canvasFixture>,
    );

    expect(graph.workflow_output_bindings).toEqual([
      {
        source: { node: 'codex', port: 'main' },
        target_port: 'evidence_pack',
        materialization: 'copy',
        required: true,
      },
    ]);
    expect(graph.control_edges).toEqual([]);
  });

  test('edge canonical preview shows expanded boundary input bindings', () => {
    const canvas = canvasFixture();
    canvas.workflows = canvas.workflows.map((workflowValue) =>
      workflowValue.id === 'source_flow'
        ? {
            ...workflowValue,
            inputPorts: [
              { id: 'target', label: 'target', direction: 'input' },
              { id: 'verified_data', label: 'verified data', direction: 'input' },
            ],
            internalNodes: (workflowValue.internalNodes as Array<Record<string, unknown>>).map((node) =>
              node.id === 'codex'
                ? {
                    ...node,
                    inputPorts: [
                      { id: 'target', label: 'target', direction: 'input' },
                      { id: 'verified_data', label: 'verified data', direction: 'input' },
                    ],
                  }
                : node,
            ),
          }
        : workflowValue,
    );
    const edge = {
      id: 'control_source_flow_workflow_inputs_codex',
      kind: 'control',
      source: { workflowId: 'source_flow__workflow_inputs' },
      target: { workflowId: 'codex' },
    };

    expect(edgeCanonicalPreview(edge, canvas)).toEqual(
      expect.objectContaining({
        workflow_input_bindings: [
          {
            source_port: 'target',
            target: { node: 'codex', port: 'target' },
            materialization: 'copy',
            required: false,
          },
          {
            source_port: 'verified_data',
            target: { node: 'codex', port: 'verified_data' },
            materialization: 'copy',
            required: false,
          },
        ],
        workbench_projection: 'boundary_control_port_binding',
        runtime_control_edge: false,
      }),
    );
  });

  test('focused workflow graph dedupes legacy data and new boundary control bindings', () => {
    const graph = canvasToWorkflowGraph(
      focusedWorkflowCanvasFixture([
        {
          id: 'data_source_flow_workflow_inputs_codex',
          kind: 'data',
          source: { workflowId: 'source_flow__workflow_inputs', portId: 'main' },
          target: { workflowId: 'codex', portId: 'main' },
          materialization: 'copy',
        },
        {
          id: 'control_source_flow_workflow_inputs_codex',
          kind: 'control',
          source: { workflowId: 'source_flow__workflow_inputs' },
          target: { workflowId: 'codex' },
        },
      ]) as unknown as ReturnType<typeof canvasFixture>,
    );

    const inputBindings = graph.workflow_input_bindings as Array<Record<string, unknown>>;
    expect(inputBindings).toHaveLength(1);
    expect(inputBindings[0]).toEqual({
      source_port: 'main',
      target: { node: 'codex', port: 'main' },
      materialization: 'copy',
      required: false,
    });
    expect(graph.control_edges).toEqual([]);
    expect(graph.data_edges).toEqual([]);
  });

  test('selected internal node derives current Workflow main input binding from canvas', () => {
    const canvas = canvasFixture();
    (canvas.workflows[0] as { internalEdges: Array<Record<string, unknown>> }).internalEdges = [
      {
        id: 'control_source_flow_workflow_inputs_codex',
        kind: 'control',
        source: { workflowId: 'source_flow__workflow_inputs' },
        target: { workflowId: 'codex' },
      },
    ];

    expect(workflowMainInputBindingState(canvas, 'source_flow', 'codex')).toEqual(
      expect.objectContaining({
        status: 'bound',
        workflowId: 'source_flow',
        nodeId: 'codex',
        edgeId: 'control_source_flow_workflow_inputs_codex',
        sourcePort: 'main',
        targetPort: 'main',
      }),
    );
    expect(workflowMainInputBindingState(canvasFixture(), 'source_flow', 'codex')).toEqual(
      expect.objectContaining({
        status: 'unbound',
        workflowId: 'source_flow',
        nodeId: 'codex',
      }),
    );
  });

  test('node run evidence distinguishes workflow input binding from control fallback', () => {
    expect(
      nodeRunHasWorkflowInputBinding({
        binding_manifest: {
          bindings: [{ binding_kind: 'workflow_input', target_port: 'main' }],
        },
      }),
    ).toBe(true);
    expect(
      nodeRunHasWorkflowInputBinding({
        binding_manifest: {
          bindings: [{ binding_kind: 'control_main_default', target_port: 'main' }],
        },
      }),
    ).toBe(false);
  });

  test('connect-end fallback builds the same connection from pending source and release target', () => {
    const connection = connectionFromPendingEndpoint(
      {
        nodeId: 'source_flow',
        handleId: 'source_flow:workflow-input-inner-source',
        mode: 'control',
        side: 'source',
      },
      {
        nodeId: 'source_flow__internal__codex',
        handleId: null,
        side: 'target',
      },
    );

    expect(connection).toEqual({
      source: 'source_flow',
      sourceToken: 'source_flow:workflow-input-inner-source',
      target: 'source_flow__internal__codex',
      targetToken: null,
    });
  });

  test('connect fallback recovers workflow input binding when direct connection direction is wrong', () => {
    const candidates = connectionCandidatesFromPendingEndpoint(
      {
        nodeId: 'source_flow',
        handleId: 'source_flow:workflow-input-inner-source',
        mode: 'control',
        side: 'target',
        endpoint: {
          view: 'root-shell',
          role: 'workflow_inner_input',
          nodeId: 'source_flow',
          workflowId: 'source_flow',
          portId: 'main',
          handleId: 'source_flow:workflow-input-inner-source',
        },
      },
      {
        source: 'source_flow__internal__codex',
        sourceHandle: null,
        target: 'source_flow',
        targetHandle: 'source_flow:workflow-input-inner-source',
      },
    );
    const accepted = candidates
      .map((candidate) => resolveScopedConnection(canvasFixture(), candidate, 'control'))
      .find((candidate) => candidate.accepted);

    expect(accepted).toEqual(
      expect.objectContaining({
        accepted: true,
        semantic: 'workflow_input_main_binding',
        scopeWorkflowId: 'source_flow',
      }),
    );
  });

  test('reversed direct connection can still resolve to workflow input boundary binding', () => {
    const reversed = reverseConnection({
      source: 'source_flow__internal__codex',
      sourceHandle: null,
      target: 'source_flow',
      targetHandle: 'source_flow:workflow-input-inner-source',
    });
    const resolved = resolveScopedConnection(canvasFixture(), reversed || {}, 'control');

    expect(resolved).toEqual(
      expect.objectContaining({
        accepted: true,
        semantic: 'workflow_input_main_binding',
        scopeWorkflowId: 'source_flow',
      }),
    );
  });

  test('control mode maps workflow shell output to workflow output boundary binding', async () => {
    const { canvas, onCanvasChange } = renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'control');
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onConnect as (connection: unknown) => void)({
        source: 'source_flow__internal__codex',
        target: 'source_flow',
        sourceHandle: null,
        targetHandle: 'source_flow:workflow-output-inner-target',
      });
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    expect(sourceFlow?.internalEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'control',
          source: { workflowId: 'codex' },
          target: { workflowId: 'source_flow__workflow_outputs' },
        }),
      ]),
    );
    expect(nextCanvas.edges).toEqual([]);
  });

  test('focused workflow control mode connects internal agents in the original workflow scope', async () => {
    const base = canvasFixture();
    const canvas = {
      ...base,
      workflows: base.workflows.map((item) =>
        item.id === 'source_flow'
          ? {
              ...item,
              internalNodes: [
                ...item.internalNodes,
                {
                  id: 'reviewer',
                  name: 'Reviewer',
                  task: 'agent',
                  kind: 'Agent',
                  status: 'not_run',
                  callableId: 'fake-agent.generic',
                  position: { x: 400, y: 72 },
                },
              ],
            }
          : item,
      ),
    };
    const { onCanvasChange } = renderCanvas(
      canvas,
      { type: 'internal', workflowId: 'source_flow', nodeId: 'codex' },
      'control',
      vi.fn(),
      'source_flow',
    );
    await waitFor(() => {
      expect(flowMock.props?.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'codex' })]));
    });

    act(() => {
      (flowMock.props?.onConnect as (connection: unknown) => void)({
        source: 'codex',
        target: 'reviewer',
        sourceHandle: null,
        targetHandle: null,
      });
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    expect(sourceFlow?.internalEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'control',
          source: { workflowId: 'codex' },
          target: { workflowId: 'reviewer' },
        }),
      ]),
    );
    expect(nextCanvas.edges).toEqual([]);
  });

  test('clicking two internal nodes selects them without creating a control edge', async () => {
    const base = canvasFixture();
    const canvas = {
      ...base,
      workflows: base.workflows.map((item) =>
        item.id === 'source_flow'
          ? {
              ...item,
              internalNodes: [
                ...item.internalNodes,
                {
                  id: 'reviewer',
                  name: 'Reviewer',
                  task: 'agent',
                  kind: 'Agent',
                  status: 'not_run',
                  callableId: 'fake-agent.generic',
                  position: { x: 400, y: 72 },
                },
              ],
            }
          : item,
      ),
    };
    const { onCanvasChange, onSelect } = renderCanvas(
      canvas,
      { type: 'internal', workflowId: 'source_flow', nodeId: 'codex' },
      'control',
    );
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeClick as (event: unknown, node: unknown) => void)(
        {},
        { id: 'source_flow__internal__reviewer' },
      );
    });

    expect(onCanvasChange).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith({
      type: 'internal',
      workflowId: 'source_flow',
      nodeId: 'reviewer',
    });
  });

  test('data edge projection connects to data port handles instead of control handles', () => {
    const edge = {
      id: 'data_source_agent_target_flow',
      kind: 'data',
      source: { workflowId: 'source_agent', portId: 'main' },
      target: { workflowId: 'target_flow', portId: 'news_research' },
      materialization: 'copy',
    };

    const [flowEdge] = canvasEdgeToFlowEdge(edge, null, { type: 'task_canvas', taskId: 'acc_workspace_canvas' }, 'data');

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_agent',
        target: 'target_flow',
        type: 'step',
        sourceHandle: 'source_agent:output:main',
        targetHandle: 'target_flow:input:news_research',
        className: 'workflow-edge-data',
        markerEnd: expect.objectContaining({ type: 'arrowclosed' }),
      }),
    );
  });

  test('explicit main to main data edge projection is not hidden as implicit control transfer', () => {
    const edge = {
      id: 'data_source_agent_main_target_agent_main',
      kind: 'data',
      source: { workflowId: 'source_agent', portId: 'main' },
      target: { workflowId: 'target_agent', portId: 'main' },
      materialization: 'copy',
    };

    const [flowEdge] = canvasEdgeToFlowEdge(edge, null, { type: 'task_canvas', taskId: 'acc_workspace_canvas' }, 'data');

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_agent',
        target: 'target_agent',
        type: 'step',
        sourceHandle: 'source_agent:output:main',
        targetHandle: 'target_agent:input:main',
        className: 'workflow-edge-data',
        markerEnd: expect.objectContaining({ type: 'arrowclosed' }),
      }),
    );
  });

  test('control edge projection renders an arrow marker', () => {
    const edge = {
      id: 'control_source_agent_target_agent',
      kind: 'control',
      source: { workflowId: 'source_agent' },
      target: { workflowId: 'target_agent' },
    };

    const [flowEdge] = canvasEdgeToFlowEdge(
      edge,
      null,
      { type: 'task_canvas', taskId: 'acc_workspace_canvas' },
      'control',
    );

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_agent',
        target: 'target_agent',
        sourceHandle: 'source_agent:control:source',
        targetHandle: 'target_agent:control:target',
        className: 'workflow-edge-control',
        markerEnd: expect.objectContaining({ type: 'arrowclosed' }),
      }),
    );
  });

  test('workflow internals remain projected when a root node is selected', async () => {
    const base = canvasFixture();
    const canvas = {
      ...base,
      workflows: base.workflows.map((item) =>
        item.id === 'source_flow'
          ? {
              ...item,
              internalNodes: [
                ...item.internalNodes,
                {
                  id: 'reviewer',
                  name: 'Reviewer',
                  task: 'review',
                  kind: 'Agent',
                  status: 'not_run',
                  callableId: 'fake-agent.generic',
                  position: { x: 240, y: 72 },
                },
              ],
              internalEdges: [
                {
                  id: 'control_codex_reviewer',
                  kind: 'control',
                  source: { workflowId: 'codex', portId: 'main' },
                  target: { workflowId: 'reviewer', portId: 'main' },
                },
              ],
            }
          : item,
      ),
    };

    renderCanvas(
      canvas as ReturnType<typeof canvasFixture>,
      { type: 'workflow', id: 'source_agent' },
      'control',
    );
    await waitForFlowNodes();

    const nodes = flowMock.props?.nodes as Array<Record<string, unknown>>;
    const edges = flowMock.props?.edges as Array<Record<string, unknown>>;

    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'source_flow', zIndex: 0 }),
        expect.objectContaining({
          id: 'source_flow__internal__codex',
          parentId: 'source_flow',
          zIndex: 4,
        }),
        expect.objectContaining({
          id: 'source_flow__internal__reviewer',
          parentId: 'source_flow',
          zIndex: 4,
        }),
      ]),
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'workflow:source_flow::control_codex_reviewer',
          source: 'source_flow__internal__codex',
          target: 'source_flow__internal__reviewer',
          zIndex: 2,
        }),
      ]),
    );
  });

  test('invalid data edge commit reports a notice instead of crashing the canvas', async () => {
    const base = canvasWithTargetEvidencePort();
    const canvas = {
      ...base,
      edges: [
        {
          id: 'data_source_flow_main_target_flow_evidence',
          kind: 'data' as const,
          source: { workflowId: 'source_flow', portId: 'main' },
          target: { workflowId: 'target_flow', portId: 'evidence' },
          materialization: 'copy' as const,
        },
      ],
    };

    const { onCanvasChange, onNotice, onSelect } = renderCanvas(
      canvas as ReturnType<typeof canvasFixture>,
      { type: 'task_canvas', taskId: 'acc_workspace_canvas' },
      'data',
    );
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onConnect as (connection: Record<string, unknown>) => void)({
        source: 'source_agent',
        sourceHandle: 'source_agent:output:main',
        target: 'target_flow',
        targetHandle: 'target_flow:input:evidence',
      });
    });

    expect(onCanvasChange).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'edge' }));
    expect(onNotice).toHaveBeenCalledWith('Target input port 已有 data edge: target_flow.evidence');
  });

  test('schema removed source output port marks data edge broken', async () => {
    const baseCanvas = canvasFixture();
    const canvas = {
      ...baseCanvas,
      workflows: baseCanvas.workflows.map((workflowValue) => {
        if (workflowValue.id === 'source_agent') {
          return {
            ...workflowValue,
            outputSchema: {
              type: 'object',
              properties: {
                outputs: {
                  type: 'object',
                  properties: {
                    valuation_view: { type: 'string' },
                  },
                },
              },
            },
            outputPorts: [
              { id: 'main', label: 'main', direction: 'output' },
              { id: 'valuation_conclusion', label: 'stale', direction: 'output' },
            ],
          };
        }
        if (workflowValue.id === 'target_flow') {
          return {
            ...workflowValue,
            inputPorts: [
              { id: 'main', label: 'input', direction: 'input' },
              { id: 'valuation_conclusion', label: 'valuation', direction: 'input' },
            ],
          };
        }
        return workflowValue;
      }),
      edges: [
        {
          id: 'data_stale_valuation',
          kind: 'data' as const,
          source: { workflowId: 'source_agent', portId: 'valuation_conclusion' },
          target: { workflowId: 'target_flow', portId: 'valuation_conclusion' },
          materialization: 'copy' as const,
        },
      ],
    };

    renderCanvas(
      canvas as ReturnType<typeof canvasFixture>,
      { type: 'edge', id: 'data_stale_valuation', scopeWorkflowId: null },
      'data',
    );
    await waitForFlowNodes();

    const edges = flowMock.props?.edges as Array<{
      id: string;
      className?: string;
      data?: { diagnostics?: Array<Record<string, unknown>> };
    }>;
    const [edge] = edges.filter((item) => item.id === 'root::data_stale_valuation');
    expect(edge.className).toContain('workflow-edge-broken');
    expect(edge.data?.diagnostics).toEqual([
      expect.objectContaining({
        code: 'dangling_data_edge_source',
        nodeId: 'source_agent',
        portId: 'valuation_conclusion',
        expectedSchemaPath: '/properties/outputs/properties/valuation_conclusion',
      }),
    ]);
  });

  test('agent nodes keep hidden data handles when data ports are not visible', () => {
    const { container } = render(
      <AgentToolNode
        id="source_agent"
        selected={false}
        dragging={false}
        zIndex={0}
        isConnectable={true}
        type="agentToolNode"
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'source_agent',
          title: 'Source Agent',
          kind: 'Agent',
          status: 'not_run',
          inputPorts: [{ id: 'main', label: 'input', direction: 'input' }],
          outputPorts: [{ id: 'main', label: 'output', direction: 'output' }],
          showDataPorts: false,
          onSelect: vi.fn(),
          onSelectPort: vi.fn(),
        }}
      />,
    );

    expect(container.querySelector('#source_agent\\:input\\:main.workflow-port-handle.hidden.input')).toBeTruthy();
    expect(container.querySelector('#source_agent\\:output\\:main.workflow-port-handle.hidden.output')).toBeTruthy();
  });

  test('manual data port creation is capped at ten ports per side', () => {
    const canvas = {
      ...canvasFixture(),
      workflows: canvasFixture().workflows.map((item) =>
        item.id === 'target_flow'
          ? {
              ...item,
              inputPorts: Array.from({ length: 10 }, (_, index) => ({
                id: `input_${index}`,
                label: `input_${index}`,
                direction: 'input',
              })),
            }
          : item,
      ),
    };

    expect(() => addPortToDataConnectNode(canvas, null, 'target_flow', 'input', 'input_10')).toThrow(
      '数据端口最多支持 10 个',
    );
  });

  test('internal data edge projection connects to internal data port handles', () => {
    const edge = {
      id: 'data_source_internal_target_internal',
      kind: 'data',
      source: { workflowId: 'source_internal', portId: 'main' },
      target: { workflowId: 'target_internal', portId: 'sentiment_research' },
      materialization: 'copy',
    };

    const [flowEdge] = canvasEdgeToFlowEdge(
      edge,
      'source_flow',
      { type: 'task_canvas', taskId: 'acc_workspace_canvas' },
      'data',
      'source_flow',
    );

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_flow__internal__source_internal',
        target: 'source_flow__internal__target_internal',
        type: 'step',
        sourceHandle: 'source_flow__internal__source_internal:output:main',
        targetHandle: 'source_flow__internal__target_internal:input:sentiment_research',
        className: 'workflow-edge-data',
      }),
    );
  });

  test('boundary main data edge projection maps to visible workflow shell handles', () => {
    const edge = {
      id: 'data_source_flow_workflow_inputs_codex',
      kind: 'data',
      source: { workflowId: 'source_flow__workflow_inputs', portId: 'main' },
      target: { workflowId: 'codex', portId: 'main' },
      materialization: 'copy',
    };

    const [flowEdge] = canvasEdgeToFlowEdge(
      edge,
      'source_flow',
      { type: 'task_canvas', taskId: 'acc_workspace_canvas' },
      'data',
      'source_flow',
    );

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_flow',
        target: 'source_flow__internal__codex',
        type: 'step',
        sourceHandle: 'source_flow:workflow-input-inner-source',
        targetHandle: 'source_flow__internal__codex:control:target',
        className: 'workflow-edge-data workflow-edge-boundary-main',
      }),
    );
  });

  test('boundary main control binding projection maps to visible workflow shell handles', () => {
    const edge = {
      id: 'control_source_flow_workflow_inputs_codex',
      kind: 'control',
      source: { workflowId: 'source_flow__workflow_inputs' },
      target: { workflowId: 'codex' },
    };

    const [flowEdge] = canvasEdgeToFlowEdge(
      edge,
      'source_flow',
      { type: 'task_canvas', taskId: 'acc_workspace_canvas' },
      'control',
      'source_flow',
    );

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_flow',
        target: 'source_flow__internal__codex',
        sourceHandle: 'source_flow:workflow-input-inner-source',
        targetHandle: 'source_flow__internal__codex:control:target',
        className: 'workflow-edge-control workflow-edge-boundary-main',
      }),
    );

    expect(
      canvasEdgeToFlowEdge(
        edge,
        'source_flow',
        { type: 'task_canvas', taskId: 'acc_workspace_canvas' },
        'data',
        'source_flow',
        'data',
      ),
    ).toEqual([]);
  });

  test('workflow shell inner handles point into the container', async () => {
    renderCanvas(canvasFixture(), { type: 'workflow', id: 'source_flow' }, 'control');
    await waitForFlowNodes();
    const nodes = flowMock.props?.nodes as Array<{ id: string; type?: string; data: Record<string, unknown> }>;
    const nodeTypes = flowMock.props?.nodeTypes as Record<string, ComponentType<Record<string, unknown>>>;
    const workflowNode = nodes.find((item) => item.id === 'source_flow');
    expect(workflowNode).toBeTruthy();

    const WorkflowContainerNode = nodeTypes.workflowContainer;
    const { container } = render(
      <WorkflowContainerNode id="source_flow" data={workflowNode!.data} selected={false} />,
    );

    expect(container.querySelector('.workflow-shell-outer-input')?.getAttribute('data-position')).toBe('left');
    expect(container.querySelector('.workflow-shell-inner-input')?.getAttribute('data-position')).toBe('right');
    expect(container.querySelector('.workflow-shell-inner-output')?.getAttribute('data-position')).toBe('left');
    expect(container.querySelector('.workflow-shell-outer-output')?.getAttribute('data-position')).toBe('right');
  });

  test('boundary main data edge projection stays on focused boundary nodes', () => {
    const edge = {
      id: 'data_source_flow_workflow_inputs_codex',
      kind: 'data',
      source: { workflowId: 'source_flow__workflow_inputs', portId: 'main' },
      target: { workflowId: 'codex', portId: 'main' },
      materialization: 'copy',
    };

    const [flowEdge] = canvasEdgeToFlowEdge(
      edge,
      'source_flow',
      { type: 'task_canvas', taskId: 'acc_workspace_canvas' },
      'data',
    );

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_flow__workflow_inputs',
        target: 'codex',
        type: 'step',
        sourceHandle: 'source_flow__workflow_inputs:output:main',
        targetHandle: 'codex:input:main',
        className: 'workflow-edge-data',
      }),
    );
  });

  test('boundary main control binding projection stays on focused boundary nodes', () => {
    const edge = {
      id: 'control_source_flow_workflow_inputs_codex',
      kind: 'control',
      source: { workflowId: 'source_flow__workflow_inputs' },
      target: { workflowId: 'codex' },
    };

    const [flowEdge] = canvasEdgeToFlowEdge(
      edge,
      'source_flow',
      { type: 'task_canvas', taskId: 'acc_workspace_canvas' },
      'control',
    );

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_flow__workflow_inputs',
        target: 'codex',
        sourceHandle: 'source_flow__workflow_inputs:workflow-input-inner-source',
        targetHandle: 'codex:control:target',
        className: 'workflow-edge-control workflow-edge-boundary-main',
      }),
    );
  });

  test('workflow shell output boundary projection maps to visible output handle', () => {
    const edge = {
      id: 'data_codex_source_flow_workflow_outputs',
      kind: 'data',
      source: { workflowId: 'codex', portId: 'main' },
      target: { workflowId: 'source_flow__workflow_outputs', portId: 'main' },
      materialization: 'copy',
    };

    const [flowEdge] = canvasEdgeToFlowEdge(
      edge,
      'source_flow',
      { type: 'task_canvas', taskId: 'acc_workspace_canvas' },
      'control',
      'source_flow',
    );

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_flow__internal__codex',
        target: 'source_flow',
        type: 'step',
        sourceHandle: 'source_flow__internal__codex:control:source',
        targetHandle: 'source_flow:workflow-output-inner-target',
        className: 'workflow-edge-data workflow-edge-boundary-main',
      }),
    );
  });

  test('workflow shell output boundary control binding maps to visible output handle', () => {
    const edge = {
      id: 'control_codex_source_flow_workflow_outputs',
      kind: 'control',
      source: { workflowId: 'codex' },
      target: { workflowId: 'source_flow__workflow_outputs' },
    };

    const [flowEdge] = canvasEdgeToFlowEdge(
      edge,
      'source_flow',
      { type: 'task_canvas', taskId: 'acc_workspace_canvas' },
      'control',
      'source_flow',
    );

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_flow__internal__codex',
        target: 'source_flow',
        sourceHandle: 'source_flow__internal__codex:control:source',
        targetHandle: 'source_flow:workflow-output-inner-target',
        className: 'workflow-edge-control workflow-edge-boundary-main',
      }),
    );
  });

  test('root workflow control projection uses outer shell handles', () => {
    const workflowIds = new Set(['source_flow', 'target_flow']);
    const edge = {
      id: 'control_source_flow_target_flow',
      kind: 'control',
      source: { workflowId: 'source_flow' },
      target: { workflowId: 'target_flow' },
    };

    const [flowEdge] = canvasEdgeToFlowEdge(
      edge,
      null,
      { type: 'task_canvas', taskId: 'acc_workspace_canvas' },
      'control',
      undefined,
      'all',
      false,
      workflowIds,
    );

    expect(flowEdge).toEqual(
      expect.objectContaining({
        source: 'source_flow',
        target: 'target_flow',
        sourceHandle: 'source_flow:workflow-output-outer-source',
        targetHandle: 'target_flow:workflow-input-outer-target',
      }),
    );
    expect(flowEdge.markerEnd).toEqual(expect.objectContaining({ type: 'arrowclosed' }));
  });

  test('workspace canvas passes root workflow control projection to React Flow', async () => {
    const baseCanvas = canvasFixture();
    const canvas = {
      ...baseCanvas,
      workflows: baseCanvas.workflows.map((item) =>
        item.id === 'source_flow' || item.id === 'target_flow'
          ? { ...item, sourceKind: 'workflow' as const }
          : item,
      ),
      edges: [
        {
          id: 'control_source_flow_target_flow',
          kind: 'control' as const,
          source: { workflowId: 'source_flow' },
          target: { workflowId: 'target_flow' },
        },
      ],
    };

    renderCanvas(
      canvas as ReturnType<typeof canvasFixture>,
      { type: 'edge', id: 'control_source_flow_target_flow', scopeWorkflowId: null },
      'control',
    );
    await waitForFlowNodes();

    const edges = flowMock.props?.edges as Array<{
      id: string;
      source: string;
      target: string;
      sourceHandle?: string;
      targetHandle?: string;
    }>;
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'root::control_source_flow_target_flow',
          source: 'source_flow',
          target: 'target_flow',
          sourceHandle: 'source_flow:workflow-output-outer-source',
          targetHandle: 'target_flow:workflow-input-outer-target',
        }),
      ]),
    );
  });

  test('root and child edges with the same canonical id project to unique flow ids', async () => {
    const sharedEdgeId = 'control_shared_source_target';
    const base = canvasFixture();
    const canvas = {
      ...base,
      edges: [
        {
          id: sharedEdgeId,
          kind: 'control' as const,
          source: { workflowId: 'source_agent' },
          target: { workflowId: 'target_flow' },
        },
      ],
      workflows: base.workflows.map((workflowValue) =>
        workflowValue.id === 'source_flow'
          ? {
              ...workflowValue,
              internalNodes: [
                ...workflowValue.internalNodes,
                {
                  id: 'reviewer',
                  name: 'Reviewer',
                  task: 'agent',
                  kind: 'Agent',
                  status: 'not_run',
                  callableId: 'fake-agent.generic',
                  position: { x: 260, y: 72 },
                },
              ],
              internalEdges: [
                {
                  id: sharedEdgeId,
                  kind: 'control' as const,
                  source: { workflowId: 'codex' },
                  target: { workflowId: 'reviewer' },
                },
              ],
            }
          : workflowValue,
      ),
    };

    renderCanvas(canvas as ReturnType<typeof canvasFixture>, { type: 'task_canvas', taskId: 'acc_workspace_canvas' }, 'control');
    await waitForFlowNodes();

    const edges = flowMock.props?.edges as Array<{
      id: string;
      source?: string;
      target?: string;
      sourceHandle?: string;
      targetHandle?: string;
      data?: { edgeAddress?: { scopeWorkflowId: string | null; edgeId: string } };
    }>;
    const ids = edges.map((edgeValue) => edgeValue.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([`root::${sharedEdgeId}`, `workflow:source_flow::${sharedEdgeId}`]);
    expect(edges.map((edgeValue) => edgeValue.data?.edgeAddress)).toEqual(
      [
        { scopeWorkflowId: null, edgeId: sharedEdgeId },
        { scopeWorkflowId: 'source_flow', edgeId: sharedEdgeId },
      ],
    );
    expect(edges.find((edgeValue) => edgeValue.id === `workflow:source_flow::${sharedEdgeId}`)).toEqual(
      expect.objectContaining({
        source: 'source_flow__internal__codex',
        target: 'source_flow__internal__reviewer',
        sourceHandle: 'source_flow__internal__codex:control:source',
        targetHandle: 'source_flow__internal__reviewer:control:target',
      }),
    );
  });

  test('scoped edge deletion does not remove an edge with the same id in another scope', () => {
    const sharedEdgeId = 'control_shared_source_target';
    const base = canvasFixture();
    const canvas = {
      ...base,
      edges: [
        {
          id: sharedEdgeId,
          kind: 'control' as const,
          source: { workflowId: 'source_agent' },
          target: { workflowId: 'target_flow' },
        },
      ],
      workflows: base.workflows.map((workflowValue) =>
        workflowValue.id === 'source_flow'
          ? {
              ...workflowValue,
              internalEdges: [
                {
                  id: sharedEdgeId,
                  kind: 'control' as const,
                  source: { workflowId: 'codex' },
                  target: { workflowId: 'reviewer' },
                },
              ],
            }
          : workflowValue,
      ),
    } as ReturnType<typeof canvasFixture>;

    const withoutRoot = deleteSelectionFromCanvas(canvas, {
      type: 'edge',
      id: sharedEdgeId,
      scopeWorkflowId: null,
    });
    expect(withoutRoot.edges).toHaveLength(0);
    expect(withoutRoot.workflows.find((workflowValue) => workflowValue.id === 'source_flow')?.internalEdges).toHaveLength(1);

    const withoutChild = deleteSelectionFromCanvas(canvas, {
      type: 'edge',
      id: sharedEdgeId,
      scopeWorkflowId: 'source_flow',
    });
    expect(withoutChild.edges).toHaveLength(1);
    expect(withoutChild.workflows.find((workflowValue) => workflowValue.id === 'source_flow')?.internalEdges).toHaveLength(0);
  });

  test('state machine rejects workflow inner handles connected to root nodes', () => {
    const canvas = canvasFixture();

    const innerInputToRoot = resolveScopedConnection(
      canvas,
      {
        source: 'source_flow',
        target: 'source_agent',
        sourceHandle: 'source_flow:workflow-input-inner-source',
        targetHandle: null,
      },
      'control',
    );
    const rootToInnerOutput = resolveScopedConnection(
      canvas,
      {
        source: 'source_agent',
        target: 'source_flow',
        sourceHandle: null,
        targetHandle: 'source_flow:workflow-output-inner-target',
      },
      'control',
    );

    expect(innerInputToRoot).toEqual(expect.objectContaining({ accepted: false }));
    expect(rootToInnerOutput).toEqual(expect.objectContaining({ accepted: false }));
  });

  test('workflow shell rendering hides duplicate equivalent internal boundary edges', async () => {
    const base = canvasFixture();
    const duplicateEdge = {
      id: 'data_codex_source_flow_workflow_outputs',
      kind: 'data' as const,
      source: { workflowId: 'codex', portId: 'main' },
      target: { workflowId: 'source_flow__workflow_outputs', portId: 'main' },
      materialization: 'copy' as const,
    };
    const canvas = {
      ...base,
      workflows: base.workflows.map((workflow) =>
        workflow.id === 'source_flow'
          ? {
              ...workflow,
              internalEdges: [
                duplicateEdge,
                { ...duplicateEdge, id: 'data_codex_source_flow_workflow_outputs_2' },
              ],
            }
          : workflow,
      ),
    };

    renderCanvas(
      canvas as unknown as ReturnType<typeof canvasFixture>,
      { type: 'workflow', id: 'source_flow' },
      'control',
    );
    await waitForFlowNodes();

    const edges = flowMock.props?.edges as Array<{ id: string }>;
    expect(edges.filter((edge) => edge.id.includes('workflow_outputs'))).toHaveLength(1);
  });

  test('data mode creates a data edge by clicking output then input ports', async () => {
    const { canvas, onCanvasChange, onSelect } = renderCanvas(
      canvasWithTargetEvidencePort(),
      { type: 'port', workflowId: 'source_agent', portId: 'main', direction: 'output' },
      'data',
    );
    await waitForFlowNodes();

    const nodes = flowMock.props?.nodes as Array<{ id: string; data: Record<string, unknown> }>;
    const targetNode = nodes.find((node) => node.id === 'target_flow');
    expect(targetNode).toBeTruthy();

    act(() => {
      (targetNode!.data.onSelectPort as (workflowId: string, port: unknown) => void)('target_flow', {
        id: 'evidence',
        label: 'evidence',
        direction: 'input',
      });
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    expect(nextCanvas.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'data',
          source: expect.objectContaining({ workflowId: 'source_agent', portId: 'main' }),
          target: expect.objectContaining({ workflowId: 'target_flow', portId: 'evidence' }),
        }),
      ]),
    );
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ type: 'edge' }));
  });

  test('data mode connects two internal nodes by selecting source then target', async () => {
    const canvas = {
      ...canvasFixture(),
      workflows: [
        workflow('source_flow', 100, 100, [
          {
            id: 'source_internal',
            name: 'Source Agent',
            task: 'source',
            kind: 'Agent',
            status: 'not_run',
            callableId: 'fake-agent.generic',
            position: { x: 40, y: 72 },
          },
          {
            id: 'target_internal',
            name: 'Target Agent',
            task: 'target',
            kind: 'Agent',
            status: 'not_run',
            callableId: 'fake-agent.generic',
            inputPorts: [{ id: 'evidence', label: 'evidence', direction: 'input' }],
            position: { x: 360, y: 72 },
          },
        ]),
      ],
    };
    const { onCanvasChange, onSelect } = renderCanvas(
      canvas,
      { type: 'internal', workflowId: 'source_flow', nodeId: 'source_internal' },
      'data',
    );
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onConnect as (connection: unknown) => void)({
        source: 'source_flow__internal__source_internal',
        target: 'source_flow__internal__target_internal',
        sourceHandle: 'source_flow__internal__source_internal:output:main',
        targetHandle: 'source_flow__internal__target_internal:input:evidence',
      });
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    expect(nextCanvas.workflows[0].internalEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'data',
          source: expect.objectContaining({ workflowId: 'source_internal', portId: 'main' }),
          target: expect.objectContaining({ workflowId: 'target_internal', portId: 'evidence' }),
        }),
        expect.objectContaining({
          kind: 'control',
          source: expect.objectContaining({ workflowId: 'source_internal' }),
          target: expect.objectContaining({ workflowId: 'target_internal' }),
        }),
      ]),
    );
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ type: 'edge' }));
  });

  test('data mode rejects connections that do not hit explicit port handles', async () => {
    const { onCanvasChange, onNotice } = renderCanvas(
      canvasFixture(),
      { type: 'workflow', id: 'source_agent' },
      'data',
    );
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onConnect as (connection: unknown) => void)({
        source: 'source_agent',
        target: 'target_flow',
        sourceHandle: null,
        targetHandle: null,
      });
    });

    expect(onCanvasChange).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith('Data Edge 必须从 output port 连接到 input port');
  });
});

describe('WorkspaceCanvas drag buffer', () => {
  test('agent tool node body remains draggable while still selecting on pointer down', () => {
    const onSelect = vi.fn();
    const view = render(
      <AgentToolNode
        data={{
          id: 'stock_research',
          title: 'Stock Research Agent',
          subtitle: 'stock-market-research.codex',
          kind: 'Agent',
          status: 'not_run',
          selected: false,
          callableId: 'stock-market-research.codex',
          inputPorts: [{ id: 'main', label: 'input', direction: 'input' }],
          outputPorts: [{ id: 'main', label: 'output', direction: 'output' }],
          showDataPorts: false,
          onSelect,
          onSelectPort: vi.fn(),
        }}
      />,
    );

    const node = view.getByTestId('agent-tool-node-stock_research');
    expect(node.tagName).toBe('DIV');
    expect(node).not.toHaveClass('nodrag');

    fireEvent.pointerDown(node);
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(node, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  test('live events expose nested workflow node status through ui node ids', () => {
    const liveRun = liveWorkflowRunFromEvents(
      {
        id: 'task_run',
        version: '1.0',
        nodes: [
          {
            id: 'New_Workflow',
            callable_ref: { kind: 'workflow_function', id: 'New_Workflow' },
            kind: 'workflow',
          },
        ],
        edges: [],
      },
      'runs/task_run',
      [
        { type: 'workflow_started', status: 'running' },
        { type: 'node_started', node_id: 'New_Workflow', status: 'running' },
        {
          type: 'node_started',
          node_id: 'inner_agent',
          ui_node_id: 'New_Workflow__internal__inner_agent',
          parent_node_id: 'New_Workflow',
          callable_id: 'fake-agent.generic',
          status: 'running',
        },
      ],
    );

    expect(liveRun.status).toBe('running');
    expect(liveRun.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_id: 'inner_agent',
          ui_node_id: 'New_Workflow__internal__inner_agent',
          parent_node_id: 'New_Workflow',
          status: 'running',
        }),
      ]),
    );
  });

  test('run state merge keeps snapshot success when event tail omits early nested node', () => {
    const graph = {
      id: 'task_run',
      version: '1.0',
      nodes: [{ id: 'New_Workflow', callable_ref: { kind: 'workflow_function', id: 'New_Workflow' }, kind: 'workflow' }],
      edges: [],
    };
    const snapshotRun = {
      workflow_id: 'task_run',
      status: 'running',
      run_dir: 'runs/task_run',
      nodes: [
        {
          node_id: 'inner_early',
          ui_node_id: 'New_Workflow__internal__inner_early',
          parent_node_id: 'New_Workflow',
          callable_id: 'fake-agent.generic',
          status: 'success',
          run_dir: 'runs/task_run/nodes/New_Workflow/nested_workflow/nodes/inner_early',
        },
      ],
      edges: [],
      errors: [],
    };
    const eventRun = liveWorkflowRunFromEvents(graph as any, 'runs/task_run', [
      {
        type: 'node_started',
        node_id: 'inner_late',
        ui_node_id: 'New_Workflow__internal__inner_late',
        parent_node_id: 'New_Workflow',
        callable_id: 'fake-agent.generic',
      },
    ]);

    const merged = mergeWorkflowRunWithEvents(snapshotRun as any, eventRun);

    expect(merged.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ui_node_id: 'New_Workflow__internal__inner_early',
          status: 'success',
        }),
        expect.objectContaining({
          ui_node_id: 'New_Workflow__internal__inner_late',
          status: 'running',
        }),
      ]),
    );
  });

  test('run state merge is monotonic for not_run, running, and terminal statuses', () => {
    const snapshotRun = {
      workflow_id: 'task_run',
      status: 'success',
      run_dir: 'runs/task_run',
      nodes: [
        {
          node_id: 'done',
          callable_id: 'fake-agent.generic',
          status: 'success',
          run_dir: 'runs/task_run/nodes/done',
        },
        {
          node_id: 'pending',
          callable_id: 'fake-agent.generic',
          status: 'not_run',
          run_dir: 'runs/task_run/nodes/pending',
        },
        {
          node_id: 'active',
          callable_id: 'fake-agent.generic',
          status: 'running',
          run_dir: 'runs/task_run/nodes/active',
        },
      ],
      edges: [],
      errors: [],
    };
    const eventRun = {
      workflow_id: 'task_run',
      status: 'running',
      run_dir: 'runs/task_run',
      nodes: [
        {
          node_id: 'done',
          callable_id: 'fake-agent.generic',
          status: 'not_run',
          run_dir: 'runs/task_run/nodes/done',
        },
        {
          node_id: 'pending',
          callable_id: 'fake-agent.generic',
          status: 'running',
          run_dir: 'runs/task_run/nodes/pending',
        },
        {
          node_id: 'active',
          callable_id: 'fake-agent.generic',
          status: 'success',
          run_dir: 'runs/task_run/nodes/active',
        },
      ],
      edges: [],
      errors: [],
    };

    const merged = mergeWorkflowRunWithEvents(snapshotRun as any, eventRun as any);
    const statuses = Object.fromEntries(merged.nodes.map((node) => [node.node_id, node.status]));

    expect(merged.status).toBe('success');
    expect(statuses.done).toBe('success');
    expect(statuses.pending).toBe('running');
    expect(statuses.active).toBe('success');
  });

  test('run overlay does not project a root node status onto same-id internal nodes', () => {
    const base = canvasFixture();
    const canvas = {
      ...base,
      workflows: base.workflows.map((workflowValue) =>
        workflowValue.id === 'source_flow'
          ? {
              ...workflowValue,
              internalNodes: [
                {
                  id: 'source_agent',
                  name: 'Same ID Internal Agent',
                  task: 'agent',
                  kind: 'Agent',
                  status: 'not_run',
                  callableId: 'fake-agent.generic',
                  position: { x: 40, y: 72 },
                },
              ],
            }
          : workflowValue,
      ),
    };
    const overlay = runOverlayFromRun(
      {
        workflow_id: 'task_run',
        status: 'running',
        run_dir: 'runs/task_run',
        nodes: [
          {
            node_id: 'source_agent',
            callable_id: 'fake-agent.generic',
            status: 'running',
            run_dir: 'runs/task_run/nodes/source_agent',
          },
        ],
        edges: [],
      },
      { runId: 'task_run', scope: 'task', targetId: 'acc_workspace_canvas' },
    );

    const projected = applyRunOverlayToCanvas(canvas as any, overlay) as typeof canvas;
    const internalNodes = projected.workflows.find((workflowValue) => workflowValue.id === 'source_flow')
      ?.internalNodes as Array<{ id: string; status: string }> | undefined;
    expect(projected.workflows.find((workflowValue) => workflowValue.id === 'source_agent')?.status).toBe('running');
    expect(internalNodes?.find((node) => node.id === 'source_agent')?.status).toBe('not_run');
  });

  test('dragging position changes update local flow nodes without committing canvas', async () => {
    const { onCanvasChange } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        { id: 'source_flow', type: 'position', position: { x: 260, y: 340 }, dragging: true },
      ]);
    });

    expect(currentNode('source_flow').position).toEqual({ x: 260, y: 340 });
    expect(onCanvasChange).not.toHaveBeenCalled();
  });

  test('layout sync version resets uncommitted local drag positions to the canvas projection', async () => {
    const { canvas, onCanvasChange, rerender } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        { id: 'target_flow', type: 'position', position: { x: 780, y: 640 }, dragging: true },
      ]);
    });

    expect(currentNode('target_flow').position).toEqual({ x: 780, y: 640 });
    expect(onCanvasChange).not.toHaveBeenCalled();

    rerender(
      <WorkspaceCanvas
        canvas={canvas}
        layoutSyncVersion={1}
        selection={{ type: 'workflow', id: 'source_flow' }}
        connectionMode="control"
        workflowRun={null}
        focusedWorkflowId={null}
        callables={[]}
        workflows={[]}
        bindings={{}}
        onFocusedWorkflow={vi.fn()}
        onCanvasChange={onCanvasChange}
        onSelect={vi.fn()}
        onBlankCanvas={vi.fn()}
        onConfigureWorkflow={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(currentNode('target_flow').position).toEqual({ x: 620, y: 120 });
    });
  });

  test('drag end commits only once and uses the final buffered position', async () => {
    const { canvas, onCanvasChange, rerender } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        { id: 'source_agent', type: 'position', position: { x: 210, y: 480 }, dragging: true },
      ]);
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        { id: 'source_agent', type: 'position', position: { x: 360, y: 540 }, dragging: true },
      ]);
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        { id: 'source_agent', type: 'position', position: { x: 480, y: 620 }, dragging: false },
      ]);
    });

    expect(currentNode('source_agent').position).toEqual({ x: 480, y: 620 });
    expect(onCanvasChange).toHaveBeenCalledTimes(1);

    act(() => {
      (flowMock.props?.onNodeDragStop as (event: unknown, node: unknown) => void)(
        {},
        { id: 'source_agent', position: { x: 120, y: 450 } },
      );
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    expect(nextCanvas.workflows.find((item) => item.id === 'source_agent')?.position).toEqual({
      x: 480,
      y: 620,
    });
  });

  test('repeated drags of the same workflow commit distinct final positions', async () => {
    const { canvas, onCanvasChange } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        { id: 'target_flow', type: 'position', position: { x: 760, y: 260 }, dragging: false },
      ]);
    });
    expect(onCanvasChange).toHaveBeenCalledTimes(1);

    const firstUpdater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const firstCanvas = firstUpdater(canvas);
    expect(firstCanvas.workflows.find((item) => item.id === 'target_flow')?.position).toEqual({
      x: 760,
      y: 260,
    });

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        { id: 'target_flow', type: 'position', position: { x: 900, y: 520 }, dragging: false },
      ]);
    });
    expect(onCanvasChange).toHaveBeenCalledTimes(2);

    const secondUpdater = onCanvasChange.mock.calls[1][0] as (current: typeof firstCanvas) => typeof firstCanvas;
    const secondCanvas = secondUpdater(firstCanvas);
    expect(secondCanvas.workflows.find((item) => item.id === 'target_flow')?.position).toEqual({
      x: 900,
      y: 520,
    });
  });

  test('internal node dragging only moves the node before release', async () => {
    const { canvas, onCanvasChange } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: -80, y: -60 },
          dragging: true,
        },
      ]);
    });

    const internalNode = currentNode('source_flow__internal__codex');
    expect(currentNode('source_flow').position).toEqual({ x: 100, y: 100 });
    expect(internalNode.position).toEqual({ x: -80, y: -60 });
    expect(internalNode.parentId).toBe('source_flow');
    expect(internalNode.extent).toBe('parent');
    expect((canvas.workflows[0].internalNodes[0] as { position: { x: number; y: number } }).position).toEqual({
      x: 40,
      y: 72,
    });
    expect(onCanvasChange).not.toHaveBeenCalled();
  });

  test('internal node drag does not create a click-to-connect edge from prior selection', async () => {
    const base = canvasFixture();
    const canvas = {
      ...base,
      workflows: base.workflows.map((item) =>
        item.id === 'source_flow'
          ? {
              ...item,
              internalNodes: [
                ...item.internalNodes,
                {
                  id: 'reviewer',
                  name: 'Reviewer',
                  task: 'agent',
                  kind: 'Agent',
                  status: 'not_run',
                  callableId: 'fake-agent.generic',
                  position: { x: 360, y: 72 },
                },
              ],
            }
          : item,
      ),
    };
    const { onCanvasChange, onSelect } = renderCanvas(canvas, {
      type: 'internal',
      workflowId: 'source_flow',
      nodeId: 'codex',
    });
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__reviewer',
          type: 'position',
          position: { x: 420, y: 112 },
          dragging: false,
        },
      ]);
      (flowMock.props?.onNodeClick as (event: unknown, node: unknown) => void)(
        {},
        { id: 'source_flow__internal__reviewer' },
      );
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    expect(sourceFlow?.internalEdges).toEqual([]);
    expect(onSelect).toHaveBeenLastCalledWith({
      type: 'internal',
      workflowId: 'source_flow',
      nodeId: 'reviewer',
    });
  });

  test('internal node drag end expands workflow around its center without moving the child visually', async () => {
    const { canvas, onCanvasChange, rerender } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: -80, y: -60 },
          dragging: true,
        },
      ]);
    });
    expect(onCanvasChange).not.toHaveBeenCalled();

    act(() => {
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: -80, y: -60 },
          dragging: false,
        },
      ]);
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    const codex = sourceFlow?.internalNodes.find((item) => (item as { id: string }).id === 'codex') as
      | { position: { x: number; y: number } }
      | undefined;

    expect(sourceFlow?.position).toEqual({ x: 20, y: 40 });
    expect(codex?.position).toEqual({ x: 0, y: 0 });
    expect((sourceFlow?.position.x || 0) + (codex?.position?.x || 0)).toBe(20);
    expect((sourceFlow?.position.y || 0) + (codex?.position?.y || 0)).toBe(40);

    rerender(
      <WorkspaceCanvas
        canvas={nextCanvas}
        selection={{ type: 'workflow', id: 'source_flow' }}
        connectionMode="control"
        workflowRun={null}
        focusedWorkflowId={null}
        callables={[]}
        workflows={[]}
        bindings={{}}
        onFocusedWorkflow={vi.fn()}
        onCanvasChange={onCanvasChange}
        onSelect={vi.fn()}
        onBlankCanvas={vi.fn()}
        onConfigureWorkflow={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(currentNode('source_flow').position).toEqual({ x: 20, y: 40 });
      expect(currentNode('source_flow__internal__codex').position).toEqual({ x: 0, y: 0 });
    });

    act(() => {
      (flowMock.props?.onNodeDragStop as (event: unknown, node: unknown) => void)(
        {},
        { id: 'source_flow__internal__codex', position: { x: 40, y: 72 } },
      );
    });
    expect(onCanvasChange).toHaveBeenCalledTimes(1);
  });

  test('internal node released inside another workflow reparents and preserves executable fields', async () => {
    const { canvas, onCanvasChange } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: 550, y: 50 },
          dragging: false,
        },
      ]);
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    const targetFlow = nextCanvas.workflows.find((item) => item.id === 'target_flow');
    const moved = targetFlow?.internalNodes.find((item) => (item as { id: string }).id === 'codex') as
      | { name: string; callableId?: string; runtime?: string; position: { x: number; y: number } }
      | undefined;

    expect(sourceFlow?.internalNodes.some((item) => (item as { id: string }).id === 'codex')).toBe(false);
    expect(moved).toEqual(
      expect.objectContaining({
        name: 'Codex CLI',
        callableId: 'fake-agent.generic',
        position: { x: 30, y: 30 },
      }),
    );
  });

  test('internal node released inside another workflow is renamed when target scope already has the id', async () => {
    const base = canvasFixture();
    const canvas = {
      ...base,
      workflows: base.workflows.map((item) =>
        item.id === 'target_flow'
          ? {
              ...item,
              internalNodes: [
                {
                  id: 'codex',
                  name: 'Existing Codex',
                  task: 'existing',
                  kind: 'Agent',
                  status: 'not_run',
                  callableId: 'fake-agent.generic',
                  position: { x: 90, y: 90 },
                },
              ],
            }
          : item,
      ),
    };
    const { onCanvasChange, onSelect } = renderCanvas(canvas, {
      type: 'internal',
      workflowId: 'source_flow',
      nodeId: 'codex',
    });
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: 550, y: 50 },
          dragging: false,
        },
      ]);
    });

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    const targetFlow = nextCanvas.workflows.find((item) => item.id === 'target_flow');
    const targetIds = targetFlow?.internalNodes.map((item) => (item as { id: string }).id);

    expect(sourceFlow?.internalNodes.some((item) => (item as { id: string }).id === 'codex')).toBe(false);
    expect(targetIds).toEqual(['codex', 'codex_2']);
    expect(onSelect).toHaveBeenCalledWith({
      type: 'internal',
      workflowId: 'target_flow',
      nodeId: 'codex_2',
    });
  });

  test('internal node drag through a partial-outside position does not move empty source workflow when reparenting', async () => {
    const { canvas, onCanvasChange } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: -80, y: -60 },
          dragging: true,
        },
      ]);
    });
    expect(currentNode('source_flow').position).toEqual({ x: 100, y: 100 });

    act(() => {
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: 638, y: 118 },
          dragging: false,
        },
      ]);
    });

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    const targetFlow = nextCanvas.workflows.find((item) => item.id === 'target_flow');
    const moved = targetFlow?.internalNodes.find((item) => (item as { id: string }).id === 'codex') as
      | { position: { x: number; y: number }; callableId?: string }
      | undefined;

    expect(sourceFlow?.position).toEqual({ x: 100, y: 100 });
    expect(sourceFlow?.internalNodes).toHaveLength(0);
    expect((targetFlow?.position.x || 0) + (moved?.position.x || 0)).toBe(738);
    expect((targetFlow?.position.y || 0) + (moved?.position.y || 0)).toBe(218);
    expect(moved?.callableId).toBe('fake-agent.generic');
  });

  test('internal node drag through a partial-outside position does not move empty source workflow when dragging to root', async () => {
    const { canvas, onCanvasChange } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: -80, y: -60 },
          dragging: true,
        },
      ]);
    });
    expect(currentNode('source_flow').position).toEqual({ x: 100, y: 100 });

    act(() => {
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: 920, y: 500 },
          dragging: false,
        },
      ]);
    });

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    const rootNode = nextCanvas.workflows.find((item) => item.id === 'codex') as
      | { position: { x: number; y: number }; sourceKind?: string; callableId?: string }
      | undefined;

    expect(sourceFlow?.position).toEqual({ x: 100, y: 100 });
    expect(sourceFlow?.internalNodes).toHaveLength(0);
    expect(rootNode?.position).toEqual({ x: 1020, y: 600 });
    expect(rootNode?.sourceKind).toBe('agent_session');
    expect(rootNode?.callableId).toBe('fake-agent.generic');
  });

  test('internal node released outside every workflow is renamed when root scope already has the id', async () => {
    const base = canvasFixture();
    const canvas = {
      ...base,
      workflows: [
        ...base.workflows,
        agentWorkflow('codex', 1100, 500),
      ],
    };
    const { onCanvasChange, onSelect } = renderCanvas(canvas, {
      type: 'internal',
      workflowId: 'source_flow',
      nodeId: 'codex',
    });
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: 920, y: 500 },
          dragging: false,
        },
      ]);
    });

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);

    expect(nextCanvas.workflows.filter((item) => item.id === 'codex')).toHaveLength(1);
    expect(nextCanvas.workflows.some((item) => item.id === 'codex_2')).toBe(true);
    expect(onSelect).toHaveBeenCalledWith({ type: 'workflow', id: 'codex_2' });
  });

  test('root executable dragged into workflow is selected as an internal node', async () => {
    const { onCanvasChange, onSelect } = renderCanvas(canvasFixture(), {
      type: 'workflow',
      id: 'source_agent',
    });
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_agent',
          type: 'position',
          position: { x: 650, y: 150 },
          dragging: false,
        },
      ]);
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({
      type: 'internal',
      workflowId: 'target_flow',
      nodeId: 'source_agent',
    });
  });

  test('root executable dragged into workflow is renamed when target internal scope already has the id', async () => {
    const base = canvasFixture();
    const canvas = {
      ...base,
      workflows: base.workflows.map((item) =>
        item.id === 'target_flow'
          ? {
              ...item,
              internalNodes: [
                {
                  id: 'source_agent',
                  name: 'Existing Source Agent',
                  task: 'existing',
                  kind: 'Agent',
                  status: 'not_run',
                  callableId: 'fake-agent.generic',
                  position: { x: 80, y: 80 },
                },
              ],
            }
          : item,
      ),
    };
    const { onCanvasChange, onSelect } = renderCanvas(canvas, {
      type: 'workflow',
      id: 'source_agent',
    });
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_agent',
          type: 'position',
          position: { x: 650, y: 150 },
          dragging: false,
        },
      ]);
    });

    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const targetFlow = nextCanvas.workflows.find((item) => item.id === 'target_flow');

    expect(nextCanvas.workflows.some((item) => item.id === 'source_agent')).toBe(false);
    expect(targetFlow?.internalNodes.map((item) => (item as { id: string }).id)).toEqual([
      'source_agent',
      'source_agent_2',
    ]);
    expect(onSelect).toHaveBeenCalledWith({
      type: 'internal',
      workflowId: 'target_flow',
      nodeId: 'source_agent_2',
    });
  });

  test('internal node released outside every workflow becomes a root executable node', async () => {
    const { canvas, onCanvasChange } = renderCanvas();
    await waitForFlowNodes();

    act(() => {
      (flowMock.props?.onNodeDragStart as () => void)();
      (flowMock.props?.onNodesChange as (changes: unknown[]) => void)([
        {
          id: 'source_flow__internal__codex',
          type: 'position',
          position: { x: 920, y: 500 },
          dragging: false,
        },
      ]);
    });

    expect(onCanvasChange).toHaveBeenCalledTimes(1);
    const updater = onCanvasChange.mock.calls[0][0] as (current: typeof canvas) => typeof canvas;
    const nextCanvas = updater(canvas);
    const sourceFlow = nextCanvas.workflows.find((item) => item.id === 'source_flow');
    const rootNode = nextCanvas.workflows.find((item) => item.id === 'codex') as
      | { title: string; sourceKind?: string; callableId?: string; position: { x: number; y: number } }
      | undefined;

    expect(sourceFlow?.internalNodes.some((item) => (item as { id: string }).id === 'codex')).toBe(false);
    expect(rootNode).toEqual(
      expect.objectContaining({
        title: 'Codex CLI',
        sourceKind: 'agent_session',
        callableId: 'fake-agent.generic',
        position: { x: 1020, y: 600 },
      }),
    );
  });
});
