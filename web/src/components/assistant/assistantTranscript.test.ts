import { describe, expect, test } from 'vitest';

import type { AgentSessionRecord, AgentTurnRecord, RunEvent, WorkbenchLiveEvent } from '../../types';
import type { AssistantChatMessage, CanvasAuthoringValidationResult } from '../../types/workbench';
import type { WorkbenchLiveStreamState } from '../../hooks/useWorkbenchLiveStream';
import {
  assistantDisplayStatus,
  buildAssistantTranscriptItems,
  graphOpsStringList,
} from './assistantTranscript';

function liveState(events: WorkbenchLiveEvent[] = []): WorkbenchLiveStreamState {
  return { events, status: events.length ? 'live' : 'idle', error: '' };
}

function pendingTurn(overrides: Partial<AgentTurnRecord> = {}): AgentTurnRecord {
  return {
    turn_id: 'turn_1',
    session_id: 'session_1',
    status: 'running',
    reason: 'workbench_chat',
    ...overrides,
  } as AgentTurnRecord;
}

function message(overrides: Partial<AssistantChatMessage> = {}): AssistantChatMessage {
  return {
    id: 'msg_1',
    role: 'user',
    content: 'hello',
    turnId: 'turn_1',
    createdAt: '2026-06-19T00:00:00.000Z',
    ...overrides,
  };
}

function liveEvent(overrides: Partial<WorkbenchLiveEvent> = {}): WorkbenchLiveEvent {
  return {
    event_id: 'event_1',
    seq: 1,
    source: 'assistant_turn',
    session_id: 'session_1',
    turn_id: 'turn_1',
    type: 'agent_message_delta',
    text: 'partial',
    payload: {},
    timestamp: '2026-06-19T00:00:01.000Z',
    ...overrides,
  };
}

describe('assistantTranscript', () => {
  test('projects a pending turn stream without duplicating completed assistant messages', () => {
    const streamItems = buildAssistantTranscriptItems({
      messages: [message()],
      pendingTurn: pendingTurn(),
      assistantEvents: [],
      liveState: liveState([liveEvent({ text: 'draft ' }), liveEvent({ event_id: 'event_2', seq: 2, text: 'reply' })]),
      proposal: null,
      validation: null,
      graphOpsReview: null,
    });

    expect(streamItems).toContainEqual(
      expect.objectContaining({
        kind: 'assistant_stream',
        turnId: 'turn_1',
        content: 'draft reply',
      }),
    );

    const completedItems = buildAssistantTranscriptItems({
      messages: [message(), message({ id: 'msg_2', role: 'assistant', content: 'final', turnId: 'turn_1' })],
      pendingTurn: pendingTurn(),
      assistantEvents: [],
      liveState: liveState([liveEvent({ text: 'stale stream' })]),
      proposal: null,
      validation: null,
      graphOpsReview: null,
    });

    expect(completedItems.some((item) => item.kind === 'assistant_stream')).toBe(false);
    expect(completedItems.filter((item) => item.kind === 'assistant_message')).toHaveLength(1);
  });

  test('groups transcript-projected tool events and surfaces projected errors', () => {
    const items = buildAssistantTranscriptItems({
      messages: [],
      pendingTurn: null,
      assistantEvents: [],
      liveState: liveState([
        liveEvent({
          event_id: 'tool_1',
          seq: 1,
          type: 'agent_tool_use',
          projection: {
            schema_version: 'acc.transcript_projection.v1',
            visibility: 'primary',
            category: 'tool',
            display_kind: 'tool_call',
            summary: 'search filings',
          },
        }),
        liveEvent({
          event_id: 'err_1',
          seq: 2,
          type: 'agent_turn_failed',
          payload: { user_summary: 'tool failed', technical_detail: 'stack line' },
          projection: {
            schema_version: 'acc.transcript_projection.v1',
            visibility: 'primary',
            category: 'error',
            severity: 'error',
            summary: 'tool failed',
          },
        }),
      ]),
      proposal: null,
      validation: null,
      graphOpsReview: null,
    });

    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'process_group',
        turnId: 'turn_1',
        events: [expect.objectContaining({ detail: 'search filings' })],
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'error',
        content: 'tool failed',
        detail: 'stack line',
      }),
    );
  });

  test('adds validation diagnostics only when no proposal or GraphOps review owns the result block', () => {
    const validation: CanvasAuthoringValidationResult = {
      status: 'invalid',
      errors: ['missing target'],
      warnings: ['unused port'],
    };

    const diagnosticItems = buildAssistantTranscriptItems({
      messages: [],
      pendingTurn: null,
      assistantEvents: [],
      liveState: liveState(),
      proposal: null,
      validation,
      graphOpsReview: null,
    });

    expect(diagnosticItems).toContainEqual(expect.objectContaining({ kind: 'error', content: 'missing target' }));
    expect(diagnosticItems).toContainEqual(
      expect.objectContaining({ kind: 'status', label: 'Validation warning', detail: 'unused port' }),
    );

    const proposalItems = buildAssistantTranscriptItems({
      messages: [],
      pendingTurn: null,
      assistantEvents: [],
      liveState: liveState(),
      proposal: {
        proposal_id: 'proposal_1',
        base_task_id: 'task',
        base_canvas_hash: 'hash',
        target: { kind: 'task_canvas', task_id: 'task' },
        rationale: 'test',
        operations: [],
      },
      validation,
      graphOpsReview: null,
      hasResultBlock: true,
    });

    expect(proposalItems.some((item) => item.id.startsWith('validation_'))).toBe(false);
    expect(proposalItems).toContainEqual(expect.objectContaining({ kind: 'result_block' }));
  });

  test('derives assistant display status from pending and failed sessions', () => {
    expect(
      assistantDisplayStatus({
        sessionStatus: 'idle',
        busy: false,
        pendingTurn: pendingTurn({ status: 'queued' }),
      }),
    ).toMatchObject({ tone: 'queued', runningTurn: true, submissionBlocked: false });

    expect(
      assistantDisplayStatus({
        sessionStatus: 'failed',
        busy: false,
        pendingTurn: null,
        agentSession: {
          session_id: 'session_1',
          can_submit_next_turn: false,
          last_recoverability: 'blocked',
        } as AgentSessionRecord,
      }),
    ).toMatchObject({ tone: 'failed', lastFailed: true, submissionBlocked: true });
  });

  test('filters GraphOps semantic diff lists to strings only', () => {
    expect(graphOpsStringList(['a', 1, 'b', null])).toEqual(['a', 'b']);
    expect(graphOpsStringList({ value: 'a' })).toEqual([]);
  });
});
