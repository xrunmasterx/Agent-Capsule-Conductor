import { shortPath } from '../../format';
import type { AgentSessionRecord, AgentTurnRecord, RunEvent, WorkbenchLiveEvent } from '../../types';
import type {
  AssistantChatMessage,
  AssistantGraphOpsReview,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
} from '../../types/workbench';
import {
  boundedLiveEvents,
  liveEventFromAgentRunEvent,
  type WorkbenchLiveStreamState,
} from '../../hooks/useWorkbenchLiveStream';

export type AssistantProcessEvent = {
  id: string;
  label: string;
  detail?: string;
  createdAt?: string;
};

export type AssistantTranscriptItem =
  | { kind: 'user_message'; id: string; content: string; turnId?: string; createdAt?: string }
  | { kind: 'assistant_message'; id: string; content: string; turnId?: string; createdAt?: string }
  | { kind: 'assistant_stream'; id: string; turnId: string; content: string; status: string }
  | { kind: 'status'; id: string; label: string; detail?: string; createdAt?: string }
  | { kind: 'tool_event'; id: string; label: string; detail?: string; createdAt?: string }
  | {
      kind: 'process_group';
      id: string;
      turnId: string;
      label: string;
      events: AssistantProcessEvent[];
      createdAt?: string;
      defaultOpen?: boolean;
    }
  | { kind: 'proposal'; id: string; proposalId?: string; status: 'draft' | 'valid' | 'invalid' }
  | { kind: 'graphops_review'; id: string; status: 'ready' | 'blocked' }
  | { kind: 'result_block'; id: string; createdAt?: string }
  | { kind: 'error'; id: string; content: string; detail?: string; createdAt?: string };

export type AssistantDisplayStatus = {
  label: string;
  tone: string;
  connecting: boolean;
  runningTurn: boolean;
  lastFailed: boolean;
  submissionBlocked: boolean;
};


export function graphOpsStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function buildAssistantTranscriptItems({
  messages,
  pendingTurn,
  assistantEvents,
  liveState,
  proposal,
  validation,
  graphOpsReview,
  hasResultBlock = false,
  currentOutputTurnId = null,
}: {
  messages: AssistantChatMessage[];
  pendingTurn: AgentTurnRecord | null;
  assistantEvents: RunEvent[];
  liveState: WorkbenchLiveStreamState;
  proposal: CanvasAuthoringProposal | null;
  validation: CanvasAuthoringValidationResult | null;
  graphOpsReview: AssistantGraphOpsReview | null;
  hasResultBlock?: boolean;
  currentOutputTurnId?: string | null;
}): AssistantTranscriptItem[] {
  const items: AssistantTranscriptItem[] = messages.map((message) => {
    const content =
      message.role === 'assistant' ? assistantMessageDisplayContent(message.content) : message.content;
    if (message.role === 'user') {
      return {
        kind: 'user_message',
        id: `message_${message.id}`,
        content,
        turnId: message.turnId,
        createdAt: message.createdAt,
      };
    }
    if (message.role === 'assistant') {
      return {
        kind: 'assistant_message',
        id: `message_${message.id}`,
        content,
        turnId: message.turnId,
        createdAt: message.createdAt,
      };
    }
    return {
      kind: 'error',
      id: `message_${message.id}`,
      content,
      createdAt: message.createdAt,
    };
  });
  const liveEvents = assistantTranscriptLiveEvents(assistantEvents, liveState.events);
  const pendingTurnId = pendingTurn?.turn_id || '';
  const assistantMessageTurnIds = new Set(
    messages
      .filter((message) => message.role === 'assistant' && message.turnId)
      .map((message) => message.turnId as string),
  );
  const streamText = pendingTurnId ? assistantStreamTextForTurn(liveEvents, pendingTurnId) : '';
  if (pendingTurn && streamText && !assistantMessageTurnIds.has(pendingTurn.turn_id)) {
    items.push({
      kind: 'assistant_stream',
      id: `stream_${pendingTurn.turn_id}`,
      turnId: pendingTurn.turn_id,
      content: streamText,
      status: pendingTurn.status || liveState.status || 'running',
    });
  }
  const processEventsByTurn = new Map<string, AssistantProcessEvent[]>();
  for (const event of liveEvents) {
    if (event.type === 'agent_message_delta' || event.type === 'agent_message') {
      continue;
    }
    const eventItem = assistantTranscriptItemFromLiveEvent(event);
    if (eventItem) {
      if (eventItem.kind === 'status' || eventItem.kind === 'tool_event') {
        const groupKey = assistantProcessGroupKey(event);
        const currentEvents = processEventsByTurn.get(groupKey) || [];
        currentEvents.push({
          id: eventItem.id,
          label: eventItem.label,
          detail: eventItem.detail,
          createdAt: eventItem.createdAt,
        });
        processEventsByTurn.set(groupKey, currentEvents);
      } else {
        items.push(eventItem);
      }
    }
  }
  for (const [turnId, processEvents] of processEventsByTurn) {
    items.push({
      kind: 'process_group',
      id: `process_${turnId}`,
      turnId,
      label: assistantProcessGroupLabel(processEvents, pendingTurnId === turnId),
      events: processEvents,
      createdAt: assistantProcessGroupTimestamp(processEvents),
      defaultOpen: false,
    });
  }
  if (!proposal && !graphOpsReview) {
    for (const error of validation?.errors || []) {
      items.push({ kind: 'error', id: `validation_error_${error}`, content: error });
    }
    for (const warning of validation?.warnings || []) {
      items.push({ kind: 'status', id: `validation_warning_${warning}`, label: 'Validation warning', detail: warning });
    }
  }
  if (hasResultBlock) {
    items.push({
      kind: 'result_block',
      id: assistantResultBlockId({ proposal, graphOpsReview, currentOutputTurnId }),
      createdAt: assistantResultBlockTimestamp(liveEvents, currentOutputTurnId),
    });
  }
  return sortAssistantTranscriptItems(dedupeAssistantTranscriptItems(items));
}

