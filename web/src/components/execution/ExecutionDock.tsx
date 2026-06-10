/**
 * ExecutionDock - run control panel.
 *
 * Extracted from WorkflowViewer.tsx lines 4686-4727.
 * A thin presentational toolbar that shows the runtime mode and
 * provides run-task / run-workflow / run-node buttons.
 */

import { Play } from 'lucide-react';
import type { RuntimeConfig } from '../../types';

export function ExecutionDock({
  isRunning,
  runtimeConfig,
  canRunWorkflow,
  canRunNode,
  onRunTask,
  onRunWorkflow,
  onRunNode,
}: {
  isRunning: boolean;
  runtimeConfig: RuntimeConfig | null;
  canRunWorkflow: boolean;
  canRunNode: boolean;
  onRunTask: () => void;
  onRunWorkflow: () => void;
  onRunNode: () => void;
}) {
  const modeLabel = runtimeConfig?.real_external_agents_enabled
    ? 'Production: real external agents'
    : runtimeConfig?.run_mode === 'production'
      ? 'Production gate disabled'
      : 'Hermetic: no external agents';
  return (
    <div className="execution-dock" aria-label="执行控制">
      <span className="runtime-mode-pill">{modeLabel}</span>
      <button type="button" className="primary-action run-task-action" onClick={onRunTask} disabled={isRunning}>
        <Play aria-hidden="true" size={18} />
        {isRunning ? '运行中...' : '运行当前任务'}
      </button>
      {canRunWorkflow ? (
        <button type="button" onClick={onRunWorkflow} disabled={isRunning}>
          只运行此 Workflow
        </button>
      ) : null}
      {canRunNode ? (
        <button type="button" onClick={onRunNode} disabled={isRunning}>
          只运行此 Agent/Tool
        </button>
      ) : null}
    </div>
  );
}
