import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { WorkflowBindingView } from '../../types';
import { WorkflowBindingDialog } from './WorkflowBindingDialog';

function binding(overrides: Partial<WorkflowBindingView> = {}): WorkflowBindingView {
  return {
    workflowId: 'flow_a',
    bindingPath: 'bindings/flow_a.binding.local.json',
    workspaceRoot: 'F:/workspace/current',
    exists: true,
    status: 'valid',
    ...overrides,
  };
}

describe('WorkflowBindingDialog', () => {
  test('renders current binding state and opens bindings folder', () => {
    const onOpenFolder = vi.fn().mockResolvedValue(undefined);

    render(
      <WorkflowBindingDialog
        workflowId="flow_a"
        binding={binding()}
        onClose={vi.fn()}
        onValidate={vi.fn()}
        onSave={vi.fn()}
        onOpenFolder={onOpenFolder}
        onSelectDirectory={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: '配置工作目录' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('F:/workspace/current')).toBeInTheDocument();
    expect(screen.getByText('bindings/flow_a.binding.local.json')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开 bindings 目录' }));

    expect(onOpenFolder).toHaveBeenCalledWith('flow_a');
  });

  test('selects, validates, and saves workspace root', async () => {
    const onValidate = vi.fn().mockResolvedValue({ ...binding(), status: 'valid' });
    const onSave = vi.fn().mockResolvedValue({ ...binding(), status: 'saved' });
    const onSelectDirectory = vi.fn().mockResolvedValue({
      status: 'selected',
      valid: true,
      workspace_root: 'F:/workspace/selected',
    });

    render(
      <WorkflowBindingDialog
        workflowId="flow_a"
        binding={binding({ workspaceRoot: '' })}
        onClose={vi.fn()}
        onValidate={onValidate}
        onSave={onSave}
        onOpenFolder={vi.fn()}
        onSelectDirectory={onSelectDirectory}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));

    await waitFor(() => expect(screen.getByDisplayValue('F:/workspace/selected')).toBeInTheDocument());
    expect(screen.getByText('selected')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('workspace_root'), {
      target: { value: 'F:/workspace/typed' },
    });
    fireEvent.click(screen.getByRole('button', { name: '校验目录' }));

    await waitFor(() => expect(onValidate).toHaveBeenCalledWith('flow_a', 'F:/workspace/typed'));
    expect(screen.getByText('valid')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存绑定' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('flow_a', 'F:/workspace/typed'));
    expect(screen.getByText('saved')).toBeInTheDocument();
  });
});
