import type { WorkflowContainerModel, WorkspaceCanvasModel } from '../../types/workbench';

export type FlowEndpoint = {
  nodeId: string;
  workflowId: string | null;
  internal: boolean;
};

export function workflowInputBoundaryId(workflowId: string): string {
  return `${workflowId}__workflow_inputs`;
}

export function workflowOutputBoundaryId(workflowId: string): string {
  return `${workflowId}__workflow_outputs`;
}

export function isWorkflowBoundaryId(nodeId: string): boolean {
  return nodeId.endsWith('__workflow_inputs') || nodeId.endsWith('__workflow_outputs');
}

export function isExecutableNodeWorkflow(workflow: WorkflowContainerModel): boolean {
  if (workflow.boundaryKind) {
    return false;
  }
  if (workflow.sourceKind === 'workflow') {
    return false;
  }
  if (workflow.sourceKind && workflow.sourceKind !== 'workflow') {
    return true;
  }
  return false;
}

export function internalFlowNodeId(workflowId: string, nodeId: string): string {
  return `${workflowId}__internal__${nodeId}`;
}

export function parseInternalFlowNodeId(nodeId: string): { workflowId: string; nodeId: string } | null {
  const marker = '__internal__';
  const index = nodeId.lastIndexOf(marker);
  if (index < 0) {
    return null;
  }
  return {
    workflowId: nodeId.slice(0, index),
    nodeId: nodeId.slice(index + marker.length),
  };
}

export function flowEndpoint(flowNodeId: string): FlowEndpoint {
  const internal = parseInternalFlowNodeId(flowNodeId);
  if (internal) {
    return { nodeId: internal.nodeId, workflowId: internal.workflowId, internal: true };
  }
  return { nodeId: flowNodeId, workflowId: null, internal: false };
}

export function flowEndpointForCanvas(canvas: WorkspaceCanvasModel, flowNodeId: string): FlowEndpoint {
  const endpoint = flowEndpoint(flowNodeId);
  if (endpoint.internal || canvas.layout !== 'workflow-focus') {
    return endpoint;
  }
  if (isWorkflowBoundaryId(flowNodeId)) {
    return endpoint;
  }
  const focusedWorkflowId = canvas.focusedWorkflowId;
  if (!focusedWorkflowId) {
    return endpoint;
  }
  const workflow = canvas.workflows.find((item) => item.id === flowNodeId);
  if (!workflow || workflow.boundaryKind) {
    return endpoint;
  }
  return { nodeId: flowNodeId, workflowId: focusedWorkflowId, internal: true };
}
