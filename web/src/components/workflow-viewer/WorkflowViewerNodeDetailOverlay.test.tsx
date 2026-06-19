import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';

import type { AgentSessionUiState } from '../../hooks/useSelectedAgentSession';
import type { WorkbenchLiveStreamState } from '../../hooks/useWorkbenchLiveStream';
import type {
  InternalNodeView,
  SelectedEntityDetailsModel,
  WorkflowContainerModel,
} from '../../types/workbench';
import { WorkflowViewerNodeDetailOverlay } from './WorkflowViewerNodeDetailOverlay';

vi.mock('../inspector/NodeDetailOverlay', () => ({
  NodeDetailOverlay: ({
    children,
    onClose,
  }: {
    children: ReactNode;
    onClose: () => void;
  }) => (
    <section data-testid="node-detail-overlay">
      <button type="button" onClick={onClose}>
        close
      </button>
      {children}
    </section>
  ),
}));

vi.mock('../inspector/SelectionInputPane', () => ({
  SelectionInputPane: ({ onEnsureArtifactContent }: { onEnsureArtifactContent: (path: string) => void }) => (
    <button type="button" onClick={() => onEnsureArtifactContent('input.json')}>
      input pane
    </button>
  ),
}));

vi.mock('../inspector/SelectionOutputPane', () => ({
  SelectionOutputPane: ({ liveState }: { liveState: WorkbenchLiveStreamState }) => (
    <div data-testid="output-pane">{liveState.status}</div>
  ),
}));

vi.mock('../inspector/AgentNodeSettingsPanel', () => ({
  SelectionPropertiesPane: ({
    onUpdateInput,
    onUpdateLabel,
    onUpdateForwardMainOutput,
    onUpdateEmptyInputPolicy,
    onUpdateCodexExecutionMode,
  }: {
    onUpdateInput: (input: Record<string, unknown>) => void;
    onUpdateLabel: (label: string) => void;
    onUpdateForwardMainOutput: (value: boolean) => void;
    onUpdateEmptyInputPolicy: (value: 'allow' | 'block') => void;
    onUpdateCodexExecutionMode: (value: 'default') => void;
  }) => (
    <div>
      <button type="button" onClick={() => onUpdateInput({ target: 'AAPL' })}>
        update input
      </button>
      <button type="button" onClick={() => onUpdateLabel('Updated label')}>
        update label
      </button>
      <button type="button" onClick={() => onUpdateForwardMainOutput(true)}>
        update forward
      </button>
      <button type="button" onClick={() => onUpdateEmptyInputPolicy('block')}>
        update empty policy
      </button>
      <button type="button" onClick={() => onUpdateCodexExecutionMode('default')}>
        update codex mode
      </button>
    </div>
  ),
}));

function detailModel(overrides: Partial<SelectedEntityDetailsModel> = {}): SelectedEntityDetailsModel {
  return {
    key: 'node:workflow_1.node_1',
    kind: 'node',
    title: 'Node 1',
    status: 'not_run',
    scopeLabel: 'workflow_1',
    log: { stdout: '', stderr: '', excerpt: '' },
    properties: [],
    evidenceActions: [],
    events: [],
    ...overrides,
  };
}

function workflow(overrides: Partial<WorkflowContainerModel> = {}): WorkflowContainerModel {
  return {
    id: 'workflow_1',
    title: 'Workflow 1',
    sourceKind: 'agent',
    directory: 'workflows/demo',
    status: 'not_run',
    inputPorts: [],
    outputPorts: [],
    internalNodes: [],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 320, height: 200 },
    warnings: [],
    ...overrides,
  };
}

function internalNode(overrides: Partial<InternalNodeView> = {}): InternalNodeView {
  return {
    id: 'node_1',
    name: 'Node 1',
    task: 'agent.codex',
    kind: 'Agent',
    status: 'not_run',
    ...overrides,
  };
}

function liveState(overrides: Partial<WorkbenchLiveStreamState> = {}): WorkbenchLiveStreamState {
  return { events: [], status: 'idle', error: '', ...overrides };
}

function agentSessionState(): AgentSessionUiState {
  return {
    status: 'idle',
    session: null,
    messages: [],
    events: [],
    pendingTurn: null,
    interactions: [],
    error: '',
  };
}

function props() {
  return {
    open: true,
    model: detailModel(),
    selection: { type: 'internal' as const, workflowId: 'workflow_1', nodeId: 'node_1' },
    selectedWorkflow: workflow(),
    selectedInternalNode: internalNode(),
    artifactCacheByPath: {},
    selectedAgentTurnLiveState: liveState(),
    selectedAgentLiveState: liveState({ status: 'live' }),
    callableState: { status: 'idle' as const, detail: null, error: '' },
    runtimeConfig: null,
    agentSessionState: agentSessionState(),
    onClose: vi.fn(),
    onEnsureArtifactContent: vi.fn(async () => undefined),
    onReadEvidence: vi.fn(),
    onRefreshAgentSession: vi.fn(async () => undefined),
    onPublishAgentOutput: vi.fn(async () => undefined),
    onAnswerAgentInteraction: vi.fn(async () => undefined),
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

describe('WorkflowViewerNodeDetailOverlay', () => {
  test('routes internal node edits to internal callbacks', () => {
    const overlayProps = props();
    render(<WorkflowViewerNodeDetailOverlay {...overlayProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'update input' }));
    fireEvent.click(screen.getByRole('button', { name: 'update label' }));
    fireEvent.click(screen.getByRole('button', { name: 'update forward' }));
    fireEvent.click(screen.getByRole('button', { name: 'update empty policy' }));
    fireEvent.click(screen.getByRole('button', { name: 'update codex mode' }));

    expect(overlayProps.onUpdateInternalInput).toHaveBeenCalledWith('workflow_1', 'node_1', {
      target: 'AAPL',
    });
    expect(overlayProps.onUpdateInternalLabel).toHaveBeenCalledWith(
      'workflow_1',
      'node_1',
      'Updated label',
    );
    expect(overlayProps.onUpdateInternalForwardMainOutput).toHaveBeenCalledWith(
      'workflow_1',
      'node_1',
      true,
    );
    expect(overlayProps.onUpdateInternalEmptyInputPolicy).toHaveBeenCalledWith(
      'workflow_1',
      'node_1',
      'block',
    );
    expect(overlayProps.onUpdateInternalCodexExecutionMode).toHaveBeenCalledWith(
      'workflow_1',
      'node_1',
      'default',
    );
    expect(overlayProps.onUpdateWorkflowInput).not.toHaveBeenCalled();
  });

  test('routes workflow node edits to workflow callbacks and forwards close', () => {
    const overlayProps = props();
    render(
      <WorkflowViewerNodeDetailOverlay
        {...overlayProps}
        selection={{ type: 'workflow', id: 'workflow_1' }}
        selectedInternalNode={undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'update input' }));
    fireEvent.click(screen.getByRole('button', { name: 'update label' }));
    fireEvent.click(screen.getByRole('button', { name: 'close' }));

    expect(overlayProps.onUpdateWorkflowInput).toHaveBeenCalledWith('workflow_1', {
      target: 'AAPL',
    });
    expect(overlayProps.onUpdateWorkflowLabel).toHaveBeenCalledWith('workflow_1', 'Updated label');
    expect(overlayProps.onUpdateInternalInput).not.toHaveBeenCalled();
    expect(overlayProps.onClose).toHaveBeenCalledTimes(1);
  });
});
