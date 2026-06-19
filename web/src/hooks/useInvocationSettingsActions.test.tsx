import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { useState, type SetStateAction } from 'react';

import type {
  InternalNodeView,
  WorkflowContainerModel,
  WorkflowPortView,
  WorkspaceCanvasModel,
} from '../types/workbench';
import {
  useInvocationSettingsActions,
  type UseInvocationSettingsActionsResult,
} from './useInvocationSettingsActions';

let latestActions: UseInvocationSettingsActionsResult | null = null;
let latestCanvas: WorkspaceCanvasModel | null = null;

function applySetState<T>(current: T, next: SetStateAction<T>): T {
  return typeof next === 'function' ? (next as (value: T) => T)(current) : next;
}

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

function internalNode(id: string): InternalNodeView {
  return {
    id,
    name: id,
    task: 'Run internal task',
    kind: 'Agent',
    status: 'not_run',
    callableId: `${id}.codex`,
    inputPorts: [port('main', 'input')],
    outputPorts: [port('main', 'output')],
  };
}

function workflow(): WorkflowContainerModel {
  return {
    id: 'workflow_1',
    title: 'workflow_1',
    workflowBodyKind: 'inline_container',
    directory: 'workflows/workflow_1',
    status: 'not_run',
    inputPorts: [port('main', 'input')],
    outputPorts: [port('main', 'output')],
    internalNodes: [internalNode('agent_1')],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 430, height: 328 },
    warnings: [],
  };
}

function canvas(): WorkspaceCanvasModel {
  return {
    id: 'task_canvas',
    name: '任务',
    layout: 'workspace-canvas',
    rootWorkflowId: 'task_canvas',
    workflows: [workflow()],
    edges: [],
  };
}

function Harness() {
  const [currentCanvas, setCurrentCanvas] = useState(canvas);
  const updateCanvas = (next: SetStateAction<WorkspaceCanvasModel>) => {
    setCurrentCanvas((current) => applySetState(current, next));
  };

  latestActions = useInvocationSettingsActions({
    updateCanvas,
    updateCanvasAndGraph: updateCanvas,
  });
  latestCanvas = currentCanvas;

  return <output>{currentCanvas.workflows[0].title}</output>;
}

function selectedWorkflow(): WorkflowContainerModel {
  const workflowValue = latestCanvas?.workflows.find((item) => item.id === 'workflow_1');
  if (!workflowValue) {
    throw new Error('workflow_1 missing');
  }
  return workflowValue;
}

function selectedInternalNode(): InternalNodeView {
  const node = selectedWorkflow().internalNodes.find((item) => item.id === 'agent_1');
  if (!node) {
    throw new Error('agent_1 missing');
  }
  return node;
}

describe('useInvocationSettingsActions', () => {
  afterEach(() => {
    latestActions = null;
    latestCanvas = null;
  });

  test('updates workflow and internal invocation inputs', () => {
    render(<Harness />);

    act(() => {
      latestActions?.updateWorkflowInvocationInput('workflow_1', { user_prompt: 'Analyze NVDA' });
    });
    act(() => {
      latestActions?.updateInternalInvocationInput('workflow_1', 'agent_1', { target: 'NVDA' });
    });

    expect(selectedWorkflow().sourceInput).toEqual({ user_prompt: 'Analyze NVDA' });
    expect(selectedInternalNode().input).toEqual({ target: 'NVDA' });
  });

  test('trims invocation labels and falls back to ids for blank labels', () => {
    render(<Harness />);

    act(() => {
      latestActions?.updateWorkflowInvocationLabel('workflow_1', '  Fundamentals  ');
    });
    expect(selectedWorkflow()).toMatchObject({
      title: 'Fundamentals',
      invocationLabel: 'Fundamentals',
    });

    act(() => {
      latestActions?.updateInternalInvocationLabel('workflow_1', 'agent_1', '   ');
    });
    expect(selectedInternalNode()).toMatchObject({
      name: 'agent_1',
      invocationLabel: 'agent_1',
    });
  });

  test('updates workflow and internal control-main forwarding flags', () => {
    render(<Harness />);

    act(() => {
      latestActions?.updateWorkflowForwardMainOutput('workflow_1', true);
    });
    act(() => {
      latestActions?.updateInternalForwardMainOutput('workflow_1', 'agent_1', true);
    });

    expect(selectedWorkflow().forwardMainOutputOnControl).toBe(true);
    expect(selectedInternalNode().forwardMainOutputOnControl).toBe(true);
  });

  test('updates empty-input policy for workflow and internal nodes', () => {
    render(<Harness />);

    act(() => {
      latestActions?.updateWorkflowEmptyInputPolicy('workflow_1', 'block');
    });
    act(() => {
      latestActions?.updateInternalEmptyInputPolicy('workflow_1', 'agent_1', 'block');
    });

    expect(selectedWorkflow().emptyInputPolicy).toBe('block');
    expect(selectedInternalNode().emptyInputPolicy).toBe('block');
  });

  test('normalizes Codex execution mode for workflow and internal nodes', () => {
    render(<Harness />);

    act(() => {
      latestActions?.updateWorkflowCodexExecutionMode('workflow_1', 'danger_full_access');
    });
    act(() => {
      latestActions?.updateInternalCodexExecutionMode(
        'workflow_1',
        'agent_1',
        'unsupported_mode' as 'default',
      );
    });

    expect(selectedWorkflow().codexExecutionMode).toBe('danger_full_access');
    expect(selectedInternalNode().codexExecutionMode).toBe('default');
  });
});
