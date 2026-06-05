import { ChevronDown, ChevronUp } from 'lucide-react';

import type { ArtifactContent, RunEvent, WorkflowRunResult } from '../../types';
import { ReadableArtifact } from '../ArtifactViewer';

type EvidenceOwner = {
  kind: 'validation' | 'run' | 'node' | 'artifact';
  taskId?: string;
  runId?: string;
  nodeId?: string;
  createdAt?: string;
};

type Props = {
  state: {
    open: boolean;
    title: string;
    content: ArtifactContent | null;
    owner?: EvidenceOwner;
  };
  message: string;
  workflowRun: WorkflowRunResult | null;
  workflowEvents: RunEvent[];
  currentTaskId?: string;
  selectedRunId?: string | null;
  onToggle: () => void;
};

export function WorkflowEvidenceDock({
  state,
  message,
  workflowRun,
  workflowEvents,
  currentTaskId,
  selectedRunId,
  onToggle,
}: Props) {
  const failure = workflowRun ? runFailureSummary(workflowRun, workflowEvents) : null;
  const content = evidenceContentForCurrentContext(state, {
    currentTaskId,
    selectedRunId,
    hasWorkflowRun: Boolean(workflowRun),
  });
  const currentEvidenceTitle = content?.name || state.title || '运行证据';

  return (
    <footer className={state.open ? 'evidence-dock open' : 'evidence-dock'} aria-label="Workflow Evidence Dock">
      <button type="button" className="evidence-dock-toggle" onClick={onToggle}>
        <span className={`evidence-dock-status status-${workflowRun?.status || 'not_run'}`}>
          {workflowRun ? statusLabel(workflowRun.status) : '未运行'}
        </span>
        <span className="evidence-dock-message">{message}</span>
        <span className="evidence-dock-current">{currentEvidenceTitle}</span>
        {state.open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {state.open ? (
        <div className="evidence-dock-body">
          <section className="evidence-artifact-pane" aria-label="当前证据详情">
            <header className="evidence-pane-header">
              <div>
                <span>当前证据</span>
                <h3>{state.title}</h3>
              </div>
              {content ? <small>{content.path}</small> : null}
            </header>
            {failure ? <FailureSummaryCard failure={failure} /> : null}
            {content ? <ReadableArtifact content={content} /> : <p className="empty-state">暂无打开的证据。</p>}
          </section>
          <EventTimeline events={workflowEvents} title="最近事件" />
        </div>
      ) : null}
    </footer>
  );
}

function evidenceContentForCurrentContext(
  state: Props['state'],
  context: { currentTaskId?: string; selectedRunId?: string | null; hasWorkflowRun: boolean },
): ArtifactContent | null {
  if (!state.content) {
    return null;
  }
  const owner = state.owner;
  if (!owner) {
    return state.content;
  }
  if (owner.taskId && context.currentTaskId && owner.taskId !== context.currentTaskId) {
    return null;
  }
  if (owner.kind === 'validation') {
    return context.hasWorkflowRun || context.selectedRunId ? null : state.content;
  }
  if ((owner.kind === 'run' || owner.kind === 'node' || owner.kind === 'artifact') && owner.runId) {
    return owner.runId === context.selectedRunId ? state.content : null;
  }
  return state.content;
}

type FailureSummary = {
  nodeId: string;
  reason: string;
  evidencePath: string;
  stderrPath?: string | null;
  outputPath?: string | null;
};

function FailureSummaryCard({ failure }: { failure: FailureSummary }) {
  return (
    <article className="failure-summary-card" aria-label="Run failure summary">
      <strong>失败节点: {failure.nodeId}</strong>
      <p>原因: {failure.reason}</p>
      <small>证据: {failure.evidencePath}</small>
      {failure.stderrPath ? <small>stderr: {failure.stderrPath}</small> : null}
      {failure.outputPath ? <small>output: {failure.outputPath}</small> : null}
    </article>
  );
}

function runFailureSummary(
  workflowRun: WorkflowRunResult,
  events: RunEvent[],
): FailureSummary | null {
  if (!['failed', 'crashed', 'timeout', 'schema_error', 'artifact_error'].includes(workflowRun.status)) {
    return null;
  }
  const failedNode =
    workflowRun.nodes.find((node) => node.status !== 'success') || workflowRun.nodes[0] || null;
  const eventError = latestEventError(events);
  const errorMessage =
    failedNode?.error ||
    failedNode?.errors?.map((error) => error.message).filter(Boolean).join('\n') ||
    failedNode?.summary ||
    eventError ||
    workflowRun.errors?.join('\n') ||
    'Run failed without a detailed error message.';
  return {
    nodeId: failedNode?.node_id || workflowRun.workflow_id || workflowRun.run_dir,
    reason: errorMessage,
    evidencePath: `${workflowRun.run_dir}/run_summary.json`,
    stderrPath: failedNode?.stderr_log,
    outputPath: failedNode?.output_path,
  };
}

function latestEventError(events: RunEvent[]): string {
  for (const event of [...events].reverse()) {
    const payloadError = event.payload?.error || event.payload?.message || event.payload?.detail;
    if (typeof payloadError === 'string' && payloadError) {
      return payloadError;
    }
    const directError = event.error || event.message || event.detail;
    if (typeof directError === 'string' && directError) {
      return directError;
    }
  }
  return '';
}

function EventTimeline({ events, title }: { events: RunEvent[]; title: string }) {
  const visibleEvents = events.slice(-12).reverse();
  return (
    <section className="event-timeline" aria-label={title}>
      <h3>{title}</h3>
      {visibleEvents.map((event, index) => (
        <article className="event-row compact" key={`${event.timestamp || index}-${event.type || event.event}`}>
          <strong>{String(event.type || event.event || 'event')}</strong>
          <span>{event.node_id || event.workflow_run_id || ''}</span>
          <small>{String(event.status || '')}</small>
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
