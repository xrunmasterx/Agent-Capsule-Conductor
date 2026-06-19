import { describe, expect, test } from 'vitest';

import {
  BOUNDARY_TRANSFER_SCHEMA,
  boundaryTransferToGraphMetadata,
  unavailableBoundaryTransferPreview,
} from './boundaryTransfer';
import {
  BOUNDARY_TRANSFER_SCHEMA as MODEL_BOUNDARY_TRANSFER_SCHEMA,
  boundaryTransferToGraphMetadata as modelBoundaryTransferToGraphMetadata,
} from '../../workbench/model/boundaryTransferProjection';

describe('boundaryTransfer canvas facade', () => {
  test('re-exports the workbench model implementation for migration compatibility', () => {
    expect(BOUNDARY_TRANSFER_SCHEMA).toBe(MODEL_BOUNDARY_TRANSFER_SCHEMA);
    expect(
      boundaryTransferToGraphMetadata({
        direction: 'workflow_output',
        materialization: 'copy',
        inference: 'explicit',
        mappings: [{ sourcePort: 'main', targetPort: 'evidence_pack' }],
      }),
    ).toEqual(
      modelBoundaryTransferToGraphMetadata({
        direction: 'workflow_output',
        materialization: 'copy',
        inference: 'explicit',
        mappings: [{ sourcePort: 'main', targetPort: 'evidence_pack' }],
      }),
    );
    expect(unavailableBoundaryTransferPreview().canonical_preview.runtime_control_edge).toBe(false);
  });
});
