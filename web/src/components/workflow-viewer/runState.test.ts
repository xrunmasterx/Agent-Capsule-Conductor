import { describe, expect, test } from 'vitest';

import {
  overlayStatusForNode,
  overlayStatusForWorkflow,
  type RunOverlayState,
} from './runState';

const overlay: RunOverlayState = {
  runId: 'run_1',
  scope: 'task',
  targetId: 'source_flow',
  status: 'running',
  nodeStatusById: {
    source_agent: 'running',
    source_flow__internal__codex: 'success',
    source_flow__internal__reviewer: 'scheduled',
  },
  workflowStatusById: {},
};

describe('run overlay projection helpers', () => {
  test('returns overlay node status without changing the fallback status', () => {
    expect(overlayStatusForNode(overlay, 'source_agent', 'not_run')).toBe('running');
    expect(overlayStatusForNode(overlay, 'missing_agent', 'not_run')).toBe('not_run');
    expect(overlayStatusForNode(null, 'source_agent', 'not_run')).toBe('not_run');
  });

  test('derives workflow status from direct and internal overlay state', () => {
    expect(
      overlayStatusForWorkflow(overlay, {
        id: 'source_flow',
        status: 'not_run',
        internalNodes: [
          { id: 'codex', status: 'not_run' },
          { id: 'reviewer', status: 'not_run' },
        ],
      }),
    ).toBe('running');

    expect(
      overlayStatusForWorkflow(
        {
          ...overlay,
          targetId: undefined,
          status: 'success',
          workflowStatusById: { source_flow: 'failed' },
          nodeStatusById: {},
        },
        {
          id: 'source_flow',
          status: 'not_run',
          internalNodes: [],
        },
      ),
    ).toBe('failed');
  });
});
