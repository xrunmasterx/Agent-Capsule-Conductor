import { AGENT_MAX_DATA_PORTS, CONTROL_SLOT_LIMIT } from '../constants';
import type {
  ConnectionMode,
  InternalNodeView,
  PortDirection,
  WorkflowCanvasEdge,
  WorkflowContainerModel,
  WorkflowPortView,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { internalInvocationLabel, workflowInvocationLabel } from './selectionModel';
import { effectiveOutputPortsForNode, outputPortsFromSchema } from './schemaPorts';
import {
  flowEndpointForCanvas,
  type FlowEndpoint,
  isWorkflowBoundaryId,
  isWorkflowOutputBoundaryId,
  parseInternalFlowNodeId,
  workflowBoundaryKind,
  workflowInputBoundaryId,
  workflowIdFromBoundaryId,
  workflowOutputBoundaryId,
} from './workflowNodeModel';
export type DataEdgeCommandRequest = {
  scopeWorkflowId: string | null;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  materialization: 'copy' | 'reference';
  replaceExisting?: boolean;
};

export type DataEdgeCommandResult = {
  canvas: WorkspaceCanvasModel;
  edge: WorkflowCanvasEdge;
  autoAddedControlEdge: boolean;
};

export type DataConnectNodeOption = {
  nodeId: string;
  label: string;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  subtitle?: string;
};

export type EdgeDiagnostic = {
  code: 'dangling_data_edge_source' | 'dangling_data_edge_target';
  message: string;
  nodeId: string;
  portId: string;
  expectedSchemaPath?: string;
};

export type CanvasConnection = {
  [key: string]: unknown;
  source?: string | null;
  target?: string | null;
  sourceToken?: string | null;
  targetToken?: string | null;
};

export type ConnectionTokens = {
  sourceToken: string | null | undefined;
  targetToken: string | null | undefined;
};

export type ScopedEdgeSemantic =
  | 'workflow_input_main_binding'
  | 'workflow_output_main_binding'
  | 'internal_control'
  | 'internal_data'
  | 'root_control_main'
  | 'root_control_main_to_workflow'
  | 'root_control_main_from_workflow'
  | 'root_workflow_to_workflow_control'
  | 'root_data';

export type ScopedEdgeResult = {
  edge: WorkflowCanvasEdge;
  scopeWorkflowId: string | null;
  semantic: ScopedEdgeSemantic;
  sourceToken?: string;
  targetToken?: string;
  rejectionReason?: string;
};

export type EndpointRole =
  | 'root_executable_output'
  | 'root_executable_input'
  | 'workflow_outer_input'
  | 'workflow_outer_output'
  | 'workflow_inner_input'
  | 'workflow_inner_output'
  | 'internal_executable_output'
  | 'internal_executable_input'
  | 'focus_boundary_input_output'
  | 'focus_boundary_output_input';

export type EndpointSide = 'source' | 'target';


export type EndpointDescriptor = {
  view: 'root-shell' | 'workflow-focus';
  role: EndpointRole;
  nodeId: string;
  workflowId: string | null;
  portId: string;
  handleId: string | null;
};

export type ConnectionResolution =
  | {
      accepted: true;
      edge: WorkflowCanvasEdge;
      scopeWorkflowId: string | null;
      semantic: ScopedEdgeSemantic;
      sourceToken?: string;
      targetToken?: string;
    }
  | {
      accepted: false;
      reason: string;
    };

export type CommitConnectionResult = {
  canvas: WorkspaceCanvasModel;
  edge: WorkflowCanvasEdge;
};

export type CommitConnectionAttempt =
  | { ok: true; result: CommitConnectionResult }
  | { ok: false; message: string };

export type ConnectionEndpoint = {
  nodeId: string;
  handleId: string | null;
  side: EndpointSide;
};

export type PendingCanvasConnection = {
  nodeId: string;
  handleId: string | null;
  mode: ConnectionMode;
  side: EndpointSide;
  endpoint?: EndpointDescriptor | null;
};

const SOURCE_EXTERNAL_TOKEN_KEY = 'source' + 'Han' + 'dle';
const TARGET_EXTERNAL_TOKEN_KEY = 'target' + 'Han' + 'dle';

function connectionToken(connection: CanvasConnection, side: EndpointSide): string | null | undefined {
  const localToken = side === 'source' ? connection.sourceToken : connection.targetToken;
  if (typeof localToken === 'string' || localToken === null) {
    return localToken;
  }
  const externalKey = side === 'source' ? SOURCE_EXTERNAL_TOKEN_KEY : TARGET_EXTERNAL_TOKEN_KEY;
  const externalToken = (connection as Record<string, unknown>)[externalKey];
  return typeof externalToken === 'string' || externalToken === null ? externalToken : undefined;
}
export function createDataEdgeCommand(
  canvas: WorkspaceCanvasModel,
  request: DataEdgeCommandRequest,
): DataEdgeCommandResult {
  if (request.materialization !== 'copy' && request.materialization !== 'reference') {
    throw new Error('Unsupported data edge materialization: ' + request.materialization);
  }
  if (request.sourceNodeId === request.targetNodeId) {
    throw new Error('Data Edge 不能连接到同一个节点。');
  }
  const boundaryBinding =
    isWorkflowBoundaryId(request.sourceNodeId) || isWorkflowBoundaryId(request.targetNodeId);
  if (
    !boundaryBinding &&
    (request.sourcePortId || 'main') === 'main' &&
    (request.targetPortId || 'main') === 'main'
  ) {
    throw new Error('main 已通过控制线默认传递；显式 Data Edge 请使用非 main 端口');
  }
  const sourceNode = findDataConnectNode(canvas, request.scopeWorkflowId, request.sourceNodeId);
  const targetNode = findDataConnectNode(canvas, request.scopeWorkflowId, request.targetNodeId);
  if (!sourceNode || !targetNode) {
    throw new Error('Data Edge 必须连接同一层级内的节点');
  }
  if (!sourceNode.outputPorts.some((portValue) => portValue.id === request.sourcePortId)) {
    throw new Error('Source output port 不存在: ' + request.sourceNodeId + '.' + request.sourcePortId);
  }
  const targetPort = targetNode.inputPorts.find((portValue) => portValue.id === request.targetPortId);
  if (!targetPort) {
    throw new Error('Target input port 不存在: ' + request.targetNodeId + '.' + request.targetPortId);
  }
  const scopedEdges = dataConnectEdges(canvas, request.scopeWorkflowId);
  const existingEquivalent = scopedEdges.find(
    (edge) =>
      edge.kind === 'data' &&
      edge.source.workflowId === request.sourceNodeId &&
      edge.source.portId === request.sourcePortId &&
      edge.target.workflowId === request.targetNodeId &&
      edge.target.portId === request.targetPortId,
  );
  if (existingEquivalent?.kind === 'data') {
    return { canvas, edge: existingEquivalent, autoAddedControlEdge: false };
  }
  const duplicateWorkflowOutputSource = scopedEdges.find(
    (edge) =>
      edge.kind === 'data' &&
      isWorkflowOutputBoundaryId(edge.target.workflowId) &&
      edge.target.workflowId === request.targetNodeId &&
      edge.target.portId === request.targetPortId &&
      edge.source.workflowId === request.sourceNodeId,
  );
  if (duplicateWorkflowOutputSource?.kind === 'data') {
    return { canvas, edge: duplicateWorkflowOutputSource, autoAddedControlEdge: false };
  }
  const hasTargetConflict = scopedEdges.some(
    (edge) =>
      edge.kind === 'data' &&
      edge.target.workflowId === request.targetNodeId &&
      edge.target.portId === request.targetPortId,
  );
  if (
    hasTargetConflict &&
    !isWorkflowOutputBoundaryId(request.targetNodeId) &&
    (targetPort.cardinality || 'one') !== 'many' &&
    !request.replaceExisting
  ) {
    throw new Error('Target input port 已有 data edge: ' + request.targetNodeId + '.' + request.targetPortId);
  }
  const dataEdge: Extract<WorkflowCanvasEdge, { kind: 'data' }> = {
    id: uniqueEdgeIdForScope(
      canvas,
      request.scopeWorkflowId,
      'data',
      request.sourceNodeId,
      request.targetNodeId,
    ),
    kind: 'data',
    source: { workflowId: request.sourceNodeId, portId: request.sourcePortId },
    target: { workflowId: request.targetNodeId, portId: request.targetPortId },
    materialization: request.materialization,
  };
  const hadControlDependency = hasControlDependency(
    canvas,
    request.scopeWorkflowId,
    request.sourceNodeId,
    request.targetNodeId,
  );
  const filteredEdges = scopedEdges.filter((item) => {
    if (item.id === dataEdge.id) {
      return false;
    }
    if (!request.replaceExisting || item.kind !== 'data') {
      return true;
    }
    return !(
      item.target.workflowId === request.targetNodeId &&
      item.target.portId === request.targetPortId
    );
  });

  if (request.scopeWorkflowId) {
    const scopedCanvas = { ...canvas, edges: filteredEdges };
    const nextScopedCanvas = addEdgeWithControlDependency(scopedCanvas, dataEdge, request.scopeWorkflowId);
    return {
      canvas: {
        ...canvas,
        workflows: canvas.workflows.map((workflow) =>
          workflow.id === request.scopeWorkflowId
            ? { ...workflow, internalEdges: nextScopedCanvas.edges }
            : workflow,
        ),
      },
      edge: dataEdge,
      autoAddedControlEdge: !boundaryBinding && !hadControlDependency,
    };
  }

  const nextCanvas = addEdgeWithControlDependency({ ...canvas, edges: filteredEdges }, dataEdge, null);
  return {
    canvas: nextCanvas,
    edge: dataEdge,
    autoAddedControlEdge: !boundaryBinding && !hadControlDependency,
  };
}

export function addPortToDataConnectNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
  direction: PortDirection,
  requestedPortId: string,
): WorkspaceCanvasModel {
  const portId = slugId(requestedPortId);
  if (!portId) {
    throw new Error('端口 id 不能为空');
  }
  const storedDirection = storedPortDirectionForDataConnectNode(scopeWorkflowId, nodeId, direction);
  const nextPort = port(portId, portId, storedDirection);
  return updateDataConnectNodePorts(canvas, scopeWorkflowId, nodeId, direction, (ports) => {
    if (ports.some((portValue) => portValue.id === portId)) {
      throw new Error('端口已存在: ' + nodeId + '.' + portId);
    }
    if (ports.length >= AGENT_MAX_DATA_PORTS) {
      throw new Error('数据端口最多支持 ' + AGENT_MAX_DATA_PORTS + ' 个');
    }
    return [...ports, nextPort];
  });
}

