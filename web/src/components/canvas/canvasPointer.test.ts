import { describe, expect, it } from 'vitest';
import {
  connectionPreviewFromHandle,
  flowPositionFromPoint,
  pointerPoint,
} from './canvasPointer';

describe('canvasPointer', () => {
  it('uses React Flow screenToFlowPosition when available', () => {
    expect(
      flowPositionFromPoint(
        { screenToFlowPosition: (position) => ({ x: position.x / 2, y: position.y / 4 }) },
        { x: 100, y: 80 },
      ),
    ).toEqual({ x: 50, y: 20 });
  });

  it('falls back to element-relative coordinates without a React Flow instance', () => {
    const element = document.createElement('div');
    element.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 80, right: 110, bottom: 100, x: 10, y: 20, toJSON: () => ({}) });

    expect(flowPositionFromPoint(null, { x: 55, y: 65 }, element)).toEqual({ x: 45, y: 45 });
  });

  it('normalizes mouse and touch event points', () => {
    expect(pointerPoint({ clientX: 12, clientY: 34 } as MouseEvent)).toEqual({ x: 12, y: 34 });
    expect(
      pointerPoint({
        changedTouches: [{ clientX: 56, clientY: 78 }],
      } as unknown as TouchEvent),
    ).toEqual({ x: 56, y: 78 });
  });

  it('starts connection previews at the handle center when measurable', () => {
    const handle = document.createElement('button');
    handle.getBoundingClientRect = () => ({ left: 10, top: 20, width: 40, height: 20, right: 50, bottom: 40, x: 10, y: 20, toJSON: () => ({}) });

    expect(connectionPreviewFromHandle(handle, { x: 99, y: 88 })).toEqual({
      start: { x: 30, y: 30 },
      end: { x: 99, y: 88 },
    });
  });
});
