/**
 * SSE streaming hook for workflow run events.
 * * Manages the EventSource connection to the run stream, dispatching
 * node_log_delta, live_event, summary, and agent_event frames to the appropriate
 * state updaters.
 */

import { useEffect } from 'react';
import { api } from '../api';
import type { NodeLogDelta, RunEvent, RunSummary, WorkbenchLiveEvent } from '../types';
import type { WorkflowStatus } from '../types/workbench';

// ---------------------------------------------------------------------------
// Re-exported local types
// ---------------------------------------------------------------------------

export type { NodeLogDelta };

export type { WorkflowStatus };

// ---------------------------------------------------------------------------
// Hook: useRunStream
// ---------------------------------------------------------------------------

export type RunStreamCallbacks = {
  appendNodeLogDeltas: (runId: string, deltas: NodeLogDelta[]) => void;
  appendRunAgentEvents: (runId: string, events: RunEvent[]) => void;
  appendRunLiveEvents: (runId: string, events: WorkbenchLiveEvent[]) => void;
  applyRunSummary: (runId: string, summary: RunSummary) => void;
};

/**
 * Opens an EventSource to the selected run's stream endpoint and dispatches
 * three event types:
 *
 * - `node_log_delta` - incremental stdout/stderr from a running node
 * - `summary` - updated RunSummary snapshot
 * - `agent_event` - agent timeline events
 * - `live_event` - transcript-oriented live output events
 *
 * The stream is best-effort; polling in the parent component owns durable
 * run state.  The hook closes the source on unmount or when `selectedRunId`
 * changes.
 */
export function useRunStream(
  selectedRunId: string | null,
  callbacks: RunStreamCallbacks,
): void {
  const { appendNodeLogDeltas, appendRunAgentEvents, appendRunLiveEvents, applyRunSummary } = callbacks;

  useEffect(() => {
    if (!selectedRunId || typeof EventSource === 'undefined') {
      return undefined;
    }
    const source = new EventSource(api.runStreamUrl(selectedRunId, { history: 'none' }));
    const buffer: {
      nodeLogDeltas: NodeLogDelta[];
      agentEvents: RunEvent[];
      liveEvents: WorkbenchLiveEvent[];
      summary: RunSummary | null;
    } = {
      nodeLogDeltas: [],
      agentEvents: [],
      liveEvents: [],
      summary: null,
    };
    let rafHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const clearScheduledFlush = () => {
      if (rafHandle !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(rafHandle);
      }
      rafHandle = null;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      timeoutHandle = null;
    };

    const flush = () => {
      rafHandle = null;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      const nodeLogDeltas = buffer.nodeLogDeltas;
      const agentEvents = buffer.agentEvents;
      const liveEvents = buffer.liveEvents;
      const summary = buffer.summary;
      buffer.nodeLogDeltas = [];
      buffer.agentEvents = [];
      buffer.liveEvents = [];
      buffer.summary = null;
      if (nodeLogDeltas.length > 0) {
        appendNodeLogDeltas(selectedRunId, nodeLogDeltas);
      }
      if (agentEvents.length > 0) {
        appendRunAgentEvents(selectedRunId, agentEvents);
      }
      if (liveEvents.length > 0) {
        appendRunLiveEvents(selectedRunId, liveEvents);
      }
      if (summary) {
        applyRunSummary(selectedRunId, summary);
        source.close();
        closed = true;
      }
    };

    const scheduleFlush = () => {
      if (closed) {
        return;
      }
      if (rafHandle === null) {
        if (typeof requestAnimationFrame !== 'undefined') {
          rafHandle = requestAnimationFrame(flush);
        } else {
          rafHandle = window.setTimeout(flush, 0);
        }
      }
      if (timeoutHandle === null) {
        timeoutHandle = setTimeout(flush, 100);
      }
    };

    const onLogDelta = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as NodeLogDelta;
        if (payload.type === 'node_log_delta') {
          buffer.nodeLogDeltas.push(payload);
          scheduleFlush();
        }
      } catch {
        // Ignore malformed stream chunks; polling still owns durable run state.
      }
    };

    const onSummary = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string; summary?: RunSummary };
        if (payload.type === 'summary' && payload.summary) {
          buffer.summary = payload.summary;
          scheduleFlush();
        }
      } catch {
        // Keep the stream best-effort; existing run polling remains the fallback.
      }
    };

    const onAgentEvent = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as RunEvent;
        buffer.agentEvents.push(payload);
        scheduleFlush();
      } catch {
        // Durable node event reads refresh the timeline if a live frame is malformed.
      }
    };
    const onLiveEvent = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as WorkbenchLiveEvent;
        buffer.liveEvents.push(payload);
        scheduleFlush();
      } catch {
        // Live output is best-effort; run evidence and polling remain the durable fallback.
      }
    };

    source.addEventListener('node_log_delta', onLogDelta as EventListener);
    source.addEventListener('agent_event', onAgentEvent as EventListener);
    source.addEventListener('live_event', onLiveEvent as EventListener);
    source.addEventListener('summary', onSummary as EventListener);
    source.onerror = () => {
      // Keep native EventSource reconnect active. Cleanup on unmount or
      // selectedRunId changes remains responsible for closing the source.
    };

    return () => {
      flush();
      clearScheduledFlush();
      source.close();
    };
  }, [appendNodeLogDeltas, appendRunAgentEvents, appendRunLiveEvents, applyRunSummary, selectedRunId]);
}