function assistantStreamTextForTurn(events: WorkbenchLiveEvent[], turnId: string): string {
  const turnMessageEvents = events.filter(
    (event) =>
      event.turn_id === turnId &&
      (event.type === 'agent_message_delta' || event.type === 'agent_message'),
  );
  const completedMessages = turnMessageEvents
    .filter((event) => event.type === 'agent_message')
    .map(assistantLiveEventText)
    .filter(Boolean)
    .map(assistantMessageDisplayContent);
  if (completedMessages.length > 0) {
    return completedMessages.join('\n').trim();
  }
  return turnMessageEvents
    .filter((event) => event.type === 'agent_message_delta')
    .map(assistantLiveEventText)
    .filter(Boolean)
    .join('')
    .trim();
}

function assistantTranscriptLiveEvents(
  assistantEvents: RunEvent[],
  liveEvents: WorkbenchLiveEvent[],
): WorkbenchLiveEvent[] {
  const refilled = assistantEvents.map((event, index) =>
    liveEventFromAgentRunEvent(event, index + 1, 'assistant_turn'),
  );
  return boundedLiveEvents(refilled, liveEvents);
}

function assistantTranscriptItemFromLiveEvent(event: WorkbenchLiveEvent): AssistantTranscriptItem | null {
  const id = `event_${event.event_id || event.seq || event.timestamp || event.type}`;
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const projection = supportedTranscriptProjection(event.projection);
  if (projection) {
    if (projection.visibility === 'hidden' || projection.visibility === 'technical') {
      return null;
    }
    const detail = compactText(
      stringValue(projection.summary) ||
        assistantLiveEventText(event) ||
        assistantLiveEventPayloadSummary(event.payload),
    );
    if (projection.category === 'error' || projection.severity === 'error') {
      const userSummary = compactText(stringValue(payload.user_summary));
      const technicalDetail = assistantFailureTechnicalDetail(payload);
      return {
        kind: 'error',
        id,
        content: userSummary || detail || 'AI 助手 turn 执行失败。',
        detail: technicalDetail,
        createdAt: event.timestamp,
      };
    }
    if (
      projection.category === 'tool' ||
      projection.category === 'artifact' ||
      projection.category === 'proposal' ||
      projection.category === 'approval' ||
      projection.category === 'decision'
    ) {
      return {
        kind: 'tool_event',
        id,
        label: assistantProjectionLabel(projection),
        detail,
        createdAt: event.timestamp,
      };
    }
    if (projection.category === 'status') {
      return {
        kind: 'status',
        id,
        label: assistantProjectionLabel(projection),
        detail,
        createdAt: event.timestamp,
      };
    }
    return null;
  }
  const rawType = assistantLiveEventRawType(event);
  const detail = assistantLiveEventText(event) || assistantLiveEventPayloadSummary(event.payload);
  if (rawType === 'agent_turn_failed') {
    const errorText = compactText(
      stringValue(payload.user_summary) ||
        stringValue(payload.error) ||
        stringValue(payload.message) ||
        detail,
    );
    return {
      kind: 'error',
      id,
      content: errorText || detail || 'AI 助手 turn 执行失败。',
      detail: assistantFailureTechnicalDetail(payload),
      createdAt: event.timestamp,
    };
  }
  if (event.type === 'gap') {
    return { kind: 'error', id, content: detail || '实时输出存在缺口，已回退到轮询刷新。', createdAt: event.timestamp };
  }
  if (
    event.type === 'agent_tool_use' ||
    event.type === 'agent_tool_result' ||
    event.type === 'artifact_ready' ||
    rawType === 'artifact_ready'
  ) {
    return {
      kind: 'tool_event',
      id,
      label: assistantLiveEventLabel(event),
      detail,
      createdAt: event.timestamp,
    };
  }
  return null;
}

