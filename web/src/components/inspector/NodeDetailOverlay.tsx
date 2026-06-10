/**
 * NodeDetailOverlay - floating panel for detailed node inspection.
 *
 * Extracted from WorkflowViewer.tsx lines 8175-8262.
 * Renders three panes: input, properties, and output.
 *
 * NOTE: SelectionInputPane / SelectionPropertiesPane / SelectionOutputPane
 * remain inside WorkflowViewer.tsx and are passed as render props via the
 * `children` slot.  This file owns only the overlay chrome (header + close).
 */

import type { ReactNode } from 'react';

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
// Component
// ---------------------------------------------------------------------------

export type NodeDetailOverlayModel = {
  title: string;
  subtitle?: string;
  status: string;
};

export function NodeDetailOverlay({
  model,
  onClose,
  children,
}: {
  model: NodeDetailOverlayModel;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section className="node-detail-overlay" aria-label="节点详情浮层">
      <header className="node-detail-overlay-header">
        <div>
          <span className={`evidence-dock-status status-${model.status || 'not_run'}`}>
            {statusLabel(model.status || 'not_run')}
          </span>
          <div>
            <strong>{model.title}</strong>
            {model.subtitle ? <small>{model.subtitle}</small> : null}
          </div>
        </div>
        <button type="button" className="node-detail-close" aria-label="关闭节点详情" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="node-detail-overlay-body">{children}</div>
    </section>
  );
}
