import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, test, vi } from 'vitest';

import type { WorkflowContainerModel, WorkflowPortView, WorkspaceCanvasModel } from '../../types/workbench';
import type { InspectorRenderers } from './InspectorRenderers';
import { WorkflowInspector } from './WorkflowInspector';

function port(id: string, direction: 'input' | 'output'): WorkflowPortView {
  return { id, label: id, direction, cardinality: 'one' };
}

function workflowFixture(overrides: Partial<WorkflowContainerModel> = {}): WorkflowContainerModel {
  return {
    id: 'workflow_a',
    title: 'Workflow A',
    directory: 'workflows/a',
    sourceKind: 'agent',
    callableId: 'agent.workflow',
    status: 'not_run',
    inputPorts: [port('main', 'input')],
    outputPorts: [port('summary', 'output')],
    internalNodes: [],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 240, height: 120 },
    warnings: [],
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
    codeBlock: ({ title, content }) => (
      <div data-testid={`code-${title}`}>
        {title}
        {content}
      </div>
    ),
    evidencePreview: ({ title, path, emptyText }) => <div>{path ? `${title}:${path}` : emptyText}</div>,
    invocationInputEditor: ({ onChange }) => (
      <button type="button" onClick={() => onChange({ topic: 'updated' })}>
        update invocation input
      </button>
    ),
    invocationIdentityCard: ({ label }) => <div>{label}</div>,
    liveLogBlocks: () => <div>live logs</div>,
    nodeEvidencePaths: () => <div>node evidence</div>,
    portList: ({ title, ports }) => (
      <div>
        {title}
        {ports.map((item) => (
          <span key={item.id}>{item.id}</span>
        ))}
      </div>
    ),
    eventTimeline: ({ title, events }) => (
      <div>
        {title}:{events.length}
      </div>
    ),
  };
}

function renderWorkflowInspector(
  overrides: Partial<ComponentProps<typeof WorkflowInspector>> = {},
) {
  const workflow = workflowFixture();
  const props: ComponentProps<typeof WorkflowInspector> = {
    canvas: canvasFixture(workflow),
    workflow,
    tab: 'overview',
    workflowRun: null,
    runtimeConfig: null,
    liveLogs: {},
    events: [],
    dataConnectionDraft: null,
    renderers: renderersFixture(),
    onReadEvidence: vi.fn(),
    onConfigureBinding: vi.fn(),
    onBeginDataConnection: vi.fn(),
    onCancelDataConnection: vi.fn(),
    onUpdateDataConnectionMaterialization: vi.fn(),
    onCompleteDataConnection: vi.fn(),
    onCompleteDataConnectionWithNewInputPort: vi.fn(),
    onAddDataConnectPort: vi.fn(),
    onRenameDataConnectPort: vi.fn(),
    onDeleteDataConnectPort: vi.fn(),
    onUpdateInput: vi.fn(),
    onUpdateLabel: vi.fn(),
    ...overrides,
  };
  render(<WorkflowInspector {...props} />);
  return props;
}

describe('WorkflowInspector', () => {
  test('routes invocation input changes through the workflow id', () => {
    const props = renderWorkflowInspector({ tab: 'invocation' });

    fireEvent.click(screen.getByRole('button', { name: 'update invocation input' }));

    expect(props.onUpdateInput).toHaveBeenCalledWith('workflow_a', { topic: 'updated' });
    expect(screen.getByTestId('code-core-v2-invocation-preview.json')).toHaveTextContent('Workflow A');
  });

  test('renders executable workflow connection controls with workflow-scoped ports', () => {
    const props = renderWorkflowInspector({ tab: 'connections' });

    const summaryRow = screen.getAllByText('summary')[0]?.closest('.port-contract-row');
    expect(summaryRow).not.toBeNull();
    fireEvent.click(within(summaryRow as HTMLElement).getByRole('button', { name: '从此输出连接...' }));

    expect(screen.getAllByText('summary').length).toBeGreaterThan(0);
    expect(props.onBeginDataConnection).toHaveBeenCalledWith({
      scopeWorkflowId: null,
      sourceNodeId: 'workflow_a',
      sourceNodeLabel: 'Workflow A',
      sourcePortId: 'summary',
      materialization: 'copy',
    });
  });

  test('uses the supplied renderer for non-executable workflow port lists', () => {
    renderWorkflowInspector({
      tab: 'output',
      workflow: workflowFixture({ sourceKind: 'workflow', callableId: undefined }),
    });

    expect(screen.getByText('summary')).toBeInTheDocument();
  });
});