function assistantProcessGroupKey(event: WorkbenchLiveEvent): string {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  return event.turn_id || stringValue(payload.acc_turn_id) || stringValue(payload.turn_id) || 'session';
}

function assistantProcessGroupLabel(events: AssistantProcessEvent[], isRunning: boolean): string {
  const hasDraft = events.some((event) => event.label === '生成草稿');
  const hasTool = events.some((event) => event.label === '调用工具' || event.label === '工具结果');
  if (isRunning) {
    return events.length ? `执行中 · ${events.length} 个过程事件` : '执行中';
  }
  if (hasDraft) {
    return events.length > 1 ? `生成草稿 · ${events.length} 个过程事件` : '生成草稿';
  }
  if (hasTool) {
    return events.length > 1 ? `工具调用 · ${events.length} 个过程事件` : '工具调用';
  }
  return events.length > 1 ? `过程详情 · ${events.length} 条` : '过程详情';
}

function assistantProcessGroupTimestamp(events: AssistantProcessEvent[]): string | undefined {
  let first: { timestamp: string; time: number } | null = null;
  for (const event of events) {
    if (!event.createdAt) {
      continue;
    }
    const time = Date.parse(event.createdAt);
    if (!Number.isFinite(time)) {
      continue;
    }
    if (!first || time < first.time) {
      first = { timestamp: event.createdAt, time };
    }
  }
  return first?.timestamp;
}

function supportedTranscriptProjection(
  projection: WorkbenchLiveEvent['projection'],
): WorkbenchLiveEvent['projection'] | null {
  return projection?.schema_version === 'acc.transcript_projection.v1' ? projection : null;
}

function assistantProjectionLabel(projection: NonNullable<WorkbenchLiveEvent['projection']>): string {
  if (projection.display_kind === 'tool_call') {
    return '调用工具';
  }
  if (projection.display_kind === 'tool_result') {
    return '工具结果';
  }
  if (projection.category === 'artifact' || projection.category === 'proposal') {
    return '生成草稿';
  }
  if (projection.category === 'approval') {
    return '等待批准';
  }
  if (projection.category === 'decision') {
    return '审批结果';
  }
  return projection.category === 'status' ? '状态' : projection.category || '状态';
}

function assistantResultBlockId({
  proposal,
  graphOpsReview,
  currentOutputTurnId,
}: {
  proposal: CanvasAuthoringProposal | null;
  graphOpsReview: AssistantGraphOpsReview | null;
  currentOutputTurnId?: string | null;
}): string {
  if (graphOpsReview?.proposal.proposal_id) {
    return `assistant_result_graphops_${graphOpsReview.proposal.proposal_id}`;
  }
  if (proposal?.proposal_id) {
    return `assistant_result_proposal_${proposal.proposal_id}`;
  }
  if (currentOutputTurnId) {
    return `assistant_result_turn_${currentOutputTurnId}`;
  }
  return 'assistant_result_current';
}

function assistantResultBlockTimestamp(
  events: WorkbenchLiveEvent[],
  currentOutputTurnId?: string | null,
): string | undefined {
  const relatedEvents = events.filter((event) => {
    const rawType = assistantLiveEventRawType(event);
    const isResultEvent =
      rawType === 'agent_output_draft' ||
      rawType === 'agent_output_published' ||
      rawType === 'artifact_ready';
    if (!isResultEvent) {
      return false;
    }
    return currentOutputTurnId ? event.turn_id === currentOutputTurnId : true;
  });
  return latestWorkbenchEventTimestamp(relatedEvents);
}

