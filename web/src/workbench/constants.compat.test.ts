import { describe, expect, test } from 'vitest';

import * as canvasConstants from '../components/canvas/canvasConstants';
import * as workbenchConstants from './constants';

describe('canvas constants compatibility exports', () => {
  test('re-exports authoritative workbench constants', () => {
    expect(canvasConstants.TASK_STORE_KEY).toBe(workbenchConstants.TASK_STORE_KEY);
    expect(canvasConstants.TASK_STORE_KEY).toBe('acc.workbench.tasks.v2');
    expect(canvasConstants.AGENT_CONTROL_HANDLE_TOP).toBe(workbenchConstants.AGENT_CONTROL_HANDLE_TOP);
    expect(canvasConstants.AGENT_CONTROL_HANDLE_TOP).toBe('50%');
    expect(canvasConstants.AGENT_TOOL_NODE_SIZE).toBe(workbenchConstants.AGENT_TOOL_NODE_SIZE);
  });

  test('uses the shared data port positioning rule', () => {
    expect(canvasConstants.agentDataPortTop(1, 3, 132)).toBe(
      workbenchConstants.agentDataPortTop(1, 3, 132),
    );
  });
});
