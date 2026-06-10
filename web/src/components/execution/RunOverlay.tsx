/**
 * RunOverlay - live output viewer and run status display.
 *
 * Extracted from WorkflowViewer.tsx lines 9665-9760.
 * Contains LiveOutputViewer (streaming event list with filter tabs)
 * and related helpers for formatting live events.
 */

import { useMemo, useState } from 'react';
import { shortPath } from '../../format';
import type { WorkbenchLiveEvent } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    success: '成功',
    failed: '失败',
    timeout: '超时',
    schema_error: 'Schema 错误',
    artifact_error: '产物错误',
    running: '运行中',
    scheduled: '已调度',
    manual_review: '等待人工确认',
    not_run: '未运行',
  };
  return labels[status] || status;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function limitText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function assistantMessageDisplayContent(content: string): string {
  if (!content) {
    return '';
  }
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) {
        const readable = parsed.summary || parsed.rationale || parsed.content || parsed.message;
        if (typeof readable === 'string') {
          return readable;
        }
      }
    } catch {
      // Not JSON; show as-is.
    }
  }
  return trimmed;
}

function filterLiveEvents(
  events: WorkbenchLiveEvent[],
  filter: 'all' | 'agent' | 'stdout' | 'stderr' | 'errors',
): WorkbenchLiveEvent[] {
  if (filter === 'all') {
    return events;
  }
  if (filter === 'errors') {
    return events.filter((event) =>
      `${event.type} ${event.text || ''} ${stringValue(event.payload?.error)}`.toLowerCase().includes('error') ||
      String(event.type).includes('failed'),
    );
  }
  return events.filter((event) => event.stream === filter);
}

function liveEventLabel(event: WorkbenchLiveEvent): string {
  const prefix = event.stream || 'agent';
  const time = event.timestamp ? event.timestamp.split('T').pop()?.replace('Z', '') || event.timestamp : '';
  return [time, prefix, event.type].filter(Boolean).join(' · ');
}

function liveEventText(event: WorkbenchLiveEvent): string {
  if (event.text) {
    return limitText(event.text, 2400);
  }
  if (event.payload) {
    const content = stringValue(event.payload.content);
    if (content) {
      return limitText(assistantMessageDisplayContent(content), 2400);
    }
    const outputPath = stringValue(event.payload.output_path);
    if (outputPath) {
      return shortPath(outputPath);
    }
    const status = stringValue(event.payload.status);
    if (status) {
      return status;
    }
  }
  return event.type;
}

// ---------------------------------------------------------------------------
// LiveOutputViewer
// ---------------------------------------------------------------------------

export function LiveOutputViewer({
  events,
  status,
  emptyText,
}: {
  events: WorkbenchLiveEvent[];
  status: string;
  emptyText: string;
}) {
  const [filter, setFilter] = useState<'all' | 'agent' | 'stdout' | 'stderr' | 'errors'>('all');
  const visibleEvents = useMemo(() => filterLiveEvents(events, filter).slice(-160), [events, filter]);
  const hasEvents = visibleEvents.length > 0;
  return (
    <section className="live-output-viewer" aria-label="实时输出">
      <header className="live-output-header">
        <div>
          <span>实时输出</span>
          <strong>{statusLabel(status || 'not_run')}</strong>
        </div>
        <div className="selection-log-stream-tabs" role="tablist" aria-label="Live output filters">
          {(['all', 'agent', 'stdout', 'stderr', 'errors'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={filter === item ? 'active' : ''}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </header>
      <div className="selection-log-output selection-live-output" role="log" aria-live="polite">
        {hasEvents ? (
          <div className="live-output-lines">
            {visibleEvents.map((event) => (
              <article key={`${event.event_id}-${event.seq}`} className={`live-output-line stream-${event.stream || 'agent'}`}>
                <span>{liveEventLabel(event)}</span>
                <pre>{liveEventText(event)}</pre>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">{emptyText}</p>
        )}
      </div>
    </section>
  );
}
