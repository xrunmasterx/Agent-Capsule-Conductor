import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, test, vi } from 'vitest';

import type { WorkflowContainerModel, WorkflowPortView, WorkspaceCanvasModel } from '../../types/workbench';
import { DataConnectionsPanel } from './DataConnectionsPanel';

function port(
  id: string,
  direction: 'input' | 'output',
  overrides: Partial<WorkflowPortView> = {},
): WorkflowPortView {
  return {
    id,
    label: id,
    direction,
    cardinality: 'one',
    ...overrides,
  };
}

function node(
  id: string,
  inputPorts: WorkflowPortView[] = [port('main', 'input')],
  outputPorts: WorkflowPortView[] = [port('main', 'output')],
): WorkflowContainerModel {
  return {
    id,
    title: id,
    directory: `workflows/${id}`,
    status: 'not_run',
    inputPorts,
    outputPorts,
    internalNodes: [],
    internalEdges: [],
    position: { x: 0, y: 0 },
    size: { width: 240, height: 120 },
    warnings: [],
  };
}

function canvasFixture(): WorkspaceCanvasModel {
  return {
    id: 'task',
    name: 'Task',
    layout: 'workspace-canvas',
    rootWorkflowId: 'task',
    workflows: [
      node('source_agent', [port('main', 'input')], [
        port('summary', 'output'),
        port('schema_value', 'output', { projectionSource: 'output_schema' }),
      ]),
      node('target_agent', [port('main', 'input')]),
    ],
    edges: [
      {
        id: 'data_source_target',
        kind: 'data',
        source: { workflowId: 'source_agent', portId: 'summary' },
        target: { workflowId: 'target_agent', portId: 'main' },
        materialization: 'copy',
      },
    ],
  };
}

function renderPanel(overrides: Partial<ComponentProps<typeof DataConnectionsPanel>> = {}) {
  const defaults: ComponentProps<typeof DataConnectionsPanel> = {
    canvasNodeKind: 'workflow',
    canvas: canvasFixture(),
    scopeWorkflowId: null,
    nodeId: 'source_agent',
    nodeLabel: 'Source Agent',
    callableId: 'agent.source',
    inputPorts: [port('main', 'input')],
    outputPorts: [
      port('summary', 'output'),
      port('schema_value', 'output', { projectionSource: 'output_schema' }),
    ],
    dataConnectionDraft: null,
    onBeginDataConnection: vi.fn(),
    onCancelDataConnection: vi.fn(),
    onUpdateDataConnectionMaterialization: vi.fn(),
    onCompleteDataConnection: vi.fn(),
    onCompleteDataConnectionWithNewInputPort: vi.fn(),
    onAddPort: vi.fn(),
    onRenamePort: vi.fn(),
    onDeletePort: vi.fn(),
  };
  const props = { ...defaults, ...overrides };
  render(<DataConnectionsPanel {...props} />);
  return props;
}

describe('DataConnectionsPanel', () => {
  test('starts a data connection from a selected output port', () => {
    const props = renderPanel();
    const summaryRow = screen.getAllByText('summary')[0]?.closest('.port-contract-row');
    expect(summaryRow).not.toBeNull();

    fireEvent.click(within(summaryRow as HTMLElement).getByRole('button', { name: '从此输出连接...' }));

    expect(props.onBeginDataConnection).toHaveBeenCalledWith({
      scopeWorkflowId: null,
      sourceNodeId: 'source_agent',
      sourceNodeLabel: 'Source Agent',
      sourcePortId: 'summary',
      materialization: 'copy',
    });
  });

  test('renames ports through an inline form instead of browser prompt dialogs', () => {
    const props = renderPanel();
    const summaryRow = screen.getAllByText('summary')[0]?.closest('.port-contract-row');
    expect(summaryRow).not.toBeNull();

    fireEvent.click(within(summaryRow as HTMLElement).getByRole('button', { name: '重命名' }));
    const renameInput = screen.getByLabelText('rename output port summary');
    fireEvent.change(renameInput, { target: { value: 'final_summary' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(props.onRenamePort).toHaveBeenCalledWith(
      null,
      'source_agent',
      'output',
      'summary',
      'final_summary',
    );
  });

  test('disables rename and delete for schema-derived output ports', () => {
    renderPanel();
    const readonlyRow = screen.getAllByText('schema_value')[0]?.closest('.port-contract-row');
    expect(readonlyRow).not.toBeNull();

    expect(within(readonlyRow as HTMLElement).getByRole('button', { name: '重命名' })).toBeDisabled();
    expect(within(readonlyRow as HTMLElement).getByRole('button', { name: '删除' })).toBeDisabled();
  });

  test('shows same-scope target conflicts and replacement action', () => {
    const onCompleteDataConnection = vi.fn();
    renderPanel({
      dataConnectionDraft: {
        scopeWorkflowId: null,
        sourceNodeId: 'source_agent',
        sourceNodeLabel: 'Source Agent',
        sourcePortId: 'summary',
        materialization: 'copy',
      },
      onCompleteDataConnection,
    });

    fireEvent.click(screen.getByRole('button', { name: '替换连接' }));

    expect(screen.getAllByText('target_agent').length).toBeGreaterThan(0);
    expect(onCompleteDataConnection).toHaveBeenCalledWith('target_agent', 'main', {
      replaceExisting: true,
    });
  });
});
