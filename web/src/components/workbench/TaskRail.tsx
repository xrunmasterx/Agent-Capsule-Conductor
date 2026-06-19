/**
 * TaskRail - left sidebar listing workbench tasks.
 *
 * Shows a vertical list of task cards. Each card can be selected
 * or deleted. A "new task" button sits at the top.
 */

import { Trash2 } from 'lucide-react';

export type WorkbenchTaskSummary = {
  taskId: string;
  title: string;
  status: string;
  activeRunId?: string;
  latestRunId?: string;
};

export function TaskRail({
  tasks,
  activeTaskId,
  onSelectTask,
  onNewTask,
  onDeleteTask,
}: {
  tasks: WorkbenchTaskSummary[];
  activeTaskId: string;
  onSelectTask: (taskId: string) => void;
  onNewTask: () => void;
  onDeleteTask: (taskId: string) => void;
}) {
  return (
    <aside className="task-rail" aria-label="任务列表">
      <button type="button" className="task-rail-new" onClick={onNewTask}>
        新建任务
      </button>
      {tasks.map((task) => (
        <article
          key={task.taskId}
          className={[
            'task-rail-item',
            task.taskId === activeTaskId ? 'active' : '',
            `status-${task.status}`,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <button type="button" className="task-rail-select" onClick={() => onSelectTask(task.taskId)}>
            <strong>{task.title}</strong>
            <small>{task.activeRunId || task.latestRunId || '未运行'}</small>
          </button>
          <button
            type="button"
            className="task-rail-delete"
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
    </aside>
  );
}
