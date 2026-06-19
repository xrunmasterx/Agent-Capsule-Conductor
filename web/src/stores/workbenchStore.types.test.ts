import { describe, expect, test } from 'vitest';

import { useWorkbenchStore } from './workbenchStore';
import { DEFAULT_TASK_ID, INSPECTOR_DEFAULT_WIDTH } from '../workbench/constants';
import type { WorkbenchChromeState } from '../types/workbench';

describe('workbench store shared type defaults', () => {
  test('initializes task identity and chrome from shared contracts', () => {
    const state = useWorkbenchStore.getState();
    const chrome: WorkbenchChromeState = state.chrome;

    expect(state.activeTaskId).toBe(DEFAULT_TASK_ID);
    expect(state.taskIds).toEqual([DEFAULT_TASK_ID]);
    expect(chrome.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
  });
});
