import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { TopBar } from './TopBar';

describe('TopBar', () => {
  test('renders Chinese toolbar labels and forwards primary actions', () => {
    const handlers = {
      onNew: vi.fn(),
      onLoadDemo: vi.fn(),
      onSave: vi.fn(),
      onValidate: vi.fn(),
      onRun: vi.fn(),
      onAutoLayout: vi.fn(),
      onToggleAssistant: vi.fn(),
      onToggleDetails: vi.fn(),
    };

    render(
      <TopBar
        title="基本面工作流"
        subtitle="WorkflowFunctionTemplate"
        isRunning={false}
        assistantOpen={false}
        detailsOpen={false}
        {...handlers}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /运行详情/ }));
    fireEvent.click(screen.getByRole('button', { name: /AI 助手/ }));
    fireEvent.click(screen.getByRole('button', { name: /新建任务/ }));
    fireEvent.click(screen.getByRole('button', { name: /加载示例/ }));
    fireEvent.click(screen.getByRole('button', { name: /发布为可复用 Workflow/ }));
    fireEvent.click(screen.getByRole('button', { name: /校验/ }));
    fireEvent.click(screen.getByRole('button', { name: /^运行$/ }));
    fireEvent.click(screen.getByRole('button', { name: /自动布局/ }));

    expect(handlers.onToggleDetails).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleAssistant).toHaveBeenCalledTimes(1);
    expect(handlers.onNew).toHaveBeenCalledTimes(1);
    expect(handlers.onLoadDemo).toHaveBeenCalledTimes(1);
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
    expect(handlers.onValidate).toHaveBeenCalledTimes(1);
    expect(handlers.onRun).toHaveBeenCalledTimes(1);
    expect(handlers.onAutoLayout).toHaveBeenCalledTimes(1);
  });

  test('disables save, validate, and run while running', () => {
    render(
      <TopBar
        title="基本面工作流"
        subtitle="WorkflowFunctionTemplate"
        isRunning
        assistantOpen
        detailsOpen
        onNew={vi.fn()}
        onLoadDemo={vi.fn()}
        onSave={vi.fn()}
        onValidate={vi.fn()}
        onRun={vi.fn()}
        onAutoLayout={vi.fn()}
        onToggleAssistant={vi.fn()}
        onToggleDetails={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /发布为可复用 Workflow/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /校验/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /运行中/ })).toBeDisabled();
  });
});
