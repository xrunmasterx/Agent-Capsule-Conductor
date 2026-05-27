import { ChevronDown, ChevronUp } from 'lucide-react';

import type { ArtifactContent, RunEvent, WorkflowRunResult } from '../../types';
import { ReadableArtifact } from '../ArtifactViewer';

type Props = {
  state: {
    open: boolean;
    title: string;
    content: ArtifactContent | null;
  };
  message: string;
  workflowRun: WorkflowRunResult | null;
  workflowEvents: RunEvent[];
  onToggle: () => void;
};

export function WorkflowEvidenceDock({
  state,
  message,
  workflowRun,
  workflowEvents,
  onToggle,
}: Props) {
  return (
    <footer className={state.open ? 'evidence-dock open' : 'evidence-dock'} aria-label="Workflow Evidence Dock">
      <button type="button" className="evidence-dock-toggle" onClick={onToggle}>
        {state.open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        <strong>{workflowRun ? statusLabel(workflowRun.status) : '未运行'}</strong>
        <span>{message}</span>
      </button>
      {state.open ? (
        <div className="evidence-dock-body">
          <section>
            <h3>{state.title}</h3>
            {state.content ? <ReadableArtifact content={state.content} /> : <p>暂无打开的证据。</p>}
          </section>
          <EventTimeline events={workflowEvents} title="最近事件" />
        </div>
      ) : null}
    </footer>
  );
}

function EventTimeline({ events, title }: { events: RunEvent[]; title: string }) {
  return (
    <section className="event-timeline">
      <h3>{title}</h3>
      {events.slice(-12).map((event, index) => (
        <article key={`${event.timestamp || index}-${event.type || event.event}`}>
          <strong>{String(event.type || event.event || 'event')}</strong>
          <span>{event.node_id || event.workflow_run_id || ''}</span>
          <small>{event.timestamp || ''}</small>
        </article>
      ))}
      {events.length === 0 ? <p className="muted">暂无事件。</p> : null}
    </section>
  );
}

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
