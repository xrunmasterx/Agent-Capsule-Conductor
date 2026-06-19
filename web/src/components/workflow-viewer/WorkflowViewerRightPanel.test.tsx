import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type {
  CanvasSelection,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { WorkflowViewerRightPanel } from './WorkflowViewerRightPanel';

vi.mock('../inspector/ResourceInspector', () => ({
  ResourceInspector: ({ resource }: { resource: { name: string } }) => (
    <div data-testid="resource-inspector">{resource.name}</div>
  ),
}));

vi.mock('../inspector/RightInspector', () => ({
  RightInspector: ({
    onConnectionMode,
    onConfigureBinding,
  }: {
    onConnectionMode: (mode: 'data' | 'control') => void;
    onConfigureBinding: (workflowId: string) => void;
  }) => (
    <div data-testid="right-inspector">
      <button type="button" onClick={() => onConnectionMode('control')}>
        control mode
      </button>
      <button type="button" onClick={() => onConfigureBinding('workflow_1')}>
        configure binding
      </button>
    </div>
  ),
}));

function canvas(): WorkspaceCanvasModel {
  return {
    id: 'task_1',
    name: 'Task 1',
    rootWorkflowId: 'root',
    workflows: [],
    edges: [],
  };
}

function props() {
  const selection: CanvasSelection = { type: 'task_canvas', taskId: 'task_1' };
  return {
    resourceDetailOpen: false,
    inspectorOpen: false,
    inspectorWidth: 360,
    selection,
    selectedResource: null,
    canvas: canvas(),
    selectedWorkflow: undefined,
    selectedPort: undefined,
    selectedEdge: undefined,
    selectedInternalNode: undefined,
    connectionMode: 'data' as const,
    dataConnectionDraft: null,
    runtimeConfig: null,
    liveLogs: {},
    workflowRun: null,
    workflowEvents: [],
    workflows: [],
    workflowBindings: {},
    onResizeStart: vi.fn(),
    onCollapseRightPanel: vi.fn(),
    onConnectionMode: vi.fn(),
    onBeginDataConnection: vi.fn(),
    onCancelDataConnection: vi.fn(),
    onUpdateDataConnectionMaterialization: vi.fn(),
    onCompleteDataConnection: vi.fn(),
    onCompleteDataConnectionWithNewInputPort: vi.fn(),
    onAddDataConnectPort: vi.fn(),
    onRenameDataConnectPort: vi.fn(),
    onDeleteDataConnectPort: vi.fn(),
    onReadEvidence: vi.fn(),
    onConfigureBinding: vi.fn(),
    onUpdateWorkflowInput: vi.fn(),
    onUpdateInternalInput: vi.fn(),
    onUpdateWorkflowLabel: vi.fn(),
    onUpdateInternalLabel: vi.fn(),
    onUpdateWorkflowForwardMainOutput: vi.fn(),
    onUpdateInternalForwardMainOutput: vi.fn(),
    onUpdateWorkflowEmptyInputPolicy: vi.fn(),
    onUpdateInternalEmptyInputPolicy: vi.fn(),
    onUpdateWorkflowCodexExecutionMode: vi.fn(),
    onUpdateInternalCodexExecutionMode: vi.fn(),
    onOpenCallableResource: vi.fn(),
  };
}

describe('WorkflowViewerRightPanel', () => {
  test('renders resource detail drawer and forwards collapse', () => {
    const panelProps = props();
    render(
      <WorkflowViewerRightPanel
        {...panelProps}
        resourceDetailOpen
        selectedResource={{ callableId: 'agent_1', name: 'Agent 1', kind: 'agent_class' }}
      />,
    );

    expect(screen.getByTestId('resource-inspector')).toHaveTextContent('Agent 1');
    fireEvent.click(screen.getByRole('button', { name: /收起|鏀惰捣/ }));
    expect(panelProps.onCollapseRightPanel).toHaveBeenCalledTimes(1);
  });

  test('renders inspector drawer and forwards inspector commands', () => {
    const panelProps = props();
    render(<WorkflowViewerRightPanel {...panelProps} inspectorOpen />);

    fireEvent.click(screen.getByRole('button', { name: 'control mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'configure binding' }));

    expect(panelProps.onConnectionMode).toHaveBeenCalledWith('control');
    expect(panelProps.onConfigureBinding).toHaveBeenCalledWith('workflow_1');
  });
});