function latestWorkbenchEventTimestamp(events: WorkbenchLiveEvent[]): string | undefined {
  let latest: { timestamp: string; time: number } | null = null;
  for (const event of events) {
    const time = Date.parse(event.timestamp);
    if (!Number.isFinite(time)) {
      continue;
    }
    if (!latest || time > latest.time) {
      latest = { timestamp: event.timestamp, time };
    }
  }
  return latest?.timestamp;
}

function assistantLiveEventRawType(event: WorkbenchLiveEvent): string {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  return stringValue(payload.event_type) || event.type;
}

function assistantLiveEventLabel(event: WorkbenchLiveEvent): string {
  const rawType = assistantLiveEventRawType(event);
  if (event.type === 'agent_tool_use') {
    return '调用工具';
  }
  if (event.type === 'agent_tool_result') {
    return '工具结果';
  }
  if (event.type === 'artifact_ready' || rawType === 'artifact_ready') {
    return '生成草稿';
  }
  if (event.type === 'agent_usage') {
    return '用量';
  }
  if (event.type === 'agent_status') {
    return '状态';
  }
  return event.type;
}

function assistantLiveEventText(event: WorkbenchLiveEvent): string {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  return (
    event.text ||
    stringValue(payload.error) ||
    stringValue(payload.content) ||
    stringValue(payload.delta) ||
    stringValue(payload.message) ||
    stringValue(payload.summary) ||
    stringValue(payload.name) ||
    stringValue(payload.tool) ||
    stringValue(payload.status)
  );
}

function assistantLiveEventPayloadSummary(payload: Record<string, unknown> | undefined): string {
  if (!payload) {
    return '';
  }
  const summary =
    stringValue(payload.error) ||
    stringValue(payload.summary) ||
    stringValue(payload.message) ||
    stringValue(payload.status);
  if (summary) {
    return summary;
  }
  const outputPath = stringValue(payload.output_path) || stringValue(payload.path);
  return outputPath ? shortPath(outputPath) : '';
}

function assistantFailureTechnicalDetail(payload: Record<string, unknown>): string {
  const details = [
    stringValue(payload.technical_detail),
    stringValue(payload.error),
    stringValue(payload.raw_error_ref),
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  return details.join('\n');
}

function dedupeAssistantTranscriptItems(items: AssistantTranscriptItem[]): AssistantTranscriptItem[] {
  const seen = new Set<string>();
  const result: AssistantTranscriptItem[] = [];
  for (const item of items) {
    const key = assistantTranscriptDedupeKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function assistantTranscriptDedupeKey(item: AssistantTranscriptItem): string {
  if (item.kind === 'assistant_stream') {
    return `assistant_stream_${item.turnId}`;
  }
  if (
    (item.kind === 'assistant_message' || item.kind === 'user_message') &&
    item.turnId &&
    item.content
  ) {
    return `${item.kind}_${item.turnId}_${item.content}`;
  }
  return item.id;
}

function sortAssistantTranscriptItems(items: AssistantTranscriptItem[]): AssistantTranscriptItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftTime = assistantTranscriptItemTime(left.item);
      const rightTime = assistantTranscriptItemTime(right.item);
      if (leftTime === rightTime) {
        if (leftTime === null) {
          const leftRank = assistantUntimedItemRank(left.item);
          const rightRank = assistantUntimedItemRank(right.item);
          if (leftRank !== rightRank) {
            return leftRank - rightRank;
          }
        }
        return left.index - right.index;
      }
      if (leftTime === null) {
        return 1;
      }
      if (rightTime === null) {
        return -1;
      }
      return leftTime - rightTime;
    })
    .map(({ item }) => item);
}

function assistantUntimedItemRank(item: AssistantTranscriptItem): number {
  if (item.kind === 'result_block' || item.kind === 'proposal' || item.kind === 'graphops_review') {
    return 1;
  }
  if (
    item.kind === 'status' ||
    item.kind === 'tool_event' ||
    item.kind === 'process_group' ||
    item.kind === 'error'
  ) {
    return 2;
  }
  return 3;
}

