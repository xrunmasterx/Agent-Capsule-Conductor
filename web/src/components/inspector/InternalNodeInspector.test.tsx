import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, test, vi } from 'vitest';

import type {
  InternalNodeView,
  WorkflowContainerModel,
  WorkflowPortView,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import type { InspectorRenderers } from './InspectorRenderers';
import { InternalNodeInspector } from './InternalNodeInspector';

function port(id: string, direction: 'input' | 'output'): WorkflowPortView {
  return { id, label: id, direction, cardinality: 'one' };
}

function internalNodeFixture(overrides: Partial<InternalNodeView> = {}): InternalNodeView {
  return {
    id: 'internal_a',
    name: 'Internal A',
    task: 'Do internal work',
    kind: 'Agent',
    status: 'not_run',
    callableId: 'agent.internal',
    inputPorts: [port('main', 'input')],
    outputPorts: [port('summary', 'output')],
    input: { topic: 'initial' },
    ...overrides,
  };
}

function workflowFixture(node = internalNodeFixture()): WorkflowContainerModel {
  return {
    id: 'workflow_a',
    title: 'Workflow A',
    directory: 'workflows/a',
    sourceKind: 'workflow',
    status: 'not_run',
    inputPorts: [port('main', 'input')],
    outputPorts: [port('summary', 'output')],
    internalNodes: [node],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 240, height: 120 },
    warnings: [],
  };
}

function canvasFixture(workflow: WorkflowContainerModel): WorkspaceCanvasModel {
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
        update internal input
      </button>
    ),
    invocationIdentityCard: ({ label }) => <div>{label}</div>,
    liveLogBlocks: () => <div>live logs</div>,
    nodeEvidencePaths: () => <div>node evidence</div>,
    portList: ({ title }) => <div>{title}</div>,
    eventTimeline: ({ title }) => <div>{title}</div>,
  };
}

function renderInternalNodeInspector(
  overrides: Partial<ComponentProps<typeof InternalNodeInspector>> = {},
) {
  const node = internalNodeFixture();
  const workflow = workflowFixture(node);
  const props: ComponentProps<typeof InternalNodeInspector> = {
    canvas: canvasFixture(workflow),
    workflow,
    node,
    tab: 'overview',
    workflowRun: null,
    runtimeConfig: null,
    liveLogs: {},
    dataConnectionDraft: null,
    renderers: renderersFixture(),
    onReadEvidence: vi.fn(),
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
  render(<InternalNodeInspector {...props} />);
  return props;
}

describe('InternalNodeInspector', () => {
  test('routes invocation input changes through workflow and node ids', () => {
    const props = renderInternalNodeInspector({ tab: 'invocation' });

    fireEvent.click(screen.getByRole('button', { name: 'update internal input' }));

    expect(props.onUpdateInput).toHaveBeenCalledWith('workflow_a', 'internal_a', { topic: 'updated' });
    expect(screen.getByTestId('code-core-v2-invocation-preview.json')).toHaveTextContent('Internal A');
  });

  test('renders internal data connection controls in workflow scope', () => {
    const props = renderInternalNodeInspector({ tab: 'connections' });

    const summaryRow = screen.getAllByText('summary')[0]?.closest('.port-contract-row');
    expect(summaryRow).not.toBeNull();
    fireEvent.click(within(summaryRow as HTMLElement).getByRole('button', { name: '从此输出连接...' }));

    expect(screen.getAllByText('summary').length).toBeGreaterThan(0);
    expect(props.onBeginDataConnection).toHaveBeenCalledWith({
      scopeWorkflowId: 'workflow_a',
      sourceNodeId: 'internal_a',
      sourceNodeLabel: 'Internal A',
      sourcePortId: 'summary',
      materialization: 'copy',
    });
  });
});
