import { shortPath } from '../format';
import type { WorkbenchLiveEvent } from '../types';

export type LiveOutputFilter = 'all' | 'logs' | 'stdout' | 'stderr' | 'errors' | 'raw';

export type AccTranscriptEntry = {
  id: string;
  type:
    | 'assistant_delta'
    | 'assistant_message'
    | 'thinking_delta'
    | 'status'
    | 'tool_start'
    | 'tool_result'
    | 'usage'
    | 'stdout'
    | 'stderr'
    | 'error'
    | 'gap'
    | 'terminal'
    | 'raw';
  stream: 'agent' | 'stdout' | 'stderr' | 'system' | 'raw';
  label: string;
  text: string;
  timestamp?: string;
  sourceEvent: WorkbenchLiveEvent;
};

export function buildAccTranscript(
  events: WorkbenchLiveEvent[],
  filter: LiveOutputFilter,
): AccTranscriptEntry[] {
  const entries: AccTranscriptEntry[] = [];
  for (const event of events) {
    const entry = transcriptEntryFromEvent(event, filter);
    if (!entry) {
      continue;
    }
    appendTranscriptEntry(entries, entry, event);
  }
  return entries;
}

export function isProviderRawFrame(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return false;
  }
  try {
    const payload = JSON.parse(trimmed) as { method?: unknown; jsonrpc?: unknown };
    const method = typeof payload.method === 'string' ? payload.method : '';
    return method.startsWith('item/') || method.startsWith('turn/') || method === 'codex/event' || payload.jsonrpc === '2.0';
  } catch {
    return false;
  }
}

function transcriptEntryFromEvent(
  event: WorkbenchLiveEvent,
  filter: LiveOutputFilter,
): AccTranscriptEntry | null {
  if (filter === 'raw') {
    return rawEntry(event);
  }
  if ((filter === 'stdout' || filter === 'stderr') && event.type === 'node_log_delta' && event.stream === filter) {
    return makeEntry(event, filter, filter, filter, liveEventText(event));
  }
  const semanticEntry = semanticEntryFromEvent(event);
  if (!semanticEntry) {
    return null;
  }
  if (filter === 'all') {
    return isSemanticOutput(semanticEntry) ? semanticEntry : null;
  }
  if (filter === 'logs') {
    return semanticEntry.type === 'stdout' || semanticEntry.type === 'stderr' ? semanticEntry : null;
  }
  if (filter === 'errors') {
    return semanticEntry.type === 'error' || semanticEntry.type === 'gap' || semanticEntry.text.toLowerCase().includes('error') ? semanticEntry : null;
  }
  return semanticEntry.stream === filter ? semanticEntry : null;
}

function semanticEntryFromEvent(event: WorkbenchLiveEvent): AccTranscriptEntry | null {
  const projectedEntry = semanticEntryFromProjection(event);
  if (projectedEntry !== undefined) {
    return projectedEntry;
  }
  const text = liveEventText(event);
  if (event.type === 'agent_message_delta') {
    return makeEntry(event, 'assistant_delta', 'agent', 'assistant', text);
  }
  if (event.type === 'agent_message') {
    return makeEntry(event, 'assistant_message', 'agent', 'assistant', text);
  }
  if (event.type === 'agent_tool_use') {
    return makeEntry(event, 'tool_start', 'agent', 'tool started', text);
  }
  if (event.type === 'agent_tool_result') {
    return makeEntry(event, 'tool_result', 'agent', 'tool result', text);
  }
  if (event.type === 'agent_usage') {
    return makeEntry(event, 'usage', 'agent', 'usage', text);
  }
  if (event.type === 'agent_status') {
    return makeEntry(event, 'status', 'agent', 'status', text);
  }
  if (event.type === 'gap') {
    return makeEntry(event, 'gap', 'system', 'gap', text || '实时流出现缺口，正在依赖运行证据恢复。');
  }
  if (event.type === 'terminal') {
    return makeEntry(event, 'terminal', 'system', 'terminal', text || 'terminal');
  }
  if (event.type === 'node_log_delta') {
    if (event.stream === 'stdout' && isProviderRawFrame(event.text || '')) {
      return null;
    }
    const stream = event.stream === 'stderr' ? 'stderr' : 'stdout';
    const type = stream === 'stderr' ? 'stderr' : 'stdout';
    return makeEntry(event, type, stream, stream, text);
  }
  if (String(event.type).includes('failed') || String(event.type).includes('error')) {
    return makeEntry(event, 'error', 'system', 'error', text);
  }
  return null;
}

