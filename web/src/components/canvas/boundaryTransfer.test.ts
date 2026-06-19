import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  boundaryTransferFromGraphEdge,
  boundaryTransferPreviewHasErrors,
  boundaryTransferToGraphMetadata,
  inferBoundaryTransferPairs,
  unavailableBoundaryTransferPreview,
} from './boundaryTransfer';

const fixtures = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../tests/fixtures/boundary_transfer_cases.json'), 'utf-8'),
) as {
  inference_cases: Array<{
    name: string;
    source_ports: string[];
    target_ports: string[];
    expected_pairs: Array<{ sourcePort: string; targetPort: string }>;
  }>;
};

describe('boundaryTransfer metadata helpers', () => {
  test('normalizes snake_case graph metadata into canvas metadata', () => {
    expect(
      boundaryTransferFromGraphEdge({
        id: 'edge',
        from: 'writer',
        to: 'Workflow__workflow_outputs',
        boundary_transfer: {
          schema: 'acc.workbench.boundary_transfer.v1',
          direction: 'workflow_output',
          materialization: 'copy',
          inference: 'explicit',
          mappings: [{ source_port: 'main', target_port: 'evidence_pack' }],
        },
      }),
    ).toEqual({
      direction: 'workflow_output',
      materialization: 'copy',
      inference: 'explicit',
      mappings: [{ sourcePort: 'main', targetPort: 'evidence_pack' }],
    });
  });

  test('serializes canvas metadata to snake_case v1 graph metadata', () => {
    expect(
      boundaryTransferToGraphMetadata({
        direction: 'workflow_output',
        materialization: 'copy',
        inference: 'same_name',
        mappings: [{ sourcePort: 'main', targetPort: 'evidence_pack' }],
      }),
    ).toEqual({
      schema: 'acc.workbench.boundary_transfer.v1',
      direction: 'workflow_output',
      materialization: 'copy',
      inference: 'explicit',
      mappings: [{ source_port: 'main', target_port: 'evidence_pack' }],
    });
  });

  test('marks unavailable preview as non-authoritative warning', () => {
    const preview = unavailableBoundaryTransferPreview();

    expect(preview.status).toBe('invalid');
    expect(boundaryTransferPreviewHasErrors(preview)).toBe(false);
    expect(preview.diagnostics[0]).toMatchObject({
      code: 'boundary_transfer_preview_unavailable',
      severity: 'warning',
    });
  });

  test('keeps fallback inference aligned with shared golden fixtures', () => {
    fixtures.inference_cases.forEach((testCase) => {
      expect(
        inferBoundaryTransferPairs(testCase.source_ports, testCase.target_ports),
        testCase.name,
      ).toEqual(testCase.expected_pairs);
    });
  });
});
