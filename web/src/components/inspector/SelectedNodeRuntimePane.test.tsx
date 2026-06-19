import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import type { SelectedEntityDetailsModel } from '../../types/workbench';
import { SelectedNodeRuntimePane } from './SelectedNodeRuntimePane';

function model(overrides: Partial<SelectedEntityDetailsModel> = {}): SelectedEntityDetailsModel {
  return {
    key: 'node:task_a:node_a',
    kind: 'node',
    title: 'Agent A',
    subtitle: 'agent.a',
    scopeLabel: 'root',
    status: 'success',
    evidenceActions: [],
    properties: [],
    log: { stdout: 'stdout line', stderr: '', excerpt: '' },
    events: [],
    nodeSettings: {
      scopeLabel: 'root',
      nodeId: 'node_a',
      label: 'Agent A',
      task: 'Do work',
      kind: 'Agent',
      status: 'success',
      callableId: 'agent.a',
      input: {},
      inputPorts: [],
      outputPorts: [
        {
          id: 'evidence_pack',
          label: 'Evidence Pack',
          direction: 'output',
          required: false,
          artifactTypes: ['json'],
        },
      ],
      outputSchema: undefined,
      preview: {},
      raw: {},
    },
    ...overrides,
  };
}

describe('SelectedNodeRuntimePane', () => {
  test('renders empty state for non-node selections', () => {
    render(<SelectedNodeRuntimePane model={model({ kind: 'canvas', title: 'Canvas' })} />);

    expect(screen.getByRole('region', { name: '选中节点输出' })).toBeInTheDocument();
    expect(screen.getByText('未选择节点')).toBeInTheDocument();
    expect(screen.getByText('选择一个 Agent/Tool/Workflow 节点查看输出。')).toBeInTheDocument();
  });

  test('renders live output with formatted agent events', () => {
    render(<SelectedNodeRuntimePane model={model()} agentEventText="[agent events]\nagent turn completed" />);

    expect(screen.getByText('Agent A')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
    expect(screen.getByRole('log')).toHaveTextContent('stdout line');
    expect(screen.getByRole('log')).toHaveTextContent('[agent events]');
  });

  test('renders output schema and error tabs', () => {
    render(<SelectedNodeRuntimePane model={model({ log: { stdout: '', stderr: 'stderr line', excerpt: '' } })} failedEventText="agent turn failed" />);

    fireEvent.click(screen.getByRole('button', { name: 'output schema' }));
    expect(screen.getByText('Evidence Pack')).toBeInTheDocument();
    expect(screen.getByText('json')).toBeInTheDocument();
    expect(screen.getByText('输出端口: evidence_pack')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'error' }));
    expect(screen.getByRole('log')).toHaveTextContent('stderr line');
    expect(screen.getByRole('log')).toHaveTextContent('agent turn failed');
  });

  test('resets to live tab when selected model changes', () => {
    const { rerender } = render(<SelectedNodeRuntimePane model={model()} />);

    fireEvent.click(screen.getByRole('button', { name: 'output schema' }));
    expect(screen.getByText('Evidence Pack')).toBeInTheDocument();

    rerender(<SelectedNodeRuntimePane model={model({ key: 'node:task_a:node_b', title: 'Agent B' })} />);

    expect(screen.getByText('Agent B')).toBeInTheDocument();
    expect(screen.getByRole('log')).toBeInTheDocument();
  });
});
