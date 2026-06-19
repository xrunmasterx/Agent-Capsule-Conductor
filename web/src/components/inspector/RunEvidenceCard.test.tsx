import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { NodeRunSummary, RuntimeConfig } from '../../types';
import { RunEvidenceCard } from './RunEvidenceCard';

const runtimeConfig: RuntimeConfig = {
  run_mode: 'production',
  external_agent_execution_enabled: true,
  real_external_agents_enabled: true,
};

const nodeRun: NodeRunSummary = {
  node_id: 'summary_agent',
  callable_id: 'stock-research-synthesis.codex',
  status: 'success',
  run_dir: 'C:/runs/run_1/nodes/summary_agent',
  input_path: 'C:/runs/run_1/nodes/summary_agent/input.json',
  output_path: 'C:/runs/run_1/nodes/summary_agent/output.json',
  stderr_log: 'C:/runs/run_1/nodes/summary_agent/stderr.log',
  output_preview: {
    status: 'success',
    summary: 'Ready',
    outputs: {
      main: {},
      evidence_pack: {},
    },
  },
  binding_manifest: {
    inputs: ['target', 'verified_data'],
    bindings: [
      {
        binding_kind: 'workflow_input',
        source_node: '__workflow_inputs',
        source_port: 'target',
        target_port: 'target',
      },
      {
        binding_kind: 'control_main_default',
        source_node: 'upstream_agent',
        source_port: 'main',
        target_port: 'main',
      },
    ],
  },
};

describe('RunEvidenceCard', () => {
  test('renders empty state when the node has not run', () => {
    render(<RunEvidenceCard runtimeConfig={runtimeConfig} onReadEvidence={vi.fn()} />);

    expect(screen.getByText('尚未运行；运行后这里会显示真实输入、输出、绑定来源和日志入口。')).toBeInTheDocument();
  });

  test('renders run facts, transfer rows, evidence actions, and latest logs', () => {
    const onReadEvidence = vi.fn();
    render(
      <RunEvidenceCard
        nodeRun={nodeRun}
        liveLogs={{
          stdout: 'stdout line',
          stderr: 'stderr line',
          stdoutOffset: 0,
          stderrOffset: 0,
        }}
        runtimeConfig={runtimeConfig}
        onReadEvidence={onReadEvidence}
      />,
    );

    expect(screen.getByLabelText('运行证据')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
    expect(screen.getByText('production / real CLI')).toBeInTheDocument();
    expect(screen.getByText('target, verified_data')).toBeInTheDocument();
    expect(screen.getByText('workflow_input')).toBeInTheDocument();
    expect(screen.getByText('__workflow_inputs.target -> target')).toBeInTheDocument();
    expect(screen.getByText('控制线 main 传输')).toBeInTheDocument();
    expect(screen.getByText('upstream_agent.main -> main')).toBeInTheDocument();
    expect(screen.getByText('status=success / summary=Ready / outputs=main, evidence_pack')).toBeInTheDocument();
    expect(screen.getByText(/stderr line/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /真实输入/ }));
    expect(onReadEvidence).toHaveBeenLastCalledWith(nodeRun.input_path, '真实输入');

    fireEvent.click(screen.getByRole('button', { name: /真实输出/ }));
    expect(onReadEvidence).toHaveBeenLastCalledWith(nodeRun.output_path, '真实输出');

    fireEvent.click(screen.getByRole('button', { name: /运行日志/ }));
    expect(onReadEvidence).toHaveBeenLastCalledWith(nodeRun.stderr_log, '运行日志');
  });
});
