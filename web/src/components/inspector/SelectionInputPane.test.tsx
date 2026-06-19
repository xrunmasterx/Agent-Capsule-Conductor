import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { ArtifactContent } from '../../types';
import type { SelectedEntityDetailsModel } from '../../types/workbench';
import { SelectionInputPane } from './SelectionInputPane';

function model(overrides: Partial<SelectedEntityDetailsModel> = {}): SelectedEntityDetailsModel {
  return {
    key: 'node:task_a:node_a',
    kind: 'node',
    title: 'Agent A',
    subtitle: 'agent.a',
    scopeLabel: 'root',
    status: 'success',
    evidenceActions: [{ label: 'input.json', title: 'input.json', path: 'runs/r1/node/input.json' }],
    properties: [],
    log: { stdout: '', stderr: '', excerpt: '' },
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
    path: 'runs/r1/node/input.json',
    name: 'input.json',
    type: 'json',
    content,
    size_bytes: content.length,
    ...overrides,
  };
}

describe('SelectionInputPane', () => {
  test('renders named input ports from input.json evidence', async () => {
    const onEnsureArtifactContent = vi.fn().mockResolvedValue(undefined);

    render(
      <SelectionInputPane
        model={model()}
        artifactCacheByPath={{
          'runs/r1/node/input.json': artifact(JSON.stringify({ target: 'AAPL', verified_data: { ok: true } })),
        }}
        onEnsureArtifactContent={onEnsureArtifactContent}
      />,
    );

    expect(screen.getByRole('region', { name: '输入' })).toBeInTheDocument();
    expect(screen.getByText('target 输入')).toBeInTheDocument();
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('verified_data 输入')).toBeInTheDocument();
    expect(screen.getByText('ok')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();
    await waitFor(() => expect(onEnsureArtifactContent).toHaveBeenCalledWith('runs/r1/node/input.json'));
  });

  test('expands control-main aggregate sources into display cards', () => {
    render(
      <SelectionInputPane
        model={model()}
        artifactCacheByPath={{
          'runs/r1/node/input.json': artifact(
            JSON.stringify({
              main: {
                kind: 'control_main_aggregate',
                order: ['upstream_a', 'upstream_b'],
                sources: {
                  upstream_a: { summary: 'first' },
                  upstream_b: { summary: 'second' },
                },
              },
            }),
          ),
        }}
        onEnsureArtifactContent={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText('upstream_a')).toBeInTheDocument();
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('upstream_b')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  test('renders text fallback and empty evidence states', () => {
    const { rerender } = render(
      <SelectionInputPane
        model={model()}
        artifactCacheByPath={{
          'runs/r1/node/input.json': artifact('plain text input', { type: 'text' }),
        }}
        onEnsureArtifactContent={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText('plain text input')).toBeInTheDocument();

    rerender(
      <SelectionInputPane
        model={model({ evidenceActions: [] })}
        artifactCacheByPath={{}}
        onEnsureArtifactContent={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText('当前节点还没有真实 input.json。')).toBeInTheDocument();
  });
});
