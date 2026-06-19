import type {
  WorkflowDataEdge,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowPort,
  WorkflowRunResult,
} from '../../types';
import type {
  CodexExecutionMode,
  EmptyInputPolicy,
  InternalNodeView,
  PortDirection,
  WorkflowCanvasEdge,
  WorkflowContainerModel,
  WorkflowPortView,
  WorkflowStatus,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import {
  BOUNDARY_NODE_SIZE,
  DEFAULT_CONTAINER_SIZE,
} from '../constants';
import { boundaryTransferFromGraphEdge } from './boundaryTransferProjection';
import {
  boundaryPort,
  internalNodeInputPorts,
  internalNodeOutputPorts,
  port,
} from './workflowGraphProjection';
import {
  emptyInputPolicyFromMetadata,
  normalizedCodexExecutionMode,
} from './taskModel';
import { outputPortsFromSchema } from './schemaPorts';
import {
  workflowInputBoundaryId,
  workflowOutputBoundaryId,
} from './workflowNodeModel';

export function graphToWorkspaceCanvas(
  graph: WorkflowGraph,
  workflowRun: WorkflowRunResult | null,
): WorkspaceCanvasModel {
  const nodeStatus = new Map(workflowRun?.nodes.map((node) => [node.node_id, node.status]) || []);
  const layout = graph.metadata?.layout;
  const isWorkflowFocusGraph =
    layout === 'workflow-focus' ||
    (layout !== 'workspace-canvas' && graph.nodes.every((node) => node.callable_ref.kind !== 'workflow_function'));
  const runtimeWorkflows = graph.nodes.map((node, index) =>
    workflowFromGraphNode(node, index, nodeStatus, isWorkflowFocusGraph),
  );
  const workflows = isWorkflowFocusGraph
    ? [
        workflowFocusInputBoundary(graph),
        ...runtimeWorkflows,
        workflowFocusOutputBoundary(graph),
      ]
    : runtimeWorkflows;
  const metadata = (graph.metadata || {}) as Record<string, unknown>;
  const edges = [
    ...(graph.data_edges || []).map(dataEdgeToCanvasEdge),
    ...(graph.control_edges || graph.edges || []).map(controlEdgeToCanvasEdge),
    ...workflowPortEdgesFromMetadata(metadata),
  ];
  return {
    id: graph.id,
    name: graph.name || graph.id,
    layout: isWorkflowFocusGraph ? 'workflow-focus' : 'workspace-canvas',
    rootWorkflowId:
      typeof metadata.root_workflow_id === 'string'
        ? metadata.root_workflow_id
        : runtimeWorkflows[0]?.id || graph.id,
    exposedOutputs: isWorkflowFocusGraph ? undefined : workflowPortsFromGraph(graph.exposed_outputs, 'output'),
    workflowOutputBindings: isWorkflowFocusGraph ? undefined : graph.workflow_output_bindings,
    workflows,
    edges,
  };
}

function workflowFocusInputBoundary(graph: WorkflowGraph): WorkflowContainerModel {
  return {
    id: workflowInputBoundaryId(graph.id),
    title: 'Workflow Inputs',
    boundaryKind: 'workflow_input',
    directory: 'Workflow boundary',
    status: 'not_run',
    inputPorts: [],
    outputPorts: workflowPortsFromGraph(graph.exposed_inputs, 'input').map((item) =>
      boundaryPort(item, 'output'),
    ),
    internalNodes: [],
    internalEdges: [],
    position: { x: 40, y: 250 },
    size: BOUNDARY_NODE_SIZE,
    warnings: [],
  };
}

function workflowFocusOutputBoundary(graph: WorkflowGraph): WorkflowContainerModel {
  return {
    id: workflowOutputBoundaryId(graph.id),
    title: 'Workflow Outputs',
    boundaryKind: 'workflow_output',
    directory: 'Workflow boundary',
    status: 'not_run',
    inputPorts: workflowPortsFromGraph(graph.exposed_outputs, 'output').map((item) =>
      boundaryPort(item, 'input'),
    ),
    outputPorts: [],
    internalNodes: [],
    internalEdges: [],
    position: { x: Math.max(820, 360 + graph.nodes.length * 420), y: 250 },
    size: BOUNDARY_NODE_SIZE,
    warnings: [],
  };
}

function workflowPortEdgesFromMetadata(metadata: Record<string, unknown>): WorkflowCanvasEdge[] {
  const rawEdges = metadata.workflow_port_edges;
  if (!Array.isArray(rawEdges)) {
    return [];
  }
  return rawEdges.flatMap((edge) => {
    if (isWorkflowDataEdge(edge)) {
      return [dataEdgeToCanvasEdge(edge)];
    }
    if (isWorkflowGraphEdge(edge)) {
      return [controlEdgeToCanvasEdge(edge)];
    }
    return [];
  });
}

function workflowFromGraphNode(
  node: WorkflowGraphNode,
  index: number,
  nodeStatus: Map<string, string>,
  isWorkflowFocusGraph = false,
): WorkflowContainerModel {
  const metadata = (node.ui || {}) as Record<string, unknown>;
  const nodeMetadata = (node.metadata || {}) as Record<string, unknown>;
  const uiLabel =
    typeof nodeMetadata.ui_label === 'string' && nodeMetadata.ui_label.trim()
      ? nodeMetadata.ui_label
      : node.label || node.id;
  const explicitWorkflowContainer = metadata.semantic_kind === 'workflow_container';
  const callableId = node.callable_ref.id;
  const callableKind = node.callable_ref.kind;
  const sourceKind =
    callableKind === 'workflow_function'
      ? 'workflow'
      : callableKind === 'tool_class'
        ? 'tool'
        : 'agent_session';
  const outputSchema = outputSchemaFromGraphNode(node);
  const rawInternalNodes =
    Array.isArray(metadata.internal_nodes)
      ? (metadata.internal_nodes as InternalNodeView[])
      : explicitWorkflowContainer || callableKind === 'workflow_function'
        ? []
        : [
            {
              id: `${node.id}_session`,
              name: uiLabel,
              invocationLabel: uiLabel,
              task: callableId || 'Callable Session',
              kind: callableKind === 'tool_class' ? ('Tool' as const) : ('Agent' as const),
              status: (nodeStatus.get(node.id) as WorkflowStatus) || 'not_run',
              callableId,
              runtime: callableId,
              codexExecutionMode: codexExecutionModeFromGraphNode(node),
              emptyInputPolicy: emptyInputPolicyFromGraphNode(node),
            },
          ];
  const internalNodes = rawInternalNodes.map((internalNodeValue) => ({
    ...internalNodeValue,
    inputPorts: internalNodeInputPorts(internalNodeValue),
    outputPorts: internalNodeOutputPorts(internalNodeValue),
  }));
  const graphOutputPorts = workflowPortsFromGraph(node.output_ports, 'output');
  return {
    id: node.id,
    title: uiLabel,
    invocationLabel: uiLabel,
    sourceKind: explicitWorkflowContainer ? 'workflow' : sourceKind,
    workflowBodyKind:
      callableKind === 'workflow_function'
        ? explicitWorkflowContainer
          ? 'inline_container'
          : 'external_ref'
        : undefined,
    callableId,
    codexExecutionMode: callableKind === 'workflow_function' ? undefined : codexExecutionModeFromGraphNode(node),
    sourceInput: node.input,
    sourceInputMapping: node.input_mapping,
    control: node.control,
    outputSchema,
    forwardMainOutputOnControl: forwardMainOutputFromGraphNode(node),
    emptyInputPolicy: emptyInputPolicyFromGraphNode(node),
    workflowRef: callableKind === 'workflow_function' ? callableId : node.workflow_ref,
    directory:
      typeof metadata.directory === 'string'
        ? metadata.directory
        : directoryForNode(node.id, node.relative_cwd),
    relativeCwd: node.relative_cwd,
    status: (nodeStatus.get(node.id) as WorkflowStatus) || 'not_run',
    inputPorts: workflowPortsFromGraph(node.input_ports, 'input'),
    outputPorts:
      !explicitWorkflowContainer && sourceKind !== 'workflow'
        ? outputPortsFromSchema(outputSchema, graphOutputPorts)
        : graphOutputPorts,
    internalNodes,
    internalEdges: internalEdgesFromMetadata(metadata),
    position: node.position || { x: 80 + index * 500, y: 220 },
    size: DEFAULT_CONTAINER_SIZE,
    warnings: [],
  };
}

function codexExecutionModeFromGraphNode(node: WorkflowGraphNode): CodexExecutionMode {
  return normalizedCodexExecutionMode(node.metadata?.codex_execution_mode);
}

function emptyInputPolicyFromGraphNode(node: WorkflowGraphNode): EmptyInputPolicy {
  return emptyInputPolicyFromMetadata(node.metadata?.empty_input_policy);
}

export function workflowPortsFromGraph(
  ports: WorkflowPort[] | undefined,
  direction: PortDirection,
): WorkflowPortView[] {
  if (!ports || ports.length === 0) {
    return direction === 'input' ? [port('main', 'input', 'input')] : [port('main', 'output', 'output')];
  }
  return ports.map((item) =>
    port(
      item.id,
      item.artifact_types?.join(', ') || item.id,
      direction,
      item.required,
      item.cardinality,
    ),
  );
}

function outputSchemaFromGraphNode(node: WorkflowGraphNode): Record<string, unknown> | undefined {
  return isPlainRecord(node.output_schema) ? node.output_schema : undefined;
}

function forwardMainOutputFromGraphNode(node: WorkflowGraphNode): boolean | null {
  const control = node.control;
  if (!control || typeof control.forward_main_output_on_control !== 'boolean') {
    return null;
  }
  return control.forward_main_output_on_control;
}

function dataEdgeToCanvasEdge(edge: WorkflowDataEdge): WorkflowCanvasEdge {
  const sourcePort = edge.from.port || edge.from.output || edge.from.artifact || 'main';
  const targetPort = edge.to.port || edge.to.input || 'main';
  return {
    id: edge.id || `data_${edge.from.node}_${sourcePort}_${edge.to.node}_${targetPort}`,
    kind: 'data',
    source: { workflowId: edge.from.node, portId: sourcePort },
    target: { workflowId: edge.to.node, portId: targetPort },
    materialization: edge.materialization === 'reference' ? 'reference' : 'copy',
  };
}

function controlEdgeToCanvasEdge(edge: WorkflowGraphEdge): WorkflowCanvasEdge {
  const boundaryTransfer = boundaryTransferFromGraphEdge(edge);
  return {
    id: edge.id || `control_${edge.from}_${edge.to}`,
    kind: 'control',
    source: { workflowId: edge.from },
    target: { workflowId: edge.to },
    condition: edge.condition || null,
    context: 'none',
    ...(boundaryTransfer ? { boundaryTransfer } : {}),
  };
}

function internalEdgesFromMetadata(metadata: Record<string, unknown>): WorkflowCanvasEdge[] {
  const rawEdges = metadata.internal_edges;
  if (!Array.isArray(rawEdges)) {
    return [];
  }
  return rawEdges.flatMap((edge) => {
    if (isWorkflowDataEdge(edge)) {
      return [dataEdgeToCanvasEdge(edge)];
    }
    if (isWorkflowGraphEdge(edge)) {
      return [controlEdgeToCanvasEdge(edge)];
    }
    return [];
  });
}

function isWorkflowDataEdge(edge: unknown): edge is WorkflowDataEdge {
  if (!edge || typeof edge !== 'object') {
    return false;
  }
  const candidate = edge as WorkflowDataEdge;
  return Boolean(candidate.from && typeof candidate.from === 'object' && 'node' in candidate.from);
}

function isWorkflowGraphEdge(edge: unknown): edge is WorkflowGraphEdge {
  if (!edge || typeof edge !== 'object') {
    return false;
  }
  const candidate = edge as WorkflowGraphEdge;
  return typeof candidate.from === 'string' && typeof candidate.to === 'string';
}

function directoryForNode(nodeId: string, relativeCwd?: string): string {
  if (relativeCwd && relativeCwd.trim()) {
    return relativeCwd;
  }
  return `workflows/demo/${nodeId}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
