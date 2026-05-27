export function workflowInputBoundaryId(workflowId: string): string {
  return `${workflowId}__workflow_inputs`;
}

export function workflowOutputBoundaryId(workflowId: string): string {
  return `${workflowId}__workflow_outputs`;
}

export function isWorkflowBoundaryId(nodeId: string): boolean {
  return nodeId.endsWith('__workflow_inputs') || nodeId.endsWith('__workflow_outputs');
}
