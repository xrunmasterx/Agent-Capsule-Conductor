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

export function useSubmittedRunPolling(): UseSubmittedRunPollingResult {
  const timersRef = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const timerId of timersRef.current) {
        window.clearTimeout(timerId);
      }
      timersRef.current = [];
    },
    [],
  );

  const pollSubmittedRunUntilTerminal = useCallback(
    ({ runId, foreground, onSnapshot, onError }: StartSubmittedRunPollingOptions) => {
      const schedule = (delayMs: number) => {
        const timerId = window.setTimeout(() => {
          timersRef.current = timersRef.current.filter((currentTimerId) => currentTimerId !== timerId);
          void pollOnce();
        }, delayMs);
        timersRef.current.push(timerId);
      };

      async function pollOnce() {
        try {
          const [summary, stateSnapshot, result] = await Promise.all([
            api.run(runId),
            api.runState(runId).catch(() => null),
            api.runEvents(runId).catch(() => ({ events: [] as RunEvent[] })),
          ]);
          const shouldContinue = onSnapshot({
            summary,
            stateSnapshot,
            events: result.events,
          });
          if (shouldContinue) {
            schedule(foreground ? FOREGROUND_POLL_MS : BACKGROUND_POLL_MS);
          }
        } catch {
          onError();
          schedule(BACKGROUND_POLL_MS);
        }
      }

      void pollOnce();
    },
    [],
  );

  return { pollSubmittedRunUntilTerminal };
}
