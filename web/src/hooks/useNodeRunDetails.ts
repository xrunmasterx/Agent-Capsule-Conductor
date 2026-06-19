import { useEffect, useState } from 'react';

import { api } from '../api';
import type { NodeRunSummary } from '../types';

export type UseNodeRunDetailsOptions = {
  runId: string | null | undefined;
  nodeRun: NodeRunSummary | null | undefined;
  detailKey: string;
  mergeDetail: (base: NodeRunSummary, detail: NodeRunSummary) => NodeRunSummary;
};

export type UseNodeRunDetailsResult = {
  nodeRunDetailsByKey: Record<string, NodeRunSummary>;
};

export function useNodeRunDetails({
  runId,
  nodeRun,
  detailKey,
  mergeDetail,
}: UseNodeRunDetailsOptions): UseNodeRunDetailsResult {
  const [nodeRunDetailsByKey, setNodeRunDetailsByKey] = useState<Record<string, NodeRunSummary>>({});

  useEffect(() => {
    if (!runId || !nodeRun || !detailKey) {
      return undefined;
    }
    if (nodeRunDetailsByKey[detailKey]) {
      return undefined;
    }
    let cancelled = false;
    api
      .node(runId, nodeRun.node_id)
      .then((detail) => {
        if (cancelled) {
          return;
        }
        setNodeRunDetailsByKey((current) => ({
          ...current,
          [detailKey]: mergeDetail(nodeRun, detail),
        }));
      })
      .catch(() => {
        // The lightweight run summary remains usable if detail projection is not available yet.
      });
    return () => {
      cancelled = true;
    };
  }, [detailKey, mergeDetail, nodeRun, nodeRunDetailsByKey, runId]);

  return { nodeRunDetailsByKey };
}
