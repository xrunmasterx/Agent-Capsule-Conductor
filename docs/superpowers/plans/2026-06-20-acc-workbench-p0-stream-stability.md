# ACC Workbench P0 Stream Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Current audit status (2026-06-22)

Status: **mostly complete; manual verification still open**. Code-level hook changes and focused automated verification are implemented, but Task 3 Step 3 remains unchecked: manual Workbench Network-panel confirmation that a `runId` does not accumulate multiple submitted-run polling chains after re-submission or error. Keep this plan open until that manual evidence is recorded.

See `docs/superpowers/plans/STATUS.md` for the cross-plan audit summary.

**Goal:** Stop the immediate Workbench disconnect/request-storm failure mode by making submitted-run polling single-owner per run and preventing run EventSource errors from permanently closing live updates.

**Architecture:** Keep this as a narrow frontend containment change. Polling remains the durable fallback, but a hook instance owns at most one timer chain per `runId` and errors stop the failing chain instead of rescheduling forever. Run SSE remains browser-owned so native EventSource reconnect can recover transient transport failures.

**Tech Stack:** React 19 hooks, Vitest, Testing Library React, jsdom, TypeScript.

---

## File Structure

- Modify `web/src/hooks/useSubmittedRunPolling.ts`: replace the timer array with a keyed poller map, expose the same hook API, and stop the poller on terminal snapshot or run summary errors.
- Create `web/src/hooks/useSubmittedRunPolling.test.tsx`: hook-level tests with fake timers and mocked `api` methods.
- Modify `web/src/hooks/useRunStream.ts`: remove close-on-error behavior and keep cleanup-owned closure.
- Create `web/src/hooks/useRunStream.test.tsx`: hook-level tests with a fake `EventSource`.

## Task 1: Submitted Run Polling Lifecycle

**Files:**
- Create: `web/src/hooks/useSubmittedRunPolling.test.tsx`
- Modify: `web/src/hooks/useSubmittedRunPolling.ts`

- [x] **Step 1: Write the failing tests**

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import { useSubmittedRunPolling } from './useSubmittedRunPolling';
import type { RunSummary } from '../types';

vi.mock('../api', () => ({
  api: {
    run: vi.fn(),
    runState: vi.fn(),
    runEvents: vi.fn(),
  },
}));

const runMock = vi.mocked(api.run);
const runStateMock = vi.mocked(api.runState);
const runEventsMock = vi.mocked(api.runEvents);

