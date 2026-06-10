/**
 * TaskWorkspaceSwitcher - toggle between overview and blueprint views.
 */

import { GitBranch, LayoutDashboard } from 'lucide-react';

export type TaskWorkspaceView = 'overview' | 'blueprint';

export function TaskWorkspaceSwitcher({
  value,
  onChange,
}: {
  value: TaskWorkspaceView;
  onChange: (value: TaskWorkspaceView) => void;
}) {
  return (
    <div className="task-workspace-switcher" aria-label="Task workspace view">
      <button
        type="button"
        className={value === 'overview' ? 'active' : ''}
        onClick={() => onChange('overview')}
      >
        <LayoutDashboard aria-hidden="true" size={15} />
        任务总览
      </button>
      <button
        type="button"
        className={value === 'blueprint' ? 'active' : ''}
        onClick={() => onChange('blueprint')}
      >
        <GitBranch aria-hidden="true" size={15} />
        任务蓝图
      </button>
    </div>
  );
}
