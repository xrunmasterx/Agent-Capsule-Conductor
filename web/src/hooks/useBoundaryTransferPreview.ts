import { useCallback, useEffect, useState } from 'react';

import { api } from '../api';
import type { BoundaryTransferPreview } from '../types';
import {
  boundaryTransferPreviewHasErrors,
  unavailableBoundaryTransferPreview,
} from '../workbench/model/boundaryTransferProjection';

export type BoundaryTransferPreviewRequest = {
  enabled: boolean;
  canvasSnapshot: Record<string, unknown> | null;
  edgeId?: string;
};

export type ValidateBoundaryTransfers = (canvasSnapshot: Record<string, unknown>) => Promise<void>;

export type UseBoundaryTransferValidationResult = {
  validateBoundaryTransfers: ValidateBoundaryTransfers;
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

export async function validateBoundaryTransferSnapshot(
  canvasSnapshot: Record<string, unknown>,
): Promise<void> {
  let preview: BoundaryTransferPreview;
  try {
    preview = await api.boundaryTransferPreview({
      canvas_snapshot: canvasSnapshot,
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    throw new Error(`边界控制线 preview 暂不可用: ${text}`);
  }
  if (!boundaryTransferPreviewHasErrors(preview)) {
    return;
  }
  const messages = preview.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
  throw new Error(messages.join('；') || '边界控制线存在无法运行的配置错误。');
}

export function useBoundaryTransferValidation(): UseBoundaryTransferValidationResult {
  const validateBoundaryTransfers = useCallback<ValidateBoundaryTransfers>(
    (canvasSnapshot) => validateBoundaryTransferSnapshot(canvasSnapshot),
    [],
  );

  return { validateBoundaryTransfers };
}
