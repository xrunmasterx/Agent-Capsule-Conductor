import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { ExecutionDock } from './ExecutionDock';

describe('ExecutionDock', () => {
  test('renders run controls and forwards clicks when idle', () => {
    const onRunTask = vi.fn();
    const onRunWorkflow = vi.fn();
    const onRunNode = vi.fn();

    render(
      <ExecutionDock
        isRunning={false}
        runtimeConfig={{
          run_mode: 'test',
          real_external_agents_enabled: false,
          external_agent_execution_enabled: false,
        }}
        canRunWorkflow
        canRunNode
        onRunTask={onRunTask}
        onRunWorkflow={onRunWorkflow}
        onRunNode={onRunNode}
      />,
    );

    expect(screen.getByText('隔离模式：不调用外部 Agent')).toBeInTheDocument();
    expect(screen.getByText('运行范围：当前任务')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /运行当前任务/ }));
    fireEvent.click(screen.getByRole('button', { name: '只运行此 Workflow' }));
    fireEvent.click(screen.getByRole('button', { name: '只运行此 Agent/Tool' }));

    expect(onRunTask).toHaveBeenCalledTimes(1);
    expect(onRunWorkflow).toHaveBeenCalledTimes(1);
    expect(onRunNode).toHaveBeenCalledTimes(1);
  });

  test('disables visible run controls while running', () => {
    render(
      <ExecutionDock
        isRunning
        runtimeConfig={{
          run_mode: 'production',
          real_external_agents_enabled: true,
          external_agent_execution_enabled: true,
        }}
        canRunWorkflow
        canRunNode
        onRunTask={vi.fn()}
        onRunWorkflow={vi.fn()}
        onRunNode={vi.fn()}
      />,
    );

    expect(screen.getByText('生产模式：将调用真实外部 Agent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /运行中/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '只运行此 Workflow' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '只运行此 Agent/Tool' })).toBeDisabled();
  });
});
