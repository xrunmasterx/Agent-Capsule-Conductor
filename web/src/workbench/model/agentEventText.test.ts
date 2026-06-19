import { describe, expect, test } from 'vitest';

import type { RunEvent } from '../../types';
import {
  agentEventsLiveText,
  agentMessagesToAssistantMessages,
  assistantMessageDisplayContent,
  failedAgentEventsText,
  liveOutputFilterLabel,
  mergeAgentEvents,
  transcriptEntryLabel,
} from './agentEventText';

describe('agentEventText', () => {
  test('summarizes structured assistant message content', () => {
    const content = JSON.stringify({
      assistant_message: '草稿已生成',
      proposal: {
        proposal_id: 'proposal_1',
        rationale: '基于当前画布补齐节点说明。',
      },
    });

    expect(assistantMessageDisplayContent(content)).toBe(
      '草稿已生成\nProposal: proposal_1\nRationale: 基于当前画布补齐节点说明。',
    );
    expect(assistantMessageDisplayContent('plain text')).toBe('plain text');
  });

  test('projects agent session messages into assistant chat messages', () => {
    const messages = agentMessagesToAssistantMessages([
      {
        role: 'assistant',
        content: '{"assistant_message":"ready"}',
        turn_id: 'turn_1',
        created_at: '2026-06-20T00:00:00Z',
      },
      {
        role: 'tool',
        content: 'tool output',
      },
      {
        role: 'assistant',
        content: '',
      },
    ]);

    expect(messages).toEqual([
      {
        id: 'turn_1_0',
        role: 'assistant',
        content: 'ready',
        turnId: 'turn_1',
        createdAt: '2026-06-20T00:00:00Z',
      },
      {
        id: 'assistant_msg_1',
        role: 'system',
        content: 'tool output',
        turnId: undefined,
        createdAt: undefined,
      },
    ]);
  });

  test('deduplicates and sorts agent events by stable event identity', () => {
    const base: RunEvent[] = [
      { event_id: 'event_2', type: 'agent_status', timestamp: '2026-06-20T00:00:02Z' },
    ];
    const incoming: RunEvent[] = [
      { event_id: 'event_1', type: 'agent_status', timestamp: '2026-06-20T00:00:01Z' },
      { event_id: 'event_2', type: 'agent_status', timestamp: '2026-06-20T00:00:03Z' },
    ];

    expect(mergeAgentEvents(base, incoming).map((event) => event.event_id)).toEqual(['event_1', 'event_2']);
  });

  test('formats live event text for drafts, failures, and web search status', () => {
    const events: RunEvent[] = [
      {
        type: 'agent_status',
        timestamp: '2026-06-20T00:00:00Z',
        payload: { item: { type: 'web_search_call', query: 'AAPL earnings' } },
      },
      {
        type: 'agent_output_draft',
        timestamp: '2026-06-20T00:00:01Z',
        payload: { output_path: 'C:/runs/run_1/nodes/agent_a/current_output.json' },
      },
      {
        type: 'agent_turn_failed',
        timestamp: '2026-06-20T00:00:02Z',
        status: 'failed',
        payload: { error: 'provider failed' },
      },
    ];

    expect(agentEventsLiveText(events)).toContain('搜索 AAPL earnings');
    expect(agentEventsLiveText(events)).toContain('草稿已生成 runs/run_1/nodes/agent_a/current_output.json');
    expect(failedAgentEventsText(events)).toContain('agent turn failed: provider failed');
  });

  test('formats live output filter and transcript labels', () => {
    expect(liveOutputFilterLabel('all')).toBe('输出');
    expect(liveOutputFilterLabel('errors')).toBe('错误');
    expect(
      transcriptEntryLabel({
        id: 'entry_1',
        type: 'stdout',
        timestamp: '2026-06-20T00:00:00Z',
        stream: 'stdout',
        label: 'agent',
        text: 'hello',
        sourceEvent: {
          event_id: 'event_1',
          seq: 1,
          source: 'run_node',
          timestamp: '2026-06-20T00:00:00Z',
          type: 'node_log_delta',
          payload: {},
        },
      }),
    ).toBe('00:00:00 / stdout / agent');
  });
});
