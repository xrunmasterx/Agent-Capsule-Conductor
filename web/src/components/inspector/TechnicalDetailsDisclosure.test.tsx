import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import type { AgentNodeSettingsModel } from '../../types/workbench';
import { TechnicalDetailsDisclosure } from './TechnicalDetailsDisclosure';

const node: AgentNodeSettingsModel = {
  scopeLabel: '任务画布',
  nodeId: 'agent_a',
  label: 'Agent A',
  task: 'Agent A',
  kind: 'Agent',
  status: 'not_run',
  callableId: 'stock-research.codex',
  input: {},
  inputPorts: [],
  outputPorts: [],
  preview: { node_id: 'agent_a', input: { target: 'AAPL' } },
  raw: { id: 'agent_a', label: 'Agent A' },
  logs: {
    stdout: 'stdout line',
    stderr: 'stderr line',
    stdoutOffset: 0,
    stderrOffset: 0,
  },
};

describe('TechnicalDetailsDisclosure', () => {
  test('hides details by default and expands technical evidence', () => {
    render(
      <TechnicalDetailsDisclosure
        node={node}
        runtimeConfig={{
          run_mode: 'production',
          external_agent_execution_enabled: true,
          real_external_agents_enabled: true,
        }}
        callableDetail={null}
      />,
    );

    expect(screen.queryByText('agent_a')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /更多技术详情/ }));

    expect(screen.getByText('agent_a')).toBeInTheDocument();
    expect(screen.getByText('stock-research.codex')).toBeInTheDocument();
    expect(screen.getByText('production / real CLI')).toBeInTheDocument();
    expect(screen.getByText('core-v2-invocation-preview.json')).toBeInTheDocument();
    expect(screen.getByText('node-raw.json')).toBeInTheDocument();
    expect(screen.getByText(/stdout line/)).toBeInTheDocument();
    expect(screen.getByText(/stderr line/)).toBeInTheDocument();
  });

  test('renders callable detail block when available', () => {
    render(
      <TechnicalDetailsDisclosure
        node={node}
        runtimeConfig={{
          run_mode: 'hermetic',
          external_agent_execution_enabled: false,
          real_external_agents_enabled: false,
        }}
        callableDetail={{
          id: 'stock-research.codex',
          version: '1',
          kind: 'agent_class',
          backend: 'codex',
          source_id: 'stock-research.codex',
          name: 'Stock Research',
          description: 'Research agent',
          metadata: {},
          input_ports: {},
          output_ports: {},
          artifact_contract: {},
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /更多技术详情/ }));

    expect(screen.getByText('hermetic or external gate disabled')).toBeInTheDocument();
    expect(screen.getByText('callable-template.json')).toBeInTheDocument();
    expect(screen.getByText(/Stock Research/)).toBeInTheDocument();
  });
});
