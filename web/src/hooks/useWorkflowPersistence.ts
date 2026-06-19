import { useCallback } from 'react';

import { api } from '../api';
import type { WorkflowGraph } from '../types';

export type SavedWorkflowResult = {
  status: string;
  workflow_id: string;
  canonical_preview?: Record<string, unknown>;
};

export type WorkflowValidationResult = {
  status: string;
  workflow_id: string;
};

export type SaveWorkflowGraph = (
  graph: WorkflowGraph,
  force?: boolean,
) => Promise<SavedWorkflowResult>;

export type ValidateWorkflowGraph = (workflowId: string) => Promise<WorkflowValidationResult>;

export type UseWorkflowPersistenceResult = {
  saveWorkflowGraph: SaveWorkflowGraph;
  validateWorkflowGraph: ValidateWorkflowGraph;
};

export function useWorkflowPersistence(): UseWorkflowPersistenceResult {
  const saveWorkflowGraph = useCallback<SaveWorkflowGraph>(
    (graph, force = true) => api.saveWorkflow(graph, force),
    [],
  );
  const validateWorkflowGraph = useCallback<ValidateWorkflowGraph>(
    (workflowId) => api.validateWorkflow(workflowId),
    [],
  );

  return {
    saveWorkflowGraph,
    validateWorkflowGraph,
  };
}
