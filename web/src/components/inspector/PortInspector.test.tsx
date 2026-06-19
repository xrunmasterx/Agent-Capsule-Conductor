import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import type { WorkflowContainerModel, WorkflowPortView, WorkspaceCanvasModel } from '../../types/workbench';
import { PortInspector } from './PortInspector';

function port(id: string, direction: 'input' | 'output'): WorkflowPortView {
  return {
    id,
    label: id,
    direction,
    required: id === 'main',
    cardinality: 'one',
  };
}

function workflowFixture(): WorkflowContainerModel {
  return {
    id: 'workflow_a',
    title: 'Workflow A',
    directory: 'workflows/a',
    status: 'not_run',
    inputPorts: [port('main', 'input')],
    outputPorts: [port('summary', 'output')],
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
    rootWorkflowId: 'task',
    workflows: [workflowFixture()],
    edges: [
      {
        id: 'data_summary',
        kind: 'data',
        source: { workflowId: 'workflow_a', portId: 'summary' },
        target: { workflowId: 'workflow_b', portId: 'main' },
        materialization: 'copy',
      },
    ],
  };
}

describe('PortInspector', () => {
  test('renders port contract details', () => {
    render(
      <PortInspector
        workflow={workflowFixture()}
        port={port('summary', 'output')}
        tab="overview"
        canvas={canvasFixture()}
      />,
    );

    expect(screen.getByText('Workflow A')).toBeInTheDocument();
    expect(screen.getAllByText('summary').length).toBeGreaterThan(0);
    expect(screen.getByText('output')).toBeInTheDocument();
  });

  test('renders related data edges for the selected port', () => {
    render(
      <PortInspector
        workflow={workflowFixture()}
        port={port('summary', 'output')}
        tab="connections"
        canvas={canvasFixture()}
      />,
    );

    expect(screen.getByText(/workflow_a\.summary/u)).toBeInTheDocument();
    expect(screen.getByText(/workflow_b\.main/u)).toBeInTheDocument();
  });
});
