import { describe, expect, it } from 'vitest';
import { buildAccTranscript, isProviderRawFrame } from './runTranscript';
import type { WorkbenchLiveEvent } from '../types';

function event(partial: Partial<WorkbenchLiveEvent>): WorkbenchLiveEvent {
  return {
    event_id: partial.event_id || `evt_${partial.seq || 1}`,
    seq: partial.seq || 1,
    source: partial.source || 'run_node',
    type: partial.type || 'agent_message_delta',
    stream: partial.stream || 'agent',
    timestamp: partial.timestamp || '2026-06-12T00:00:00Z',
    ...partial,
  };
}

describe('run transcript projection', () => {
  it('coalesces adjacent agent message deltas by turn and item', () => {
    const transcript = buildAccTranscript(
      [
        event({ seq: 1, text: '模', turn_id: 'turn_1', payload: { item_id: 'msg_1' } }),
        event({ seq: 2, text: '型', turn_id: 'turn_1', payload: { item_id: 'msg_1' } }),
      ],
      'all',
    );

    expect(transcript).toHaveLength(1);
    expect(transcript[0].type).toBe('assistant_delta');
    expect(transcript[0].text).toBe('模型');
  });

  it('keeps provider raw stdout out of the default semantic output', () => {
    const raw = '{"method":"item/agentMessage/delta","params":{"delta":"模"}}';
    const transcript = buildAccTranscript(
      [event({ seq: 1, type: 'node_log_delta', stream: 'stdout', text: raw })],
      'all',
    );

    expect(isProviderRawFrame(raw)).toBe(true);
    expect(transcript).toHaveLength(0);
    expect(buildAccTranscript([event({ seq: 1, type: 'node_log_delta', stream: 'stdout', text: raw })], 'raw')).toHaveLength(1);
  });

  it('keeps tool events separate from assistant text', () => {
    const transcript = buildAccTranscript(
      [
        event({ seq: 1, text: '分析', turn_id: 'turn_1', payload: { item_id: 'msg_1' } }),
        event({ seq: 2, type: 'agent_tool_use', payload: { tool: 'exec_command', input: 'date' } }),
        event({ seq: 3, text: '完成', turn_id: 'turn_1', payload: { item_id: 'msg_1' } }),
      ],
      'all',
    );

    expect(transcript.map((entry) => entry.type)).toEqual(['assistant_delta', 'tool_start', 'assistant_delta']);
    expect(transcript.map((entry) => entry.text)).toEqual(['分析', 'date', '完成']);
  });

  it('uses backend projection visibility before event type fallback', () => {
    const transcript = buildAccTranscript(
      [
        event({
          seq: 1,
          type: 'agent_status',
          payload: { status: 'running' },
          projection: {
            schema_version: 'acc.transcript_projection.v1',
            visibility: 'hidden',
            category: 'provider',
            severity: 'info',
            display_kind: 'status_pill',
          },
        }),
        event({
          seq: 2,
          type: 'agent_tool_use',
          payload: { tool: 'exec_command', input: 'date' },
          projection: {
            schema_version: 'acc.transcript_projection.v1',
            visibility: 'folded',
            category: 'tool',
            severity: 'info',
            display_kind: 'tool_call',
            summary: 'exec_command',
          },
        }),
        event({
          seq: 3,
          type: 'agent_turn_failed',
          payload: { error: 'bad output' },
          projection: {
            schema_version: 'acc.transcript_projection.v1',
            visibility: 'primary',
            category: 'error',
            severity: 'error',
            display_kind: 'error_message',
            summary: 'bad output',
          },
        }),
      ],
      'all',
    );

    expect(transcript.map((entry) => entry.type)).toEqual(['tool_start', 'error']);
    expect(transcript.map((entry) => entry.text)).toEqual(['exec_command', 'bad output']);
  });
});
