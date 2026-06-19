import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import type { BoundaryTransferPreview } from '../types';
import {
  loadingBoundaryTransferPreview,
  useBoundaryTransferPreview,
  type BoundaryTransferPreviewRequest,
} from './useBoundaryTransferPreview';

vi.mock('../api', () => ({
  api: {
    boundaryTransferPreview: vi.fn(),
  },
}));

function validPreview(): BoundaryTransferPreview {
  return {
    status: 'valid',
    bindings: {
      workflow_input_bindings: [],
      workflow_output_bindings: [],
    },
    diagnostics: [],
    canonical_preview: {
      workbench_projection: 'boundary_control_port_binding',
      runtime_control_edge: false,
    },
  };
}

function Harness({
  request,
  onPreview,
}: {
  request: BoundaryTransferPreviewRequest;
  onPreview: (preview: BoundaryTransferPreview | null) => void;
}) {
  const preview = useBoundaryTransferPreview(request);
  onPreview(preview);
  return <output>{preview?.status || 'none'}</output>;
}

describe('useBoundaryTransferPreview', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test('loads server preview for enabled boundary control edge', async () => {
    vi.mocked(api.boundaryTransferPreview).mockResolvedValue(validPreview());
    const previews: Array<BoundaryTransferPreview | null> = [];

    render(
      <Harness
        request={{ enabled: true, canvasSnapshot: { id: 'canvas' }, edgeId: 'edge_1' }}
        onPreview={(preview) => previews.push(preview)}
      />,
    );

    expect(api.boundaryTransferPreview).toHaveBeenCalledWith({
      canvas_snapshot: { id: 'canvas' },
      edge_id: 'edge_1',
    });
    expect(previews.some((preview) => preview?.status === 'loading')).toBe(true);
    await waitFor(() => {
      expect(previews.at(-1)?.status).toBe('valid');
    });
  });

  test('does not call preview API when disabled or missing snapshot', () => {
    const previews: Array<BoundaryTransferPreview | null> = [];

    render(
      <Harness
        request={{ enabled: false, canvasSnapshot: { id: 'canvas' }, edgeId: 'edge_1' }}
        onPreview={(preview) => previews.push(preview)}
      />,
    );

    expect(api.boundaryTransferPreview).not.toHaveBeenCalled();
    expect(previews.at(-1)).toBeNull();
  });

  test('returns unavailable diagnostic without fabricating valid bindings on API failure', async () => {
    vi.mocked(api.boundaryTransferPreview).mockRejectedValue(new Error('offline'));
    const previews: Array<BoundaryTransferPreview | null> = [];

    render(
      <Harness
        request={{ enabled: true, canvasSnapshot: { id: 'canvas' }, edgeId: 'edge_1' }}
        onPreview={(preview) => previews.push(preview)}
      />,
    );

    await waitFor(() => {
      expect(previews.at(-1)?.diagnostics[0]?.code).toBe('boundary_transfer_preview_unavailable');
    });
    expect(previews.at(-1)?.status).toBe('invalid');
    expect(previews.at(-1)?.bindings.workflow_input_bindings).toEqual([]);
    expect(previews.at(-1)?.canonical_preview.runtime_control_edge).toBe(false);
  });

  test('loading preview is explicit and never enters runtime control edges', () => {
    expect(loadingBoundaryTransferPreview()).toEqual(
      expect.objectContaining({
        status: 'loading',
        canonical_preview: expect.objectContaining({
          runtime_control_edge: false,
        }),
      }),
    );
  });
});
