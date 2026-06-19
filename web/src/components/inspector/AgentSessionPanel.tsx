import { FileText, RefreshCw, UploadCloud } from 'lucide-react';
import { useState } from 'react';

import { shortPath } from '../../format';
import type { AgentSessionUiState } from '../../hooks/useSelectedAgentSession';
import type { AgentMessage, AgentSessionRecord, RunEvent } from '../../types';
import type { AgentNodeSettingsModel } from '../../types/workbench';

type AgentSessionPanelProps = {
  node: AgentNodeSettingsModel;
  state: AgentSessionUiState;
  events: RunEvent[];
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onRefresh: () => Promise<void>;
  onPublish: (expectedTurnId: string) => Promise<void>;
  onAnswerInteraction: (interactionId: string, answer: Record<string, unknown>) => Promise<void>;
};

export function AgentSessionPanel({
  node,
  state,
  events,
  onReadEvidence,
  onRefresh,
  onPublish,
  onAnswerInteraction,
}: AgentSessionPanelProps) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const session = state.session;
  const draftPath = agentSessionArtifactPath(session, session?.current_output_ref);
  const publishedSessionPath = agentSessionArtifactPath(session, session?.published_output_ref);
  const outputStateLabel = session
    ? canPublishAgentOutput(session)
      ? '有待发布草稿'
      : session.published_output_turn_id
        ? '已发布'
        : '等待输出'
    : '未绑定';
  const canPublish = Boolean(
    session?.bound_run_id &&
      session?.bound_node_id &&
      session.current_output_turn_id &&
      session.current_output_turn_id !== session.published_output_turn_id,
  );

  async function publishDraft() {
    if (!session?.current_output_turn_id) {
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      await onPublish(session.current_output_turn_id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function answerInteraction(interactionId: string, answer: Record<string, unknown>) {
    setBusy(true);
    setActionError('');
    try {
      await onAnswerInteraction(interactionId, answer);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (node.kind === 'Tool' || !node.run) {
    return null;
  }

  return (
    <section className="node-settings-card agent-session-card" aria-label="Agent 输出状态">
      <div className="node-settings-section-header">
        <div>
          <span className="panel-kicker">Agent 输出</span>
          <h4>{outputStateLabel}</h4>
        </div>
        <button
          type="button"
          className="secondary-action compact-action"
          disabled={busy || state.status === 'loading'}
          onClick={() => void onRefresh()}
        >
          <RefreshCw aria-hidden="true" size={14} />
          刷新
        </button>
      </div>

      {state.status === 'loading' ? <p className="empty-state">正在读取 Agent Session...</p> : null}
      {state.status === 'error' ? <p className="notice compact-notice">{state.error}</p> : null}
      {actionError ? <p className="notice compact-notice">{actionError}</p> : null}

      {session ? (
        <>
          <div className="agent-session-status-grid">
            <div>
              <span>会话</span>
              <strong>{session.status || 'ready'}</strong>
            </div>
            <div>
              <span>草稿</span>
              <strong>{session.current_output_turn_id ? '可用' : '无'}</strong>
            </div>
            <div>
              <span>正式输出</span>
              <strong>{session.published_output_turn_id ? '已发布' : '未发布'}</strong>
            </div>
          </div>

          {state.interactions.length > 0 ? (
            <section className="agent-session-subsection" aria-label="Agent approval requests">
              <h5>待审批</h5>
              {state.interactions.map((interaction) => (
                <article key={interaction.interaction_id} className="interaction-card compact">
                  <strong>{interaction.kind}</strong>
                  <p>{interaction.prompt}</p>
                  <div className="interaction-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void answerInteraction(interaction.interaction_id, { decision: 'approve' })}
                    >
                      通过
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void answerInteraction(interaction.interaction_id, { decision: 'reject' })}
                    >
                      拒绝
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          <div className="agent-output-primary-actions">
            <button
              type="button"
              className="secondary-action compact-action"
              disabled={!canPublish || busy}
              onClick={() => void publishDraft()}
            >
              <UploadCloud aria-hidden="true" size={14} />
              发布为本节点输出
            </button>
            {!canPublish ? <p className="muted">当前没有新的待发布草稿。</p> : null}
          </div>

          <AgentSessionDebugDetails
            session={session}
            node={node}
            messages={state.messages}
            events={events}
            draftPath={draftPath}
            publishedSessionPath={publishedSessionPath}
            onReadEvidence={onReadEvidence}
          />
        </>
      ) : state.status === 'loading' ? null : (
        <p className="empty-state">当前 run node 还没有绑定到可读取的 Agent Session。</p>
      )}
    </section>
  );
}

function canPublishAgentOutput(session: AgentSessionRecord): boolean {
  return Boolean(
    session.bound_run_id &&
      session.bound_node_id &&
      session.current_output_turn_id &&
      session.current_output_turn_id !== session.published_output_turn_id,
  );
}

function AgentSessionDebugDetails({
  session,
  node,
  messages,
  events,
  draftPath,
  publishedSessionPath,
  onReadEvidence,
}: {
  session: AgentSessionRecord;
  node: AgentNodeSettingsModel;
  messages: AgentMessage[];
  events: RunEvent[];
  draftPath: string | null;
  publishedSessionPath: string | null;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
}) {
  return (
    <details className="agent-session-debug-details">
      <summary>调试详情</summary>
      <div className="agent-session-debug-content">
        <dl className="node-settings-facts agent-session-facts">
          <dt>session_id</dt>
          <dd>{session.session_id}</dd>
          <dt>provider_session_id</dt>
          <dd>{session.provider_session_id || 'n/a'}</dd>
          <dt>bound node</dt>
          <dd>{[session.bound_run_id, session.bound_node_id].filter(Boolean).join(' / ') || 'unbound'}</dd>
          <dt>last turn</dt>
          <dd>
            {session.last_turn_id || 'n/a'} / {session.status || 'unknown'}
          </dd>
          <dt>draft turn</dt>
          <dd>{session.current_output_turn_id || 'n/a'}</dd>
          <dt>published turn</dt>
          <dd>{session.published_output_turn_id || 'n/a'}</dd>
        </dl>

        <div className="agent-output-actions">
          <button
            type="button"
            className="path-button"
            disabled={!draftPath}
            onClick={() => onReadEvidence(draftPath, '待发布草稿 current_output.json')}
          >
            <FileText aria-hidden="true" size={16} />
            <span>待发布草稿</span>
            <small>{shortPath(draftPath)}</small>
          </button>
          <button
            type="button"
            className="path-button"
            disabled={!node.run?.output_path}
            onClick={() => onReadEvidence(node.run?.output_path, '已发布输出 output.json')}
          >
            <FileText aria-hidden="true" size={16} />
            <span>已发布输出</span>
            <small>{shortPath(node.run?.output_path)}</small>
          </button>
          <button
            type="button"
            className="path-button"
            disabled={!publishedSessionPath}
            onClick={() => onReadEvidence(publishedSessionPath, 'session published_output.json')}
          >
            <FileText aria-hidden="true" size={16} />
            <span>Session 发布副本</span>
            <small>{shortPath(publishedSessionPath)}</small>
          </button>
        </div>

        <section className="agent-session-subsection" aria-label="Agent messages">
          <h5>会话消息</h5>
          <div className="agent-message-list">
            {messages.length === 0 ? <p className="empty-state">暂无会话消息。</p> : null}
            {messages.slice(-8).map((item, index) => (
              <article key={`${item.turn_id || 'msg'}-${index}`} className={`agent-message role-${item.role}`}>
                <strong>{item.role}</strong>
                <p>{assistantMessageDisplayContent(item.content)}</p>
                {item.turn_id ? <small>{item.turn_id}</small> : null}
              </article>
            ))}
          </div>
        </section>

        <AgentEventTimeline events={events} />
      </div>
    </details>
  );
}

function AgentEventTimeline({ events, maxEvents = 12 }: { events: RunEvent[]; maxEvents?: number }) {
  const agentEvents = events.filter((event) => String(event.type || event.event || '').startsWith('agent_'));
  const visibleEvents = agentEvents.slice(-maxEvents).reverse();
  return (
    <section className="agent-session-subsection" aria-label="Agent timeline">
      <h5>Agent timeline</h5>
      {visibleEvents.length === 0 ? <p className="empty-state">暂无 agent 事件。</p> : null}
      <div className="event-timeline compact">
        {visibleEvents.map((event, index) => (
          <article key={`${event.event_id || event.type || event.event || 'agent_event'}-${index}`}>
            <strong>{String(event.type || event.event || 'agent_event')}</strong>
            <span>{agentEventSummary(event)}</span>
            <small>{event.timestamp || ''}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function agentEventSummary(event: RunEvent): string {
  const payload = isPlainRecord(event.payload) ? event.payload : {};
  const content = stringValue(payload.content);
  if (content) {
    return compactText(assistantMessageDisplayContent(content));
  }
  const summary = stringValue(payload.summary) || stringValue(payload.message) || stringValue(payload.error);
  if (summary) {
    return compactText(summary);
  }
  const toolName = stringValue(payload.name) || stringValue(payload.tool) || stringValue(payload.command);
  if (toolName) {
    return compactText(toolName);
  }
  const outputPath = stringValue(payload.output_path);
  if (outputPath) {
    return shortPath(outputPath);
  }
  return event.status ? String(event.status) : 'canonical agent event';
}

function assistantMessageDisplayContent(content: string): string {
  const parsed = parseEmbeddedJsonObject(content);
  if (!parsed) {
    return compactText(content);
  }
  const assistantMessage = stringValue(parsed.assistant_message) || stringValue(parsed.message);
  const proposal = isPlainRecord(parsed.proposal) ? parsed.proposal : null;
  const proposalId = proposal ? stringValue(proposal.proposal_id) : '';
  const rationale = proposal ? stringValue(proposal.rationale) : '';
  const parts = [
    assistantMessage,
    proposalId ? `proposal=${proposalId}` : '',
    rationale ? `rationale=${compactText(rationale, 180)}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : compactText(content);
}

function parseEmbeddedJsonObject(value: string): Record<string, unknown> | null {
  const direct = parseJsonObject(value);
  if (direct) {
    return direct;
  }
  const start = value.indexOf('{');
  if (start < 0) {
    return null;
  }
  return scanJsonObject(value, start);
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function scanJsonObject(value: string, start: number): Record<string, unknown> | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return parseJsonObject(value.slice(start, index + 1));
      }
    }
  }
  return null;
}

function agentSessionArtifactPath(session: AgentSessionRecord | null | undefined, ref: unknown): string | null {
  if (!session || typeof ref !== 'string' || !ref) {
    return null;
  }
  if (/^[a-zA-Z]:[\\/]/u.test(ref) || ref.startsWith('/') || ref.startsWith('\\')) {
    return ref;
  }
  const sessionDir = typeof session.session_dir === 'string' ? session.session_dir : '';
  if (!sessionDir) {
    return ref;
  }
  return `${sessionDir.replace(/[\\/]+$/u, '')}/${ref}`;
}

function compactText(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
