import { ArrowRight, Box } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { api } from '../api';
import type { WorkflowDetail, WorkflowSummary } from '../types';

type Props = {
  workflows: WorkflowSummary[];
  selectedWorkflowId: string;
  onSelect: (workflowId: string) => void;
};

export function WorkflowViewer({ workflows, selectedWorkflowId, onSelect }: Props) {
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);

  useEffect(() => {
    if (!selectedWorkflowId) {
      return;
    }
    let ignore = false;
    api.workflow(selectedWorkflowId).then((workflow) => {
      if (!ignore) {
        setDetail(workflow);
      }
    });
    return () => {
      ignore = true;
    };
  }, [selectedWorkflowId]);

  const tasks = detail?.workflow.tasks || [];
  const taskNames = useMemo(() => new Set(tasks.map((task) => task.name)), [tasks]);

  return (
    <section className="panel workflow-viewer" aria-label="Workflow Viewer">
      <header className="panel-header">
        <div>
          <h2>Workflow Viewer</h2>
          <p>{workflows.length} read-only workflow files</p>
        </div>
      </header>
      <div className="split compact">
        <div className="list-stack">
          {workflows.map((workflow) => (
            <button
              key={workflow.workflow_id}
              type="button"
              className={
                selectedWorkflowId === workflow.workflow_id ? 'list-item selected' : 'list-item'
              }
              onClick={() => onSelect(workflow.workflow_id)}
            >
              <strong>{workflow.workflow_id}</strong>
              <span>{workflow.path}</span>
              <small>{workflow.task_count} tasks</small>
            </button>
          ))}
        </div>
        {detail ? (
          <div className="detail-surface">
            <h3>{detail.workflow.name || detail.workflow_id}</h3>
            <p>{detail.workflow.description || 'No description'}</p>
            <div className="workflow-dag" aria-label="Workflow DAG">
              {tasks.map((task) => {
                const dependencies = task.depends_on || [];
                const capsuleId = findCapsuleId(task.command);
                const runDir = findRunDir(task.command);
                return (
                  <article key={task.name} className="workflow-node">
                    <header>
                      <Box aria-hidden="true" size={16} />
                      <strong>{task.name}</strong>
                      <span>{task.type || 'task'}</span>
                    </header>
                    {dependencies.length > 0 ? (
                      <p className="edge-line">
                        {dependencies.filter((dependency) => taskNames.has(dependency)).join(', ')}
                        <ArrowRight aria-hidden="true" size={14} />
                        {task.name}
                      </p>
                    ) : (
                      <p className="edge-line">Entry node</p>
                    )}
                    {capsuleId ? <p>Capsule: {capsuleId}</p> : null}
                    {runDir ? <p>Run dir: {runDir}</p> : null}
                  </article>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="empty-state">Select a workflow.</div>
        )}
      </div>
    </section>
  );
}

function findCapsuleId(command: unknown): string {
  if (!Array.isArray(command)) {
    return '';
  }
  const runIndex = command.lastIndexOf('run');
  const candidate = command[runIndex + 1];
  return typeof candidate === 'string' && candidate.includes('.') ? candidate : '';
}

function findRunDir(command: unknown): string {
  if (!Array.isArray(command)) {
    return '';
  }
  const optionIndex = command.findIndex((item) => item === '--run-dir');
  const candidate = command[optionIndex + 1];
  return typeof candidate === 'string' ? candidate : '';
}
