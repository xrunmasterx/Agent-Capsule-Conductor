import { AGENT_MAX_DATA_PORTS } from '../constants';
import type {
  InternalNodeView,
  PortDirection,
  WorkflowCanvasEdge,
  WorkflowContainerModel,
  WorkflowPortView,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { internalInvocationLabel, workflowInvocationLabel } from './selectionModel';
import { effectiveOutputPortsForNode, outputPortsFromSchema } from './schemaPorts';

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

export function createDataEdgeCommand(
  canvas: WorkspaceCanvasModel,
  request: DataEdgeCommandRequest,
): DataEdgeCommandResult {
  if (request.materialization !== 'copy' && request.materialization !== 'reference') {
    throw new Error(`Unsupported data edge materialization: ${request.materialization}`);
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
    throw new Error(`Source output port 不存在: ${request.sourceNodeId}.${request.sourcePortId}`);
  }
  const targetPort = targetNode.inputPorts.find((portValue) => portValue.id === request.targetPortId);
  if (!targetPort) {
    throw new Error(`Target input port 不存在: ${request.targetNodeId}.${request.targetPortId}`);
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
    throw new Error(`Target input port 已有 data edge: ${request.targetNodeId}.${request.targetPortId}`);
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
      throw new Error(`端口已存在: ${nodeId}.${portId}`);
    }
    if (ports.length >= AGENT_MAX_DATA_PORTS) {
      throw new Error(`数据端口最多支持 ${AGENT_MAX_DATA_PORTS} 个`);
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
      throw new Error(`端口不存在: ${nodeId}.${portId}`);
    }
    if (ports.some((portValue) => portValue.id === nextPortId)) {
      throw new Error(`端口已存在: ${nodeId}.${nextPortId}`);
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
    throw new Error(`端口仍有 data edge，不能删除: ${nodeId}.${portId}`);
  }
  return updateDataConnectNodePorts(canvas, scopeWorkflowId, nodeId, direction, (ports) => {
    if (!ports.some((portValue) => portValue.id === portId)) {
      throw new Error(`端口不存在: ${nodeId}.${portId}`);
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
        ? `缺少 source output port: ${edge.source.workflowId}.${edge.source.portId}`
        : `缺少 source node: ${edge.source.workflowId}`,
      nodeId: edge.source.workflowId,
      portId: edge.source.portId,
      expectedSchemaPath: `/properties/outputs/properties/${jsonPointerToken(edge.source.portId)}`,
    });
  }
  const target = nodes.find((node) => node.nodeId === edge.target.workflowId);
  const targetPort = target?.inputPorts.find((portValue) => portValue.id === edge.target.portId);
  if (!target || !targetPort) {
    diagnostics.push({
      code: 'dangling_data_edge_target',
      message: target
        ? `缺少 target input port: ${edge.target.workflowId}.${edge.target.portId}`
        : `缺少 target node: ${edge.target.workflowId}`,
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
      throw new Error('Workflow Inputs boundary 只能维护输出侧端口');
    }
    return 'input';
  }
  if (scopeWorkflowId && nodeId === workflowOutputBoundaryId(scopeWorkflowId)) {
    if (direction !== 'input') {
      throw new Error('Workflow Outputs boundary 只能维护输入侧端口');
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
  let edgeId = `${kind}_${sourceWorkflowId}_${targetWorkflowId}`;
  while (existing.has(edgeId)) {
    index += 1;
    edgeId = `${kind}_${sourceWorkflowId}_${targetWorkflowId}_${index}`;
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

function isWorkflowBoundaryId(nodeId: string): boolean {
  return nodeId.endsWith('__workflow_inputs') || nodeId.endsWith('__workflow_outputs');
}

function isWorkflowOutputBoundaryId(nodeId: string): boolean {
  return nodeId.endsWith('__workflow_outputs');
}

function workflowInputBoundaryId(workflowId: string): string {
  return `${workflowId}__workflow_inputs`;
}

function workflowOutputBoundaryId(workflowId: string): string {
  return `${workflowId}__workflow_outputs`;
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
    id = `${normalizedBaseId}_${index}`;
    index += 1;
  }
  return id;
}
