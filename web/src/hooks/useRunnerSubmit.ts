import { useCallback } from 'react';

import { runnerApi } from '../api';
import type { RunnerJob, WorkflowGraph } from '../types';

export type SubmitRunnerJobOptions = {
  jobId?: string;
  runId?: string;
  taskId?: string;
  workspaceAlias?: string;
  bindingRef?: string;
  input?: Record<string, unknown>;
};

export type SubmitRunnerJob = (
  graph: WorkflowGraph,
  options?: SubmitRunnerJobOptions,
) => Promise<RunnerJob>;

export type UseRunnerSubmitResult = {
  submitRunnerJob: SubmitRunnerJob;
};

export function useRunnerSubmit(): UseRunnerSubmitResult {
  const submitRunnerJob = useCallback<SubmitRunnerJob>(
    (graph, options) => runnerApi.submitJob(graph, options),
    [],
  );

  return { submitRunnerJob };
}
