/**
 * AssistantDrawer — AI assistant side-drawer and bottom-dock content.
 *
 * Extracted from WorkflowViewer.tsx lines 5005-5672.
 * Contains: AssistantDrawer (right panel), AssistantDockContent (bottom dock),
 * AssistantControlRail, AssistantProposalSummary, and SelectedNodeRuntimePane.
 */

import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  AgentSessionRecord,
  AgentTurnRecord,
  AuthoringAgentSummary,
  AuthoringRequiredAction,
  RunEvent,
} from '../../types';
import type {
  AssistantGraphOpsReview,
  AssistantTurnReason,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
} from '../../types/workbench';
import { AssistantTurnList, type AssistantChatMessage } from './AssistantTurnList';

// ---------------------------------------------------------------------------
// Types re-exported for consumers
// ---------------------------------------------------------------------------

export type {
  AssistantGraphOpsReview,
  AssistantTurnReason,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
};

export type TemporaryResourceDraft = {
  draft_id: string;
  kind: 'agent_template';
  status: 'draft' | 'approved_for_canvas' | 'discarded';
  agent_draft: { name?: string };
  referenced_by: string[];
};

export type WorkbenchLiveStreamState = {
  events: any[];
  status: 'idle' | 'connecting' | 'live' | 'closed' | 'error';
  error: string;
};

