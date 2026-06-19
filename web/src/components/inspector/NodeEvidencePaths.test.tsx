import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { NodeRunSummary } from '../../types';
import { NodeEvidencePaths } from './NodeEvidencePaths';

function nodeRun(overrides: Partial<NodeRunSummary> = {}): NodeRunSummary {
  return {
    node_id: 'agent_a',
    callable_id: 'agent.template',
    status: 'success',
    run_dir: 'runs/agent_a',
    input_path: 'runs/agent_a/input.json',
    prompt_path: 'runs/agent_a/prompt.md',
    output_path: 'runs/agent_a/output.json',
    event_log: 'runs/agent_a/events.jsonl',
    stdout_log: 'runs/agent_a/stdout.log',
    stderr_log: null,
    artifact_dir: 'runs/agent_a/artifacts',
    runtime: { execution_mode: 'mock' },
    binding_manifest: { inputs: ['main'] },
    ...overrides,
  };
}

describe('NodeEvidencePaths', () => {
  test('renders evidence paths and opens selected artifact', () => {
    const onReadEvidence = vi.fn();
    render(<NodeEvidencePaths nodeRun={nodeRun()} onReadEvidence={onReadEvidence} />);

    fireEvent.click(screen.getByRole('button', { name: /输入/u }));

    expect(onReadEvidence).toHaveBeenCalledWith('runs/agent_a/input.json', '输入');
    expect(screen.getByText('runtime.json')).toBeInTheDocument();
    expect(screen.getByText('data-binding-evidence.json')).toBeInTheDocument();
    expect(screen.getByText('artifacts')).toBeInTheDocument();
  });

  test('renders empty artifact state and live logs without a run record', () => {
    render(
      <NodeEvidencePaths
        liveLogs={{ stdout: 'streaming stdout', stderr: '', stdoutOffset: 0, stderrOffset: 0 }}
        onReadEvidence={vi.fn()}
      />,
    );

    expect(screen.getByText('尚未运行')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Live stdout' })).toHaveTextContent('streaming stdout');
    expect(screen.getByRole('button', { name: /输入/u })).toBeDisabled();
  });
});
