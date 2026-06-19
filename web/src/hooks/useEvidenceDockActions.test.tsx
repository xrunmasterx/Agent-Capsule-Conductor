import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';

import {
  useEvidenceDockActions,
  type EvidenceDockState,
  type UseEvidenceDockActionsResult,
} from './useEvidenceDockActions';

let latestActions: UseEvidenceDockActionsResult | null = null;
let latestDock: EvidenceDockState | null = null;
const readArtifactContent = vi.fn();

function Harness({
  activeTaskId = 'task_1',
  selectedRunId = 'run_1',
}: {
  activeTaskId?: string;
  selectedRunId?: string | null;
}) {
  const [dock, setDock] = useState<EvidenceDockState>({
    open: true,
    title: 'Existing',
    content: {
      path: 'old.log',
      name: 'old.log',
      type: 'log',
      content: 'old',
      size_bytes: 3,
    },
  });

  latestActions = useEvidenceDockActions({
    activeTaskId,
    selectedRunId,
    readArtifactContent,
    setEvidenceDock: setDock,
  });
  latestDock = dock;

  return <output>{dock.title}</output>;
}

describe('useEvidenceDockActions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T00:00:00Z'));
  });

  afterEach(() => {
    latestActions = null;
    latestDock = null;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test('closes the evidence dock with the canonical Chinese title', () => {
    render(<Harness />);

    act(() => {
      latestActions?.closeEvidenceDock();
    });

    expect(latestDock).toMatchObject({
      open: false,
      title: '运行证据',
      content: null,
    });
  });

  test('does not read artifacts when path is missing', async () => {
    render(<Harness />);

    await act(async () => {
      await latestActions?.readEvidence(null);
    });

    expect(readArtifactContent).not.toHaveBeenCalled();
    expect(latestDock?.title).toBe('Existing');
  });

  test('opens artifact evidence with owner metadata and trimmed content', async () => {
    const longText = Array.from({ length: 190 }, (_, index) => `line-${index}`).join('\n');
    readArtifactContent.mockResolvedValue({
      path: 'runs/run_1/stdout.log',
      name: 'stdout.log',
      type: 'log',
      content: longText,
      size_bytes: longText.length,
    });
    render(<Harness />);

    await act(async () => {
      await latestActions?.readEvidence('runs/run_1/stdout.log', '标准输出');
    });

    expect(readArtifactContent).toHaveBeenCalledWith('runs/run_1/stdout.log');
    expect(latestDock?.open).toBe(true);
    expect(latestDock?.title).toBe('标准输出');
    expect(latestDock?.content?.type).toBe('log');
    const lines = latestDock?.content?.content.split('\n') ?? [];
    expect(lines).toHaveLength(182);
    expect(lines[0]).toBe('日志较大，仅显示最后 180 行。');
    expect(lines.at(-1)).toBe('line-189');
    expect(latestDock?.owner).toEqual({
      kind: 'artifact',
      taskId: 'task_1',
      runId: 'run_1',
      createdAt: '2026-06-20T00:00:00.000Z',
    });
  });
});