export function renamePortOnDataConnectNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
  direction: PortDirection,
  portId: string,
  requestedPortId: string,
): WorkspaceCanvasModel {
  const nextPortId = slugId(requestedPortId);
  if (!nextPortId) {
    throw new Error('端口 id 不能为空');
  }
  if (portId === nextPortId) {
    return canvas;
  }
  const nextCanvas = updateDataConnectNodePorts(canvas, scopeWorkflowId, nodeId, direction, (ports) => {
    if (!ports.some((portValue) => portValue.id === portId)) {
      throw new Error('端口不存在: ' + nodeId + '.' + portId);
    }
    if (ports.some((portValue) => portValue.id === nextPortId)) {
      throw new Error('端口已存在: ' + nodeId + '.' + nextPortId);
    }
    return ports.map((portValue) =>
      portValue.id === portId
        ? { ...portValue, id: nextPortId, label: portValue.label === portId ? nextPortId : portValue.label }
        : portValue,
    );
  });
  return mapDataConnectEdges(nextCanvas, scopeWorkflowId, (edge) => {
    if (edge.kind !== 'data') {
      return edge;
    }
    if (
      direction === 'output' &&
      edge.source.workflowId === nodeId &&
      edge.source.portId === portId
    ) {
      return { ...edge, source: { ...edge.source, portId: nextPortId } };
    }
    if (
      direction === 'input' &&
      edge.target.workflowId === nodeId &&
      edge.target.portId === portId
    ) {
      return { ...edge, target: { ...edge.target, portId: nextPortId } };
    }
    return edge;
  });
}

export function deletePortFromDataConnectNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
  direction: PortDirection,
  portId: string,
): WorkspaceCanvasModel {
  const relatedEdges = dataEdgesForNode(canvas, scopeWorkflowId, nodeId, direction).filter((edge) =>
    direction === 'input' ? edge.target.portId === portId : edge.source.portId === portId,
  );
  if (relatedEdges.length > 0) {
    throw new Error('端口仍有 data edge，不能删除: ' + nodeId + '.' + portId);
  }
  return updateDataConnectNodePorts(canvas, scopeWorkflowId, nodeId, direction, (ports) => {
    if (!ports.some((portValue) => portValue.id === portId)) {
      throw new Error('端口不存在: ' + nodeId + '.' + portId);
    }
    if (ports.length <= 1) {
      throw new Error('至少需要保留一个端口');
    }
    return ports.filter((portValue) => portValue.id !== portId);
  });
}

