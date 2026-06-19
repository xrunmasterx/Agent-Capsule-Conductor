import type { ConnectionMode } from '../../types/workbench';
import type { ConnectionEndpoint, EndpointSide } from '../../workbench/model/canvasEdgeOps';

export type DomConnectionEndpoint = ConnectionEndpoint;

export type ConnectionTraceEvent = {
  event: string;
  detail: Record<string, unknown>;
  timestamp: number;
};

export function connectionHandleSelector(mode?: ConnectionMode): string {
  if (mode === 'control') {
    return '.acc-connect-hitbox, .workflow-control-handle, .agent-control-handle';
  }
  if (mode === 'data') {
    return '.workflow-port-handle';
  }
  return '.acc-connect-hitbox, .workflow-control-handle, .agent-control-handle, .workflow-port-handle, .react-flow__handle';
}

export function closestConnectionHandle(element: Element | null): HTMLElement | null {
  const handle = element?.closest?.(connectionHandleSelector());
  return handle instanceof HTMLElement ? handle : null;
}

export function isConnectionHandleForMode(handle: HTMLElement, mode: ConnectionMode): boolean {
  if (mode === 'control') {
    return (
      handle.classList.contains('acc-connect-hitbox') ||
      handle.classList.contains('workflow-control-handle') ||
      handle.classList.contains('agent-control-handle')
    );
  }
  return handle.classList.contains('workflow-port-handle');
}

export function connectionModeForHandleElement(handle: HTMLElement): ConnectionMode | null {
  if (
    handle.classList.contains('acc-connect-hitbox') ||
    handle.classList.contains('workflow-control-handle') ||
    handle.classList.contains('agent-control-handle')
  ) {
    return 'control';
  }
  if (handle.classList.contains('workflow-port-handle')) {
    return 'data';
  }
  return null;
}

export function connectionSideFromHandleElement(handle: HTMLElement): EndpointSide | null {
  const handleId = handle.getAttribute('data-handleid') || '';
  if (handleId.endsWith(':control:source') || handleId.includes('workflow-input-inner-source') || handleId.includes('workflow-output-outer-source')) {
    return 'source';
  }
  if (handleId.endsWith(':control:target') || handleId.includes('workflow-input-outer-target') || handleId.includes('workflow-output-inner-target')) {
    return 'target';
  }
  if (handle.classList.contains('source')) {
    return 'source';
  }
  if (handle.classList.contains('target')) {
    return 'target';
  }
  return null;
}

export function queueControlHandleConnectionStart(
  target: EventTarget | null,
  onControlHandleMouseDown: (
    nodeId: string,
    handleId: string,
    side: EndpointSide,
    mode?: ConnectionMode,
  ) => void,
  mode: ConnectionMode = 'control',
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const handle = closestConnectionHandle(target);
  if (!(handle instanceof HTMLElement)) {
    return false;
  }
  if (!isConnectionHandleForMode(handle, mode)) {
    return false;
  }
  const nodeId = handle.getAttribute('data-nodeid');
  const handleId = handle.getAttribute('data-handleid');
  const side = connectionSideFromHandleElement(handle);
  if (!nodeId || !handleId || !side) {
    return false;
  }
  onControlHandleMouseDown(nodeId, handleId, side, mode);
  return true;
}

export function elementByDataHandleId(handleId: string, nodeId?: string): HTMLElement | null {
  const allHandles = Array.from(document.querySelectorAll<HTMLElement>('[data-handleid]'))
    .filter((handle) => handle.getAttribute('data-handleid') === handleId);
  const handles = nodeId
    ? allHandles.filter((handle) => handle.getAttribute('data-nodeid') === nodeId)
    : allHandles;
  const candidatesForNode = handles.length ? handles : allHandles;
  if (!candidatesForNode.length) {
    return null;
  }
  const visibleHandles = candidatesForNode.filter((handle) => {
    const rect = handle.getBoundingClientRect();
    const style = window.getComputedStyle(handle);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  });
  const candidates = visibleHandles.length ? visibleHandles : candidatesForNode;
  return (
    candidates.find((handle) => handle.classList.contains('workflow-control-handle') || handle.classList.contains('agent-control-handle')) ||
    candidates.find((handle) => handle.classList.contains('workflow-port-handle')) ||
    candidates.find((handle) => handle.classList.contains('acc-connect-hitbox')) ||
    candidates[0] ||
    null
  );
}

