import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';

import { formatDuration, statusTone } from '../format';
import type { RunSummary } from '../types';

type Props = {
  runs: RunSummary[];
  selectedRunId: string;
  onSelect: (runId: string) => void;
};

export function RunList({ runs, selectedRunId, onSelect }: Props) {
  return (
    <section className="panel run-list" aria-label="运行记录">
      <header className="panel-header">
        <div>
          <h2>运行记录</h2>
          <p>{runs.length} 个已索引 Session</p>
        </div>
      </header>
      <div className="table">
        <div className="table-row table-head">
          <span>运行</span>
          <span>状态</span>
          <span>耗时</span>
          <span>失败</span>
        </div>
        {runs.map((run) => (
          <button
            key={run.run_id}
            type="button"
            className={selectedRunId === run.run_id ? 'table-row selected' : 'table-row'}
            onClick={() => onSelect(run.run_id)}
          >
            <span>
              <strong>{run.run_id}</strong>
              <small>{run.workflow_id || '单 Capsule Session'}</small>
            </span>
            <span className={`pill ${statusTone(run.status)}`}>
              {run.status === 'success' ? (
                <CheckCircle2 aria-hidden="true" size={14} />
              ) : (
                <AlertCircle aria-hidden="true" size={14} />
              )}
              {run.status}
            </span>
            <span className="muted with-icon">
              <Clock aria-hidden="true" size={14} />
              {formatDuration(run.duration_ms)}
            </span>
            <span>{run.failed_nodes.length}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
