import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { InvocationInputEditor } from './InvocationInputEditor';

describe('InvocationInputEditor', () => {
  test('updates and clears user prompt while preserving static input', () => {
    const onChange = vi.fn();
    render(
      <InvocationInputEditor
        input={{ user_prompt: 'Original prompt', target: 'AAPL' }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('User Prompt'), { target: { value: 'Updated prompt' } });
    expect(onChange).toHaveBeenLastCalledWith({ target: 'AAPL', user_prompt: 'Updated prompt' });

    fireEvent.click(screen.getByRole('button', { name: '清空 User Prompt' }));
    expect(onChange).toHaveBeenLastCalledWith({ target: 'AAPL' });
  });

  test('updates static input JSON and rejects non-object values', () => {
    const onChange = vi.fn();
    render(
      <InvocationInputEditor
        input={{ user_prompt: 'Prompt', target: 'AAPL' }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Static Input JSON'), {
      target: { value: JSON.stringify({ target: 'MSFT', verified_data: true }) },
    });
    expect(onChange).toHaveBeenLastCalledWith({ target: 'MSFT', verified_data: true, user_prompt: 'Prompt' });

    fireEvent.change(screen.getByLabelText('Static Input JSON'), { target: { value: '[]' } });
    expect(screen.getByText('JSON 必须是对象；当前修改不会提交。')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Static Input JSON'), { target: { value: '{' } });
    expect(screen.getByText(/Expected property name/)).toBeInTheDocument();
  });

  test('formats object JSON and resets to the latest input', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <InvocationInputEditor
        input={{ user_prompt: 'Prompt', target: 'AAPL' }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Static Input JSON'), { target: { value: '{"target":"MSFT"}' } });
    fireEvent.click(screen.getByRole('button', { name: '格式化 JSON' }));
    expect(screen.getByLabelText('Static Input JSON')).toHaveValue('{\n  "target": "MSFT"\n}');

    rerender(
      <InvocationInputEditor
        input={{ user_prompt: 'Second prompt', ticker: 'NVDA' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('User Prompt'), { target: { value: 'Draft prompt' } });
    fireEvent.click(screen.getByRole('button', { name: '重置为当前值' }));

    expect(onChange).toHaveBeenLastCalledWith({ user_prompt: 'Second prompt', ticker: 'NVDA' });
    expect(screen.getByLabelText('Static Input JSON')).toHaveValue('{\n  "ticker": "NVDA"\n}');
  });
});
