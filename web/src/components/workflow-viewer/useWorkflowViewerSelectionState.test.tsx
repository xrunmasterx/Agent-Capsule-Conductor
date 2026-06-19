import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type {
  CanvasSelection,
  WorkbenchTask,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { useWorkflowViewerSelectionState } from './useWorkflowViewerSelectionState';

vi.mock('../../hooks/useCallableDetail', () => ({
  useCallableDetail: () => ({ status: 'idle', detail: null, error: '' }),
}));

vi.mock('../../hooks/useNodeRunDetails', () => ({
  useNodeRunDetails: () => ({ nodeRunDetailsByKey: {} }),
}));

vi.mock('../../hooks/useSelectedAgentSession', () => ({
  useSelectedAgentSession: () => ({
    state: {
      status: 'idle',
      session: null,
      messages: [],
      events: [],
      pendingTurn: null,
      interactions: [],
      error: '',
    },
    refresh: async () => undefined,
    setPendingTurn: () => undefined,
    appendEvent: () => undefined,
  }),
}));

vi.mock('../../hooks/useWorkbenchLiveStream', () => ({
  liveStateForNodeRun: () => ({ events: [], status: 'idle', error: '' }),
  useWorkbenchLiveStream: () => ({ events: [], status: 'idle', error: '' }),
}));

function canvas(): WorkspaceCanvasModel {
  return {
    id: 'task_1',
    name: 'Task 1',
    rootWorkflowId: 'workflow_1',
    workflows: [
      {
        id: 'workflow_1',
        title: 'Workflow 1',
        directory: 'workflows/workflow_1',
        status: 'not_run',
        inputPorts: [{ id: 'main', label: 'main', direction: 'input' }],
        outputPorts: [{ id: 'result', label: 'result', direction: 'output' }],
        internalNodes: [
          {
            id: 'agent_1',
            name: 'Agent 1',
            task: 'agent_template',
            kind: 'Agent',
            status: 'not_run',
            callableId: 'agent_template',
            inputPorts: [{ id: 'main', label: 'main', direction: 'input' }],
            outputPorts: [{ id: 'main', label: 'main', direction: 'output' }],
          },
        ],
        internalEdges: [],
        position: { x: 0, y: 0 },
        size: { width: 360, height: 240 },
        warnings: [],
      },
    ],
    edges: [
      {
        id: 'edge_1',
        kind: 'control',
        source: { workflowId: 'workflow_1' },
        target: { workflowId: 'workflow_1' },
      },
    ],
  };
}

function task(canvasModel: WorkspaceCanvasModel): WorkbenchTask {
  return {
    taskId: 'task_1',
    title: 'Task 1',
    canvas: canvasModel,
    status: 'not_run',
  };
}

function renderSelection(selection: CanvasSelection) {
  const canvasModel = canvas();
  return renderHook(() =>
    useWorkflowViewerSelectionState({
      displayCanvas: canvasModel,
      selection,
      selectedRunId: null,
      selectedRunProjection: undefined,
      workflowRun: null,
      workflowEvents: [],
      selectedLiveLogs: {},
      selectedRunLiveEvents: [],
      runtimeConfig: null,
      workflowBindings: {},
      currentTask: task(canvasModel),
    }),
  );
}

describe('useWorkflowViewerSelectionState', () => {
  test('resolves workflow and port selections from the display canvas', () => {
    const workflowResult = renderSelection({ type: 'workflow', id: 'workflow_1' });
    expect(workflowResult.result.current.selectedWorkflow?.id).toBe('workflow_1');
    expect(workflowResult.result.current.selectedDetailsModelWithAgentEvents.kind).toBe('workflow');

    const portResult = renderSelection({
      type: 'port',
      workflowId: 'workflow_1',
      portId: 'result',
      direction: 'output',
    });
    expect(portResult.result.current.selectedWorkflow?.id).toBe('workflow_1');
    expect(portResult.result.current.selectedPort?.id).toBe('result');
  });

  test('resolves edge and internal-node selections without API-backed run state', () => {
    const edgeResult = renderSelection({ type: 'edge', id: 'edge_1' });
    expect(edgeResult.result.current.selectedEdge?.id).toBe('edge_1');
    expect(edgeResult.result.current.selectedDetailsModelWithAgentEvents.kind).toBe('edge');

    const internalResult = renderSelection({
      type: 'internal',
      workflowId: 'workflow_1',
      nodeId: 'agent_1',
    });
    expect(internalResult.result.current.selectedInternalNode?.id).toBe('agent_1');
    expect(internalResult.result.current.selectedAgentSessionContext).toBeNull();
  });
});
