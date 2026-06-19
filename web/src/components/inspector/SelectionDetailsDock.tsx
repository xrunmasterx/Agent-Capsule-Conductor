/**
 * SelectionDetailsDock - bottom evidence/assistant dock.
 */

import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { shortPath } from '../../format';
import type { ArtifactContent } from '../../types';
import type { SelectedDetailsEvidenceAction } from '../../types/workbench';
import { CodeBlock } from '../CodeBlock';

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

export type EvidenceDockState = {
  open: boolean;
  title: string;
  content: ArtifactContent | null;
  owner?: {
    kind: 'validation' | 'run' | 'node' | 'artifact';
    taskId?: string;
    runId?: string;
    nodeId?: string;
    createdAt?: string;
  };
};

export type BottomDockMode = 'evidence' | 'assistant';

export type SelectionDetailsDockModel = {
  title: string;
  subtitle?: string;
  scopeLabel?: string;
  status: string;
  evidenceActions?: SelectedDetailsEvidenceAction[];
};

function evidenceIdentityLabel(
  owner: EvidenceDockState['owner'],
  currentTaskId?: string,
  selectedRunId?: string | null,
): string {
  const parts: string[] = [];
  const taskId = owner?.taskId || currentTaskId;
  const runId = owner?.runId || selectedRunId || undefined;
  if (taskId) {
    parts.push(`task_id: ${taskId}`);
  }
  if (runId) {
    parts.push(`run_id: ${runId}`);
  }
  if (owner?.nodeId) {
    parts.push(`node_id: ${owner.nodeId}`);
  }
  return parts.join(' / ');
}

function EvidenceDockArtifactContent({
  artifact,
  fallbackTitle,
  identity,
  evidenceActions = [],
  onReadEvidence,
}: {
  artifact: ArtifactContent | null;
  fallbackTitle: string;
  identity?: string;
  evidenceActions?: SelectedDetailsEvidenceAction[];
  onReadEvidence?: (path: string | null | undefined, title?: string) => void;
}) {
  if (!artifact) {
    const hasEvidenceActions = evidenceActions.some((action) => action.path);
    return (
      <section className="selection-details-empty" aria-label="证据摘要">
        <span>Run evidence</span>
        <h3>{fallbackTitle || '没有 run evidence'}</h3>
        {identity ? <small className="evidence-identity-line">{identity}</small> : null}
        <p>
          {hasEvidenceActions
            ? '已找到当前选中对象的运行证据。打开下面的入口查看真实输入、输出、日志或 run summary。'
            : '没有 run evidence。Workbench 当前选择只是编辑投影，不代表已经产生运行事实。'}
        </p>
        <div className="evidence-entry-list" aria-label="运行证据入口">
          {hasEvidenceActions ? (
            evidenceActions.map((action) => (
              <button
                key={`${action.label}:${action.path || ''}`}
                type="button"
                className="evidence-path-button"
                disabled={!action.path}
                onClick={() => onReadEvidence?.(action.path, action.title)}
              >
                {action.label}
              </button>
            ))
          ) : (
            <>
              <span>Run summary</span>
              <span>Node input/output</span>
              <span>Logs</span>
              <span>Events</span>
              <span>Artifacts</span>
            </>
          )}
        </div>
      </section>
    );
  }
  return (
    <section className="evidence-artifact-pane" aria-label="证据内容">
      <header className="evidence-pane-header">
        <div>
          <span>证据</span>
          <h3>{artifact.name || fallbackTitle}</h3>
        </div>
        <small title={artifact.path}>{shortPath(artifact.path)}</small>
      </header>
      <CodeBlock title={artifact.path} content={artifact.content} variant={artifact.type} />
    </section>
  );
}

export function evidenceContentForCurrentSelection(
  state: EvidenceDockState,
  context: { currentTaskId?: string; selectedRunId?: string | null },
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
  if ((owner.kind === 'run' || owner.kind === 'node' || owner.kind === 'artifact') && owner.runId) {
    return owner.runId === context.selectedRunId ? state.content : null;
  }
  return state.content;
}

export function SelectionDetailsDock({
  state,
  mode,
  message,
  model,
  currentTaskId,
  selectedRunId,
  onToggle,
  onReadEvidence,
  assistantContent,
}: {
  state: EvidenceDockState;
  mode: BottomDockMode;
  message: string;
  model: SelectionDetailsDockModel;
  currentTaskId?: string;
  selectedRunId?: string | null;
  onToggle: () => void;
  onReadEvidence?: (path: string | null | undefined, title?: string) => void;
  assistantContent: ReactNode;
}) {
  const openedArtifact = evidenceContentForCurrentSelection(state, {
    currentTaskId,
    selectedRunId,
  });
  const evidenceActions = mode === 'assistant' ? [] : (model.evidenceActions || []).filter((action) => action.path);
  const hasEvidenceActions = evidenceActions.length > 0;
  const evidenceIdentity = mode === 'assistant' ? '' : evidenceIdentityLabel(state.owner, currentTaskId, selectedRunId);
  const currentEvidenceTitle =
    mode === 'assistant'
      ? 'AI Console'
      : openedArtifact
        ? openedArtifact.name || state.title || 'Run evidence'
        : hasEvidenceActions
          ? '运行证据可用'
          : '没有 run evidence';
  const currentEvidenceLabel = evidenceIdentity
    ? `${currentEvidenceTitle} / ${evidenceIdentity}`
    : currentEvidenceTitle;
  const bodyClassName =
    mode === 'assistant' ? 'selection-details-body assistant-console-body' : 'selection-details-body';
  return (
    <footer
      className={state.open ? 'evidence-dock selection-details-dock open' : 'evidence-dock selection-details-dock'}
      aria-label="选中对象详情"
    >
      <button type="button" className="evidence-dock-toggle selection-details-toggle" onClick={onToggle}>
        <span className={`evidence-dock-status status-${model.status || 'not_run'}`}>
          {statusLabel(model.status || 'not_run')}
        </span>
        <span className="selection-details-title">
          <strong>{mode === 'assistant' ? 'AI 助手' : model.title}</strong>
          <small>{mode === 'assistant' ? model.title : model.subtitle || model.scopeLabel}</small>
        </span>
        <span className="evidence-dock-message">{mode === 'assistant' ? 'AI Console' : message}</span>
        <span className="evidence-dock-current" title={evidenceIdentity || currentEvidenceTitle}>
          {currentEvidenceLabel}
        </span>
        {state.open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {state.open ? (
        <div className={bodyClassName}>
          {mode === 'assistant' ? (
            assistantContent
          ) : (
            <EvidenceDockArtifactContent
              artifact={openedArtifact}
              fallbackTitle={currentEvidenceTitle}
              identity={evidenceIdentity}
              evidenceActions={evidenceActions}
              onReadEvidence={onReadEvidence}
            />
          )}
        </div>
      ) : null}
    </footer>
  );
}
