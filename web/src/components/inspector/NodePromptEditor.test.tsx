import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { NodePromptEditor } from './NodePromptEditor';

describe('NodePromptEditor', () => {
  test('edits and clears user prompt while preserving static input', () => {
    const onChange = vi.fn();
    render(
      <NodePromptEditor
        nodeKey="node_a"
        input={{ user_prompt: 'Old prompt', target: 'AAPL' }}
        systemPrompt="System prompt"
        onChange={onChange}
      />,
    );

    expect(screen.getByText('系统提示词')).toBeInTheDocument();
    expect(screen.getByText('System prompt')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('用户提示词'), { target: { value: 'New prompt' } });
    expect(onChange).toHaveBeenLastCalledWith({ target: 'AAPL', user_prompt: 'New prompt' });

    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    expect(onChange).toHaveBeenLastCalledWith({ target: 'AAPL' });
  });

  test('edits advanced static input and validates JSON object shape', () => {
    const onChange = vi.fn();
    render(
      <NodePromptEditor
        nodeKey="node_a"
        input={{ user_prompt: 'Prompt', target: 'AAPL' }}
        systemPrompt=""
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '高级输入参数' }));
    fireEvent.change(screen.getByLabelText('高级输入参数'), {
      target: { value: JSON.stringify({ target: 'MSFT', verified_data: true }) },
    });

    expect(onChange).toHaveBeenLastCalledWith({ target: 'MSFT', verified_data: true, user_prompt: 'Prompt' });

    fireEvent.change(screen.getByLabelText('高级输入参数'), { target: { value: '[]' } });
    expect(screen.getByText('高级输入参数必须是对象；当前修改不会提交。')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('高级输入参数'), { target: { value: '{' } });
    expect(screen.getByText(/Expected property name|JSON/)).toBeInTheDocument();
  });

  test('resets to initial input and closes advanced editor when node changes', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <NodePromptEditor
        nodeKey="node_a"
        input={{ user_prompt: 'Initial prompt', target: 'AAPL' }}
        systemPrompt=""
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('用户提示词'), { target: { value: 'Edited prompt' } });
    fireEvent.click(screen.getByRole('button', { name: '高级输入参数' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复当前值' }));

    expect(onChange).toHaveBeenLastCalledWith({ user_prompt: 'Initial prompt', target: 'AAPL' });
    expect(screen.getByLabelText('高级输入参数')).toBeInTheDocument();

    rerender(
      <NodePromptEditor
        nodeKey="node_b"
        input={{ user_prompt: 'Second prompt', ticker: 'NVDA' }}
        systemPrompt=""
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText('用户提示词')).toHaveValue('Second prompt');
    expect(screen.queryByLabelText('高级输入参数')).not.toBeInTheDocument();
  });
});
