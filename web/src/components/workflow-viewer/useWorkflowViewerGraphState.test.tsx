import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import type { WorkspaceCanvasModel } from '../../types/workbench';
import { useWorkflowViewerGraphState } from './useWorkflowViewerGraphState';

function canvas(id = 'task_canvas'): WorkspaceCanvasModel {
  return {
    id,
    name: 'Task Canvas',
    rootWorkflowId: 'workflow_1',
    workflows: [
      {
        id: 'workflow_1',
        title: 'Workflow 1',
        directory: '',
        status: 'not_run',
        inputPorts: [{ id: 'target', label: 'target', direction: 'input' }],
        outputPorts: [{ id: 'main', label: 'main', direction: 'output' }],
        internalNodes: [],
        internalEdges: [],
        position: { x: 0, y: 0 },
        size: { width: 420, height: 260 },
        warnings: [],
      },
    ],
    edges: [],
  };
}

describe('useWorkflowViewerGraphState', () => {
  test('derives source graph and graph ref from the current canvas revision', () => {
    const initialCanvas = canvas();
    const revisedCanvas = { ...initialCanvas, id: 'task_canvas_revised', name: 'Task Canvas Revised' };
    const { result, rerender } = renderHook(
      ({ currentCanvas, canvasRevision }) =>
        useWorkflowViewerGraphState(currentCanvas, canvasRevision),
      {
        initialProps: { currentCanvas: initialCanvas, canvasRevision: 0 },
      },
    );

    expect(result.current.sourceGraph.id).toBe('task_canvas');
    expect(result.current.sourceGraph.name).toBe('Task Canvas');
    expect(result.current.sourceGraph.nodes).toHaveLength(1);
    expect(result.current.sourceGraph.nodes[0]?.id).toBe('workflow_1');
    expect(result.current.graphRef.current).toBe(result.current.sourceGraph);
    expect('setSourceGraph' in result.current).toBe(false);

    rerender({ currentCanvas: revisedCanvas, canvasRevision: 1 });

    expect(result.current.sourceGraph.id).toBe('task_canvas_revised');
    expect(result.current.sourceGraph.name).toBe('Task Canvas Revised');
    expect(result.current.graphRef.current).toBe(result.current.sourceGraph);
  });

  test('keeps layout sync version owned by the graph state hook', () => {
    const { result } = renderHook(() => useWorkflowViewerGraphState(canvas(), 0));

    act(() => {
      result.current.setLayoutSyncVersion((current) => current + 1);
    });

    expect(result.current.layoutSyncVersion).toBe(1);
  });
});