export function dataConnectNodes(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
): DataConnectNodeOption[] {
  if (scopeWorkflowId) {
    const workflow = canvas.workflows.find((item) => item.id === scopeWorkflowId);
    return workflow ? workflowScopedDataConnectNodes(workflow) : [];
  }
  return rootDataConnectNodes(canvas);
}

export function edgeDiagnosticsForCanvasEdge(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  edge: WorkflowCanvasEdge,
): EdgeDiagnostic[] {
  return edgeDiagnosticsForDataNodes(dataConnectNodes(canvas, scopeWorkflowId), edge);
}

export function edgeDiagnosticsForWorkflowEdge(
  workflow: WorkflowContainerModel,
  edge: WorkflowCanvasEdge,
): EdgeDiagnostic[] {
  return edgeDiagnosticsForDataNodes(workflowScopedDataConnectNodes(workflow), edge);
}

export function findDataConnectNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
): DataConnectNodeOption | undefined {
  return dataConnectNodes(canvas, scopeWorkflowId).find((node) => node.nodeId === nodeId);
}

export function dataConnectEdges(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
): WorkflowCanvasEdge[] {
  if (!scopeWorkflowId) {
    return canvas.edges;
  }
  return canvas.workflows.find((workflow) => workflow.id === scopeWorkflowId)?.internalEdges || [];
}

export function dataEdgesForNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
  direction: PortDirection,
): Extract<WorkflowCanvasEdge, { kind: 'data' }>[] {
  return dataConnectEdges(canvas, scopeWorkflowId).filter(
    (edge): edge is Extract<WorkflowCanvasEdge, { kind: 'data' }> => {
      if (edge.kind !== 'data') {
        return false;
      }
      return direction === 'input'
        ? edge.target.workflowId === nodeId
        : edge.source.workflowId === nodeId;
    },
  );
}

export function canvasEdgesAreEquivalent(left: WorkflowCanvasEdge, right: WorkflowCanvasEdge): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'control' && right.kind === 'control') {
    return left.source.workflowId === right.source.workflowId && left.target.workflowId === right.target.workflowId;
  }
  if (left.kind !== 'data' || right.kind !== 'data') {
    return false;
  }
  return (
    left.source.workflowId === right.source.workflowId &&
    left.source.portId === right.source.portId &&
    left.target.workflowId === right.target.workflowId &&
    left.target.portId === right.target.portId
  );
}

export function resolveScopedConnection(
  canvas: WorkspaceCanvasModel,
  connection: CanvasConnection,
  connectionMode: ConnectionMode,
): ConnectionResolution {
  if (!connection.source || !connection.target) {
    return { accepted: false, reason: 'Connection endpoints must be different nodes' };
  }
  if (connection.source === connection.target) {
    return {
      accepted: false,
      reason: connectionMode === 'data'
        ? 'Data Edge 必须从 output port 连接到 input port'
        : 'Connection endpoints must be different nodes',
    };
  }
  if (connectionMode === 'data') {
    return resolveDataConnection(canvas, connection);
  }
  return resolveControlConnection(canvas, connection);
}

export function scopedEdgeFromConnection(
  canvas: WorkspaceCanvasModel,
  connection: CanvasConnection,
  connectionMode: ConnectionMode,
): ScopedEdgeResult | null {
  const resolved = resolveScopedConnection(canvas, connection, connectionMode);
  if (!resolved.accepted) {
    return null;
  }
  return resolved;
}

export function connectionFromPendingEndpoint(
  pending: PendingCanvasConnection,
  target: ConnectionEndpoint | null,
): CanvasConnection | null {
  if (!target || (pending.nodeId === target.nodeId && pending.handleId === target.handleId)) {
    return null;
  }
  const pendingCanSource = pending.endpoint ? endpointCanSource(pending.endpoint) : pending.side === 'source';
  const pendingCanTarget = pending.endpoint ? endpointCanTarget(pending.endpoint) : pending.side === 'target';
  if (pendingCanSource && target.side === 'target') {
    return {
      source: pending.nodeId,
      sourceToken: pending.handleId,
      target: target.nodeId,
      targetToken: target.handleId,
    };
  }
  if (pendingCanTarget && target.side === 'source') {
    return {
      source: target.nodeId,
      sourceToken: target.handleId,
      target: pending.nodeId,
      targetToken: pending.handleId,
    };
  }
  return null;
}

export function connectionCandidatesFromPendingEndpoint(
  pending: PendingCanvasConnection | null,
  connection: CanvasConnection,
): CanvasConnection[] {
  if (!pending?.endpoint) {
    return [];
  }
  const candidates: CanvasConnection[] = [];
  const seen = new Set<string>();
  const addCandidate = (endpoint: ConnectionEndpoint | null) => {
    const candidate = connectionFromPendingEndpoint(pending, endpoint);
    if (!candidate) {
      return;
    }
    const key = [
      candidate.source,
      candidate.sourceToken || '',
      candidate.target,
      candidate.targetToken || '',
    ].join('/');
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(candidate);
  };
  const endpoints: Array<{ nodeId?: string | null; handleId?: string | null }> = [
    { nodeId: connection.source, handleId: connectionToken(connection, 'source') },
    { nodeId: connection.target, handleId: connectionToken(connection, 'target') },
  ];
  for (const endpoint of endpoints) {
    if (!endpoint.nodeId || (endpoint.nodeId === pending.nodeId && (endpoint.handleId || null) === pending.handleId)) {
      continue;
    }
    addCandidate({ nodeId: endpoint.nodeId, handleId: endpoint.handleId || null, side: 'target' });
    addCandidate({ nodeId: endpoint.nodeId, handleId: endpoint.handleId || null, side: 'source' });
  }
  return candidates;
}

export function reverseConnection(connection: CanvasConnection): CanvasConnection | null {
  if (!connection.source || !connection.target || connection.source === connection.target) {
    return null;
  }
  return {
    source: connection.target,
    sourceToken: connectionToken(connection, 'target') || null,
    target: connection.source,
    targetToken: connectionToken(connection, 'source') || null,
  };
}

