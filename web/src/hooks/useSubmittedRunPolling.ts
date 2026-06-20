import { useCallback, useEffect, useRef } from 'react';

import { api } from '../api';
import type { RunEvent, RunSummary, WorkflowRunResult } from '../types';

export type SubmittedRunPollSnapshot = {
  summary: RunSummary;
  stateSnapshot: WorkflowRunResult | null;
  events: RunEvent[];
};

export type StartSubmittedRunPollingOptions = {
  runId: string;
  foreground: boolean;
  onSnapshot: (snapshot: SubmittedRunPollSnapshot) => boolean;
  onError: () => void;
};

export type UseSubmittedRunPollingResult = {
  pollSubmittedRunUntilTerminal: (options: StartSubmittedRunPollingOptions) => void;
};

const FOREGROUND_POLL_MS = 1000;
const BACKGROUND_POLL_MS = 2500;

type ActiveSubmittedRunPoller = {
  timerId: number | null;
  stopped: boolean;
};

export function useSubmittedRunPolling(): UseSubmittedRunPollingResult {
  const pollersRef = useRef<Map<string, ActiveSubmittedRunPoller>>(new Map());

  useEffect(
    () => () => {
      for (const poller of pollersRef.current.values()) {
        poller.stopped = true;
        if (poller.timerId !== null) {
          window.clearTimeout(poller.timerId);
        }
      }
      pollersRef.current.clear();
    },
    [],
  );

  const pollSubmittedRunUntilTerminal = useCallback(
    ({ runId, foreground, onSnapshot, onError }: StartSubmittedRunPollingOptions) => {
      const stopPoller = () => {
        const current = pollersRef.current.get(runId);
        if (current !== poller) {
          return;
        }
        poller.stopped = true;
        if (poller.timerId !== null) {
          window.clearTimeout(poller.timerId);
          poller.timerId = null;
        }
        pollersRef.current.delete(runId);
      };

      const existingPoller = pollersRef.current.get(runId);
      if (existingPoller) {
        existingPoller.stopped = true;
        if (existingPoller.timerId !== null) {
          window.clearTimeout(existingPoller.timerId);
        }
      }

      const poller: ActiveSubmittedRunPoller = {
        timerId: null,
        stopped: false,
      };
      pollersRef.current.set(runId, poller);

      const isActivePoller = () => !poller.stopped && pollersRef.current.get(runId) === poller;

      const schedule = (delayMs: number) => {
        if (!isActivePoller()) {
          return;
        }
        const timerId = window.setTimeout(() => {
          if (!isActivePoller()) {
            return;
          }
          poller.timerId = null;
          void pollOnce();
        }, delayMs);
        poller.timerId = timerId;
      };

      async function pollOnce() {
        try {
          const [summary, stateSnapshot, result] = await Promise.all([
            api.run(runId),
            api.runState(runId).catch(() => null),
            api.runEvents(runId).catch(() => ({ events: [] as RunEvent[] })),
          ]);
          if (!isActivePoller()) {
            return;
          }
          const shouldContinue = onSnapshot({
            summary,
            stateSnapshot,
            events: result.events,
          });
          if (shouldContinue) {
            schedule(foreground ? FOREGROUND_POLL_MS : BACKGROUND_POLL_MS);
          } else {
            stopPoller();
          }
        } catch {
          if (!isActivePoller()) {
            return;
          }
          onError();
          stopPoller();
        }
      }

      void pollOnce();
    },
    [],
  );

  return { pollSubmittedRunUntilTerminal };
}
