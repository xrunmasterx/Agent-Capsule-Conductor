import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import type { WorkflowBindingView } from '../types';
import {
  bindingPathOf,
  bindingRefOfPath,
  normalizeBinding,
  useWorkflowBindings,
  type UseWorkflowBindingsOptions,
} from './useWorkflowBindings';

vi.mock('../api', () => ({
  api: {
    workflowBinding: vi.fn(),
    saveWorkflowBinding: vi.fn(),
    validateWorkflowBinding: vi.fn(),
    openWorkflowBindingFolder: vi.fn(),
    selectWorkflowBindingDirectory: vi.fn(),
  },
}));

let latestBindings: ReturnType<typeof useWorkflowBindings> | null = null;

function binding(workflowId: string, overrides: Partial<WorkflowBindingView> = {}): WorkflowBindingView {
  return {
    workflowId,
    bindingPath: `bindings/${workflowId}.binding.local.json`,
    workspaceRoot: `F:/work/${workflowId}`,
    exists: true,
    status: 'valid',
    valid: true,
    error: null,
    ...overrides,
  };
}

function Harness(options: UseWorkflowBindingsOptions) {
  latestBindings = useWorkflowBindings(options);
  return <output>{Object.keys(latestBindings.workflowBindings).join(',')}</output>;
}

describe('useWorkflowBindings', () => {
  beforeEach(() => {
    latestBindings = null;
    vi.mocked(api.workflowBinding).mockImplementation(async (workflowId) => binding(workflowId));
    vi.mocked(api.saveWorkflowBinding).mockImplementation(async (workflowId, workspaceRoot) =>
      binding(workflowId, { workspaceRoot, workspace_root: workspaceRoot }),
    );
    vi.mocked(api.validateWorkflowBinding).mockImplementation(async (workflowId, workspaceRoot) =>
      binding(workflowId, { workspaceRoot, workspace_root: workspaceRoot }),
    );
    vi.mocked(api.openWorkflowBindingFolder).mockResolvedValue({
      workflow_id: 'workflow_a',
      path: 'bindings',
      opened: true,
    });
    vi.mocked(api.selectWorkflowBindingDirectory).mockResolvedValue({
      workflow_id: 'workflow_a',
      status: 'selected',
      workspace_root: 'F:/selected',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('normalizes legacy and camel-case binding fields', () => {
    expect(
      normalizeBinding(
        {
          workflow_id: 'workflow_a',
          binding_path: 'bindings/workflow_a.binding.local.json',
          workspace_root: 'F:/workspace',
          exists: true,
          status: 'valid',
        },
        'fallback',
      ),
    ).toMatchObject({
      workflowId: 'workflow_a',
      bindingPath: 'bindings/workflow_a.binding.local.json',
      workspaceRoot: 'F:/workspace',
      exists: true,
      status: 'valid',
    });
  });

  test('loads unique workflow bindings and falls back to unbound records', async () => {
    vi.mocked(api.workflowBinding).mockImplementation(async (workflowId) => {
      if (workflowId === 'workflow_missing') {
        throw new Error('missing');
      }
      return binding(workflowId);
    });

    render(
      <Harness workflowIds={['workflow_a', 'workflow_a', 'workflow_missing']} />,
    );

    await waitFor(() => {
      expect(latestBindings?.workflowBindings.workflow_a).toMatchObject({ status: 'valid' });
      expect(latestBindings?.workflowBindings.workflow_missing).toMatchObject({
        status: 'unbound',
        exists: false,
      });
    });

    expect(api.workflowBinding).toHaveBeenCalledTimes(2);
  });

  test('does not reload when only the workflow id array identity changes', async () => {
    const view = render(<Harness workflowIds={['workflow_b']} />);
    await waitFor(() => {
      expect(latestBindings?.workflowBindings.workflow_b).toBeDefined();
    });

    view.rerender(<Harness workflowIds={['workflow_b']} />);

    expect(api.workflowBinding).toHaveBeenCalledTimes(1);
  });

  test('saves a binding, updates local state, and reports the saved binding', async () => {
    const onSaved = vi.fn();
    render(<Harness workflowIds={['workflow_a']} onSaved={onSaved} />);
    await waitFor(() => {
      expect(latestBindings?.workflowBindings.workflow_a).toBeDefined();
    });

    await act(async () => {
      await latestBindings?.saveBinding('workflow_a', 'F:/new-root');
    });

    expect(api.saveWorkflowBinding).toHaveBeenCalledWith('workflow_a', 'F:/new-root');
    expect(latestBindings?.workflowBindings.workflow_a).toMatchObject({
      workspaceRoot: 'F:/new-root',
    });
    expect(onSaved).toHaveBeenCalledWith(
      'workflow_a',
      expect.objectContaining({ workspaceRoot: 'F:/new-root' }),
      'F:/new-root',
    );
  });

  test('validates, opens, and selects workflow binding directories', async () => {
    const onOpenedFolder = vi.fn();
    render(<Harness workflowIds={['workflow_a']} onOpenedFolder={onOpenedFolder} />);
    await waitFor(() => {
      expect(latestBindings?.workflowBindings.workflow_a).toBeDefined();
    });

    await expect(latestBindings?.validateBinding('workflow_a', 'F:/root')).resolves.toMatchObject({
      workspaceRoot: 'F:/root',
    });
    await latestBindings?.openBindingsFolder('workflow_a');
    await expect(latestBindings?.selectBindingDirectory('workflow_a', 'F:/initial')).resolves.toMatchObject({
      status: 'selected',
      workspace_root: 'F:/selected',
    });

    expect(onOpenedFolder).toHaveBeenCalledWith('workflow_a');
    expect(api.selectWorkflowBindingDirectory).toHaveBeenCalledWith('workflow_a', {
      initialDir: 'F:/initial',
    });
  });

  test('normalizes binding refs for runner submission', () => {
    expect(bindingPathOf(binding('workflow_a'))).toBe('bindings/workflow_a.binding.local.json');
    expect(bindingRefOfPath('bindings/workflow_a.binding.local.json')).toBe(
      'binding:workflow_a.binding.local.json',
    );
    expect(bindingRefOfPath('binding:existing')).toBe('binding:existing');
    expect(bindingRefOfPath('F:\\workspace\\binding.local.json')).toBe(
      'binding:F:/workspace/binding.local.json',
    );
  });
});
