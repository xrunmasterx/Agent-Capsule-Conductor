import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import type { ConnectPreviewState } from './CanvasToolbar';

export type CanvasPointerEvent =
  | PointerEvent
  | MouseEvent
  | TouchEvent
  | ReactPointerEvent<Element>
  | ReactTouchEvent<Element>
  | ReactMouseEvent<Element>;

export type FlowPositionInstance = {
  screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
};

export function flowPositionFromEvent(
  flowInstance: FlowPositionInstance | null,
  event: { clientX: number; clientY: number; currentTarget?: EventTarget | null },
): { x: number; y: number } {
  return flowPositionFromPoint(flowInstance, { x: event.clientX, y: event.clientY }, event.currentTarget);
}

export function flowPositionFromPoint(
  flowInstance: FlowPositionInstance | null,
  point: { x: number; y: number },
  fallbackElement?: EventTarget | null,
): { x: number; y: number } {
  if (flowInstance?.screenToFlowPosition) {
    return flowInstance.screenToFlowPosition(point);
  }
  const rect = fallbackElement instanceof HTMLElement ? fallbackElement.getBoundingClientRect() : { left: 0, top: 0 };
  return { x: point.x - rect.left, y: point.y - rect.top };
}

export function pointerPoint(event: CanvasPointerEvent): { x: number; y: number } {
  if ('changedTouches' in event && event.changedTouches?.length) {
    const touch = event.changedTouches[0];
    return { x: touch.clientX, y: touch.clientY };
  }
  const pointerEvent = event as MouseEvent | PointerEvent | ReactMouseEvent<Element> | ReactPointerEvent<Element>;
  return { x: pointerEvent.clientX, y: pointerEvent.clientY };
}

export function connectionPreviewFromHandle(handle: HTMLElement, fallback: { x: number; y: number }): ConnectPreviewState {
  const rect = handle.getBoundingClientRect();
  const start = rect.width > 0 || rect.height > 0
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : fallback;
  return { start, end: fallback };
}
