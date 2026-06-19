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
  test('initializes source graph and graph ref from the initial canvas', () => {
    const initialCanvas = canvas();
    const { result } = renderHook(() => useWorkflowViewerGraphState(initialCanvas));

    expect(result.current.sourceGraph.id).toBe('task_canvas');
    expect(result.current.sourceGraph.name).toBe('Task Canvas');
    expect(result.current.sourceGraph.nodes).toHaveLength(1);
    expect(result.current.sourceGraph.nodes[0]?.id).toBe('workflow_1');
    expect(result.current.graphRef.current).toBe(result.current.sourceGraph);
  });

  test('keeps layout sync version owned by the graph state hook', () => {
    const { result } = renderHook(() => useWorkflowViewerGraphState(canvas()));

    act(() => {
      result.current.setLayoutSyncVersion((current) => current + 1);
    });

    expect(result.current.layoutSyncVersion).toBe(1);
  });
});
