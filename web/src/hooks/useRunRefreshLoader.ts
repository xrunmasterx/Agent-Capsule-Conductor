import { useCallback } from 'react';

import { api } from '../api';
import type { RunEvent, RunSummary, WorkflowRunResult } from '../types';

export type RunRefreshPayload = {
  runId: string;
  summary: RunSummary;
  stateSnapshot: WorkflowRunResult | null;
  events: RunEvent[];
};

export function useRunRefreshLoader(): (runId: string) => Promise<RunRefreshPayload> {
  return useCallback(async (runId: string): Promise<RunRefreshPayload> => {
    const [summary, stateSnapshot, result] = await Promise.all([
      api.run(runId),
      api.runState(runId).catch(() => null),
      api.runEvents(runId).catch(() => ({ events: [] as RunEvent[] })),
    ]);
    return {
      runId,
      summary,
      stateSnapshot,
      events: result.events,
    };
  }, []);
}
