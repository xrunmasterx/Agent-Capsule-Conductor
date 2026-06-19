import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { shortPath } from '../../format';
import type { AgentSessionRecord, AgentTurnRecord, AuthoringAgentSummary, AuthoringRequiredAction, RunEvent } from '../../types';
import type {
  AssistantChatMessage,
  AssistantGraphOpsReview,
  AssistantTurnReason,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
  TemporaryResourceDraft,
} from '../../types/workbench';
import type { WorkbenchLiveStreamState } from '../../hooks/useWorkbenchLiveStream';
import { authoringOperationSummary } from '../../workbench/model/authoringProposal';
import {
  assistantDisplayStatus,
  buildAssistantTranscriptItems,
  graphOpsStringList,
  type AssistantDisplayStatus,
  type AssistantTranscriptItem,
} from './assistantTranscript';

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
        <div className="assistant-message-list" aria-label="AI 助手消息">
          {messages.length ? (
            messages.map((message) => (
              <article key={message.id} className={`assistant-message ${message.role}`}>
                <span>{message.role}</span>
                <p>{message.content}</p>
              </article>
            ))
          ) : (
            <p className="assistant-empty">等待输入需求</p>
          )}
        </div>
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
                {graphOpsCreatedFiles.map((path) => (
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
  assistantEvents,
  liveState,
  turnReason,
  requiredActions,
  graphOpsReview,
  busy,
  targetLabel,
  hasSelectedRunNode,
  canShowNodeContext,
  runtimePane,
  canUndoApply,
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
  assistantEvents: RunEvent[];
  liveState: WorkbenchLiveStreamState;
  turnReason: AssistantTurnReason;
  requiredActions: AuthoringRequiredAction[];
  graphOpsReview: AssistantGraphOpsReview | null;
  busy: boolean;
  targetLabel: string;
  hasSelectedRunNode: boolean;
  canShowNodeContext: boolean;
  runtimePane: ReactNode;
  canUndoApply: boolean;
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
  const [nodeContextOpen, setNodeContextOpen] = useState(false);
  const hasAssistantResult = Boolean(
    proposal || temporaryDrafts.length || requiredActions.length || graphOpsReview,
  );
  const displayStatus = assistantDisplayStatus({ sessionStatus, busy, pendingTurn, agentSession });
  const transcriptItems = useMemo(
    () =>
      buildAssistantTranscriptItems({
        messages,
        pendingTurn,
        assistantEvents,
        liveState,
        proposal,
        validation,
        graphOpsReview,
        hasResultBlock: hasAssistantResult,
        currentOutputTurnId:
          typeof agentSession?.current_output_turn_id === 'string'
            ? agentSession.current_output_turn_id
            : null,
      }),
    [
      agentSession?.current_output_turn_id,
      assistantEvents,
      graphOpsReview,
      hasAssistantResult,
      liveState,
      messages,
      pendingTurn,
      proposal,
      validation,
    ],
  );
  const assistantResultBlock = hasAssistantResult ? (
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
  ) : null;

  return (
    <section className="assistant-bottom-dock-body assistant-console" aria-label="AI 助手底部面板">
      <div className="assistant-console-main">
        <header className="assistant-console-header">
          <div>
            <span>AI Console</span>
            <strong>{targetLabel}</strong>
          </div>
          <div className="assistant-console-context" aria-label="当前上下文">
            <span className="assistant-context-chip">{modificationMode ? '修改模式' : '对话模式'}</span>
            <span className="assistant-context-chip">{hasSelectedRunNode ? '选中节点上下文' : '画布级上下文'}</span>
            <span className={`assistant-context-chip status-${displayStatus.tone || 'idle'}`}>
              {displayStatus.label}
            </span>
            {canShowNodeContext ? (
              <button
                type="button"
                className="assistant-context-chip button"
                onClick={() => setNodeContextOpen((current) => !current)}
                aria-expanded={nodeContextOpen}
              >
                {nodeContextOpen ? '收起节点输出' : '选中节点输出'}
              </button>
            ) : null}
          </div>
        </header>

        <details className="assistant-technical-details">
          <summary>技术详情</summary>
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
        </details>

        {nodeContextOpen && canShowNodeContext ? (
          <div className="assistant-context-panel">
            {runtimePane}
          </div>
        ) : null}

        <AssistantTranscriptView
          items={transcriptItems}
          emptyText={assistantEmptyText}
          resultBlock={assistantResultBlock}
        />

        <AssistantComposer
          input={input}
          modificationMode={modificationMode}
          displayStatus={displayStatus}
          proposalReady={Boolean(proposal)}
          canUndoApply={canUndoApply}
          validationStatus={validation?.status}
          onInput={onInput}
          onSubmit={onSubmit}
          onApply={onApply}
          onUndoApply={onUndoApply}
          onModeChange={(nextModificationMode) =>
            onTurnReasonChange(nextModificationMode ? 'canvas_revision' : 'workbench_chat')
          }
        />
      </div>
    </section>
  );
}

function AssistantTranscriptView({
  items,
  emptyText,
  resultBlock,
}: {
  items: AssistantTranscriptItem[];
  emptyText: string;
  resultBlock: ReactNode;
}) {
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const hasContent = items.length > 0;
  const latestContentSignature = useMemo(() => assistantTranscriptContentSignature(items), [items]);

  const scrollToBottom = useCallback(() => {
    const element = transcriptRef.current;
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
  }, [isPinnedToBottom, latestContentSignature, scrollToBottom]);

  const onScroll = useCallback(() => {
    const element = transcriptRef.current;
    if (!element) {
      return;
    }
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setIsPinnedToBottom(distanceFromBottom <= 48);
  }, []);

  const jumpToLatest = useCallback(() => {
    setIsPinnedToBottom(true);
    window.requestAnimationFrame(scrollToBottom);
  }, [scrollToBottom]);

  return (
    <section className="assistant-transcript-shell" aria-label="AI 助手对话时间线">
      <div
        ref={transcriptRef}
        className="assistant-transcript"
        role="log"
        aria-label="AI 助手消息"
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={onScroll}
      >
        {hasContent ? (
          <>
            {items.map((item) =>
              item.kind === 'result_block' ? (
                resultBlock ? (
                  <div key={item.id} className="assistant-transcript-result">
                    {resultBlock}
                  </div>
                ) : null
              ) : (
                <AssistantTranscriptEntry key={item.id} item={item} />
              ),
            )}
          </>
        ) : (
          <p className="assistant-empty">{emptyText}</p>
        )}
      </div>
      {hasContent && !isPinnedToBottom ? (
        <button type="button" className="assistant-transcript-jump" onClick={jumpToLatest}>
          跳到底部
        </button>
      ) : null}
    </section>
  );
}

function assistantTranscriptContentSignature(items: AssistantTranscriptItem[]): string {
  return items
    .map((item) => {
      if (item.kind === 'assistant_stream') {
        return `${item.id}:${item.content}:${item.status}`;
      }
      if (item.kind === 'assistant_message' || item.kind === 'user_message' || item.kind === 'error') {
        return `${item.id}:${item.content}`;
      }
      if (item.kind === 'process_group') {
        return `${item.id}:${item.events.map((event) => `${event.id}:${event.detail || ''}`).join(',')}`;
      }
      return item.id;
    })
    .join('|');
}

function AssistantTranscriptEntry({ item }: { item: AssistantTranscriptItem }) {
  if (item.kind === 'result_block') {
    return null;
  }
  if (item.kind === 'proposal' || item.kind === 'graphops_review') {
    return (
      <article className={`assistant-transcript-entry ${item.kind}`}>
        <span>{item.kind === 'proposal' ? 'proposal' : 'graphops'}</span>
        <p>{item.kind === 'proposal' ? `${item.proposalId || '草稿'} · ${item.status}` : item.status}</p>
      </article>
    );
  }
  if (item.kind === 'process_group') {
    return (
      <article className="assistant-transcript-entry process_group">
        <details className="assistant-process-group" {...(item.defaultOpen ? { open: true } : {})}>
          <summary>
            <span>过程</span>
            <strong>{item.label}</strong>
          </summary>
          <div className="assistant-process-events">
            {item.events.map((event) => (
              <div key={event.id} className="assistant-process-event">
                <span>{event.label}</span>
                {event.detail ? <p>{event.detail}</p> : null}
              </div>
            ))}
          </div>
        </details>
      </article>
    );
  }
  if (item.kind === 'status' || item.kind === 'tool_event') {
    return (
      <article className={`assistant-transcript-entry ${item.kind}`}>
        <span>{item.label}</span>
        {item.detail ? <p>{item.detail}</p> : null}
      </article>
    );
  }
  const roleLabel =
    item.kind === 'user_message'
      ? 'user'
      : item.kind === 'assistant_stream'
        ? `assistant · ${item.status}`
        : item.kind === 'error'
          ? 'assistant · failure'
          : 'assistant';
  return (
    <article
      className={`assistant-transcript-entry ${item.kind}`}
      role={item.kind === 'error' ? 'alert' : undefined}
      aria-live={item.kind === 'assistant_stream' ? 'polite' : undefined}
    >
      <span>{roleLabel}</span>
      <p>{item.content}</p>
      {item.kind === 'error' && item.detail ? (
        <details className="assistant-error-detail">
          <summary>技术细节</summary>
          <pre>{item.detail}</pre>
        </details>
      ) : null}
    </article>
  );
}

function AssistantComposer({
  input,
  modificationMode,
  displayStatus,
  proposalReady,
  canUndoApply,
  validationStatus,
  onInput,
  onSubmit,
  onApply,
  onUndoApply,
  onModeChange,
}: {
  input: string;
  modificationMode: boolean;
  displayStatus: AssistantDisplayStatus;
  proposalReady: boolean;
  canUndoApply: boolean;
  validationStatus?: CanvasAuthoringValidationResult['status'];
  onInput: (value: string) => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
  onApply: () => void;
  onUndoApply: () => void;
  onModeChange: (modificationMode: boolean) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const submitDisabled =
    displayStatus.connecting || displayStatus.runningTurn || displayStatus.submissionBlocked;
  const submitLabel = displayStatus.connecting
    ? '连接中...'
    : displayStatus.runningTurn
      ? '执行中...'
      : displayStatus.submissionBlocked
        ? '需处理'
      : modificationMode
        ? proposalReady
          ? '继续微调'
          : '生成修改'
        : '发送';

  const focusComposer = useCallback(() => {
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, []);

  const handleSubmit = useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      if (submitDisabled) {
        event?.preventDefault();
        return;
      }
      onSubmit(event);
      focusComposer();
    },
    [focusComposer, onSubmit, submitDisabled],
  );

  const submitFromKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };
      const isComposing = composingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229;
      if (event.key !== 'Enter' || event.shiftKey || isComposing) {
        return;
      }
      event.preventDefault();
      handleSubmit();
    },
    [handleSubmit],
  );

  return (
    <form className="assistant-compose assistant-console-compose" onSubmit={handleSubmit}>
      <div className="assistant-composer-toolbar">
        <div className="assistant-mode-segment" role="group" aria-label="AI 助手模式">
          <button
            type="button"
            className={!modificationMode ? 'active' : ''}
            aria-pressed={!modificationMode}
            onClick={() => onModeChange(false)}
          >
            对话模式
          </button>
          <button
            type="button"
            className={modificationMode ? 'active' : ''}
            aria-pressed={modificationMode}
            onClick={() => onModeChange(true)}
          >
            修改模式
          </button>
        </div>
        <button
          type="button"
          className="assistant-tertiary-action"
          onClick={onUndoApply}
          disabled={!canUndoApply || submitDisabled}
        >
          撤回节点
        </button>
      </div>
      <div className="assistant-console-input-row">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={submitFromKeyboard}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          placeholder={
            modificationMode
              ? '描述要生成或调整的 workflow 草稿'
              : '像 Codex CLI 一样和当前画布助手对话'
          }
          rows={2}
        />
        <div className="assistant-compose-actions">
          {modificationMode && proposalReady ? (
            <button
              type="button"
              className="primary-action"
              onClick={onApply}
              disabled={submitDisabled || validationStatus === 'invalid'}
            >
              应用修改
            </button>
          ) : null}
          <button type="submit" className="secondary-action" disabled={submitDisabled}>
            {submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

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
            {graphOpsCreatedFiles.map((path) => (
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


function AgentEventTimeline({ events, maxEvents = 12 }: { events: RunEvent[]; maxEvents?: number }) {
  const agentEvents = events.filter((event) => String(event.type || event.event || '').startsWith('agent_'));
  const visibleEvents = agentEvents.slice(-maxEvents).reverse();
  return (
    <section className="agent-session-subsection" aria-label="Agent timeline">
      <h5>Agent timeline</h5>
      {visibleEvents.length === 0 ? <p className="empty-state">?? agent ???</p> : null}
      <div className="event-timeline compact">
        {visibleEvents.map((event, index) => (
          <article key={String(event.event_id || event.type || event.event || 'agent_event') + '-' + index}>
            <strong>{String(event.type || event.event || 'agent_event')}</strong>
            <span>{agentEventSummary(event)}</span>
            <small>{event.timestamp || ''}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function authoringRequiredActionLabel(kind: string): string {
  if (kind === 'ask') {
    return '提问';
  }
  if (kind === 'confirm_canvas_apply') {
    return '确认应用';
  }
  if (kind === 'approve_resource_persistence') {
    return '审批资源持久化';
  }
  if (kind === 'reject_or_revise') {
    return '拒绝或修改';
  }
  return kind;
}

function agentEventSummary(event: RunEvent): string {
  const payload = event.payload && typeof event.payload === 'object' ? (event.payload as Record<string, unknown>) : {};
  const text =
    stringValue(payload.content) ||
    stringValue(payload.summary) ||
    stringValue(payload.message) ||
    stringValue(payload.error) ||
    stringValue(payload.name) ||
    stringValue(payload.tool) ||
    stringValue(payload.status) ||
    stringValue(payload.output_path);
  return text ? compactText(text.includes('/') || text.includes('\\') ? shortPath(text) : text) : String(event.status || 'canonical agent event');
}

function compactText(value: string): string {
  const text = value.replace(/\s+/gu, ' ').trim();
  return text.length > 420 ? text.slice(0, 420) + '...' : text || 'empty';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
