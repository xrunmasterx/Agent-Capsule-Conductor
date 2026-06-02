import type { RunSummary } from '../types';
import { RunInspectorCore } from './RunInspector';
import { RunList } from './RunList';

type Props = {
  runs: RunSummary[];
  loadError?: string;
  selectedRunId: string;
  onSelectRun: (runId: string) => void;
};

export function RunMonitorPage({ runs, loadError = '', selectedRunId, onSelectRun }: Props) {
  const selectedRun = runs.find((run) => run.run_id === selectedRunId) || runs[0];
  return (
    <section className="run-monitor-stack">
      {loadError ? <div className="notice">运行记录加载失败：{loadError}</div> : null}
      <div className="split run-monitor-page">
        <RunList runs={runs} selectedRunId={selectedRun?.run_id || ''} onSelect={onSelectRun} />
        <RunInspectorCore runId={selectedRun?.run_id || ''} />
      </div>
    </section>
  );
}
