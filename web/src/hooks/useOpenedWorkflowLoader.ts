import { useEffect, useRef } from 'react';

import { api } from '../api';
import type { WorkflowDetail } from '../types';

export type UseOpenedWorkflowLoaderOptions = {
  enabled: boolean;
  workflowId: string | null | undefined;
  onWorkflowLoaded: (workflow: WorkflowDetail) => void;
  onError?: (error: unknown) => void;
};

export function useOpenedWorkflowLoader({
  enabled,
  workflowId,
  onWorkflowLoaded,
  onError,
}: UseOpenedWorkflowLoaderOptions): void {
  const onWorkflowLoadedRef = useRef(onWorkflowLoaded);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onWorkflowLoadedRef.current = onWorkflowLoaded;
  }, [onWorkflowLoaded]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!enabled || !workflowId) {
      return undefined;
    }
    let cancelled = false;
    api
      .workflow(workflowId)
      .then((workflow) => {
        if (!cancelled) {
          onWorkflowLoadedRef.current(workflow);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          onErrorRef.current?.(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, workflowId]);
}