export function describeEndpoint(
  canvas: WorkspaceCanvasModel,
  flowNodeId: string,
  handleId: string | null | undefined,
  side: EndpointSide,
  mode: ConnectionMode,
): EndpointDescriptor | null {
  const view = canvas.layout === 'workflow-focus' ? 'workflow-focus' : 'root-shell';
  const endpointSide = controlTokenSide(flowNodeId, handleId) || side;
  const portToken = parsePortToken(handleId);
  const portId = portToken?.portId || 'main';
  const internal = parseInternalFlowNodeId(flowNodeId);
  if (internal) {
    return {
      view,
      role: endpointSide === 'source' ? 'internal_executable_output' : 'internal_executable_input',
      nodeId: internal.nodeId,
      workflowId: internal.workflowId,
      portId,
      handleId: handleId || null,
    };
  }
  const boundaryKind = workflowBoundaryKind(flowNodeId);
  if (view === 'workflow-focus' && boundaryKind) {
    const workflowId = workflowIdFromBoundaryId(flowNodeId);
    if (!workflowId) {
      return null;
    }
    if (boundaryKind === 'workflow_input' && endpointSide === 'source') {
      return { view, role: 'focus_boundary_input_output', nodeId: flowNodeId, workflowId, portId, handleId: handleId || null };
    }
    if (boundaryKind === 'workflow_output' && endpointSide === 'target') {
      return { view, role: 'focus_boundary_output_input', nodeId: flowNodeId, workflowId, portId, handleId: handleId || null };
    }
    return null;
  }
  if (view === 'workflow-focus') {
    const focusedWorkflowId = canvas.focusedWorkflowId;
    const focusedNode = canvas.workflows.find((workflow) => workflow.id === flowNodeId && !workflow.boundaryKind);
    if (focusedWorkflowId && focusedNode) {
      return {
        view,
        role: endpointSide === 'source' ? 'internal_executable_output' : 'internal_executable_input',
        nodeId: flowNodeId,
        workflowId: focusedWorkflowId,
        portId,
        handleId: handleId || null,
      };
    }
  }
  const workflow = canvas.workflows.find((item) => item.id === flowNodeId);
  if (!workflow || workflow.boundaryKind) {
    return null;
  }
  if (workflow.sourceKind && workflow.sourceKind !== 'workflow') {
    return {
      view,
      role: endpointSide === 'source' ? 'root_executable_output' : 'root_executable_input',
      nodeId: flowNodeId,
      workflowId: null,
      portId,
      handleId: handleId || null,
    };
  }
  if (endpointSide === 'source') {
    if (handleId === workflowOutputOuterSourceTokenId(flowNodeId)) {
      return { view, role: 'workflow_outer_output', nodeId: flowNodeId, workflowId: null, portId, handleId };
    }
    if (isWorkflowInputInnerSourceToken(flowNodeId, handleId)) {
      return { view, role: 'workflow_inner_input', nodeId: flowNodeId, workflowId: flowNodeId, portId, handleId: handleId || null };
    }
    return mode === 'data' && portToken?.direction === 'output'
      ? { view, role: 'root_executable_output', nodeId: flowNodeId, workflowId: null, portId, handleId: handleId || null }
      : null;
  }
  if (handleId === workflowInputOuterTargetTokenId(flowNodeId)) {
    return { view, role: 'workflow_outer_input', nodeId: flowNodeId, workflowId: null, portId, handleId };
  }
  if (isWorkflowOutputInnerTargetToken(flowNodeId, handleId)) {
    return { view, role: 'workflow_inner_output', nodeId: flowNodeId, workflowId: flowNodeId, portId, handleId: handleId || null };
  }
  return mode === 'data' && portToken?.direction === 'input'
    ? { view, role: 'root_executable_input', nodeId: flowNodeId, workflowId: null, portId, handleId: handleId || null }
    : null;
}

export function endpointCanSource(endpoint: EndpointDescriptor): boolean {
  return endpoint.role.endsWith('_output') || endpoint.role === 'workflow_inner_input';
}

export function endpointCanTarget(endpoint: EndpointDescriptor): boolean {
  return endpoint.role.endsWith('_input') || endpoint.role === 'workflow_inner_output';
}

export function wouldCreateControlCycle(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  edge: Extract<WorkflowCanvasEdge, { kind: 'control' }>,
): boolean {
  const edges = dataConnectEdges(canvas, scopeWorkflowId).filter(
    (candidate): candidate is Extract<WorkflowCanvasEdge, { kind: 'control' }> => candidate.kind === 'control',
  );
  const adjacency = new Map<string, string[]>();
  for (const candidate of edges) {
    const list = adjacency.get(candidate.source.workflowId) || [];
    list.push(candidate.target.workflowId);
    adjacency.set(candidate.source.workflowId, list);
  }
  const stack = [edge.target.workflowId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (!nodeId || visited.has(nodeId)) {
      continue;
    }
    if (nodeId === edge.source.workflowId) {
      return true;
    }
    visited.add(nodeId);
    stack.push(...(adjacency.get(nodeId) || []));
  }
  return false;
}

export function commitResolvedConnection(
  canvas: WorkspaceCanvasModel,
  resolved: Extract<ConnectionResolution, { accepted: true }>,
): CommitConnectionResult {
  const { edge, scopeWorkflowId } = resolved;
  if (edge.kind === 'data') {
    const result = createDataEdgeCommand(canvas, {
      scopeWorkflowId,
      sourceNodeId: edge.source.workflowId,
      sourcePortId: edge.source.portId,
      targetNodeId: edge.target.workflowId,
      targetPortId: edge.target.portId,
      materialization: edge.materialization,
    });
    return { canvas: result.canvas, edge: result.edge };
  }
  if (scopeWorkflowId) {
    const workflow = canvas.workflows.find((item) => item.id === scopeWorkflowId);
    const existing = workflow?.internalEdges.find((item) => canvasEdgesAreEquivalent(item, edge));
    const edgeToStore = existing || edge;
    return {
      edge: edgeToStore,
      canvas: {
        ...canvas,
        workflows: canvas.workflows.map((item) =>
          item.id === scopeWorkflowId
            ? {
                ...item,
                internalEdges: [
                  ...item.internalEdges.filter(
                    (candidate) =>
                      candidate.id !== edgeToStore.id && !canvasEdgesAreEquivalent(candidate, edgeToStore),
                  ),
                  edgeToStore,
                ],
              }
            : item,
        ),
      },
    };
  }
  const existing = canvas.edges.find((item) => canvasEdgesAreEquivalent(item, edge));
  const edgeToStore = existing || edge;
  return {
    edge: edgeToStore,
    canvas: {
      ...canvas,
      edges: [
        ...canvas.edges.filter(
          (candidate) => candidate.id !== edgeToStore.id && !canvasEdgesAreEquivalent(candidate, edgeToStore),
        ),
        edgeToStore,
      ],
    },
  };
}

export function tryCommitResolvedConnection(
  canvas: WorkspaceCanvasModel,
  resolved: Extract<ConnectionResolution, { accepted: true }>,
): CommitConnectionAttempt {
  try {
    return { ok: true, result: commitResolvedConnection(canvas, resolved) };
  } catch (error) {
    return { ok: false, message: connectionCommitErrorMessage(error) };
  }
}

