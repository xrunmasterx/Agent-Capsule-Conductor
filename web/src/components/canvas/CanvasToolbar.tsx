import { CircleDot, FileText, GitBranch, TestTube } from 'lucide-react';

import type { CallableSummary, WorkflowRunResult, WorkflowSummary } from '../../types';
import type { ConnectionMode, EdgeViewMode } from '../../types/workbench';
import { statusLabel } from '../../workbench/model/selectedNodeModel';
import type { PaletteItem } from '../workflow-viewer/palette';

export type ConnectPreviewState = {
  start: { x: number; y: number };
  end: { x: number; y: number };
  snapped?: boolean;
};

export function CanvasToolbar({
  connectionMode,
  edgeViewMode,
  focusedWorkflowId,
  workflowRun,
  onConnectionMode,
  onEdgeViewMode,
  onExitFocus,
}: {
  connectionMode: ConnectionMode;
  edgeViewMode: EdgeViewMode;
  focusedWorkflowId: string | null;
  workflowRun: WorkflowRunResult | null;
  onConnectionMode: (mode: ConnectionMode) => void;
  onEdgeViewMode: (mode: EdgeViewMode) => void;
  onExitFocus: () => void;
}) {
  return (
    <div className="canvas-toolbar" aria-label="Canvas Toolbar">
      <span className="toolbar-group-label">边语义</span>
      <span className="mode-pill control">控制边 = 调度顺序</span>
      <span className="mode-pill data">数据边 = 端口/Artifact 传递</span>
      <span
        className={`mode-pill ${connectionMode === 'data' ? 'data' : 'control'}`}
        title={connectionMode === 'data' ? '当前正在创建数据边' : '当前正在创建控制边'}
      >
        当前连线：{connectionMode === 'data' ? '数据' : '控制'}
      </span>
      <span title={workflowRun ? `runtime status: ${workflowRun.status}` : 'runtime status: not_run'}>
        状态：{workflowRun ? statusLabel(workflowRun.status) : '未运行'}
      </span>
      <div className="segmented-control compact" aria-label="连接模式">
        <button
          type="button"
          className={connectionMode === 'control' ? 'active' : ''}
          aria-label="连接模式：控制"
          onClick={() => onConnectionMode('control')}
        >
          连控制
        </button>
        <button
          type="button"
          className={connectionMode === 'data' ? 'active' : ''}
          aria-label="连接模式：数据"
          onClick={() => onConnectionMode('data')}
        >
          连数据
        </button>
      </div>
      <div className="segmented-control compact" aria-label="边显示模式">
        {(['control', 'data', 'all'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={edgeViewMode === mode ? 'active' : ''}
            aria-label={mode === 'all' ? '显示全部边' : mode === 'control' ? '显示控制边' : '显示数据边'}
            onClick={() => onEdgeViewMode(mode)}
          >
            {mode === 'all' ? '显全部' : mode === 'control' ? '显控制' : '显数据'}
          </button>
        ))}
      </div>
      {focusedWorkflowId ? (
        <button type="button" onClick={onExitFocus}>
          返回 Workspace
        </button>
      ) : null}
    </div>
  );
}

export function NodeCreateMenu({
  x,
  y,
  focused,
  workflows,
  callables,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  focused: boolean;
  workflows: WorkflowSummary[];
  callables: CallableSummary[];
  onPick: (item: PaletteItem) => void;
  onClose: () => void;
}) {
  const agentItems = callables.filter((callable) => callable.id !== 'file-source.local').slice(0, 8);
  const workflowItems = workflows.slice(0, 8);
  return (
    <div
      className="node-create-menu"
      style={{
        left: `clamp(12px, ${x}px, calc(100vw - 332px))`,
        top: `clamp(12px, ${y}px, calc(100vh - 492px))`,
      }}
      role="menu"
      aria-label="新增节点"
      onContextMenu={(event) => event.preventDefault()}
    >
      <header>
        <strong>{focused ? '新增 Agent / Tool' : '新增 Workflow'}</strong>
        <button type="button" onClick={onClose} aria-label="关闭新增菜单">
          ×
        </button>
      </header>
      {focused ? (
        <>
          {agentItems.map((callable) => (
            <button
              key={callable.id}
              type="button"
              role="menuitem"
              onClick={() =>
                onPick({ kind: 'agent', callableId: callable.id, label: callable.name || callable.id })
              }
            >
              <CircleDot size={14} aria-hidden="true" />
              <span>{callable.name || callable.id}</span>
              <small>{callable.id}</small>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => onPick({ kind: 'tool', callableId: 'fake-agent.generic', label: 'Generic Tool' })}
          >
            <TestTube size={14} aria-hidden="true" />
            <span>Generic Tool</span>
            <small>fake-agent.generic</small>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onPick({ kind: 'file_source', callableId: 'file-source.local', label: 'File Source' })}
          >
            <FileText size={14} aria-hidden="true" />
            <span>File Source</span>
            <small>file-source.local</small>
          </button>
        </>
      ) : (
        <>
          <button type="button" role="menuitem" onClick={() => onPick({ kind: 'workflow', label: 'New Workflow' })}>
            <GitBranch size={14} aria-hidden="true" />
            <span>New Workflow</span>
            <small>workflow template</small>
          </button>
          {workflowItems.map((workflow) => (
            <button
              key={workflow.workflow_id}
              type="button"
              role="menuitem"
              onClick={() =>
                onPick({
                  kind: 'workflow',
                  workflowRef: workflow.path,
                  label: workflow.name || workflow.workflow_id,
                })
              }
            >
              <GitBranch size={14} aria-hidden="true" />
              <span>{workflow.name || workflow.workflow_id}</span>
              <small>{workflow.path}</small>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

export function ConnectPreviewLine({ preview }: { preview: ConnectPreviewState }) {
  const controlOffset = Math.max(48, Math.abs(preview.end.x - preview.start.x) * 0.45);
  const path = [
    `M ${preview.start.x} ${preview.start.y}`,
    `C ${preview.start.x + controlOffset} ${preview.start.y}`,
    `${preview.end.x - controlOffset} ${preview.end.y}`,
    `${preview.end.x} ${preview.end.y}`,
  ].join(' ');
  return (
    <svg
      className={preview.snapped ? 'acc-connect-preview snapped' : 'acc-connect-preview'}
      aria-hidden="true"
      viewBox={viewportViewBox()}
    >
      <path d={path} />
    </svg>
  );
}

function viewportViewBox(): string {
  if (typeof window === 'undefined') {
    return '0 0 1 1';
  }
  return `0 0 ${Math.max(1, window.innerWidth)} ${Math.max(1, window.innerHeight)}`;
}
