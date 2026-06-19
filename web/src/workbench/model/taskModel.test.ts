import { describe, expect, test } from 'vitest';

import {
  createEmptyTask,
  defaultTaskStorePayload,
  emptyInputPolicyFromMetadata,
  emptyWorkspaceCanvas,
  isActiveRunStatus,
  isActiveTaskStatus,
  nextTaskTitle,
  normalizeTaskRunStatus,
  normalizeWorkbenchAuthoringState,
  normalizedCodexExecutionMode,
  taskStatusFromRunStatus,
  taskStorePayloadFromSerialized,
} from './taskModel';

describe('task model', () => {
  test('creates default task and canvas without demo content', () => {
    const canvas = emptyWorkspaceCanvas();
    const task = createEmptyTask('task_canvas_default', '任务 1');

    expect(canvas).toMatchObject({
      id: 'task_canvas_default',
      name: '任务 1',
      layout: 'workspace-canvas',
      rootWorkflowId: 'task_canvas_default',
    });
    expect(canvas.workflows).toEqual([]);
    expect(canvas.edges).toEqual([]);
    expect(task.authoring).toEqual({ temporaryResources: {} });
    expect(task.status).toBe('not_run');
  });

  test('generates the next unused task title', () => {
    expect(
      nextTaskTitle([
        createEmptyTask('task_1', '任务 1'),
        createEmptyTask('task_2', '任务 3'),
      ]),
    ).toBe('任务 4');
  });

  test('falls back from malformed stored payloads', () => {
    expect(taskStorePayloadFromSerialized('{bad json')).toEqual(defaultTaskStorePayload());
    expect(taskStorePayloadFromSerialized(JSON.stringify({ version: 1, tasks: [] }))).toEqual(
      defaultTaskStorePayload(),
    );
  });

  test('migrates legacy active run id to latest run id', () => {
    const legacyTask = createEmptyTask('legacy_task', 'Legacy');
    legacyTask.activeRunId = 'run_legacy';
    const payload = taskStorePayloadFromSerialized(
      JSON.stringify({
        version: 1,
        activeTaskId: 'missing_task',
        tasks: [legacyTask],
      }),
    );

    expect(payload.activeTaskId).toBe('legacy_task');
    expect(payload.tasks[0].latestRunId).toBe('run_legacy');
  });

  test('normalizes temporary resource authoring state', () => {
    expect(
      normalizeWorkbenchAuthoringState({
        temporaryResources: {
          draft_1: {
            status: 'unknown',
            agent_draft: { id: 'tmp_agent', version: '0.1.0' },
            referenced_by: ['node_a', 42],
          },
          invalid: { status: 'draft' },
        },
      }),
    ).toEqual({
      temporaryResources: {
        draft_1: {
          draft_id: 'draft_1',
          kind: 'agent_template',
          status: 'draft',
          agent_draft: { id: 'tmp_agent', version: '0.1.0' },
          referenced_by: ['node_a', '42'],
        },
      },
    });
  });

  test('maps run and task status consistently', () => {
    expect(taskStatusFromRunStatus('scheduled')).toBe('running');
    expect(taskStatusFromRunStatus('unknown')).toBe('failed');
    expect(normalizeTaskRunStatus('manual_review')).toBe('manual_review');
    expect(normalizeTaskRunStatus('unknown')).toBe('failed');
    expect(normalizeTaskRunStatus('')).toBe('not_run');
    expect(isActiveRunStatus('scheduled')).toBe(true);
    expect(isActiveTaskStatus('cancel_requested')).toBe(true);
    expect(isActiveTaskStatus('success')).toBe(false);
  });

  test('normalizes codex execution mode and empty input policy', () => {
    expect(normalizedCodexExecutionMode('danger_full_access')).toBe('danger_full_access');
    expect(normalizedCodexExecutionMode('invalid')).toBe('default');
    expect(emptyInputPolicyFromMetadata('block')).toBe('block');
    expect(emptyInputPolicyFromMetadata('allow')).toBe('allow');
  });
});
