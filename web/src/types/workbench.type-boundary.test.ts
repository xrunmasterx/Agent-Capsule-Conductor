import { describe, expect, test } from 'vitest';

import type {
  AssistantChatMessage,
  CanvasSelection,
  RunProjectionSlim,
  WorkspaceCanvasModel,
  WorkflowCanvasEdge,
} from './workbench';

describe('workbench shared type boundary', () => {
  test('constructs core canvas and selection models without importing WorkflowViewer', () => {
    const edge: WorkflowCanvasEdge = {
      id: 'data_source_main_target_main',
      kind: 'data',
      source: { workflowId: 'source', portId: 'main' },
      target: { workflowId: 'target', portId: 'main' },
      materialization: 'copy',
    };
    const canvas: WorkspaceCanvasModel = {
      id: 'task_canvas_default',
      name: '任务 1',
      rootWorkflowId: 'task_canvas_default',
      workflows: [],
      edges: [edge],
    };
    const selection: CanvasSelection = { type: 'edge', id: edge.id };

    expect(canvas.edges[0]).toBe(edge);
    expect(selection).toEqual({ type: 'edge', id: 'data_source_main_target_main' });
  });

  test('constructs assistant and run projection domain types from the shared module', () => {
    const message: AssistantChatMessage = {
      id: 'assistant_msg_1',
      role: 'assistant',
      content: 'ready',
      turnId: 'turn_1',
    };
    const run: RunProjectionSlim = {
      runId: 'run_1',
      taskId: 'task_canvas_default',
      status: 'queued',
      pollState: 'idle',
    };

    expect(message.turnId).toBe('turn_1');
    expect(run.status).toBe('queued');
  });
});
