export type EdgeAddress = {
  scopeWorkflowId: string | null;
  edgeId: string;
};

export function rootEdgeAddress(edgeId: string): EdgeAddress {
  return { scopeWorkflowId: null, edgeId };
}

export function workflowEdgeAddress(scopeWorkflowId: string, edgeId: string): EdgeAddress {
  return { scopeWorkflowId, edgeId };
}

export function edgeAddressEquals(left: EdgeAddress | null | undefined, right: EdgeAddress | null | undefined): boolean {
  return Boolean(
    left &&
      right &&
      left.scopeWorkflowId === right.scopeWorkflowId &&
      left.edgeId === right.edgeId,
  );
}

export function flowEdgeId(address: EdgeAddress): string {
  return address.scopeWorkflowId
    ? `workflow:${address.scopeWorkflowId}::${address.edgeId}`
    : `root::${address.edgeId}`;
}

export function edgeAddressFromFlowEdgeId(id: string): EdgeAddress | null {
  if (id.startsWith('root::')) {
    return rootEdgeAddress(id.slice('root::'.length));
  }
  if (!id.startsWith('workflow:')) {
    return null;
  }
  const separator = id.indexOf('::');
  if (separator <= 'workflow:'.length) {
    return null;
  }
  return workflowEdgeAddress(
    id.slice('workflow:'.length, separator),
    id.slice(separator + '::'.length),
  );
}
