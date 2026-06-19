import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { WorkflowCanvasEdge, WorkflowContainerModel, WorkflowPortView, WorkspaceCanvasModel } from '../../types/workbench';
import { EdgeInspector } from './EdgeInspector';

function port(id: string, direction: 'input' | 'output'): WorkflowPortView {
  return { id, label: id, direction, cardinality: 'one' };
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

function canvasFixture(edge: WorkflowCanvasEdge): WorkspaceCanvasModel {
  return {
    id: 'task',
    name: 'Task',
    rootWorkflowId: 'task',
    workflows: [
      node('source_agent', [port('main', 'input')], [port('summary', 'output')]),
      node('target_agent', [port('main', 'input')]),
    ],
    edges: [edge],
  };
}

function renderEdge(edge: WorkflowCanvasEdge, tab = 'overview') {
  const onCreateTargetInputPort = vi.fn();
  render(
    <EdgeInspector
      edge={edge}
      tab={tab}
      canvas={canvasFixture(edge)}
      scopeWorkflowId={null}
      boundaryPreviewSnapshotForCanvas={() => ({})}
      onCreateTargetInputPort={onCreateTargetInputPort}
    />,
  );
  return { onCreateTargetInputPort };
}

describe('EdgeInspector', () => {
  test('renders data edge source and target endpoints', () => {
    renderEdge({
      id: 'data_summary',
      kind: 'data',
      source: { workflowId: 'source_agent', portId: 'summary' },
      target: { workflowId: 'target_agent', portId: 'main' },
      materialization: 'copy',
    });

    expect(screen.getByText('Data Edge')).toBeInTheDocument();
    expect(screen.getByText('source_agent.summary')).toBeInTheDocument();
    expect(screen.getByText('target_agent.main')).toBeInTheDocument();
  });

  test('renders canonical mapping preview for data edges', () => {
    renderEdge(
      {
        id: 'data_summary',
        kind: 'data',
        source: { workflowId: 'source_agent', portId: 'summary' },
        target: { workflowId: 'target_agent', portId: 'main' },
        materialization: 'copy',
      },
      'mapping',
    );

    expect(screen.getByText('core-v2-edge-preview.json')).toBeInTheDocument();
    expect(screen.getByText(/source_agent/u)).toBeInTheDocument();
    expect(screen.getByText(/summary/u)).toBeInTheDocument();
  });

  test('offers target input quick fix for dangling target ports', () => {
    const { onCreateTargetInputPort } = renderEdge({
      id: 'data_missing_target',
      kind: 'data',
      source: { workflowId: 'source_agent', portId: 'summary' },
      target: { workflowId: 'target_agent', portId: 'missing_input' },
      materialization: 'copy',
    });

    fireEvent.click(screen.getByRole('button', { name: '创建 target input port' }));

    expect(onCreateTargetInputPort).toHaveBeenCalledWith('target_agent', 'missing_input');
  });
});
