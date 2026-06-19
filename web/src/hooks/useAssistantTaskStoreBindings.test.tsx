import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type {
  AgentSessionRecord,
  AgentTurnRecord,
  AuthoringAgentSummary,
  RunEvent,
} from '../types';
import type {
  AssistantChatMessage,
  AssistantGraphOpsReview,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
} from '../types/workbench';
import { useAssistantStore } from '../stores/assistantStore';
import {
  useAssistantTaskStoreBindings,
} from './useAssistantTaskStoreBindings';

function message(id = 'msg_1'): AssistantChatMessage {
  return {
    id,
    role: 'assistant',
    content: 'hello',
  };
}

function proposal(): CanvasAuthoringProposal {
  return {
    proposal_id: 'proposal_1',
    base_task_id: 'task_1',
    base_canvas_hash: 'hash_1',
    target: { kind: 'task_canvas', task_id: 'task_1' },
    rationale: 'test',
    operations: [],
  };
}

function validation(): CanvasAuthoringValidationResult {
  return {
    status: 'valid',
    errors: [],
    warnings: [],
  };
}

function agentSession(): AgentSessionRecord {
  return {
    session_id: 'session_1',
    status: 'running',
  } as AgentSessionRecord;
}

function agentTurn(): AgentTurnRecord {
  return {
    turn_id: 'turn_1',
    session_id: 'session_1',
    status: 'running',
  } as AgentTurnRecord;
}

function runEvent(): RunEvent {
  return {
    type: 'agent_message',
    run_id: 'run_1',
    node_id: 'node_1',
  };
}

function authoringAgent(id = 'agent_1'): AuthoringAgentSummary {
  return {
    id,
    version: '1.0.0',
    kind: 'agent_class',
    runtime: 'codex_cli',
    backend: 'codex',
    source_id: id,
    name: id,
    default_permissions: {},
  };
}

function graphOpsReview(): AssistantGraphOpsReview {
  return {
    resourceDraftId: 'draft_1',
    callableId: 'callable_1',
    proposal: {
      proposal_id: 'proposal_1',
      operations: [],
    },
    validation: {},
    dryRun: {},
  } as unknown as AssistantGraphOpsReview;
}

describe('useAssistantTaskStoreBindings', () => {
  beforeEach(() => {
    act(() => {
      useAssistantStore.setState(useAssistantStore.getInitialState(), true);
    });
  });

  afterEach(() => {
    act(() => {
      useAssistantStore.setState(useAssistantStore.getInitialState(), true);
    });
  });

  test('returns default task state when no assistant state exists yet', () => {
    const { result } = renderHook(() => useAssistantTaskStoreBindings('task_1'));

    expect(result.current.assistantTaskState).toMatchObject({
      assistantInput: '',
      assistantMessages: [],
      assistantProposal: null,
      assistantSessionId: null,
      assistantBusy: false,
      selectedAuthoringAgentId: '',
    });
  });

  test('updates global authoring agents with set-state semantics', () => {
    const { result } = renderHook(() => useAssistantTaskStoreBindings('task_1'));

    act(() => {
      result.current.setAuthoringAgents([authoringAgent('agent_1')]);
      result.current.setAuthoringAgents((current) => [...current, authoringAgent('agent_2')]);
    });

    expect(result.current.authoringAgents.map((agent) => agent.id)).toEqual(['agent_1', 'agent_2']);
  });

  test('updates assistant task state with value and updater callbacks', () => {
    const { result } = renderHook(() => useAssistantTaskStoreBindings('task_1'));

    act(() => {
      result.current.setAssistantInput('draft');
      result.current.setAssistantInput((current) => `${current} request`);
      result.current.setAssistantMessages([message('msg_1')]);
      result.current.setAssistantMessages((current) => [...current, message('msg_2')]);
      result.current.setAssistantProposal(proposal());
      result.current.setSelectedAuthoringAgentId('agent_1');
      result.current.setAssistantSessionId('session_1');
      result.current.setAssistantAgentSession(agentSession());
      result.current.setAssistantPendingTurn(agentTurn());
      result.current.setAssistantEvents([runEvent()]);
      result.current.setAssistantTurnReason('canvas_revision');
      result.current.setAssistantSessionStatus('running');
      result.current.setAssistantBackendValidation(validation());
      result.current.setAssistantRequiredActions([{ action_id: 'act_1', kind: 'confirm', label: 'Confirm' }]);
      result.current.setAssistantGraphOpsReview(graphOpsReview());
      result.current.setAssistantBusy(true);
      result.current.setAssistantApplyUndo({
        proposalId: 'proposal_1',
        taskId: 'task_1',
        beforeCanvas: { id: 'task_1', name: 'Task 1', rootWorkflowId: 'task_1', workflows: [], edges: [] },
        beforeTemporaryResources: {},
        beforeSelection: { type: 'task_canvas', taskId: 'task_1' },
        afterCanvasHash: 'hash_2',
        affectedSelection: { type: 'task_canvas', taskId: 'task_1' },
      });
    });

    expect(result.current.assistantTaskState).toMatchObject({
      assistantInput: 'draft request',
      assistantMessages: [{ id: 'msg_1' }, { id: 'msg_2' }],
      assistantProposal: { proposal_id: 'proposal_1' },
      selectedAuthoringAgentId: 'agent_1',
      assistantSessionId: 'session_1',
      assistantAgentSession: { session_id: 'session_1' },
      assistantPendingTurn: { turn_id: 'turn_1' },
      assistantEvents: [{ type: 'agent_message' }],
      assistantTurnReason: 'canvas_revision',
      assistantSessionStatus: 'running',
      assistantBackendValidation: { status: 'valid' },
      assistantRequiredActions: [{ action_id: 'act_1' }],
      assistantGraphOpsReview: { resourceDraftId: 'draft_1' },
      assistantBusy: true,
      assistantApplyUndo: { proposalId: 'proposal_1' },
    });
  });

  test('updates only the active task partition', () => {
    const { result, rerender } = renderHook(
      ({ taskId }) => useAssistantTaskStoreBindings(taskId),
      { initialProps: { taskId: 'task_1' } },
    );

    act(() => {
      result.current.setAssistantInput('task one');
    });

    rerender({ taskId: 'task_2' });

    act(() => {
      result.current.setAssistantInput('task two');
    });

    const state = useAssistantStore.getState();
    expect(state.assistantByTaskId.task_1.assistantInput).toBe('task one');
    expect(state.assistantByTaskId.task_2.assistantInput).toBe('task two');
  });
});
