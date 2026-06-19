import type { AgentClassDraft } from '../../types';
import type {
  CodexExecutionMode,
  EmptyInputPolicy,
  TemporaryResourceDraft,
  WorkbenchAuthoringState,
  WorkbenchTask,
  WorkbenchTaskStorePayload,
  WorkflowStatus,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { DEFAULT_TASK_ID } from '../constants';

export function emptyWorkbenchAuthoringState(): WorkbenchAuthoringState {
  return { temporaryResources: {} };
}

export function emptyWorkspaceCanvas(taskId = DEFAULT_TASK_ID, title = '任务 1'): WorkspaceCanvasModel {
  return {
    id: taskId,
    name: title,
    layout: 'workspace-canvas',
    rootWorkflowId: taskId,
    workflows: [],
    edges: [],
  };
}

export function createEmptyTask(taskId: string, title: string): WorkbenchTask {
  const canvas = emptyWorkspaceCanvas(taskId, title);
  return {
    taskId,
    title,
    canvas,
    authoring: emptyWorkbenchAuthoringState(),
    status: 'not_run',
  };
}

export function nextTaskTitle(tasks: WorkbenchTask[]): string {
  const used = new Set(tasks.map((task) => task.title));
  let index = tasks.length + 1;
  let title = `任务 ${index}`;
  while (used.has(title)) {
    index += 1;
    title = `任务 ${index}`;
  }
  return title;
}

export function defaultTaskStorePayload(): WorkbenchTaskStorePayload {
  const fallbackTask = createEmptyTask(DEFAULT_TASK_ID, '任务 1');
  return { version: 1, activeTaskId: fallbackTask.taskId, tasks: [fallbackTask] };
}

export function taskStorePayloadFromSerialized(stored: string | null | undefined): WorkbenchTaskStorePayload {
  const fallback = defaultTaskStorePayload();
  if (!stored) {
    return fallback;
  }
  try {
    const payload = JSON.parse(stored) as Partial<WorkbenchTaskStorePayload>;
    const tasks = Array.isArray(payload.tasks)
      ? payload.tasks.filter(isStoredWorkbenchTask).map(migrateStoredWorkbenchTask)
      : [];
    if (!tasks.length) {
      return fallback;
    }
    const activeTaskId =
      typeof payload.activeTaskId === 'string' &&
      tasks.some((task) => task.taskId === payload.activeTaskId)
        ? payload.activeTaskId
        : tasks[0].taskId;
    return { version: 1, activeTaskId, tasks };
  } catch {
    return fallback;
  }
}

export function isStoredWorkbenchTask(value: unknown): value is WorkbenchTask {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.taskId === 'string' &&
    typeof value.title === 'string' &&
    isRecord(value.canvas) &&
    typeof value.canvas.id === 'string' &&
    Array.isArray(value.canvas.workflows) &&
    Array.isArray(value.canvas.edges) &&
    ['not_run', 'queued', 'running', 'success', 'failed', 'cancel_requested', 'cancelled', 'crashed'].includes(
      String(value.status),
    )
  );
}

export function migrateStoredWorkbenchTask(task: WorkbenchTask): WorkbenchTask {
  const migratedTask = {
    ...task,
    authoring: normalizeWorkbenchAuthoringState(task.authoring),
  };
  if (task.latestRunId || !task.activeRunId) {
    return migratedTask;
  }
  return { ...migratedTask, latestRunId: task.activeRunId };
}

export function normalizeWorkbenchAuthoringState(value: unknown): WorkbenchAuthoringState {
  if (!isRecord(value) || !isRecord(value.temporaryResources)) {
    return emptyWorkbenchAuthoringState();
  }
  const temporaryResources: Record<string, TemporaryResourceDraft> = {};
  Object.entries(value.temporaryResources).forEach(([draftId, rawDraft]) => {
    if (!isRecord(rawDraft) || !isRecord(rawDraft.agent_draft)) {
      return;
    }
    const status = String(rawDraft.status || 'draft');
    temporaryResources[draftId] = {
      draft_id: typeof rawDraft.draft_id === 'string' ? rawDraft.draft_id : draftId,
      kind: 'agent_template',
      status:
        status === 'approved_for_canvas' || status === 'discarded' || status === 'draft'
          ? status
          : 'draft',
      agent_draft: rawDraft.agent_draft as AgentClassDraft,
      referenced_by: Array.isArray(rawDraft.referenced_by)
        ? rawDraft.referenced_by.map(String)
        : [],
    };
  });
  return { temporaryResources };
}

export function taskStatusFromRunStatus(status: string): WorkbenchTask['status'] {
  if (status === 'queued') {
    return 'queued';
  }
  if (status === 'success') {
    return 'success';
  }
  if (status === 'running' || status === 'scheduled') {
    return 'running';
  }
  if (status === 'cancel_requested') {
    return 'cancel_requested';
  }
  if (status === 'cancelled') {
    return 'cancelled';
  }
  if (status === 'crashed') {
    return 'crashed';
  }
  if (status === 'not_run') {
    return 'not_run';
  }
  return 'failed';
}

export function normalizeTaskRunStatus(status: string): WorkflowStatus {
  if (
    status === 'queued' ||
    status === 'running' ||
    status === 'scheduled' ||
    status === 'success' ||
    status === 'failed' ||
    status === 'cancel_requested' ||
    status === 'cancelled' ||
    status === 'crashed' ||
    status === 'not_run' ||
    status === 'schema_error' ||
    status === 'artifact_error' ||
    status === 'manual_review'
  ) {
    return status;
  }
  return status ? 'failed' : 'not_run';
}

export function isActiveRunStatus(status: string): boolean {
  return status === 'queued' || status === 'running' || status === 'scheduled' || status === 'cancel_requested';
}

export function isActiveTaskStatus(status: WorkbenchTask['status']): boolean {
  return status === 'queued' || status === 'running' || status === 'cancel_requested';
}

export function normalizedCodexExecutionMode(value: unknown): CodexExecutionMode {
  return value === 'local_readonly_no_sandbox' || value === 'danger_full_access'
    ? value
    : 'default';
}

export function emptyInputPolicyFromMetadata(value: unknown): EmptyInputPolicy {
  return value === 'block' ? 'block' : 'allow';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
