import { useEffect, useState } from 'react';

import { api } from '../api';
import type { BoundaryTransferPreview } from '../types';
import { unavailableBoundaryTransferPreview } from '../workbench/model/boundaryTransferProjection';

export type BoundaryTransferPreviewRequest = {
  enabled: boolean;
  canvasSnapshot: Record<string, unknown> | null;
  edgeId?: string;
};

export function loadingBoundaryTransferPreview(): BoundaryTransferPreview {
  return {
    status: 'loading',
    bindings: {
      workflow_input_bindings: [],
      workflow_output_bindings: [],
    },
    diagnostics: [],
    canonical_preview: {
      workbench_projection: 'boundary_control_port_binding',
      runtime_control_edge: false,
      preview_source: 'server',
      status: 'loading',
    },
  };
}

export function useBoundaryTransferPreview({
  enabled,
  canvasSnapshot,
  edgeId,
}: BoundaryTransferPreviewRequest): BoundaryTransferPreview | null {
  const [preview, setPreview] = useState<BoundaryTransferPreview | null>(null);

  useEffect(() => {
    if (!enabled || !canvasSnapshot) {
      setPreview(null);
      return undefined;
    }
    let cancelled = false;
    setPreview(loadingBoundaryTransferPreview());
    void api
      .boundaryTransferPreview({
        canvas_snapshot: canvasSnapshot,
        edge_id: edgeId,
      })
      .then((nextPreview) => {
        if (!cancelled) {
          setPreview(nextPreview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview(unavailableBoundaryTransferPreview());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canvasSnapshot, edgeId, enabled]);

  return preview;
}