function semanticEntryFromProjection(event: WorkbenchLiveEvent): AccTranscriptEntry | null | undefined {
  const projection = event.projection;
  if (!projection || projection.schema_version !== 'acc.transcript_projection.v1') {
    return undefined;
  }
  if (projection.visibility === 'hidden' || projection.visibility === 'technical') {
    return null;
  }
  const text = liveEventText(event);
  if (projection.category === 'assistant_text') {
    const type = event.type === 'agent_message' ? 'assistant_message' : 'assistant_delta';
    return makeEntry(event, type, 'agent', 'assistant', text);
  }
  if (projection.category === 'tool') {
    const type = projection.display_kind === 'tool_result' ? 'tool_result' : 'tool_start';
    const label = projection.display_kind === 'tool_result' ? 'tool result' : 'tool started';
    return makeEntry(event, type, 'agent', label, text);
  }
  if (projection.category === 'usage') {
    return makeEntry(event, 'usage', 'agent', 'usage', text);
  }
  if (projection.category === 'error' || projection.severity === 'error') {
    return makeEntry(event, 'error', 'system', 'error', text);
  }
  if (projection.category === 'artifact' || projection.category === 'proposal') {
    return makeEntry(event, 'status', 'agent', projection.category, text);
  }
  if (projection.category === 'approval' || projection.category === 'decision') {
    return makeEntry(event, 'status', 'agent', projection.category, text);
  }
  return makeEntry(event, 'status', 'agent', projection.category || 'status', text);
}

function appendTranscriptEntry(
  entries: AccTranscriptEntry[],
  entry: AccTranscriptEntry,
  event: WorkbenchLiveEvent,
) {
  const previous = entries[entries.length - 1];
  if (previous && canCoalesce(previous, entry, event)) {
    previous.text += entry.text;
    previous.timestamp = entry.timestamp || previous.timestamp;
    return;
  }
  entries.push(entry);
}

function canCoalesce(
  previous: AccTranscriptEntry,
  entry: AccTranscriptEntry,
  event: WorkbenchLiveEvent,
): boolean {
  if (previous.type !== entry.type || !['assistant_delta', 'thinking_delta'].includes(entry.type)) {
    return false;
  }
  const previousEvent = previous.sourceEvent;
  return (
    previousEvent.run_id === event.run_id &&
    previousEvent.node_id === event.node_id &&
    previousEvent.ui_node_id === event.ui_node_id &&
    previousEvent.turn_id === event.turn_id &&
    stringValue(previousEvent.payload?.item_id) === stringValue(event.payload?.item_id)
  );
}

function isSemanticOutput(entry: AccTranscriptEntry): boolean {
  return !['stdout', 'stderr', 'raw'].includes(entry.type);
}

function rawEntry(event: WorkbenchLiveEvent): AccTranscriptEntry {
  return makeEntry(event, 'raw', 'raw', String(event.type || 'raw'), JSON.stringify(event, null, 2));
}

function makeEntry(
  event: WorkbenchLiveEvent,
  type: AccTranscriptEntry['type'],
  stream: AccTranscriptEntry['stream'],
  label: string,
  text: string,
): AccTranscriptEntry {
  return {
    id: `${event.event_id || event.type}-${event.seq || 0}-${type}`,
    type,
    stream,
    label,
    text: limitText(text || label, 4000),
    timestamp: event.timestamp,
    sourceEvent: event,
  };
}

function liveEventText(event: WorkbenchLiveEvent): string {
  if (event.text) {
    return event.text;
  }
  const projectedSummary = stringValue(event.projection?.summary);
  if (projectedSummary) {
    return projectedSummary;
  }
  if (event.payload) {
    const content = stringValue(event.payload.content) || stringValue(event.payload.delta);
    if (content) {
      return assistantMessageDisplayContent(content);
    }
    const output = stringValue(event.payload.output) || stringValue(event.payload.result);
    if (output) {
      return output;
    }
    const input = stringValue(event.payload.input);
    if (input) {
      return input;
    }
    const outputPath = stringValue(event.payload.output_path);
    if (outputPath) {
      return shortPath(outputPath);
    }
    const status = stringValue(event.payload.status);
    if (status) {
      return status;
    }
    const error = stringValue(event.payload.error);
    if (error) {
      return error;
    }
  }
  return String(event.type || '');
}

function assistantMessageDisplayContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed === 'object' && parsed !== null) {
        const readable = parsed.summary || parsed.rationale || parsed.content || parsed.message;
        if (typeof readable === 'string') {
          return readable;
        }
      }
    } catch {
      // Plain text that only looks like JSON should remain readable.
    }
  }
  return trimmed;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function limitText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
