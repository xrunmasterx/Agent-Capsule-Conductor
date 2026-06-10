/**
 * SSE streaming hook for workflow run events.
 *
 * Extracted from WorkflowViewer.tsx lines 2631-2677.
 * Manages the EventSource connection to the run stream, dispatching
 * node_log_delta, summary, and agent_event frames to the appropriate
 * state updaters.
 */

import { useEffect } from 'react';
import { api } from '../api';
import type { NodeLogDelta, RunEvent, RunSummary } from '../types';

// ---------------------------------------------------------------------------
// Re-exported local types
// ---------------------------------------------------------------------------

export type { NodeLogDelta };

export type WorkflowStatus =
  | 'not_run'
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'crashed'
  | 'scheduled';

// ---------------------------------------------------------------------------
// Hook: useRunStream
// ---------------------------------------------------------------------------

export type RunStreamCallbacks = {
  appendNodeLogDelta: (delta: NodeLogDelta) => void;
  updateRunProjection: (
    runId: string,
    update: (current: any) => any,
  ) => void;
  appendRunAgentEvent: (runId: string, event: RunEvent) => void;
};

/**
 * Opens an EventSource to the selected run's stream endpoint and dispatches
 * three event types:
 *
 * - `node_log_delta` - incremental stdout/stderr from a running node
 * - `summary` - updated RunSummary snapshot
 * - `agent_event` - agent timeline events
 *
 * The stream is best-effort; polling in the parent component owns durable
 * run state.  The hook closes the source on unmount or when `selectedRunId`
 * changes.
 */
export function useRunStream(
  selectedRunId: string | null,
  callbacks: RunStreamCallbacks,
): void {
  const { appendNodeLogDelta, updateRunProjection, appendRunAgentEvent } = callbacks;

  useEffect(() => {
    if (!selectedRunId || typeof EventSource === 'undefined') {
      return undefined;
    }
    const source = new EventSource(api.runStreamUrl(selectedRunId));

    const onLogDelta = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as NodeLogDelta;
        if (payload.type === 'node_log_delta') {
          appendNodeLogDelta(payload);
        }
      } catch {
        // Ignore malformed stream chunks; polling still owns durable run state.
      }
    };

    const onSummary = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string; summary?: RunSummary };
        if (payload.type === 'summary' && payload.summary) {
          updateRunProjection(selectedRunId, (current: any) => ({
            ...current,
            summary: payload.summary,
            status: (payload.summary as RunSummary & { status?: string })?.status as WorkflowStatus,
          }));
        }
      } catch {
        // Keep the stream best-effort; existing run polling remains the fallback.
      }
    };

    const onAgentEvent = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as RunEvent;
        appendRunAgentEvent(selectedRunId, payload);
      } catch {
        // Durable node event reads refresh the timeline if a live frame is malformed.
      }
    };

    source.addEventListener('node_log_delta', onLogDelta as EventListener);
    source.addEventListener('agent_event', onAgentEvent as EventListener);
    source.addEventListener('summary', onSummary as EventListener);
    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, [appendNodeLogDelta, appendRunAgentEvent, selectedRunId, updateRunProjection]);
}
