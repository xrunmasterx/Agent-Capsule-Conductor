import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import {
  SelectionDetailsDock,
  evidenceContentForCurrentSelection,
  type EvidenceDockState,
} from './SelectionDetailsDock';

const staleArtifact = {
  name: 'old-output.json',
  path: 'runs/old-run/output.json',
  content: '{"status":"success"}',
  type: 'json' as const,
  size_bytes: 20,
};

describe('SelectionDetailsDock evidence ownership', () => {
  test('filters artifact content by task and run ownership', () => {
    const state: EvidenceDockState = {
      open: true,
      title: 'old-output.json',
      content: staleArtifact,
      owner: {
        kind: 'artifact',
        taskId: 'task-a',
        runId: 'run-old',
        nodeId: 'node-a',
      },
    };

    expect(evidenceContentForCurrentSelection(state, { currentTaskId: 'task-b', selectedRunId: 'run-old' })).toBeNull();
    expect(evidenceContentForCurrentSelection(state, { currentTaskId: 'task-a', selectedRunId: 'run-new' })).toBeNull();
    expect(evidenceContentForCurrentSelection(state, { currentTaskId: 'task-a', selectedRunId: 'run-old' })).toBe(
      staleArtifact,
    );
  });

  test('does not render stale artifact title when selected run no longer owns it', () => {
    const state: EvidenceDockState = {
      open: true,
      title: 'old-output.json',
      content: staleArtifact,
      owner: {
        kind: 'artifact',
        taskId: 'task-a',
        runId: 'run-old',
        nodeId: 'node-a',
      },
    };

    render(
      <SelectionDetailsDock
        state={state}
        mode="evidence"
        message="ready"
        model={{ title: '当前节点', status: 'not_run' }}
        currentTaskId="task-a"
        selectedRunId="run-new"
        onToggle={vi.fn()}
        assistantContent={null}
      />,
    );

    expect(screen.getAllByText('没有 run evidence').length).toBeGreaterThan(0);
    expect(screen.queryByText('old-output.json')).not.toBeInTheDocument();
    expect(screen.getByText('未运行')).toBeInTheDocument();
  });
});
