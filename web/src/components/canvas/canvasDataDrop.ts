import { addPortToDataConnectNode, createDataEdgeCommand, dataEdgesForNode, endpointCanSource, findDataConnectNode, uniqueInputPortIdForNode, type DataEdgeCommandRequest, type DataEdgeCommandResult, type EndpointDescriptor, type PendingCanvasConnection } from '../../workbench/model/canvasEdgeOps';
import { flowEndpointForCanvas, workflowBoundaryKind, workflowInputBoundaryId, workflowOutputBoundaryId } from '../../workbench/model/workflowNodeModel';
import { slugId } from '../../workbench/model/paletteCanvasOps';
import type { WorkspaceCanvasModel } from '../../types/workbench';

export type BodyDropDataEdgePlan = {
  canvasWithTargetPort: WorkspaceCanvasModel;
  request: DataEdgeCommandRequest;
  targetPortId: string;
  createdTargetPort: boolean;
};


export function createDataEdgeToNodeBodyCommand(
  canvas: WorkspaceCanvasModel,
  visibleCanvas: WorkspaceCanvasModel,
  pending: PendingCanvasConnection,
  targetFlowNodeId: string,
): DataEdgeCommandResult & { targetPortId: string } {
  const plan = prepareDataEdgeToNodeBodyCommand(canvas, visibleCanvas, pending, targetFlowNodeId);
  const result = createDataEdgeCommand(plan.canvasWithTargetPort, plan.request);
  return { ...result, targetPortId: plan.targetPortId };
}

export function prepareDataEdgeToNodeBodyCommand(
  canvas: WorkspaceCanvasModel,
  visibleCanvas: WorkspaceCanvasModel,
  pending: PendingCanvasConnection,
  targetFlowNodeId: string,
): BodyDropDataEdgePlan {
  if (pending.mode !== 'data' || !pending.endpoint || !endpointCanSource(pending.endpoint)) {
    throw new Error('Data Edge 必须从 output port 拖到目标节点。');
  }
  const target = flowEndpointForCanvas(visibleCanvas, targetFlowNodeId);
  if (!target.nodeId || workflowBoundaryKind(target.nodeId)) {
    throw new Error('请释放到可执行节点，而不是 workflow 边界。');
  }
  const sourceScope = pending.endpoint.workflowId;
  const targetScope = target.internal ? target.workflowId : null;
  if (sourceScope !== targetScope) {
    throw new Error('Data Edge 必须连接同一层级内的节点。');
  }
  const scopeWorkflowId = sourceScope || null;
  const sourceNodeId = dataNodeIdForEndpoint(pending.endpoint);
  const targetNodeId = target.nodeId;
  if (sourceNodeId === targetNodeId) {
    throw new Error('Data Edge 不能连接到同一个节点。');
  }
  const targetPortId = inputPortIdForBodyDrop(
    canvas,
    scopeWorkflowId,
    targetNodeId,
    pending.endpoint.portId,
    sourceNodeId,
  );
  const targetNode = findDataConnectNode(canvas, scopeWorkflowId, targetNodeId);
  const createdTargetPort = !targetNode?.inputPorts.some((portValue) => portValue.id === targetPortId);
  const canvasWithTargetPort = createdTargetPort
    ? addInputPortToDataConnectNode(canvas, scopeWorkflowId, targetNodeId, targetPortId)
    : canvas;
  return {
    canvasWithTargetPort,
    targetPortId,
    createdTargetPort,
    request: {
      scopeWorkflowId,
      sourceNodeId,
      sourcePortId: pending.endpoint.portId,
      targetNodeId,
      targetPortId,
      materialization: 'copy',
    },
  };
}

export function dataNodeIdForEndpoint(endpoint: EndpointDescriptor): string {
  if (endpoint.role === 'workflow_inner_input' || endpoint.role === 'focus_boundary_input_output') {
    const workflowId = endpoint.workflowId || endpoint.nodeId;
    return workflowInputBoundaryId(workflowId);
  }
  if (endpoint.role === 'workflow_inner_output' || endpoint.role === 'focus_boundary_output_input') {
    const workflowId = endpoint.workflowId || endpoint.nodeId;
    return workflowOutputBoundaryId(workflowId);
  }
  return endpoint.nodeId;
}

export function inputPortIdForDataBodyPreview(
  canvas: WorkspaceCanvasModel,
  visibleCanvas: WorkspaceCanvasModel,
  pending: PendingCanvasConnection,
  targetFlowNodeId: string,
): string {
  if (pending.mode !== 'data' || !pending.endpoint || !endpointCanSource(pending.endpoint)) {
    throw new Error('Data Edge 必须从 output port 拖到目标节点。');
  }
  const target = flowEndpointForCanvas(visibleCanvas, targetFlowNodeId);
  const sourceScope = pending.endpoint.workflowId;
  const targetScope = target.internal ? target.workflowId : null;
  if (sourceScope !== targetScope || !target.nodeId || workflowBoundaryKind(target.nodeId)) {
    throw new Error('Data Edge 必须连接同一层级内的节点。');
  }
  return inputPortIdForBodyDrop(
    canvas,
    sourceScope || null,
    target.nodeId,
    pending.endpoint.portId,
    dataNodeIdForEndpoint(pending.endpoint),
  );
}

function inputPortIdForBodyDrop(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  targetNodeId: string,
  sourcePortId: string,
  sourceNodeId: string,
): string {
  const requestedPortId = sourcePortId === 'main' ? `${sourceNodeId}_main` : sourcePortId;
  const basePortId = slugId(requestedPortId);
  const targetNode = findDataConnectNode(canvas, scopeWorkflowId, targetNodeId);
  const existing = targetNode?.inputPorts.find((portValue) => portValue.id === basePortId);
  if (!existing) {
    return basePortId;
  }
  const conflicts = dataEdgesForNode(canvas, scopeWorkflowId, targetNodeId, 'input').filter(
    (edge) => edge.target.portId === basePortId,
  );
  if (conflicts.length === 0 || (existing.cardinality || 'one') === 'many') {
    return basePortId;
  }
  return uniqueInputPortIdForNode(canvas, scopeWorkflowId, targetNodeId, basePortId);
}

export function addInputPortToDataConnectNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
  portId: string,
): WorkspaceCanvasModel {
  return addPortToDataConnectNode(canvas, scopeWorkflowId, nodeId, 'input', portId);
}