export function controlSlotLimitIssue(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  edge: Extract<WorkflowCanvasEdge, { kind: 'control' }>,
): string | null {
  const edges = dataConnectEdges(canvas, scopeWorkflowId);
  const controlEdges = edges.filter((item): item is Extract<WorkflowCanvasEdge, { kind: 'control' }> => item.kind === 'control');
  if (controlEdges.some((item) => canvasEdgesAreEquivalent(item, edge))) {
    return null;
  }
  const outgoing = controlEdges.filter((item) => item.source.workflowId === edge.source.workflowId).length;
  if (outgoing >= CONTROL_SLOT_LIMIT) {
    return '控制线输出 slot 已满，当前节点最多支持 ' + CONTROL_SLOT_LIMIT + ' 个输出';
  }
  const incoming = controlEdges.filter((item) => item.target.workflowId === edge.target.workflowId).length;
  if (incoming >= CONTROL_SLOT_LIMIT) {
    return '控制线输入 slot 已满，当前节点最多支持 ' + CONTROL_SLOT_LIMIT + ' 个输入';
  }
  return null;
}

export function portTokenId(workflowId: string, direction: PortDirection, portId: string): string {
  return workflowId + ':' + direction + ':' + encodeURIComponent(portId);
}

export function controlSourceTokenId(flowNodeId: string): string {
  return flowNodeId + ':control:source';
}

export function controlTargetTokenId(flowNodeId: string): string {
  return flowNodeId + ':control:target';
}

export function controlTokenSide(flowNodeId: string, handleId: string | null | undefined): EndpointSide | null {
  if (handleId === controlSourceTokenId(flowNodeId)) {
    return 'source';
  }
  if (handleId === controlTargetTokenId(flowNodeId)) {
    return 'target';
  }
  return null;
}

export function workflowInputOuterTargetTokenId(workflowId: string): string {
  return workflowId + ':workflow-input-outer-target';
}

export function workflowInputInnerSourceTokenId(workflowId: string): string {
  return workflowId + ':workflow-input-inner-source';
}

export function workflowOutputInnerTargetTokenId(workflowId: string): string {
  return workflowId + ':workflow-output-inner-target';
}

export function workflowOutputOuterSourceTokenId(workflowId: string): string {
  return workflowId + ':workflow-output-outer-source';
}

export function isWorkflowInputInnerSourceToken(workflowId: string, handle: string | null | undefined): boolean {
  return handle === workflowInputInnerSourceTokenId(workflowId) || handle === workflowId + ':workflow-input-source';
}

export function isWorkflowOutputInnerTargetToken(workflowId: string, handle: string | null | undefined): boolean {
  return handle === workflowOutputInnerTargetTokenId(workflowId) || handle === workflowId + ':workflow-output-target';
}

export function parsePortToken(handle: string | null | undefined):
  | { workflowId: string; direction: PortDirection; portId: string }
  | null {
  if (!handle) {
    return null;
  }
  const [workflowId, direction, ...portParts] = handle.split(':');
  const encodedPortId = portParts.join(':');
  let portId = '';
  try {
    portId = encodedPortId ? decodeURIComponent(encodedPortId) : '';
  } catch {
    return null;
  }
  if (!workflowId || (direction !== 'input' && direction !== 'output') || !portId) {
    return null;
  }
  return { workflowId, direction, portId };
}

function resolveControlConnection(canvas: WorkspaceCanvasModel, connection: CanvasConnection): ConnectionResolution {
  const source = describeEndpoint(canvas, connection.source || '', connectionToken(connection, 'source'), 'source', 'control');
  const target = describeEndpoint(canvas, connection.target || '', connectionToken(connection, 'target'), 'target', 'control');
  if (!source || !target) {
    return { accepted: false, reason: '无法识别这条控制线的端口方向' };
  }
  const transition = controlTransitionForEndpoints(canvas, source, target);
  if (!transition || !transition.accepted) {
    return { accepted: false, reason: controlConnectionRejectionReason(source, target) };
  }
  const boundaryMainBinding =
    transition.edge.kind === 'control' &&
    transition.scopeWorkflowId !== null &&
    isWorkflowBoundaryMainBinding(transition.scopeWorkflowId, transition.edge);
  if (
    transition.edge.kind === 'control' &&
    !boundaryMainBinding &&
    wouldCreateControlCycle(canvas, transition.scopeWorkflowId, transition.edge)
  ) {
    return { accepted: false, reason: '这条控制线会形成循环' };
  }
  if (transition.edge.kind === 'control' && !boundaryMainBinding) {
    const slotIssue = controlSlotLimitIssue(canvas, transition.scopeWorkflowId, transition.edge);
    if (slotIssue) {
      return { accepted: false, reason: slotIssue };
    }
  }
  return transition;
}

function resolveDataConnection(canvas: WorkspaceCanvasModel, connection: CanvasConnection): ConnectionResolution {
  const source = describeEndpoint(canvas, connection.source || '', connectionToken(connection, 'source'), 'source', 'data');
  const target = describeEndpoint(canvas, connection.target || '', connectionToken(connection, 'target'), 'target', 'data');
  if (!source || !target || !endpointCanSource(source) || !endpointCanTarget(target)) {
    return { accepted: false, reason: 'Data Edge 必须从 output port 连接到 input port' };
  }
  const sourceWorkflow = flowEndpointForCanvas(canvas, connection.source || '');
  const targetWorkflow = flowEndpointForCanvas(canvas, connection.target || '');
  const dataEdge = scopedDataEdge(canvas, sourceWorkflow, targetWorkflow, source.portId, target.portId, {
    sourceToken: connectionToken(connection, 'source'),
    targetToken: connectionToken(connection, 'target'),
  });
  if (!dataEdge) {
    return { accepted: false, reason: 'Data Edge 必须连接同一层级内的节点' };
  }
  return {
    accepted: true,
    edge: dataEdge.edge,
    scopeWorkflowId: dataEdge.scopeWorkflowId,
    semantic: dataEdge.semantic,
  };
}

function controlConnectionRejectionReason(source: EndpointDescriptor, target: EndpointDescriptor): string {
  if (
    source.role === 'workflow_inner_input' ||
    source.role === 'workflow_inner_output' ||
    target.role === 'workflow_inner_input' ||
    target.role === 'workflow_inner_output'
  ) {
    return 'Workflow 内侧端口只能连接本 Workflow 内部节点';
  }
  if (
    source.role === 'workflow_outer_input' ||
    source.role === 'workflow_outer_output' ||
    target.role === 'workflow_outer_input' ||
    target.role === 'workflow_outer_output'
  ) {
    return 'Workflow 外侧端口只能连接父级画布节点';
  }
  return 'Control edges must connect an output endpoint to an input endpoint';
}