function summary(runId: string, status = 'running'): RunSummary {
  return {
    run_id: runId,
    status,
    run_dir: `runs/${runId}`,
    node_count: 0,
    failed_nodes: [],
    nodes: [],
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  runMock.mockResolvedValue(summary('run-a'));
  runStateMock.mockResolvedValue(null);
  runEventsMock.mockResolvedValue({ run_id: 'run-a', event_log: '', events: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useSubmittedRunPolling', () => {
  test('replaces an existing poller for the same run id', async () => {
    const { result } = renderHook(() => useSubmittedRunPolling());
    const firstSnapshot = vi.fn(() => true);
    const secondSnapshot = vi.fn(() => false);

    act(() => {
      result.current.pollSubmittedRunUntilTerminal({
        runId: 'run-a',
        foreground: true,
        onSnapshot: firstSnapshot,
        onError: vi.fn(),
      });
      result.current.pollSubmittedRunUntilTerminal({
        runId: 'run-a',
        foreground: true,
        onSnapshot: secondSnapshot,
        onError: vi.fn(),
      });
    });
    await flushPromises();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();

    expect(firstSnapshot).toHaveBeenCalledTimes(1);
    expect(secondSnapshot).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledTimes(2);
  });

  test('stops polling after the summary request fails', async () => {
    const { result } = renderHook(() => useSubmittedRunPolling());
    const onError = vi.fn();
    runMock.mockRejectedValue(new Error('404 Not Found'));

    act(() => {
      result.current.pollSubmittedRunUntilTerminal({
        runId: 'missing-run',
        foreground: false,
        onSnapshot: vi.fn(),
        onError,
      });
    });
    await flushPromises();
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    await flushPromises();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 2: Run the tests and verify they fail**

Run: `cd web; npm run test -- src/hooks/useSubmittedRunPolling.test.tsx --run`

Expected: at least one test fails because the current hook keeps multiple timer chains and reschedules after summary errors.

- [x] **Step 3: Implement keyed pollers**

```ts
type ActivePoller = {
  generation: number;
  timerId: number | null;
  stopped: boolean;
};

const pollersRef = useRef<Map<string, ActivePoller>>(new Map());

function stopPoller(runId: string) {
  const current = pollersRef.current.get(runId);
  if (!current) {
    return;
  }
  current.stopped = true;
  if (current.timerId !== null) {
    window.clearTimeout(current.timerId);
  }
  pollersRef.current.delete(runId);
}
```

The hook should call `stopPoller(runId)` before starting a new poller for the same run. A poller should only schedule again when its generation is still active and `onSnapshot` returns `true`. The `catch` branch should call `onError()` and stop the poller instead of scheduling again.

- [x] **Step 4: Run the focused test**

Run: `cd web; npm run test -- src/hooks/useSubmittedRunPolling.test.tsx --run`

Expected: both tests pass.

## Task 2: Run EventSource Error Recovery

**Files:**
- Create: `web/src/hooks/useRunStream.test.tsx`
- Modify: `web/src/hooks/useRunStream.ts`

- [x] **Step 1: Write the failing test**

```tsx
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useRunStream, type RunStreamCallbacks } from './useRunStream';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  close = vi.fn();
  listeners = new Map<string, EventListener>();
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener);
  }
}

function callbacks(): RunStreamCallbacks {
  return {
    appendNodeLogDelta: vi.fn(),
    updateRunProjection: vi.fn(),
    appendRunAgentEvent: vi.fn(),
    appendRunLiveEvent: vi.fn(),
  };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useRunStream', () => {
  test('does not permanently close the EventSource on transient errors', () => {
    const { unmount } = renderHook(() => useRunStream('run-a', callbacks()));
    const source = FakeEventSource.instances[0];

    source.onerror?.(new Event('error'));

    expect(source.close).not.toHaveBeenCalled();
    unmount();
    expect(source.close).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 2: Run the test and verify it fails**

Run: `cd web; npm run test -- src/hooks/useRunStream.test.tsx --run`

Expected: the test fails because `onerror` currently calls `source.close()`.

- [x] **Step 3: Implement cleanup-owned closure**

```ts
source.onerror = () => {
  // Let the browser EventSource implementation perform its native reconnect.
  // Cleanup on unmount or selectedRunId change remains responsible for close().
};
```

- [x] **Step 4: Run focused tests**

Run: `cd web; npm run test -- src/hooks/useSubmittedRunPolling.test.tsx src/hooks/useRunStream.test.tsx --run`

Expected: both files pass.

## Task 3: Verification

**Files:**
- Verify: `web/src/hooks/useSubmittedRunPolling.ts`
- Verify: `web/src/hooks/useRunStream.ts`
- Verify: `web/src/hooks/useSubmittedRunPolling.test.tsx`
- Verify: `web/src/hooks/useRunStream.test.tsx`

- [x] **Step 1: Run frontend typecheck**

Run: `cd web; npx tsc --noEmit`

Expected: exit code 0.

- [x] **Step 2: Run focused frontend tests**

Run: `cd web; npm run test -- src/hooks/useSubmittedRunPolling.test.tsx src/hooks/useRunStream.test.tsx --run`

Expected: exit code 0.

- [ ] **Step 3: Confirm request-storm behavior manually**

Run the Workbench, submit or restore one run, then inspect Network. Expected: the same `runId` does not accumulate multiple independent submitted-run polling chains after re-submission or error.
