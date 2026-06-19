/**
 * RunOverlay - live output viewer and run status display.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildAccTranscript,
  type AccTranscriptEntry,
  type LiveOutputFilter,
} from '../../lib/runTranscript';
import type { WorkbenchLiveEvent } from '../../types';

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

function liveOutputFilterLabel(filter: LiveOutputFilter): string {
  const labels: Record<LiveOutputFilter, string> = {
    all: '输出',
    logs: '日志',
    stdout: 'stdout',
    stderr: 'stderr',
    errors: '错误',
    raw: 'raw',
  };
  return labels[filter];
}

function transcriptEntryLabel(entry: AccTranscriptEntry): string {
  const time = entry.timestamp ? entry.timestamp.split('T').pop()?.replace('Z', '') || entry.timestamp : '';
  return [time, entry.stream, entry.label].filter(Boolean).join(' / ');
}

export function LiveOutputViewer({
  events,
  status,
  emptyText,
}: {
  events: WorkbenchLiveEvent[];
  status: string;
  emptyText: string;
}) {
  const [filter, setFilter] = useState<LiveOutputFilter>('all');
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const visibleEntries = useMemo(() => {
    const entries = buildAccTranscript(events, filter);
    if (filter === 'all' && entries.length === 0) {
      return buildAccTranscript(events, 'logs').slice(-160);
    }
    return entries.slice(-160);
  }, [events, filter]);
  const hasEvents = visibleEntries.length > 0;
  const shouldShowJump = hasEvents && !isPinnedToBottom;

  const scrollToBottom = useCallback(() => {
    const element = outputRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, []);

  useEffect(() => {
    if (!isPinnedToBottom) {
      return;
    }
    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [filter, isPinnedToBottom, scrollToBottom, visibleEntries.length]);

  const onOutputScroll = useCallback(() => {
    const element = outputRef.current;
    if (!element) {
      return;
    }
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setIsPinnedToBottom(distanceFromBottom <= 40);
  }, []);

  const selectFilter = useCallback((nextFilter: LiveOutputFilter) => {
    const element = outputRef.current;
    if (element) {
      const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      setIsPinnedToBottom(distanceFromBottom <= 40);
    }
    setFilter(nextFilter);
  }, []);

  const jumpToLatest = useCallback(() => {
    setIsPinnedToBottom(true);
    window.requestAnimationFrame(scrollToBottom);
  }, [scrollToBottom]);

  return (
    <section className="live-output-viewer" aria-label="实时输出">
      <header className="live-output-header">
        <div>
          <span>实时输出</span>
          <strong>{statusLabel(status || 'not_run')}</strong>
        </div>
        <div className="selection-log-stream-tabs" role="tablist" aria-label="Live output filters">
          {(['all', 'logs', 'stdout', 'stderr', 'errors', 'raw'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={filter === item ? 'active' : ''}
              onClick={() => selectFilter(item)}
            >
              {liveOutputFilterLabel(item)}
            </button>
          ))}
        </div>
      </header>
      <div
        ref={outputRef}
        className="selection-log-output selection-live-output"
        role="log"
        aria-live="polite"
        onScroll={onOutputScroll}
      >
        {hasEvents ? (
          <div className="live-output-lines">
            {visibleEntries.map((entry) => (
              <article key={entry.id} className={`live-output-line stream-${entry.stream}`}>
                <span>{transcriptEntryLabel(entry)}</span>
                <pre>{entry.text}</pre>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">{emptyText}</p>
        )}
      </div>
      {shouldShowJump ? (
        <button type="button" className="live-output-jump" onClick={jumpToLatest}>
          跳到最新
        </button>
      ) : null}
    </section>
  );
}