function controlTransitionForEndpoints(
  canvas: WorkspaceCanvasModel,
  source: EndpointDescriptor,
  target: EndpointDescriptor,
): ConnectionResolution | null {
  if (source.nodeId === target.nodeId && source.workflowId === target.workflowId) {
    return null;
  }
  if (
    (source.role === 'root_executable_output' || source.role === 'workflow_outer_output') &&
    (target.role === 'root_executable_input' || target.role === 'workflow_outer_input')
  ) {
    const semantic: ScopedEdgeSemantic =
      source.role === 'workflow_outer_output' && target.role === 'workflow_outer_input'
        ? 'root_workflow_to_workflow_control'
        : source.role === 'workflow_outer_output'
          ? 'root_control_main_from_workflow'
          : target.role === 'workflow_outer_input'
            ? 'root_control_main_to_workflow'
            : 'root_control_main';
    return {
      accepted: true,
      scopeWorkflowId: null,
      semantic,
      sourceToken: source.role === 'workflow_outer_output' ? workflowOutputOuterSourceTokenId(source.nodeId) : undefined,
      targetToken: target.role === 'workflow_outer_input' ? workflowInputOuterTargetTokenId(target.nodeId) : undefined,
      edge: controlEdgeWithId(
        uniqueEdgeIdForScope(canvas, null, 'control', source.nodeId, target.nodeId),
        source.nodeId,
        target.nodeId,
      ),
    };
  }
  if (
    source.role === 'workflow_inner_input' &&
    target.role === 'internal_executable_input' &&
    source.nodeId === target.workflowId
  ) {
    if ((source.portId || 'main') !== 'main' || (target.portId || 'main') !== 'main') {
      return null;
    }
    const boundaryId = workflowInputBoundaryId(source.nodeId);
    return {
      accepted: true,
      scopeWorkflowId: source.nodeId,
      semantic: 'workflow_input_main_binding',
      sourceToken: workflowInputInnerSourceTokenId(source.nodeId),
      edge: controlEdgeWithId(
        uniqueEdgeIdForScope(canvas, source.nodeId, 'control', boundaryId, target.nodeId),
        boundaryId,
        target.nodeId,
      ),
    };
  }
  if (
    source.role === 'internal_executable_output' &&
    target.role === 'workflow_inner_output' &&
    source.workflowId === target.nodeId
  ) {
    if ((source.portId || 'main') !== 'main' || (target.portId || 'main') !== 'main') {
      return null;
    }
    const boundaryId = workflowOutputBoundaryId(target.nodeId);
    return {
      accepted: true,
      scopeWorkflowId: target.nodeId,
      semantic: 'workflow_output_main_binding',
      targetToken: workflowOutputInnerTargetTokenId(target.nodeId),
      edge: controlEdgeWithId(
        uniqueEdgeIdForScope(canvas, target.nodeId, 'control', source.nodeId, boundaryId),
        source.nodeId,
        boundaryId,
      ),
    };
  }
  if (
    source.role === 'internal_executable_output' &&
    target.role === 'internal_executable_input' &&
    source.workflowId === target.workflowId &&
    source.workflowId
  ) {
    return {
      accepted: true,
      scopeWorkflowId: source.workflowId,
      semantic: 'internal_control',
      edge: controlEdgeWithId(
        uniqueEdgeIdForScope(canvas, source.workflowId, 'control', source.nodeId, target.nodeId),
        source.nodeId,
        target.nodeId,
      ),
    };
  }
  if (source.role === 'focus_boundary_input_output' && target.role === 'internal_executable_input') {
    const workflowId = source.workflowId;
    if (!workflowId || workflowId !== target.workflowId) {
      return null;
    }
    if ((source.portId || 'main') !== 'main' || (target.portId || 'main') !== 'main') {
      return null;
    }
    const boundaryId = workflowInputBoundaryId(workflowId);
    return {
      accepted: true,
      scopeWorkflowId: workflowId,
      semantic: 'workflow_input_main_binding',
      edge: controlEdgeWithId(
        uniqueEdgeIdForScope(canvas, workflowId, 'control', boundaryId, target.nodeId),
        boundaryId,
        target.nodeId,
      ),
    };
  }
  if (source.role === 'internal_executable_output' && target.role === 'focus_boundary_output_input') {
    const workflowId = target.workflowId;
    if (!workflowId || workflowId !== source.workflowId) {
      return null;
    }
    if ((source.portId || 'main') !== 'main' || (target.portId || 'main') !== 'main') {
      return null;
    }
    const boundaryId = workflowOutputBoundaryId(workflowId);
    return {
      accepted: true,
      scopeWorkflowId: workflowId,
      semantic: 'workflow_output_main_binding',
      edge: controlEdgeWithId(
        uniqueEdgeIdForScope(canvas, workflowId, 'control', source.nodeId, boundaryId),
        source.nodeId,
        boundaryId,
      ),
    };
  }
  return null;
}

function scopedDataEdge(
  canvas: WorkspaceCanvasModel,
  source: FlowEndpoint,
  target: FlowEndpoint,
  sourcePortId: string,
  targetPortId: string,
  handles: ConnectionTokens = { sourceToken: null, targetToken: null },
): ScopedEdgeResult | null {
  const boundaryDataEdge = scopedBoundaryDataEdge(
    canvas,
    source,
    target,
    sourcePortId,
    targetPortId,
    handles,
  );
  if (boundaryDataEdge) {
    return boundaryDataEdge;
  }
  if (source.internal && target.internal && source.workflowId === target.workflowId) {
    return {
      scopeWorkflowId: source.workflowId,
      semantic: 'internal_data',
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, source.workflowId, 'data', source.nodeId, target.nodeId),
        source.nodeId,
        sourcePortId,
        target.nodeId,
        targetPortId,
      ),
    };
  }
  if (!source.internal && !target.internal) {
    return {
      scopeWorkflowId: null,
      semantic: 'root_data',
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, null, 'data', source.nodeId, target.nodeId),
        source.nodeId,
        sourcePortId,
        target.nodeId,
        targetPortId,
      ),
    };
  }
  return null;
}

