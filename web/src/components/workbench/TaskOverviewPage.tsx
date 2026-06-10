/**
 * TaskOverviewPage - task list + artifact channel overview.
 *
 * Displayed when the workspace switcher is set to "overview".
 * Shows a left-side list of tasks and a right-side artifact preview pane.
 */

import { FileText, Trash2 } from 'lucide-react';
import type { WorkbenchTaskSummary } from './TaskRail';

function TaskArtifactsPane({ task }: { task?: WorkbenchTaskSummary }) {
  return (
    <section className="task-artifacts-pane" aria-label="任务产物">
      <header>
        <span>ARTIFACT CHANNEL</span>
        <strong>{task?.title || 'No task selected'}</strong>
      </header>
      <div className="task-artifacts-empty">
        <FileText aria-hidden="true" size={28} />
        <p>Artifacts view is pending.</p>
        <small>Current task outputs, reports, and audit files will appear here.</small>
      </div>
    </section>
  );
}

export function TaskOverviewPage({
  tasks,
  activeTaskId,
  onSelectTask,
  onOpenBlueprint,
  onNewTask,
  onDeleteTask,
}: {
  tasks: WorkbenchTaskSummary[];
  activeTaskId: string;
  onSelectTask: (taskId: string) => void;
  onOpenBlueprint: () => void;
  onNewTask: () => void;
  onDeleteTask: (taskId: string) => void;
}) {
  const activeTask = tasks.find((task) => task.taskId === activeTaskId) || tasks[0];
  const openTaskBlueprint = (taskId: string) => {
    onSelectTask(taskId);
    onOpenBlueprint();
  };
  return (
    <section className="task-overview-page" aria-label="任务总览">
      <aside className="task-overview-list" aria-label="任务列表">
        <div className="task-overview-header">
          <span>MISSION QUEUE</span>
          <button type="button" onClick={onNewTask}>
            新建任务
          </button>
        </div>
        <div className="task-overview-items">
          {tasks.map((task) => (
            <article
              key={task.taskId}
              className={[
                'task-overview-item',
                task.taskId === activeTaskId ? 'active' : '',
                `status-${task.status}`,
              ]
                .filter(Boolean)
                .join(' ')}
              onDoubleClick={() => openTaskBlueprint(task.taskId)}
            >
              <button
                type="button"
                className="task-overview-select"
                aria-label={`选择任务 ${task.title}`}
                onClick={() => onSelectTask(task.taskId)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  openTaskBlueprint(task.taskId);
                }}
              >
                <strong>{task.title}</strong>
                <small>{task.activeRunId || task.latestRunId || 'Not run'}</small>
              </button>
              <button
                type="button"
                className="task-overview-delete"
                aria-label={`删除任务 ${task.title}`}
                title="删除任务"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteTask(task.taskId);
                }}
              >
                <Trash2 aria-hidden="true" size={15} />
              </button>
            </article>
          ))}
        </div>
      </aside>
      <TaskArtifactsPane task={activeTask} />
    </section>
  );
}
