/**
 * SelectionDetailsDock - bottom evidence/assistant dock.
 *
 * Extracted from WorkflowViewer.tsx lines 8410-8490.
 * Renders the toggle footer bar and the dock body which switches between
 * evidence artifact display and the AI assistant content.
 */

import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { shortPath } from '../../format';
import { CodeBlock } from '../CodeBlock';
import type { ArtifactContent } from '../../types';

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
};

// ---------------------------------------------------------------------------
// Sub-component
// ---------------------------------------------------------------------------

function EvidenceDockArtifactContent({
  artifact,
  fallbackTitle,
}: {
  artifact: ArtifactContent | null;
  fallbackTitle: string;
}) {
  if (!artifact) {
    return (
      <section className="selection-details-empty" aria-label="证据摘要">
        <span>证据</span>
        <h3>{fallbackTitle}</h3>
        <p>当前没有打开的单文件证据。节点输入、输出和属性请双击节点在浮层中查看。</p>
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

// ---------------------------------------------------------------------------
// Shared evidence content filter
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SelectionDetailsDock({
  state,
  mode,
  message,
  model,
  currentTaskId,
  selectedRunId,
  onToggle,
  assistantContent,
}: {
  state: EvidenceDockState;
  mode: BottomDockMode;
  message: string;
  model: SelectionDetailsDockModel;
  currentTaskId?: string;
  selectedRunId?: string | null;
  onToggle: () => void;
  assistantContent: ReactNode;
}) {
  const openedArtifact = evidenceContentForCurrentSelection(state, {
    currentTaskId,
    selectedRunId,
  });
  const currentEvidenceTitle =
    mode === 'assistant' ? 'AI 助手' : openedArtifact?.name || state.title || '未打开证据';
  return (
    <footer className={state.open ? 'evidence-dock selection-details-dock open' : 'evidence-dock selection-details-dock'} aria-label="选中对象详情">
      <button type="button" className="evidence-dock-toggle selection-details-toggle" onClick={onToggle}>
        <span className={`evidence-dock-status status-${model.status || 'not_run'}`}>
          {statusLabel(model.status || 'not_run')}
        </span>
        <span className="selection-details-title">
          <strong>{mode === 'assistant' ? 'AI 助手' : model.title}</strong>
          <small>{mode === 'assistant' ? model.title : model.subtitle || model.scopeLabel}</small>
        </span>
        <span className="evidence-dock-message">{mode === 'assistant' ? '对话、修改与选中节点输出' : message}</span>
        <span className="evidence-dock-current">{currentEvidenceTitle}</span>
        {state.open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {state.open ? (
        <div className="selection-details-body">
          {mode === 'assistant' ? (
            assistantContent
          ) : (
            <EvidenceDockArtifactContent artifact={openedArtifact} fallbackTitle={state.title || currentEvidenceTitle} />
          )}
        </div>
      ) : null}
    </footer>
  );
}