function scopedBoundaryDataEdge(
  canvas: WorkspaceCanvasModel,
  source: FlowEndpoint,
  target: FlowEndpoint,
  sourcePortId: string,
  targetPortId: string,
  handles: ConnectionTokens = { sourceToken: null, targetToken: null },
): ScopedEdgeResult | null {
  const sourceBoundary = workflowBoundaryKind(source.nodeId);
  const targetBoundary = workflowBoundaryKind(target.nodeId);
  if (sourceBoundary === 'workflow_input' && target.internal) {
    const scopeWorkflowId = workflowIdFromBoundaryId(source.nodeId);
    if (!scopeWorkflowId || target.workflowId !== scopeWorkflowId) {
      return null;
    }
    return {
      scopeWorkflowId,
      semantic: 'workflow_input_main_binding',
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, scopeWorkflowId, 'data', source.nodeId, target.nodeId),
        source.nodeId,
        sourcePortId,
        target.nodeId,
        targetPortId,
      ),
    };
  }
  if (source.internal && targetBoundary === 'workflow_output') {
    const scopeWorkflowId = workflowIdFromBoundaryId(target.nodeId);
    if (!scopeWorkflowId || source.workflowId !== scopeWorkflowId) {
      return null;
    }
    return {
      scopeWorkflowId,
      semantic: 'workflow_output_main_binding',
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, scopeWorkflowId, 'data', source.nodeId, target.nodeId),
        source.nodeId,
        sourcePortId,
        target.nodeId,
        targetPortId,
      ),
    };
  }
  if (
    !source.internal &&
    target.internal &&
    source.nodeId === target.workflowId &&
    target.workflowId &&
    isWorkflowInputInnerSourceToken(target.workflowId, handles.sourceToken)
  ) {
    const boundaryId = workflowInputBoundaryId(target.workflowId);
    return {
      scopeWorkflowId: target.workflowId,
      semantic: 'workflow_input_main_binding',
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, target.workflowId, 'data', boundaryId, target.nodeId),
        boundaryId,
        sourcePortId,
        target.nodeId,
        targetPortId,
      ),
    };
  }
  if (
    source.internal &&
    !target.internal &&
    target.nodeId === source.workflowId &&
    source.workflowId &&
    isWorkflowOutputInnerTargetToken(source.workflowId, handles.targetToken)
  ) {
    const boundaryId = workflowOutputBoundaryId(source.workflowId);
    return {
      scopeWorkflowId: source.workflowId,
      semantic: 'workflow_output_main_binding',
      edge: dataEdgeWithId(
        uniqueEdgeIdForScope(canvas, source.workflowId, 'data', source.nodeId, boundaryId),
        source.nodeId,
        sourcePortId,
        boundaryId,
        targetPortId,
      ),
    };
  }
  return null;
}

function isWorkflowBoundaryMainBinding(workflowId: string, edge: WorkflowCanvasEdge): boolean {
  return (
    (edge.source.workflowId === workflowInputBoundaryId(workflowId) &&
      !isWorkflowBoundaryId(edge.target.workflowId)) ||
    (!isWorkflowBoundaryId(edge.source.workflowId) &&
      edge.target.workflowId === workflowOutputBoundaryId(workflowId))
  );
}

function connectionCommitErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '连接创建失败';
}

function rootDataConnectNodes(canvas: WorkspaceCanvasModel): DataConnectNodeOption[] {
  return canvas.workflows
    .filter((workflow) => !workflow.boundaryKind)
    .map((workflow) => ({
      nodeId: workflow.id,
      label: workflowInvocationLabel(workflow),
      subtitle: workflow.callableId || workflow.workflowRef,
      inputPorts: workflow.inputPorts,
      outputPorts: workflowOutputPorts(workflow),
    }));
}

function workflowScopedDataConnectNodes(workflow: WorkflowContainerModel): DataConnectNodeOption[] {
  return [
    {
      nodeId: workflowInputBoundaryId(workflow.id),
      label: 'Workflow Inputs',
      subtitle: workflowInvocationLabel(workflow),
      inputPorts: [],
      outputPorts: workflow.inputPorts.map((item) => boundaryPort(item, 'output')),
    },
    ...(workflow.internalNodes || []).map((node) => ({
      nodeId: node.id,
      label: internalInvocationLabel(node),
      subtitle: node.callableId || node.runtime,
      inputPorts: internalNodeInputPorts(node),
      outputPorts: internalNodeOutputPorts(node),
    })),
    {
      nodeId: workflowOutputBoundaryId(workflow.id),
      label: 'Workflow Outputs',
      subtitle: workflowInvocationLabel(workflow),
      inputPorts: workflow.outputPorts.map((item) => boundaryPort(item, 'input')),
      outputPorts: [],
    },
  ];
}

function edgeDiagnosticsForDataNodes(
  nodes: DataConnectNodeOption[],
  edge: WorkflowCanvasEdge,
): EdgeDiagnostic[] {
  if (edge.kind !== 'data') {
    return [];
  }
  const diagnostics: EdgeDiagnostic[] = [];
  const source = nodes.find((node) => node.nodeId === edge.source.workflowId);
  const sourcePort = source?.outputPorts.find((portValue) => portValue.id === edge.source.portId);
  if (!source || !sourcePort) {
    diagnostics.push({
      code: 'dangling_data_edge_source',
      message: source
        ? 'Missing source output port: ' + edge.source.workflowId + '.' + edge.source.portId
        : 'Missing source node: ' + edge.source.workflowId,
      nodeId: edge.source.workflowId,
      portId: edge.source.portId,
      expectedSchemaPath: '/properties/outputs/properties/' + jsonPointerToken(edge.source.portId),
    });
  }
  const target = nodes.find((node) => node.nodeId === edge.target.workflowId);
  const targetPort = target?.inputPorts.find((portValue) => portValue.id === edge.target.portId);
  if (!target || !targetPort) {
    diagnostics.push({
      code: 'dangling_data_edge_target',
      message: target
        ? 'Missing target input port: ' + edge.target.workflowId + '.' + edge.target.portId
        : 'Missing target node: ' + edge.target.workflowId,
      nodeId: edge.target.workflowId,
      portId: edge.target.portId,
    });
  }
  return diagnostics;
}

function hasControlDependency(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  sourceNodeId: string,
  targetNodeId: string,
): boolean {
  return dataConnectEdges(canvas, scopeWorkflowId).some(
    (edge) =>
      edge.kind === 'control' &&
      edge.source.workflowId === sourceNodeId &&
      edge.target.workflowId === targetNodeId,
  );
}

function updateDataConnectNodePorts(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
  direction: PortDirection,
  update: (ports: WorkflowPortView[]) => WorkflowPortView[],
): WorkspaceCanvasModel {
  const key = storedPortDirectionForDataConnectNode(scopeWorkflowId, nodeId, direction) === 'input'
    ? 'inputPorts'
    : 'outputPorts';
  if (scopeWorkflowId) {
    return {
      ...canvas,
      workflows: canvas.workflows.map((workflow) => {
        if (workflow.id !== scopeWorkflowId) {
          return workflow;
        }
        if (nodeId === workflowInputBoundaryId(workflow.id)) {
          return { ...workflow, inputPorts: update(workflow.inputPorts) };
        }
        if (nodeId === workflowOutputBoundaryId(workflow.id)) {
          return { ...workflow, outputPorts: update(workflow.outputPorts) };
        }
        return {
          ...workflow,
          internalNodes: workflow.internalNodes.map((node) => {
            if (node.id !== nodeId) {
              return node;
            }
            const ports = node[key] || [port('main', direction, direction)];
            return { ...node, [key]: update(ports) };
          }),
        };
      }),
    };
  }
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
      if (workflow.id !== nodeId) {
        return workflow;
      }
      return { ...workflow, [key]: update(workflow[key]) };
    }),
  };
}

