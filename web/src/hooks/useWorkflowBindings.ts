import { useCallback, useEffect, useMemo } from 'react';

import { api } from '../api';
import { useRunStore } from '../stores/runStore';
import type { WorkflowBindingView, WorkflowDirectorySelection } from '../types';

export type UseWorkflowBindingsOptions = {
  workflowIds: string[];
  onSaved?: (workflowId: string, binding: WorkflowBindingView, workspaceRoot: string) => void;
  onOpenedFolder?: (workflowId: string) => void;
};

export type UseWorkflowBindingsResult = {
  workflowBindings: Record<string, WorkflowBindingView>;
  saveBinding: (workflowId: string, workspaceRoot: string) => Promise<WorkflowBindingView>;
  validateBinding: (workflowId: string, workspaceRoot: string) => Promise<WorkflowBindingView>;
  openBindingsFolder: (workflowId: string) => Promise<void>;
  selectBindingDirectory: (
    workflowId: string,
    initialDir: string,
  ) => Promise<WorkflowDirectorySelection>;
};

export function normalizeBinding(
  binding: WorkflowBindingView | null | undefined,
  workflowId: string,
): WorkflowBindingView {
  return {
    workflow_id: binding?.workflow_id || binding?.workflowId || workflowId,
    workflowId: binding?.workflowId || binding?.workflow_id || workflowId,
    binding_path:
      binding?.binding_path || binding?.bindingPath || `bindings/${workflowId}.binding.local.json`,
    bindingPath:
      binding?.bindingPath || binding?.binding_path || `bindings/${workflowId}.binding.local.json`,
    workspace_root: binding?.workspace_root ?? binding?.workspaceRoot ?? null,
    workspaceRoot: binding?.workspaceRoot ?? binding?.workspace_root ?? null,
    exists: Boolean(binding?.exists),
    status: binding?.status || 'unbound',
    valid: binding?.valid,
    error: binding?.error ?? null,
  };
}

export function unboundWorkflowBinding(workflowId: string): WorkflowBindingView {
  return {
    workflowId,
    bindingPath: `bindings/${workflowId}.binding.local.json`,
    workspaceRoot: null,
    exists: false,
    status: 'unbound',
  };
}

export function bindingPathOf(binding: WorkflowBindingView | null | undefined): string {
  return binding?.bindingPath || binding?.binding_path || '';
}

export function bindingRefOfPath(bindingPath: string): string {
  const normalized = bindingPath.replace(/\\/g, '/');
  if (normalized.startsWith('binding:')) {
    return normalized;
  }
  if (normalized.startsWith('bindings/')) {
    return `binding:${normalized.slice('bindings/'.length)}`;
  }
  return `binding:${normalized}`;
}

export function useWorkflowBindings({
  workflowIds,
  onSaved,
  onOpenedFolder,
}: UseWorkflowBindingsOptions): UseWorkflowBindingsResult {
  const workflowBindings = useRunStore((state) => state.workflowBindings);
  const setWorkflowBindings = useRunStore((state) => state.setWorkflowBindings);
  const setWorkflowBinding = useRunStore((state) => state.setWorkflowBinding);
  const workflowBindingKey = useMemo(
    () => Array.from(new Set(workflowIds)).sort().join('|'),
    [workflowIds],
  );
  const uniqueWorkflowIds = useMemo(
    () => (workflowBindingKey ? workflowBindingKey.split('|') : []),
    [workflowBindingKey],
  );

  useEffect(() => {
    let ignore = false;
    Promise.all(
      uniqueWorkflowIds.map((workflowId) =>
        api
          .workflowBinding(workflowId)
          .then((binding) => [workflowId, normalizeBinding(binding, workflowId)] as const)
          .catch(() => [workflowId, unboundWorkflowBinding(workflowId)] as const),
      ),
    ).then((entries) => {
      if (ignore) {
        return;
      }
      setWorkflowBindings(Object.fromEntries(entries));
    });
    return () => {
      ignore = true;
    };
  }, [uniqueWorkflowIds]);

  const saveBinding = useCallback(
    async (workflowId: string, workspaceRoot: string): Promise<WorkflowBindingView> => {
      const result = await api.saveWorkflowBinding(workflowId, workspaceRoot);
      const normalized = normalizeBinding(result, workflowId);
      setWorkflowBinding(workflowId, normalized);
      onSaved?.(workflowId, normalized, workspaceRoot);
      return normalized;
    },
    [onSaved, setWorkflowBinding],
  );

  const validateBinding = useCallback(
    async (workflowId: string, workspaceRoot: string): Promise<WorkflowBindingView> => {
      const result = await api.validateWorkflowBinding(workflowId, workspaceRoot);
      return normalizeBinding(result, workflowId);
    },
    [],
  );

  const openBindingsFolder = useCallback(
    async (workflowId: string): Promise<void> => {
      await api.openWorkflowBindingFolder(workflowId);
      onOpenedFolder?.(workflowId);
    },
    [onOpenedFolder],
  );

  const selectBindingDirectory = useCallback(
    (workflowId: string, initialDir: string): Promise<WorkflowDirectorySelection> =>
      api.selectWorkflowBindingDirectory(workflowId, { initialDir }),
    [],
  );

  return {
    workflowBindings,
    saveBinding,
    validateBinding,
    openBindingsFolder,
    selectBindingDirectory,
  };
}
