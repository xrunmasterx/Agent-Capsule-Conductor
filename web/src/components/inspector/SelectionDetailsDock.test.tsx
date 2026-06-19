import { fireEvent, render, screen } from '@testing-library/react';
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
        model={{ title: '当前节点', status: 'not_run', evidenceActions: [] }}
        currentTaskId="task-a"
        selectedRunId="run-new"
        onToggle={vi.fn()}
        onReadEvidence={vi.fn()}
        assistantContent={null}
      />,
    );

    expect(screen.getAllByText('没有 run evidence').length).toBeGreaterThan(0);
    expect(screen.queryByText('old-output.json')).not.toBeInTheDocument();
    expect(screen.getByText('未运行')).toBeInTheDocument();
  });

  test('renders evidence action buttons and forwards read evidence requests', () => {
    const onReadEvidence = vi.fn();
    render(
      <SelectionDetailsDock
        state={{ open: true, title: '', content: null }}
        mode="evidence"
        message="ready"
        model={{
          title: '当前节点',
          status: 'success',
          evidenceActions: [
            { label: 'input.json', path: 'runs/run-1/input.json', title: '输入' },
            { label: 'output.json', path: 'runs/run-1/output.json', title: '输出' },
          ],
        }}
        currentTaskId="task-a"
        selectedRunId="run-1"
        onToggle={vi.fn()}
        onReadEvidence={onReadEvidence}
        assistantContent={null}
      />,
    );

    expect(screen.getByText('运行证据可用')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'input.json' }));
    expect(onReadEvidence).toHaveBeenCalledWith('runs/run-1/input.json', '输入');
  });

  test('keeps assistant mode body class for console styling', () => {
    render(
      <SelectionDetailsDock
        state={{ open: true, title: '', content: null }}
        mode="assistant"
        message="ready"
        model={{ title: '当前节点', status: 'running', evidenceActions: [] }}
        currentTaskId="task-a"
        selectedRunId="run-1"
        onToggle={vi.fn()}
        onReadEvidence={vi.fn()}
        assistantContent={<div>assistant body</div>}
      />,
    );

    expect(screen.getByText('assistant body').closest('.selection-details-body')).toHaveClass(
      'assistant-console-body',
    );
  });
});
