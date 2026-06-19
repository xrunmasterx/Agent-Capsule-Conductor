import { render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import { useWorkbenchTaskCanvasPersistence } from './useWorkbenchTaskCanvasPersistence';

vi.mock('../api', () => ({
  api: {
    getWorkbenchTaskCanvas: vi.fn(),
    putWorkbenchTaskCanvas: vi.fn(),
  },
}));

let latestActions: ReturnType<typeof useWorkbenchTaskCanvasPersistence> | null = null;

function Harness() {
  latestActions = useWorkbenchTaskCanvasPersistence();
  return <output>task-canvas-persistence</output>;
}

describe('useWorkbenchTaskCanvasPersistence', () => {
  afterEach(() => {
    latestActions = null;
    vi.clearAllMocks();
  });

  test('loads persisted task canvas snapshots by task id', async () => {
    vi.mocked(api.getWorkbenchTaskCanvas).mockResolvedValue({
      canvas_snapshot: { id: 'task_1' },
    });
    render(<Harness />);

    const result = await latestActions?.loadWorkbenchTaskCanvas('task_1');

    expect(api.getWorkbenchTaskCanvas).toHaveBeenCalledWith('task_1');
    expect(result).toEqual({ canvas_snapshot: { id: 'task_1' } });
  });

  test('saves task canvas snapshots without rewriting the payload', async () => {
    vi.mocked(api.putWorkbenchTaskCanvas).mockResolvedValue({ ok: true });
    const payload = {
      canvas_hash: 'hash_1',
      canvas_snapshot: { id: 'task_1', edges: [] },
      selection: { type: 'task_canvas', taskId: 'task_1' },
      temporary_resources: { tmp: { path: 'artifact.md' } },
      base_canvas_hash: null,
    };
    render(<Harness />);

    await latestActions?.saveWorkbenchTaskCanvas('task_1', payload);

    expect(api.putWorkbenchTaskCanvas).toHaveBeenCalledWith('task_1', payload);
  });
});