export type SelectedEntityDetailsModel = {
  key: string;
  kind: string;
  title: string;
  subtitle?: string;
  status: string;
  scopeLabel?: string;
  nodeRun?: any;
  logs?: any;
  log: {
    stdout: string;
    stderr: string;
    excerpt: string;
    stdoutPath?: string | null;
    stderrPath?: string | null;
  };
  properties: any[];
  evidenceActions: any[];
  events: RunEvent[];
  nodeSettings?: any;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function graphOpsStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function authoringRequiredActionLabel(kind: string): string {
  const labels: Record<string, string> = {
    human_review: '人工审核',
    approve_resource_persistence: '保存为资源',
    manual_binding: '手动绑定',
    resolve_conflict: '解决冲突',
    confirm_destructive: '确认破坏性操作',
  };
  return labels[kind] || kind.replace(/_/gu, ' ');
}

function authoringOperationSummary(operation: { op: string; [key: string]: unknown }): string {
  const op = operation.op;
  const label = typeof operation.label === 'string' ? operation.label : '';
  const nodeId = typeof operation.node_id === 'string' ? operation.node_id : '';
  const id = label || nodeId || '';
  const opLabels: Record<string, string> = {
    add_existing_callable_node: `添加节点 ${id}`,
    add_workflow_container: `添加 workflow 容器 ${id}`,
    update_invocation_input: `更新输入 ${id}`,
    update_invocation_label: `重命名 ${id}`,
    update_output_schema: `更新 output schema ${id}`,
    set_ports: `设置端口 ${id}`,
    add_control_edge: `添加控制边`,
    add_data_edge: `添加数据边`,
    remove_edge: `删除边`,
    create_temporary_agent_template: `创建临时 agent 模板 ${id}`,
    replace_temporary_template_with_existing_callable: `替换临时模板 ${id}`,
  };
  return opLabels[op] || `${op} ${id}`.trim();
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

function isNodeDetailModel(model: SelectedEntityDetailsModel): boolean {
  return model.kind === 'node' || model.kind === 'internal-node';
}

function combinedLogText(log: SelectedEntityDetailsModel['log']): string {
  const parts = [
    log.stderr ? `[stderr]\n${log.stderr.trimEnd()}` : '',
    log.stdout ? `[stdout]\n${log.stdout.trimEnd()}` : '',
  ].filter(Boolean);
  return parts.join('\n\n');
}

function agentEventsLiveText(events: RunEvent[]): string {
  const lines = events
    .filter((event) => String(event.type || event.event || '').startsWith('agent_'))
    .slice(-80)
    .map((event) => {
      const type = String(event.type || event.event || 'agent_event');
      return `${type}`;
    })
    .filter(Boolean);
  return lines.length ? ['[agent events]', ...lines].join('\n') : '';
}

// ---------------------------------------------------------------------------
// AgentEventTimeline
// ---------------------------------------------------------------------------

function agentEventSummary(event: RunEvent): string {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const content = typeof (payload as any).content === 'string' ? (payload as any).content : '';
  if (content) {
    return content.length > 120 ? `${content.slice(0, 120)}...` : content;
  }
  return String(event.type || event.event || 'agent_event');
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
          </article>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// AssistantDrawer (right panel)
// ---------------------------------------------------------------------------

export function AssistantDrawer({
  width,
  input,
  messages,
  proposal,
  validation,
  temporaryResources,
  authoringAgents,
  selectedAuthoringAgentId,
  sessionId,
  agentSession,
  sessionStatus,
  pendingTurn,
  events,
  turnReason,
  requiredActions,
  graphOpsReview,
  busy,
  targetLabel,
  hasSelectedRunNode,
  onAgentChange,
  onTurnReasonChange,
  onInput,
  onSubmit,
  onApply,
  onDiscard,
  onPersistTemporaryResource,
  onApplyGraphOpsReview,
  onDiscardGraphOpsReview,
  onClose,
  onResize,
}: {
  width: number;
  input: string;
  messages: AssistantChatMessage[];
  proposal: CanvasAuthoringProposal | null;
  validation: CanvasAuthoringValidationResult | null;
  temporaryResources: Record<string, TemporaryResourceDraft>;
  authoringAgents: AuthoringAgentSummary[];
  selectedAuthoringAgentId: string;
  sessionId: string | null;
  agentSession: AgentSessionRecord | null;
  sessionStatus: string;
  pendingTurn: AgentTurnRecord | null;
  events: RunEvent[];
  turnReason: AssistantTurnReason;
  requiredActions: AuthoringRequiredAction[];
  graphOpsReview: AssistantGraphOpsReview | null;
  busy: boolean;
  targetLabel: string;
  hasSelectedRunNode: boolean;
  onAgentChange: (agentId: string) => void;
  onTurnReasonChange: (reason: AssistantTurnReason) => void;
  onInput: (value: string) => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
  onApply: () => void;
  onDiscard: () => void;
  onPersistTemporaryResource: (resourceDraftId: string) => void;
  onApplyGraphOpsReview: (review: AssistantGraphOpsReview) => void;
  onDiscardGraphOpsReview: () => void;
  onClose: () => void;
  onResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const validationErrors = validation?.errors || [];
  const validationWarnings = validation?.warnings || [];
  const temporaryDrafts = Object.values(temporaryResources).filter(
    (draft) => draft.status !== 'discarded',
  );
  const graphOpsDiff = graphOpsReview?.dryRun.semantic_diff || {};
  const graphOpsCreatedFiles =
    graphOpsStringList(graphOpsDiff.created_files).length > 0
      ? graphOpsStringList(graphOpsDiff.created_files)
      : graphOpsReview?.dryRun.target_paths || [];
  const graphOpsCreatedCallables = graphOpsStringList(graphOpsDiff.created_callable_ids);
  const graphOpsCreatedWorkflows = graphOpsStringList(graphOpsDiff.created_workflow_ids);
  const graphOpsWarnings = graphOpsStringList(graphOpsDiff.warnings);
  return (
    <div className="canvas-drawer canvas-drawer-right assistant-drawer" style={{ width }}>
      <div
        className="drawer-resize-handle"
        role="separator"
        aria-label="调整 AI 助手面板宽度"
        aria-orientation="vertical"
        onPointerDown={onResize}
      />
      <div className="drawer-title-row">
        <strong>AI 助手</strong>
        <button type="button" onClick={onClose}>
          收起
        </button>
      </div>
      <div className="assistant-drawer-body">
        <div className="assistant-target-row">
          <span>目标</span>
          <strong>{targetLabel}</strong>
          <small>{hasSelectedRunNode ? '已选中运行节点，可在 Inspector 进入节点会话' : '画布级 Copilot'}</small>
        </div>
        <div className="assistant-session-row">
          <label>
            <span>Agent</span>
            <select
              value={selectedAuthoringAgentId}
              onChange={(event) => onAgentChange(event.target.value)}
              disabled={busy}
            >
              {authoringAgents.length ? (
                authoringAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name || agent.id} · {agent.runtime}
                  </option>
                ))
              ) : (
                <option value="">未连接</option>
              )}
            </select>
          </label>
          <small>
            {sessionId ? `${sessionStatus} · ${sessionId}` : sessionStatus}
            {agentSession?.provider_session_id ? ` · provider ${agentSession.provider_session_id}` : ''}
          </small>
        </div>
        <form className="assistant-compose" onSubmit={onSubmit}>
          <div className="segmented-control compact-tabs" role="tablist" aria-label="AI assistant turn mode">
            <button
              type="button"
              className={turnReason === 'workbench_chat' ? 'active' : ''}
              onClick={() => onTurnReasonChange('workbench_chat')}
            >
              对话
            </button>
            <button
              type="button"
              className={turnReason === 'canvas_revision' ? 'active' : ''}
              onClick={() => onTurnReasonChange('canvas_revision')}
            >
              生成修改
            </button>
            <button
              type="button"
              className={turnReason === 'selected_node_revision' ? 'active' : ''}
              onClick={() => onTurnReasonChange('selected_node_revision')}
            >
              修订当前草稿
            </button>
          </div>
          <textarea
            value={input}
            onChange={(event) => onInput(event.target.value)}
            placeholder={
              turnReason === 'workbench_chat'
                ? '像 Codex CLI 一样和当前画布助手对话'
                : '描述要生成或调整的 workflow 草稿'
            }
            rows={4}
          />
          <button type="submit" className="primary-action" disabled={busy || Boolean(pendingTurn)}>
            {busy || pendingTurn ? '执行中...' : turnReason === 'workbench_chat' ? '发送' : '提交 turn'}
          </button>
        </form>
        {pendingTurn ? (
          <section className="assistant-proposal-panel" aria-label="AI assistant pending turn">
            <header>
              <span>Running turn</span>
              <strong>{pendingTurn.turn_id}</strong>
            </header>
            <p>{pendingTurn.reason || turnReason} · {pendingTurn.status || 'queued'}</p>
          </section>
        ) : null}
        <AssistantTurnList messages={messages} />
        <AgentEventTimeline events={events} maxEvents={4} />
        {proposal ? (
          <section className="assistant-proposal-panel" aria-label="CanvasAuthoringProposal">
            <header>
              <span>待应用草稿</span>
              <strong>{proposal.proposal_id}</strong>
            </header>
            <p>{proposal.rationale}</p>
            <ol>
              {proposal.operations.map((operation, index) => (
                <li key={`${operation.op}-${index}`}>{authoringOperationSummary(operation)}</li>
              ))}
            </ol>
            {validationErrors.length ? (
              <div className="assistant-validation invalid">
                {validationErrors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            ) : null}
            {validationWarnings.length ? (
              <div className="assistant-validation warning">
                {validationWarnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
            <details>
              <summary>JSON</summary>
              <pre>{JSON.stringify(proposal, null, 2)}</pre>
            </details>
            <div className="assistant-proposal-actions">
              <button type="button" onClick={onDiscard}>
                丢弃
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={onApply}
                disabled={validation?.status === 'invalid'}
              >
                应用到当前画布
              </button>
            </div>
          </section>
        ) : null}
        {temporaryDrafts.length ? (
          <section className="assistant-temp-list" aria-label="临时资源">
            <header>临时资源</header>
            {temporaryDrafts.map((draft) => (
              <article key={draft.draft_id}>
                <strong>{draft.agent_draft.name || draft.draft_id}</strong>
                <span>{draft.draft_id}</span>
                <small>不能 run/save</small>
              </article>
            ))}
          </section>
        ) : null}
        {requiredActions.length ? (
          <section className="assistant-required-actions" aria-label="Authoring required actions">
            <header>需要人工动作</header>
            {requiredActions.map((action, index) => (
              <article key={`${action.kind}-${index}`}>
                <strong>{authoringRequiredActionLabel(action.kind)}</strong>
                <span>{action.reason || action.prompt || action.resource_draft_id || 'Review required'}</span>
                {action.kind === 'approve_resource_persistence' && action.resource_draft_id ? (
                  <button
                    type="button"
                    className="secondary-action compact-action"
                    disabled={busy || !temporaryResources[action.resource_draft_id]}
                    onClick={() => onPersistTemporaryResource(String(action.resource_draft_id))}
                  >
                    保存为资源
                  </button>
                ) : null}
              </article>
            ))}
          </section>
        ) : null}
        {graphOpsReview ? (
          <section className="assistant-graphops-review" aria-label="GraphOps 持久化预览">
            <header>
              <span>GraphOps 持久化预览</span>
              <strong>{graphOpsReview.proposal.proposal_id}</strong>
            </header>
            <p>{graphOpsReview.proposal.rationale}</p>
            <div className="assistant-graphops-summary">
              <strong>将创建</strong>
              <ul>
                {graphOpsCreatedFiles.map((path: string) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
              {graphOpsCreatedCallables.length ? (
                <span>Callable: {graphOpsCreatedCallables.join(', ')}</span>
              ) : null}
              {graphOpsCreatedWorkflows.length ? (
                <span>Workflow: {graphOpsCreatedWorkflows.join(', ')}</span>
              ) : null}
              {graphOpsWarnings.length ? <span>Warning: {graphOpsWarnings.join('; ')}</span> : null}
            </div>
            <details>
              <summary>Semantic diff</summary>
              <pre>{JSON.stringify(graphOpsReview.dryRun.semantic_diff || graphOpsReview.dryRun, null, 2)}</pre>
            </details>
            <div className="assistant-proposal-actions">
              <button type="button" onClick={onDiscardGraphOpsReview} disabled={busy}>
                取消
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={() => onApplyGraphOpsReview(graphOpsReview)}
                disabled={busy}
              >
                批准并写入
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssistantControlRail
// ---------------------------------------------------------------------------

export function AssistantControlRail({
  modificationMode,
  canUndoApply,
  busy,
  pendingTurn,
  onModeChange,
  onUndoApply,
}: {
  modificationMode: boolean;
  canUndoApply: boolean;
  busy: boolean;
  pendingTurn: boolean;
  onModeChange: (modificationMode: boolean) => void;
  onUndoApply: () => void;
}) {
  return (
    <div className="assistant-control-rail" aria-label="AI 助手模式控制">
      <button
        type="button"
        className={!modificationMode ? 'active' : ''}
        onClick={() => onModeChange(false)}
      >
        对话模式
      </button>
      <button
        type="button"
        className={modificationMode ? 'active' : ''}
        onClick={() => onModeChange(true)}
      >
        修改模式
      </button>
      <button type="button" onClick={onUndoApply} disabled={!canUndoApply || busy || pendingTurn}>
        撤回节点
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssistantProposalSummary
// ---------------------------------------------------------------------------

export function AssistantProposalSummary({
  proposal,
  validationErrors,
  validationWarnings,
  temporaryDrafts,
  requiredActions,
  graphOpsReview,
  graphOpsCreatedFiles,
  graphOpsWarnings,
  busy,
  onDiscard,
  onPersistTemporaryResource,
  onApplyGraphOpsReview,
  onDiscardGraphOpsReview,
}: {
  proposal: CanvasAuthoringProposal | null;
  validationErrors: string[];
  validationWarnings: string[];
  temporaryDrafts: TemporaryResourceDraft[];
  requiredActions: AuthoringRequiredAction[];
  graphOpsReview: AssistantGraphOpsReview | null;
  graphOpsCreatedFiles: string[];
  graphOpsWarnings: string[];
  busy: boolean;
  onDiscard: () => void;
  onPersistTemporaryResource: (resourceDraftId: string) => void;
  onApplyGraphOpsReview: (review: AssistantGraphOpsReview) => void;
  onDiscardGraphOpsReview: () => void;
}) {
  if (!proposal && !temporaryDrafts.length && !requiredActions.length && !graphOpsReview) {
    return null;
  }
  return (
    <div className="assistant-bottom-proposal-stack">
      {proposal ? (
        <section className="assistant-proposal-panel compact" aria-label="CanvasAuthoringProposal">
          <header>
            <span>待应用草稿</span>
            <strong>{proposal.proposal_id}</strong>
          </header>
          <p>{proposal.rationale}</p>
          <ol>
            {proposal.operations.map((operation, index) => (
              <li key={`${operation.op}-${index}`}>{authoringOperationSummary(operation)}</li>
            ))}
          </ol>
          {validationErrors.length ? (
            <div className="assistant-validation invalid">
              {validationErrors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          ) : null}
          {validationWarnings.length ? (
            <div className="assistant-validation warning">
              {validationWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
          <button type="button" onClick={onDiscard}>
            丢弃草稿
          </button>
        </section>
      ) : null}
      {temporaryDrafts.length ? (
        <section className="assistant-temp-list compact" aria-label="临时资源">
          <header>临时资源</header>
          {temporaryDrafts.map((draft) => (
            <article key={draft.draft_id}>
              <strong>{draft.agent_draft.name || draft.draft_id}</strong>
              <span>{draft.draft_id}</span>
            </article>
          ))}
        </section>
      ) : null}
      {requiredActions.length ? (
        <section className="assistant-required-actions compact" aria-label="Authoring required actions">
          <header>需要人工动作</header>
          {requiredActions.map((action, index) => (
            <article key={`${action.kind}-${index}`}>
              <strong>{authoringRequiredActionLabel(action.kind)}</strong>
              <span>{action.reason || action.prompt || action.resource_draft_id || 'Review required'}</span>
              {action.kind === 'approve_resource_persistence' && action.resource_draft_id ? (
                <button
                  type="button"
                  className="secondary-action compact-action"
                  disabled={busy || !action.resource_draft_id}
                  onClick={() => onPersistTemporaryResource(String(action.resource_draft_id))}
                >
                  保存为资源
                </button>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      {graphOpsReview ? (
        <section className="assistant-graphops-review compact" aria-label="GraphOps 持久化预览">
          <header>
            <span>GraphOps 持久化预览</span>
            <strong>{graphOpsReview.proposal.proposal_id}</strong>
          </header>
          <ul>
            {graphOpsCreatedFiles.map((path: string) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
          {graphOpsWarnings.length ? <p>Warning: {graphOpsWarnings.join('; ')}</p> : null}
          <div className="assistant-proposal-actions">
            <button type="button" onClick={onDiscardGraphOpsReview} disabled={busy}>
              取消
            </button>
            <button
              type="button"
              className="primary-action"
              onClick={() => onApplyGraphOpsReview(graphOpsReview)}
              disabled={busy}
            >
              批准并写入
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectedNodeRuntimePane
// ---------------------------------------------------------------------------

function SelectionLiveOutput({ model }: { model: SelectedEntityDetailsModel }) {
  const combinedLog = combinedLogText(model.log);
  const agentEventLog = agentEventsLiveText(model.events);
  const visibleLog = [combinedLog || model.log.excerpt, agentEventLog].filter(Boolean).join('\n\n');
  return (
    <div className="selection-log-output selection-live-output assistant-runtime-content" role="log" aria-live="polite">
      {visibleLog.trim() ? <pre>{visibleLog}</pre> : <p className="empty-state">当前节点还没有实时输出。</p>}
    </div>
  );
}

function NodeOutputSchemaPane({ model }: { model: SelectedEntityDetailsModel }) {
  const nodeSettings = model.nodeSettings;
  const hasSchema = nodeSettings?.outputSchema && Object.keys(nodeSettings.outputSchema).length > 0;
  return (
    <div className="selection-log-output assistant-runtime-content">
      {hasSchema ? (
        <pre>{JSON.stringify(nodeSettings?.outputSchema, null, 2)}</pre>
      ) : (
        <p className="empty-state">当前节点没有定义 output schema。</p>
      )}
    </div>
  );
}

function NodeErrorPane({ model }: { model: SelectedEntityDetailsModel }) {
  const stderr = model.log.stderr;
  const hasError = model.status === 'failed' || model.status === 'crashed' || stderr;
  return (
    <div className="selection-log-output assistant-runtime-content">
      {hasError ? (
        <pre>{stderr || `status: ${model.status}`}</pre>
      ) : (
        <p className="empty-state">当前节点没有错误输出。</p>
      )}
    </div>
  );
}

export function SelectedNodeRuntimePane({ model }: { model: SelectedEntityDetailsModel }) {
  const [tab, setTab] = useState<'live' | 'schema' | 'error'>('live');

  useEffect(() => {
    setTab('live');
  }, [model.key]);

  if (!isNodeDetailModel(model)) {
    return (
      <section className="selected-node-runtime-pane" aria-label="选中节点输出">
        <header>
          <span>选中节点输出</span>
          <strong>未选择节点</strong>
        </header>
        <p className="empty-state">选择一个 Agent/Tool/Workflow 节点查看输出。</p>
      </section>
    );
  }

  return (
    <section className="selected-node-runtime-pane" aria-label="选中节点输出">
      <header>
        <div>
          <span>选中节点输出</span>
          <strong>{model.title}</strong>
        </div>
        <small className={`evidence-dock-status status-${model.status || 'not_run'}`}>
          {statusLabel(model.status || 'not_run')}
        </small>
      </header>
      <div className="selected-node-runtime-tabs" role="tablist" aria-label="选中节点输出视图">
        <button type="button" className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}>
          实时输出
        </button>
        <button type="button" className={tab === 'schema' ? 'active' : ''} onClick={() => setTab('schema')}>
          output schema
        </button>
        <button type="button" className={tab === 'error' ? 'active' : ''} onClick={() => setTab('error')}>
          error
        </button>
      </div>
      {tab === 'live' ? <SelectionLiveOutput model={model} /> : null}
      {tab === 'schema' ? <NodeOutputSchemaPane model={model} /> : null}
      {tab === 'error' ? <NodeErrorPane model={model} /> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// AssistantDockContent (bottom dock view)
// ---------------------------------------------------------------------------

export function AssistantDockContent({
  input,
  messages,
  proposal,
  validation,
  temporaryResources,
  authoringAgents,
  selectedAuthoringAgentId,
  sessionId,
  agentSession,
  sessionStatus,
  pendingTurn,
  liveState,
  turnReason,
  requiredActions,
  graphOpsReview,
  busy,
  targetLabel,
  hasSelectedRunNode,
  model,
  canUndoApply,
  LiveOutputViewerSlot,
  onAgentChange,
  onTurnReasonChange,
  onInput,
  onSubmit,
  onApply,
  onDiscard,
  onUndoApply,
  onPersistTemporaryResource,
  onApplyGraphOpsReview,
  onDiscardGraphOpsReview,
}: {
  input: string;
  messages: AssistantChatMessage[];
  proposal: CanvasAuthoringProposal | null;
  validation: CanvasAuthoringValidationResult | null;
  temporaryResources: Record<string, TemporaryResourceDraft>;
  authoringAgents: AuthoringAgentSummary[];
  selectedAuthoringAgentId: string;
  sessionId: string | null;
  agentSession: AgentSessionRecord | null;
  sessionStatus: string;
  pendingTurn: AgentTurnRecord | null;
  liveState: WorkbenchLiveStreamState;
  turnReason: AssistantTurnReason;
  requiredActions: AuthoringRequiredAction[];
  graphOpsReview: AssistantGraphOpsReview | null;
  busy: boolean;
  targetLabel: string;
  hasSelectedRunNode: boolean;
  model: SelectedEntityDetailsModel;
  canUndoApply: boolean;
  LiveOutputViewerSlot?: ReactNode;
  onAgentChange: (agentId: string) => void;
  onTurnReasonChange: (reason: AssistantTurnReason) => void;
  onInput: (value: string) => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
  onApply: () => void;
  onDiscard: () => void;
  onUndoApply: () => void;
  onPersistTemporaryResource: (resourceDraftId: string) => void;
  onApplyGraphOpsReview: (review: AssistantGraphOpsReview) => void;
  onDiscardGraphOpsReview: () => void;
}) {
  const modificationMode = turnReason !== 'workbench_chat';
  const validationErrors = validation?.errors || [];
  const validationWarnings = validation?.warnings || [];
  const temporaryDrafts = Object.values(temporaryResources).filter(
    (draft) => draft.status !== 'discarded',
  );
  const graphOpsDiff = graphOpsReview?.dryRun.semantic_diff || {};
  const graphOpsCreatedFiles =
    graphOpsStringList(graphOpsDiff.created_files).length > 0
      ? graphOpsStringList(graphOpsDiff.created_files)
      : graphOpsReview?.dryRun.target_paths || [];
  const graphOpsWarnings = graphOpsStringList(graphOpsDiff.warnings);
  const assistantEmptyText = modificationMode
    ? '描述要生成或调整的 workflow 草稿。'
    : '等待输入需求';

  return (
    <section className="assistant-bottom-dock-body" aria-label="AI 助手底部面板">
      <div className="assistant-bottom-chat">
        <header className="assistant-bottom-header">
          <div>
            <span>AI 助手</span>
            <strong>{targetLabel}</strong>
          </div>
          <div className="assistant-bottom-header-actions">
            <small>{hasSelectedRunNode ? '已聚焦选中节点' : '画布级对话'}</small>
            <AssistantControlRail
              modificationMode={modificationMode}
              canUndoApply={canUndoApply}
              busy={busy}
              pendingTurn={Boolean(pendingTurn)}
              onModeChange={(nextModificationMode) =>
                onTurnReasonChange(nextModificationMode ? 'canvas_revision' : 'workbench_chat')
              }
              onUndoApply={onUndoApply}
            />
          </div>
        </header>
        <div className="assistant-session-row compact assistant-session-strip">
          <label>
            <span>Agent</span>
            <select
              value={selectedAuthoringAgentId}
              onChange={(event) => onAgentChange(event.target.value)}
              disabled={busy}
            >
              {authoringAgents.length ? (
                authoringAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name || agent.id} · {agent.runtime}
                  </option>
                ))
              ) : (
                <option value="">未连接</option>
              )}
            </select>
          </label>
          <small>
            {sessionId ? `${sessionStatus} · ${sessionId}` : sessionStatus}
            {agentSession?.provider_session_id ? ` · provider ${agentSession.provider_session_id}` : ''}
          </small>
        </div>
        <AssistantTurnList
          messages={messages}
          className="assistant-bottom-messages"
          emptyText={assistantEmptyText}
        />
        {pendingTurn ? (
          <section className="assistant-proposal-panel compact" aria-label="AI assistant pending turn">
            <header>
              <span>Running turn</span>
              <strong>{pendingTurn.turn_id}</strong>
            </header>
            <p>{pendingTurn.reason || turnReason} · {pendingTurn.status || 'queued'}</p>
            {LiveOutputViewerSlot}
          </section>
        ) : null}
        <AssistantProposalSummary
          proposal={proposal}
          validationErrors={validationErrors}
          validationWarnings={validationWarnings}
          temporaryDrafts={temporaryDrafts}
          requiredActions={requiredActions}
          graphOpsReview={graphOpsReview}
          graphOpsCreatedFiles={graphOpsCreatedFiles}
          graphOpsWarnings={graphOpsWarnings}
          busy={busy}
          onDiscard={onDiscard}
          onPersistTemporaryResource={onPersistTemporaryResource}
          onApplyGraphOpsReview={onApplyGraphOpsReview}
          onDiscardGraphOpsReview={onDiscardGraphOpsReview}
        />
        <form className="assistant-compose assistant-bottom-compose" onSubmit={onSubmit}>
          <textarea
            value={input}
            onChange={(event) => onInput(event.target.value)}
            placeholder={
              modificationMode
                ? '描述要生成或调整的 workflow 草稿'
                : '像 Codex CLI 一样和当前画布助手对话'
            }
            rows={2}
          />
          <div className="assistant-compose-actions">
            {modificationMode && proposal ? (
              <button
                type="button"
                className="primary-action"
                onClick={onApply}
                disabled={busy || validation?.status === 'invalid'}
              >
                应用修改
              </button>
            ) : null}
            <button type="submit" className="secondary-action" disabled={busy || Boolean(pendingTurn)}>
              {busy || pendingTurn ? '执行中...' : modificationMode ? (proposal ? '继续微调' : '生成修改') : '发送'}
            </button>
          </div>
        </form>
      </div>
      <SelectedNodeRuntimePane model={model} />
    </section>
  );
}
