import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type {
  CanvasSelection,
  DataConnectionDraft,
  WorkbenchChromeState,
  WorkflowContainerModel,
  WorkflowPortView,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { useWorkflowViewerCanvasGuards } from './useWorkflowViewerCanvasGuards';

function port(id: string, direction: 'input' | 'output'): WorkflowPortView {
  return {
    id,
    label: id,
    direction,
    required: false,
    cardinality: 'one',
    artifactTypes: ['artifact'],
  };
}

function workflow(id: string, outputPorts: WorkflowPortView[] = []): WorkflowContainerModel {
  return {
    id,
    title: id,
    sourceKind: 'agent_session',
    callableId: `${id}.codex`,
    directory: `workflows/${id}`,
    status: 'not_run',
    inputPorts: [],
    outputPorts,
    internalNodes: [],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 276, height: 132 },
    warnings: [],
  };
}

function canvas(workflows: WorkflowContainerModel[] = [workflow('source_agent', [port('main', 'output')])]): WorkspaceCanvasModel {
  return {
    id: 'task_canvas',
    name: 'Task Canvas',
    layout: 'workspace-canvas',
    rootWorkflowId: 'task_canvas',
    workflows,
    edges: [],
  };
}

function draft(sourcePortId = 'main'): Exclude<DataConnectionDraft, null> {
  return {
    scopeWorkflowId: null,
    sourceNodeId: 'source_agent',
    sourceNodeLabel: 'Source Agent',
    sourcePortId,
    materialization: 'copy',
  };
}

function chrome(): WorkbenchChromeState {
  return {
    rightPanel: 'inspector',
    inspectorWidth: 360,
    leftPanel: 'resources',
  };
}

describe('useWorkflowViewerCanvasGuards', () => {
  test('normalizes stale selection and closes hidden task-canvas details', () => {
    const setSelection = vi.fn();
    const setChrome = vi.fn();
    const setNodeDetailOpen = vi.fn();

    renderHook(() =>
      useWorkflowViewerCanvasGuards({
        displayCanvas: canvas([]),
        selection: { type: 'workflow', id: 'missing_workflow' },
        focusedWorkflowId: null,
        connectionMode: 'control',
        dataConnectionDraft: null,
        setSelection,
        setChrome,
        setNodeDetailOpen,
        setDataConnectionDraft: vi.fn(),
      }),
    );

    expect(setSelection).toHaveBeenCalledWith({ type: 'task_canvas', taskId: 'task_canvas' });
    expect(setChrome.mock.calls[0][0](chrome()).rightPanel).toBe('none');
    expect(setNodeDetailOpen).toHaveBeenCalledWith(false);
  });

  test('clears data connection draft when connection mode leaves data mode', () => {
    const setDataConnectionDraft = vi.fn();

    renderHook(() =>
      useWorkflowViewerCanvasGuards({
        displayCanvas: canvas(),
        selection: { type: 'task_canvas', taskId: 'task_canvas' },
        focusedWorkflowId: null,
        connectionMode: 'control',
        dataConnectionDraft: draft(),
        setSelection: vi.fn(),
        setChrome: vi.fn(),
        setNodeDetailOpen: vi.fn(),
        setDataConnectionDraft,
      }),
    );

    expect(setDataConnectionDraft).toHaveBeenCalledWith(null);
  });

  test('clears data connection draft when the source node disappears', () => {
    const setDataConnectionDraft = vi.fn();

    renderHook(() =>
      useWorkflowViewerCanvasGuards({
        displayCanvas: canvas([workflow('other_agent', [port('main', 'output')])]),
        selection: { type: 'task_canvas', taskId: 'task_canvas' },
        focusedWorkflowId: null,
        connectionMode: 'data',
        dataConnectionDraft: draft('main'),
        setSelection: vi.fn(),
        setChrome: vi.fn(),
        setNodeDetailOpen: vi.fn(),
        setDataConnectionDraft,
      }),
    );

    expect(setDataConnectionDraft).toHaveBeenCalledWith(null);
  });

  test('keeps valid data connection draft in data mode', () => {
    const setDataConnectionDraft = vi.fn();

    renderHook(() =>
      useWorkflowViewerCanvasGuards({
        displayCanvas: canvas(),
        selection: { type: 'task_canvas', taskId: 'task_canvas' },
        focusedWorkflowId: null,
        connectionMode: 'data',
        dataConnectionDraft: draft(),
        setSelection: vi.fn(),
        setChrome: vi.fn(),
        setNodeDetailOpen: vi.fn(),
        setDataConnectionDraft,
      }),
    );

    expect(setDataConnectionDraft).not.toHaveBeenCalled();
  });
});
