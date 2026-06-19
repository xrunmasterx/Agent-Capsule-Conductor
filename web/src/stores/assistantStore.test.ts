import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  emptyAssistantTaskState,
  selectAssistantForTask,
  useAssistantStore,
  type AssistantChatMessage,
  type CanvasAuthoringProposal,
} from './assistantStore';
import type { AgentTurnRecord } from '../types';

function resetStore(): void {
  useAssistantStore.setState(useAssistantStore.getInitialState(), true);
}

function message(id: string, content: string): AssistantChatMessage {
  return { id, role: 'assistant', content };
}

function proposal(id: string, taskId: string): CanvasAuthoringProposal {
  return {
    proposal_id: id,
    base_task_id: taskId,
    base_canvas_hash: `${taskId}:hash`,
    target: { kind: 'task_canvas', task_id: taskId },
    rationale: 'test',
    operations: [],
  };
}

function pendingTurn(turnId: string, sessionId: string): AgentTurnRecord {
  return {
    turn_id: turnId,
    session_id: sessionId,
    status: 'running',
  } as AgentTurnRecord;
}

describe('assistantStore task ownership', () => {
  beforeEach(resetStore);

  test('keeps assistant proposals isolated per task', () => {
    useAssistantStore.getState().setAssistantProposal('task_a', proposal('proposal_a', 'task_a'));
    useAssistantStore.getState().setAssistantProposal('task_b', proposal('proposal_b', 'task_b'));

    const state = useAssistantStore.getState();
    expect(selectAssistantForTask(state, 'task_a').assistantProposal?.proposal_id).toBe('proposal_a');
    expect(selectAssistantForTask(state, 'task_b').assistantProposal?.proposal_id).toBe('proposal_b');
  });

  test('resets one task without clearing sibling assistant state', () => {
    useAssistantStore.getState().setAssistantMessages('task_a', [message('a', 'Task A')]);
    useAssistantStore.getState().setAssistantMessages('task_b', [message('b', 'Task B')]);
    useAssistantStore.getState().setAssistantBusy('task_a', true);

    useAssistantStore.getState().resetAssistantTask('task_a');
    const state = useAssistantStore.getState();

    expect(selectAssistantForTask(state, 'task_a')).toEqual(emptyAssistantTaskState());
    expect(selectAssistantForTask(state, 'task_b').assistantMessages).toEqual([message('b', 'Task B')]);
  });

  test('ignores stale turn completion with mismatched turn id', () => {
    useAssistantStore.getState().setAssistantSessionId('task_a', 'session_current');
    useAssistantStore.getState().setAssistantPendingTurn('task_a', pendingTurn('turn_current', 'session_current'));

    const applied = useAssistantStore.getState().applyTurnCompletion({
      taskId: 'task_a',
      sessionId: 'session_current',
      turnId: 'turn_old',
      proposal: proposal('proposal_old', 'task_a'),
      messages: [message('old', 'stale')],
      status: 'success',
    });
    const state = useAssistantStore.getState();

    expect(applied).toBe(false);
    expect(selectAssistantForTask(state, 'task_a').assistantProposal).toBeNull();
    expect(selectAssistantForTask(state, 'task_a').assistantMessages).toEqual([]);
  });

  test('applies matching turn completion to the requested task only', () => {
    useAssistantStore.getState().setAssistantSessionId('task_a', 'session_a');
    useAssistantStore.getState().setAssistantPendingTurn('task_a', pendingTurn('turn_a', 'session_a'));
    useAssistantStore.getState().setAssistantProposal('task_b', proposal('proposal_b', 'task_b'));

    const applied = useAssistantStore.getState().applyTurnCompletion({
      taskId: 'task_a',
      sessionId: 'session_a',
      turnId: 'turn_a',
      proposal: proposal('proposal_a', 'task_a'),
      messages: [message('a', 'complete')],
      status: 'success',
    });
    const state = useAssistantStore.getState();

    expect(applied).toBe(true);
    expect(selectAssistantForTask(state, 'task_a').assistantProposal?.proposal_id).toBe('proposal_a');
    expect(selectAssistantForTask(state, 'task_a').assistantMessages).toEqual([message('a', 'complete')]);
    expect(selectAssistantForTask(state, 'task_b').assistantProposal?.proposal_id).toBe('proposal_b');
  });

  test('does not import API, ReactFlow, or WorkflowViewer dependencies', () => {
    const source = readFileSync(join(process.cwd(), 'src/stores/assistantStore.ts'), 'utf8');
    expect(source).not.toContain('api.');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('@xyflow/react');
    expect(source).not.toContain('WorkflowViewer');
  });
});