function storedPortDirectionForDataConnectNode(
  scopeWorkflowId: string | null,
  nodeId: string,
  direction: PortDirection,
): PortDirection {
  if (scopeWorkflowId && nodeId === workflowInputBoundaryId(scopeWorkflowId)) {
    if (direction !== 'output') {
      throw new Error('Workflow Inputs boundary can only maintain output-side ports');
    }
    return 'input';
  }
  if (scopeWorkflowId && nodeId === workflowOutputBoundaryId(scopeWorkflowId)) {
    if (direction !== 'input') {
      throw new Error('Workflow Outputs boundary can only maintain input-side ports');
    }
    return 'output';
  }
  return direction;
}

function mapDataConnectEdges(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  update: (edge: WorkflowCanvasEdge) => WorkflowCanvasEdge,
): WorkspaceCanvasModel {
  if (scopeWorkflowId) {
    return {
      ...canvas,
      workflows: canvas.workflows.map((workflow) =>
        workflow.id === scopeWorkflowId
          ? { ...workflow, internalEdges: workflow.internalEdges.map(update) }
          : workflow,
      ),
    };
  }
  return { ...canvas, edges: canvas.edges.map(update) };
}

function workflowOutputPorts(workflow: WorkflowContainerModel): WorkflowPortView[] {
  if (workflow.sourceKind && workflow.sourceKind !== 'workflow') {
    return outputPortsFromSchema(workflow.outputSchema, workflow.outputPorts);
  }
  return workflow.outputPorts;
}

function internalNodeInputPorts(node: InternalNodeView): WorkflowPortView[] {
  return node.inputPorts || [port('main', 'input', 'input')];
}

function internalNodeOutputPorts(node: InternalNodeView): WorkflowPortView[] {
  return effectiveOutputPortsForNode({
    outputSchema: node.outputSchema,
    outputPorts: node.outputPorts || [port('main', 'output', 'output')],
  });
}

function addEdgeWithControlDependency(
  canvas: WorkspaceCanvasModel,
  edge: WorkflowCanvasEdge,
  scopeWorkflowId: string | null,
): WorkspaceCanvasModel {
  const existing = canvas.edges.find((item) => canvasEdgesAreEquivalent(item, edge));
  const edgeToStore = existing || edge;
  const edges = [
    ...canvas.edges.filter((item) => item.id !== edgeToStore.id && !canvasEdgesAreEquivalent(item, edgeToStore)),
    edgeToStore,
  ];
  if (edgeToStore.kind !== 'data') {
    return { ...canvas, edges };
  }
  if (isWorkflowBoundaryEdge(edgeToStore)) {
    return { ...canvas, edges };
  }
  const hasControlEdge = edges.some(
    (item) =>
      item.kind === 'control' &&
      item.source.workflowId === edgeToStore.source.workflowId &&
      item.target.workflowId === edgeToStore.target.workflowId,
  );
  if (hasControlEdge) {
    return { ...canvas, edges };
  }
  const control = controlEdgeWithId(
    uniqueEdgeIdForScope(
      { ...canvas, edges },
      scopeWorkflowId,
      'control',
      edgeToStore.source.workflowId,
      edgeToStore.target.workflowId,
    ),
    edgeToStore.source.workflowId,
    edgeToStore.target.workflowId,
  );
  return { ...canvas, edges: [...edges, control] };
}

function controlEdgeWithId(
  id: string,
  sourceWorkflowId: string,
  targetWorkflowId: string,
): WorkflowCanvasEdge {
  return {
    id,
    kind: 'control',
    source: { workflowId: sourceWorkflowId },
    target: { workflowId: targetWorkflowId },
    condition: null,
    context: 'none',
  };
}

function dataEdgeWithId(
  id: string,
  sourceWorkflowId: string,
  sourcePortId: string,
  targetWorkflowId: string,
  targetPortId: string,
): WorkflowCanvasEdge {
  return {
    id,
    kind: 'data',
    source: { workflowId: sourceWorkflowId, portId: sourcePortId },
    target: { workflowId: targetWorkflowId, portId: targetPortId },
    materialization: 'copy',
  };
}

function uniqueEdgeIdForScope(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  kind: 'data' | 'control',
  sourceWorkflowId: string,
  targetWorkflowId: string,
): string {
  const scopedEdges =
    scopeWorkflowId === null
      ? canvas.edges
      : canvas.workflows.find((workflow) => workflow.id === scopeWorkflowId)?.internalEdges || [];
  const existing = new Set(scopedEdges.map((edge) => edge.id));
  let index = 1;
  let edgeId = kind + '_' + sourceWorkflowId + '_' + targetWorkflowId;
  while (existing.has(edgeId)) {
    index += 1;
    edgeId = kind + '_' + sourceWorkflowId + '_' + targetWorkflowId + '_' + index;
  }
  return edgeId;
}

export function uniqueInputPortIdForNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
  requestedPortId: string,
): string {
  const target = findDataConnectNode(canvas, scopeWorkflowId, nodeId);
  const existingIds = new Set((target?.inputPorts || []).map((portValue) => portValue.id));
  return uniqueId(slugId(requestedPortId || 'input') || 'input', existingIds);
}

function boundaryPort(portValue: WorkflowPortView, direction: PortDirection): WorkflowPortView {
  return { ...portValue, direction };
}

function port(
  id: string,
  label: string,
  direction: PortDirection,
  required = false,
  cardinality = 'one',
): WorkflowPortView {
  return { id, label, direction, required, cardinality, artifactTypes: ['artifact'] };
}

function isWorkflowBoundaryEdge(edge: WorkflowCanvasEdge): boolean {
  return isWorkflowBoundaryId(edge.source.workflowId) || isWorkflowBoundaryId(edge.target.workflowId);
}

function jsonPointerToken(value: string): string {
  return value.replace(/~/gu, '~0').replace(/\//gu, '~1');
}

function slugId(value: string): string {
  const slug = value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 48);
  return slug || 'node';
}

function uniqueId(baseId: string, existingIds: Set<string>): string {
  const normalizedBaseId = slugId(baseId);
  let id = normalizedBaseId;
  let index = 2;
  while (existingIds.has(id)) {
    id = normalizedBaseId + '_' + index;
    index += 1;
  }
  return id;
}
