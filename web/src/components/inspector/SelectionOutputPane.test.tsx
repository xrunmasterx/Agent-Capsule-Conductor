import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { ArtifactContent } from '../../types';
import type { SelectedEntityDetailsModel } from '../../types/workbench';
import { SelectionOutputPane } from './SelectionOutputPane';

function model(overrides: Partial<SelectedEntityDetailsModel> = {}): SelectedEntityDetailsModel {
  return {
    key: 'node:task_a:node_a',
    kind: 'node',
    title: 'Agent A',
    subtitle: 'agent.a',
    scopeLabel: 'root',
    status: 'success',
    evidenceActions: [{ label: 'output.json', title: 'output.json', path: 'runs/r1/node/output.json' }],
    properties: [],
    log: { stdout: 'stdout line', stderr: 'stderr line', excerpt: 'excerpt line' },
    events: [],
    nodeRun: {
      node_id: 'node_a',
      callable_id: 'agent.a',
      status: 'success',
      run_dir: 'runs/r1/node',
    },
    ...overrides,
  };
}

function artifact(content: string, overrides: Partial<ArtifactContent> = {}): ArtifactContent {
  return {
    path: 'runs/r1/node/output.json',
    name: 'output.json',
    type: 'json',
    content,
    size_bytes: content.length,
    ...overrides,
  };
}

describe('SelectionOutputPane', () => {
  test('renders live output and stream filters', () => {
    render(
      <SelectionOutputPane
        model={model()}
        agentEventText="[agent events]\nagent turn completed"
        artifactCacheByPath={{}}
        onEnsureArtifactContent={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole('region', { name: '输出' })).toBeInTheDocument();
    expect(screen.getByRole('log')).toHaveTextContent('stdout line');
    expect(screen.getByRole('log')).toHaveTextContent('stderr line');
    expect(screen.getByRole('log')).toHaveTextContent('[agent events]');

    fireEvent.click(screen.getByRole('button', { name: 'stdout' }));
    expect(screen.getByRole('log')).toHaveTextContent('stdout line');
    expect(screen.getByRole('log')).not.toHaveTextContent('stderr line');
  });

  test('loads and renders final JSON output artifact', async () => {
    const onEnsureArtifactContent = vi.fn().mockResolvedValue(undefined);
    render(
      <SelectionOutputPane
        model={model()}
        artifactCacheByPath={{
          'runs/r1/node/output.json': artifact(
            JSON.stringify({ status: 'success', summary: 'Finished', evidence_pack: { count: 2 } }),
          ),
        }}
        onEnsureArtifactContent={onEnsureArtifactContent}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '最终结果' }));

    expect(screen.getByText('状态：success')).toBeInTheDocument();
    expect(screen.getByText('摘要')).toBeInTheDocument();
    expect(screen.getByText('Finished')).toBeInTheDocument();
    expect(screen.getByText('evidence pack')).toBeInTheDocument();
    expect(screen.getByText('count')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    await waitFor(() => expect(onEnsureArtifactContent).toHaveBeenCalledWith('runs/r1/node/output.json'));
  });

  test('renders text fallback and empty final evidence state', () => {
    const { rerender } = render(
      <SelectionOutputPane
        model={model()}
        artifactCacheByPath={{
          'runs/r1/node/output.json': artifact('plain output', { type: 'text' }),
        }}
        onEnsureArtifactContent={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '最终结果' }));
    expect(screen.getByText('文本结果')).toBeInTheDocument();
    expect(screen.getByText('plain output')).toBeInTheDocument();

    rerender(
      <SelectionOutputPane
        model={model({ evidenceActions: [] })}
        artifactCacheByPath={{}}
        onEnsureArtifactContent={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole('button', { name: '最终结果' })).toBeDisabled();
  });
});
