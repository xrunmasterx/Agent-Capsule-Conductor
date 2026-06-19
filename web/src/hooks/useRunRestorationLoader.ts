import { useEffect, useRef } from 'react';

import { api } from '../api';
import type { RunEvent, RunSummary, WorkflowRunResult } from '../types';

export type RunRestorationPayload = {
  runId: string;
  summary: RunSummary;
  stateSnapshot: WorkflowRunResult | null;
  events: RunEvent[] | null;
};

export type UseRunRestorationLoaderOptions = {
  enabled: boolean;
  runId: string | null | undefined;
  onLoaded: (payload: RunRestorationPayload) => void;
  onLoadFailed?: (runId: string, error: unknown) => void;
};

export function useRunRestorationLoader({
  enabled,
  runId,
  onLoaded,
  onLoadFailed,
}: UseRunRestorationLoaderOptions): void {
  const onLoadedRef = useRef(onLoaded);
  const onLoadFailedRef = useRef(onLoadFailed);

  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  useEffect(() => {
    onLoadFailedRef.current = onLoadFailed;
  }, [onLoadFailed]);

  useEffect(() => {
    if (!enabled || !runId) {
      return undefined;
    }
    let cancelled = false;
    api
      .run(runId)
      .then(async (summary) => {
        const [stateSnapshot, eventPayload] = await Promise.all([
          api.runState(runId).catch(() => null),
          api.runEvents(runId).catch(() => null),
        ]);
        if (!cancelled) {
          onLoadedRef.current({
            runId,
            summary,
            stateSnapshot,
            events: eventPayload?.events || null,
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          onLoadFailedRef.current?.(runId, error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, runId]);
}
