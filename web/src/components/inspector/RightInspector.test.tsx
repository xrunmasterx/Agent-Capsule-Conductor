import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, test, vi } from 'vitest';

import type {
  InternalNodeView,
  WorkflowContainerModel,
  WorkflowPortView,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import type { InspectorRenderers } from './InspectorRenderers';
import { RightInspector, type AgentNodeSettingsRendererProps } from './RightInspector';

vi.mock('../../hooks/useCallableDetail', () => ({
  useCallableDetail: vi.fn(() => ({ status: 'idle', detail: null, error: '' })),
}));

function port(id: string, direction: 'input' | 'output'): WorkflowPortView {
  return { id, label: id, direction, cardinality: 'one' };
}

function internalNodeFixture(): InternalNodeView {
  return {
    id: 'internal_a',
    name: 'Internal A',
    task: 'Do internal work',
    kind: 'Agent',
    status: 'not_run',
    callableId: 'agent.internal',
    inputPorts: [port('main', 'input')],
    outputPorts: [port('summary', 'output')],
    input: { topic: 'internal' },
  };
}

function workflowFixture(overrides: Partial<WorkflowContainerModel> = {}): WorkflowContainerModel {
  const internalNode = internalNodeFixture();
  return {
    id: 'workflow_a',
    title: 'Workflow A',
    directory: 'workflows/a',
    sourceKind: 'agent',
    callableId: 'agent.workflow',
    status: 'not_run',
    inputPorts: [port('main', 'input')],
    outputPorts: [port('summary', 'output')],
    internalNodes: [internalNode],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 240, height: 120 },
    warnings: [],
    sourceInput: { topic: 'workflow' },
    ...overrides,
  };
}

function canvasFixture(workflow = workflowFixture()): WorkspaceCanvasModel {
  return {
    id: 'task',
    name: 'Task',
    rootWorkflowId: 'task',
    workflows: [workflow],
    edges: [],
  };
}

function renderersFixture(): InspectorRenderers {
  return {
    codeBlock: ({ title }) => <div>{title}</div>,
    evidencePreview: ({ title }) => <div>{title}</div>,
    invocationInputEditor: () => <div>invocation editor</div>,
    invocationIdentityCard: ({ label }) => <div>{label}</div>,
    liveLogBlocks: () => <div>live logs</div>,
    nodeEvidencePaths: () => <div>node evidence</div>,
    portList: ({ title }) => <div>{title}</div>,
    eventTimeline: ({ title }) => <div>{title}</div>,
  };
}

function baseProps(
  overrides: Partial<ComponentProps<typeof RightInspector>> = {},
): ComponentProps<typeof RightInspector> {
  const workflow = workflowFixture();
  const canvas = canvasFixture(workflow);
  return {
    canvas,
    selection: { type: 'task_canvas', taskId: 'task' },
    selectedWorkflow: undefined,
    selectedPort: undefined,
    selectedEdge: undefined,
    selectedInternalNode: undefined,
    connectionMode: 'data',
    dataConnectionDraft: null,
    runtimeConfig: null,
    liveLogs: {},
    workflowRun: null,
    workflowEvents: [],
    workflows: [],
    binding: undefined,
    renderers: renderersFixture(),
    renderAgentNodeSettings: vi.fn((props: AgentNodeSettingsRendererProps) => (
      <div>agent settings:{props.node.nodeId}</div>
    )),
    boundaryPreviewSnapshotForCanvas: vi.fn(() => ({})),
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
    ...overrides,
  };
}

describe('RightInspector', () => {
  test('projects an executable workflow into the agent settings renderer', () => {
    const workflow = workflowFixture();
    const renderAgentNodeSettings = vi.fn((props: AgentNodeSettingsRendererProps) => (
      <div>agent settings:{props.node.nodeId}</div>
    ));

    render(
      <RightInspector
        {...baseProps({
          canvas: canvasFixture(workflow),
          selection: { type: 'workflow', id: workflow.id },
          selectedWorkflow: workflow,
          renderAgentNodeSettings,
        })}
      />,
    );

    expect(screen.getByText('agent settings:workflow_a')).toBeInTheDocument();
    expect(renderAgentNodeSettings).toHaveBeenCalledTimes(1);
    const rendererProps = renderAgentNodeSettings.mock.calls[0]?.[0];
    expect(rendererProps?.node).toMatchObject({
      nodeId: 'workflow_a',
      callableId: 'agent.workflow',
      input: { topic: 'workflow' },
    });
    expect(rendererProps?.connectionEditor).toMatchObject({
      canvasNodeKind: 'workflow',
      scopeWorkflowId: null,
      nodeId: 'workflow_a',
      callableId: 'agent.workflow',
    });
  });

  test('projects an internal node into the same agent settings renderer contract', () => {
    const workflow = workflowFixture({ sourceKind: 'workflow', callableId: undefined });
    const internalNode = workflow.internalNodes[0];
    const renderAgentNodeSettings = vi.fn((props: AgentNodeSettingsRendererProps) => (
      <div>agent settings:{props.node.nodeId}</div>
    ));

    render(
      <RightInspector
        {...baseProps({
          canvas: canvasFixture(workflow),
          selection: { type: 'internal', workflowId: workflow.id, nodeId: internalNode.id },
          selectedWorkflow: workflow,
          selectedInternalNode: internalNode,
          renderAgentNodeSettings,
        })}
      />,
    );

    expect(screen.getByText('agent settings:internal_a')).toBeInTheDocument();
    expect(renderAgentNodeSettings).toHaveBeenCalledTimes(1);
    const rendererProps = renderAgentNodeSettings.mock.calls[0]?.[0];
    expect(rendererProps?.node).toMatchObject({
      nodeId: 'internal_a',
      callableId: 'agent.internal',
      input: { topic: 'internal' },
    });
    expect(rendererProps?.connectionEditor).toMatchObject({
      canvasNodeKind: 'internal',
      scopeWorkflowId: 'workflow_a',
      nodeId: 'internal_a',
      outputPortsReadonly: true,
    });
  });
});
