import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type {
  AgentSessionRecord,
  AgentTurnRecord,
  AuthoringAgentSummary,
  WorkflowBindingView,
} from '../../types';
import type {
  AssistantGraphOpsReview,
  SelectedEntityDetailsModel,
} from '../../types/workbench';
import type { WorkbenchLiveStreamState } from '../../hooks/useWorkbenchLiveStream';
import { WorkflowViewerDock } from './WorkflowViewerDock';

function workflowBinding(): WorkflowBindingView {
  return {
    workflow_id: 'workflow_1',
    workflowId: 'workflow_1',
    binding_path: 'bindings/workflow_1.binding.local.json',
    bindingPath: 'bindings/workflow_1.binding.local.json',
    workspace_root: 'F:/workspace',
    workspaceRoot: 'F:/workspace',
    exists: true,
    status: 'valid',
  };
}

function selectedDetailsModel(): SelectedEntityDetailsModel {
  return {
    key: 'canvas:task_1',
    kind: 'canvas',
    title: 'Task 1',
    status: 'not_run',
    log: {
      stdout: '',
      stderr: '',
      excerpt: '',
    },
    properties: [],
    evidenceActions: [],
    events: [],
  };
}

function liveState(): WorkbenchLiveStreamState {
  return { events: [], status: 'idle', error: '' };
}

function props() {
  return {
    bindingEditorWorkflowId: null,
    setBindingEditorWorkflowId: vi.fn(),
    workflowBindings: { workflow_1: workflowBinding() },
    validateBinding: vi.fn(async () => workflowBinding()),
    saveBinding: vi.fn(async () => workflowBinding()),
    openBindingsFolder: vi.fn(async () => undefined),
    selectBindingDirectory: vi.fn(async () => ({ workflow_id: 'workflow_1', status: 'cancelled' })),
    saveWorkflowDialog: null,
    setSaveWorkflowDialog: vi.fn(),
    confirmSaveWorkflow: vi.fn(),
    blueprintViewActive: false,
    evidenceDock: { open: false, title: 'Evidence', content: null },
    setEvidenceDock: vi.fn(),
    bottomDockMode: 'evidence' as const,
    message: 'ready',
    selectedDetailsModel: selectedDetailsModel(),
    currentTaskId: 'task_1',
    selectedRunId: null,
    readEvidence: vi.fn(),
    assistantInput: '',
    assistantMessages: [],
    assistantProposal: null,
    assistantValidation: null,
    temporaryResources: {},
    authoringAgents: [] as AuthoringAgentSummary[],
    selectedAuthoringAgentId: '',
    assistantSessionId: null,
    assistantAgentSession: null as AgentSessionRecord | null,
    assistantSessionStatus: 'disconnected',
    assistantPendingTurn: null as AgentTurnRecord | null,
    assistantEvents: [],
    assistantLiveState: liveState(),
    assistantTurnReason: 'workbench_chat' as const,
    assistantRequiredActions: [],
    assistantGraphOpsReview: null as AssistantGraphOpsReview | null,
    assistantBusy: false,
    selection: { type: 'task_canvas' as const, taskId: 'task_1' },
    selectedWorkflow: undefined,
    selectedInternalNode: undefined,
    hasSelectedRunNode: false,
    canUndoAssistantApply: false,
    setSelectedAuthoringAgentId: vi.fn(),
    setAssistantSessionId: vi.fn(),
    setAssistantAgentSession: vi.fn(),
    setAssistantPendingTurn: vi.fn(),
    setAssistantEvents: vi.fn(),
    setAssistantSessionStatus: vi.fn(),
    setAssistantTurnReason: vi.fn(),
    setAssistantInput: vi.fn(),
    generateAssistantProposal: vi.fn(),
    applyAssistantProposal: vi.fn(),
    discardAssistantProposal: vi.fn(),
    undoLastAssistantApply: vi.fn(),
    persistTemporaryResourceDraft: vi.fn(),
    applyGraphOpsPersistenceReview: vi.fn(),
    setAssistantGraphOpsReview: vi.fn(),
  };
}

describe('WorkflowViewerDock', () => {
  test('renders workflow binding dialog from explicit dialog state', () => {
    const dockProps = props();
    render(<WorkflowViewerDock {...dockProps} bindingEditorWorkflowId="workflow_1" />);

    expect(screen.getByRole('dialog', { name: '配置工作目录' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(dockProps.setBindingEditorWorkflowId).toHaveBeenCalledWith(null);
  });

  test('renders save workflow dialog and forwards confirm', () => {
    const dockProps = props();
    render(
      <WorkflowViewerDock
        {...dockProps}
        saveWorkflowDialog={{ name: 'Reusable workflow', saving: false, error: null }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '发布到 canonical .accflow.json' }));
    expect(dockProps.confirmSaveWorkflow).toHaveBeenCalledTimes(1);
  });
});
