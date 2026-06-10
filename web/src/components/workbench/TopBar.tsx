/**
 * TopBar - workbench header toolbar.
 *
 * Renders the canvas title, status subtitle, and action buttons
 * (new task, load demo, save, validate, run, auto-layout, toggles).
 */

import { Bot, Database, GitBranch, LayoutDashboard, Play, Save, TestTube } from 'lucide-react';

export function TopBar({
  title,
  subtitle,
  isRunning,
  onNew,
  onLoadDemo,
  onSave,
  onValidate,
  onRun,
  onAutoLayout,
  assistantOpen,
  onToggleAssistant,
  detailsOpen,
  onToggleDetails,
}: {
  title: string;
  subtitle: string;
  isRunning: boolean;
  onNew: () => void;
  onLoadDemo: () => void;
  onSave: () => void;
  onValidate: () => void;
  onRun: () => void;
  onAutoLayout: () => void;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}) {
  return (
    <header className="workbench-topbar">
      <div className="topbar-title">
        <span className="topbar-kicker">Workspace Canvas</span>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="toolbar-actions" aria-label="工作流工具栏">
        <button
          type="button"
          className={detailsOpen ? 'toggle-action active' : 'toggle-action'}
          onClick={onToggleDetails}
        >
          <Database aria-hidden="true" size={16} />
          运行详情
        </button>
        <button
          type="button"
          className={assistantOpen ? 'toggle-action active' : 'toggle-action'}
          onClick={onToggleAssistant}
        >
          <Bot aria-hidden="true" size={16} />
          AI 助手
        </button>
        <button type="button" onClick={onNew}>
          <GitBranch aria-hidden="true" size={16} />
          新建任务
        </button>
        <button type="button" onClick={onLoadDemo}>
          <LayoutDashboard aria-hidden="true" size={16} />
          加载示例
        </button>
        <button type="button" onClick={onSave} disabled={isRunning}>
          <Save aria-hidden="true" size={16} />
          保存任务为 Workflow
        </button>
        <button type="button" onClick={onValidate} disabled={isRunning}>
          <TestTube aria-hidden="true" size={16} />
          校验
        </button>
        <button type="button" className="primary-action topbar-run-action" onClick={onRun} disabled={isRunning}>
          <Play aria-hidden="true" size={16} />
          {isRunning ? '运行中...' : '运行'}
        </button>
        <button type="button" onClick={onAutoLayout}>
          <LayoutDashboard aria-hidden="true" size={16} />
          自动布局
        </button>
      </div>
    </header>
  );
}