export function rectCenter(rect: DOMRect): { x: number; y: number } {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

export function recordConnectionTrace(event: string, detail: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') {
    return;
  }
  const entry: ConnectionTraceEvent = { event, detail, timestamp: Date.now() };
  try {
    const diagnosticsWindow = window as Window & {
      __ACC_CONNECTION_TRACE__?: ConnectionTraceEvent[];
    };
    const trace = diagnosticsWindow.__ACC_CONNECTION_TRACE__ || [];
    trace.push(entry);
    diagnosticsWindow.__ACC_CONNECTION_TRACE__ = trace.slice(-80);
  } catch {
    // Some browser automation sandboxes expose a non-extensible window proxy.
  }
  if (window.localStorage?.getItem('acc.connection.trace') === '1') {
    console.info('[acc-connection]', event, detail);
  }
}

export function domConnectionEndpointAtPoint(
  point: { x: number; y: number },
  mode: ConnectionMode,
): DomConnectionEndpoint | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const stack =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(point.x, point.y)
      : [document.elementFromPoint(point.x, point.y)].filter(Boolean) as Element[];
  for (const element of stack) {
    const endpoint = domConnectionEndpointFromElement(element, mode);
    if (endpoint) {
      return endpoint;
    }
  }
  const direct = domConnectionEndpointFromElement(document.elementFromPoint(point.x, point.y), mode);
  if (direct) {
    return direct;
  }
  const handles = Array.from(document.querySelectorAll<HTMLElement>(connectionHandleSelector(mode)));
  let best: { endpoint: DomConnectionEndpoint; distance: number } | null = null;
  for (const handle of handles) {
    const endpoint = domConnectionEndpointFromElement(handle, mode);
    if (!endpoint) {
      continue;
    }
    const rect = handle.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.hypot(centerX - point.x, centerY - point.y);
    const insideExpandedRect =
      point.x >= rect.left - 12 &&
      point.x <= rect.right + 12 &&
      point.y >= rect.top - 12 &&
      point.y <= rect.bottom + 12;
    if (!insideExpandedRect && distance > 18) {
      continue;
    }
    if (!best || distance < best.distance) {
      best = { endpoint, distance };
    }
  }
  return best?.endpoint || null;
}

export function domConnectionEndpointFromElement(
  element: Element | null,
  mode?: ConnectionMode,
): DomConnectionEndpoint | null {
  const handle = closestConnectionHandle(element);
  if (!(handle instanceof HTMLElement)) {
    return null;
  }
  if (mode && !isConnectionHandleForMode(handle, mode)) {
    return null;
  }
  const nodeId = handle.getAttribute('data-nodeid');
  if (!nodeId) {
    return null;
  }
  const side = connectionSideFromHandleElement(handle);
  if (!side) {
    return null;
  }
  return {
    nodeId,
    handleId: handle.getAttribute('data-handleid'),
    side,
  };
}

export function domFlowNodeIdAtPoint(
  point: { x: number; y: number },
  elementOverride?: Element | null,
): string | null {
  const overrideId = flowNodeIdFromElement(elementOverride);
  if (overrideId) {
    return overrideId;
  }
  if (typeof document === 'undefined') {
    return null;
  }
  const stack =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(point.x, point.y)
      : ([document.elementFromPoint(point.x, point.y)].filter(Boolean) as Element[]);
  for (const element of stack) {
    const flowNodeId = flowNodeIdFromElement(element);
    if (flowNodeId) {
      return flowNodeId;
    }
  }
  return flowNodeIdFromElement(document.elementFromPoint(point.x, point.y));
}

export function flowNodeIdFromElement(element: Element | null | undefined): string | null {
  const node = element?.closest?.('.react-flow__node');
  if (!(node instanceof HTMLElement)) {
    return null;
  }
  return (
    node.getAttribute('data-id') ||
    node.getAttribute('data-nodeid') ||
    node.id ||
    null
  );
}

export function connectionHandleElementForEndpoint(endpoint: DomConnectionEndpoint): HTMLElement | null {
  return endpoint.handleId ? elementByDataHandleId(endpoint.handleId, endpoint.nodeId) : null;
}