function assistantTranscriptItemTime(item: AssistantTranscriptItem): number | null {
  const createdAt =
    'createdAt' in item && typeof item.createdAt === 'string' ? Date.parse(item.createdAt) : NaN;
  return Number.isFinite(createdAt) ? createdAt : null;
}

export function assistantDisplayStatus({
  sessionStatus,
  busy,
  pendingTurn,
  agentSession,
}: {
  sessionStatus: string;
  busy: boolean;
  pendingTurn: AgentTurnRecord | null;
  agentSession?: AgentSessionRecord | null;
}): AssistantDisplayStatus {
  const pendingStatus = String(pendingTurn?.status || '');
  if (pendingTurn && (!pendingStatus || pendingStatus === 'queued' || pendingStatus === 'running')) {
    return {
      label: pendingStatus === 'queued' ? '排队中' : '执行中',
      tone: pendingStatus || 'running',
      connecting: false,
      runningTurn: true,
      lastFailed: false,
      submissionBlocked: false,
    };
  }
  if (
    busy &&
    !pendingTurn &&
    (!sessionStatus ||
      sessionStatus === 'idle' ||
      sessionStatus === 'creating' ||
      sessionStatus === 'connecting' ||
      sessionStatus === 'loading')
  ) {
    return {
      label: '连接中',
      tone: 'connecting',
      connecting: true,
      runningTurn: false,
      lastFailed: false,
      submissionBlocked: false,
    };
  }
  if (busy && !pendingTurn && sessionStatus !== 'failed') {
    return {
      label: '执行中',
      tone: 'running',
      connecting: false,
      runningTurn: true,
      lastFailed: false,
      submissionBlocked: false,
    };
  }
  if (sessionStatus === 'failed') {
    const canSubmitNextTurn = agentSession?.can_submit_next_turn;
    const recoverability = stringValue(agentSession?.last_recoverability);
    if (canSubmitNextTurn === false || recoverability === 'blocked') {
      return {
        label: '需处理 · 上轮失败',
        tone: 'failed',
        connecting: false,
        runningTurn: false,
        lastFailed: true,
        submissionBlocked: true,
      };
    }
    return {
      label:
        recoverability === 'user_action_required'
          ? '需处理 · 可继续对话'
          : '可继续 · 上轮失败',
      tone: 'failed',
      connecting: false,
      runningTurn: false,
      lastFailed: true,
      submissionBlocked: false,
    };
  }
  const normalizedStatus = sessionStatus || 'idle';
  return {
    label: normalizedStatus,
    tone: normalizedStatus,
    connecting: false,
    runningTurn: false,
    lastFailed: false,
    submissionBlocked: false,
  };
}


function compactText(value: string): string {
  const text = value.replace(/\s+/gu, ' ').trim();
  return text.length > 420 ? `${text.slice(0, 420)}...` : text || 'empty';
}


function assistantMessageDisplayContent(content: string): string {
  const payload = parseEmbeddedJsonObject(content);
  if (!payload) {
    return content;
  }
  const assistantMessage = typeof payload.assistant_message === 'string' ? payload.assistant_message : '';
  const proposal = isPlainRecord(payload.proposal) ? payload.proposal : null;
  const proposalId = proposal && typeof proposal.proposal_id === 'string' ? proposal.proposal_id : '';
  const rationale = proposal && typeof proposal.rationale === 'string' ? proposal.rationale : '';
  const lines = [
    assistantMessage || '已生成结构化草稿。',
    proposalId ? `Proposal: ${proposalId}` : '',
    rationale ? `Rationale: ${rationale}` : '',
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : '已生成结构化 JSON 草稿。';
}

function parseEmbeddedJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const candidates = [trimmed];
  if (trimmed.includes('```')) {
    const parts = trimmed.split('```');
    for (let index = 1; index < parts.length; index += 2) {
      const block = parts[index].trim().replace(/^json\s*/iu, '').trim();
      candidates.push(block);
    }
  }
  for (const candidate of candidates) {
    const parsed = parseJsonObject(candidate);
    if (parsed) {
      return parsed;
    }
    for (let offset = 0; offset < candidate.length; offset += 1) {
      if (candidate[offset] !== '{') {
        continue;
      }
      const scanned = scanJsonObject(candidate.slice(offset));
      if (scanned) {
        return scanned;
      }
    }
  }
  return null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function scanJsonObject(value: string): Record<string, unknown> | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return parseJsonObject(value.slice(0, index + 1));
      }
    }
  }
  return null;
}


function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

