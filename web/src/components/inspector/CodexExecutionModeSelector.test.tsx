import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { CodexExecutionModeSelector } from './CodexExecutionModeSelector';

describe('CodexExecutionModeSelector', () => {
  test('renders options and emits normalized selected mode', () => {
    const onChange = vi.fn();

    render(<CodexExecutionModeSelector value="default" onChange={onChange} />);

    const selector = screen.getByLabelText('Codex 执行模式');
    expect(selector).toHaveValue('default');
    expect(screen.getByRole('option', { name: '默认安全模式（read-only sandbox）' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '本地只读无沙箱（高风险）' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '危险全权权限（高风险）' })).toBeInTheDocument();

    fireEvent.change(selector, { target: { value: 'danger_full_access' } });

    expect(onChange).toHaveBeenCalledWith('danger_full_access');
  });

  test('renders risk notices for bypass modes', () => {
    const { rerender } = render(<CodexExecutionModeSelector value="local_readonly_no_sandbox" onChange={vi.fn()} />);

    expect(screen.getByText(/只读约束来自提示词/)).toBeInTheDocument();

    rerender(<CodexExecutionModeSelector value="danger_full_access" onChange={vi.fn()} />);

    expect(screen.getByText(/不会注入禁止修改文件/)).toBeInTheDocument();
  });
});
