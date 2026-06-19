import { describe, expect, test } from 'vitest';

import {
  AGENT_CONTROL_HANDLE_TOP,
  AGENT_TOOL_NODE_SIZE,
  DEFAULT_TASK_ID,
  TASK_STORE_KEY,
  TEMPORARY_CALLABLE_ID_PREFIX,
  agentDataPortTop,
} from './constants';

describe('workbench constants', () => {
  test('uses the canonical task persistence key and defaults', () => {
    expect(TASK_STORE_KEY).toBe('acc.workbench.tasks.v2');
    expect(TASK_STORE_KEY).not.toBe('acc.workbench.tasks.v1');
    expect(DEFAULT_TASK_ID).toBe('task_canvas_default');
    expect(TEMPORARY_CALLABLE_ID_PREFIX).toBe('tmp_agent_');
  });

  test('keeps control handles centered independently from node height', () => {
    expect(AGENT_CONTROL_HANDLE_TOP).toBe('50%');
    expect(AGENT_CONTROL_HANDLE_TOP).not.toBe(AGENT_TOOL_NODE_SIZE.height / 2);
  });

  test('keeps data port slots centered around the node midpoint', () => {
    expect(agentDataPortTop(0, 1, 132)).toBe(94);
    expect(agentDataPortTop(0, 2, 132)).toBe(38);
    expect(agentDataPortTop(1, 2, 132)).toBe(94);
    expect(agentDataPortTop(0, 3, 132)).toBe(38);
    expect(agentDataPortTop(1, 3, 132)).toBe(94);
    expect(agentDataPortTop(2, 3, 132)).toBe(122);
  });
});
