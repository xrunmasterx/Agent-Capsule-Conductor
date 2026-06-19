import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';

import type {
  AgentSessionRecord,
  AgentTurnRecord,
  AuthoringAgentSummary,
  AuthoringRequiredAction,
  RunEvent,
} from '../types';
import type {
  AssistantApplyUndoToken,
  AssistantChatMessage,
  AssistantGraphOpsReview,
  AssistantTurnReason,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
  CanvasSelection,
} from '../types/workbench';
import { emptyWorkspaceCanvas } from '../workbench/model/taskModel';
import {
  useAssistantAuthoringSessionActions,
  type UseAssistantAuthoringSessionActionsResult,
} from './useAssistantAuthoringSessionActions';

const apiMock = vi.hoisted(() => ({
  authoringAgents: vi.fn(),
  createWorkbenchAssistantSession: vi.fn(),
  getAgentSessionMessages: vi.fn(),
  getAgentSession: vi.fn(),
  submitWorkbenchAssistantTurn: vi.fn(),
}));

vi.mock('../api', () => ({
  api: apiMock,
}));

let latestActions: UseAssistantAuthoringSessionActionsResult | null = null;
let latestInput = '';
let latestMessages: AssistantChatMessage[] = [];
let latestProposal: CanvasAuthoringProposal | null = null;
let latestUndo: AssistantApplyUndoToken | null = null;
let latestTurnReason: AssistantTurnReason = 'workbench_chat';
let latestBackendValidation: CanvasAuthoringValidationResult | null = null;
let latestRequiredActions: AuthoringRequiredAction[] = [];
let latestGraphOpsReview: AssistantGraphOpsReview | null = null;
let latestSessionId: string | null = null;
let latestAgentSession: AgentSessionRecord | null = null;
let latestPendingTurn: AgentTurnRecord | null = null;
let latestEvents: RunEvent[] = [];
let latestStatus = '';
let latestBusy = false;
let latestAuthoringAgents: AuthoringAgentSummary[] = [];
let latestSelectedAuthoringAgentId = '';

function Harness({
  initialSessionId = null,
  initialAgentId = '',
}: {
  initialSessionId?: string | null;
  initialAgentId?: string;
}) {
  const [input, setInput] = useState('draft request');
  const [messages, setMessages] = useState<AssistantChatMessage[]>([
    { id: 'old_msg', role: 'assistant', content: 'old' },
  ]);
  const [proposal, setProposal] = useState<CanvasAuthoringProposal | null>({
    proposal_id: 'proposal_1',
    base_task_id: 'task_1',
    base_canvas_hash: 'hash_1',
    target: { kind: 'task_canvas', task_id: 'task_1' },
    rationale: 'old',
    operations: [],
  });
  const [undo, setUndo] = useState<AssistantApplyUndoToken | null>({
    proposalId: 'proposal_1',
    taskId: 'task_1',
    beforeCanvas: emptyWorkspaceCanvas('task_1', 'Before'),
    beforeTemporaryResources: {},
    beforeSelection: { type: 'task_canvas', taskId: 'task_1' },
    afterCanvasHash: 'hash_after',
    affectedSelection: { type: 'task_canvas', taskId: 'task_1' },
  });
  const [turnReason, setTurnReason] = useState<AssistantTurnReason>('canvas_revision');
  const [backendValidation, setBackendValidation] = useState<CanvasAuthoringValidationResult | null>({
    status: 'invalid',
    errors: ['old'],
    warnings: [],
  });
  const [requiredActions, setRequiredActions] = useState<AuthoringRequiredAction[]>([
    { kind: 'confirm_canvas_apply' },
  ]);
  const [graphOpsReview, setGraphOpsReview] = useState<AssistantGraphOpsReview | null>({
    resourceDraftId: 'draft_1',
    callableId: 'agent_1',
    proposal: {
      schema_version: 'acc.graphops.transaction.v1',
      proposal_id: 'graphops_1',
      author: 'assistant',
      base: { content_hashes: {} },
      rationale: 'old',
      targets: [],
    },
    validation: {},
    dryRun: {
      status: 'valid',
      proposal_id: 'graphops_1',
      mutated: true,
      target_paths: [],
      dry_run_digest: 'digest',
    },
  });
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [agentSession, setAgentSession] = useState<AgentSessionRecord | null>({
    session_id: 'old_session',
  });
  const [pendingTurn, setPendingTurn] = useState<AgentTurnRecord | null>({
    session_id: 'old_session',
    turn_id: 'turn_1',
    status: 'queued',
  });
  const [events, setEvents] = useState<RunEvent[]>([{ event: 'old' } as RunEvent]);
  const [status, setStatus] = useState('ready');
  const [busy, setBusy] = useState(true);
  const [authoringAgents, setAuthoringAgents] = useState<AuthoringAgentSummary[]>([]);
  const [selectedAuthoringAgentId, setSelectedAuthoringAgentId] = useState(initialAgentId);

  latestActions = useAssistantAuthoringSessionActions({
    activeTaskId: 'task_1',
    canvas: emptyWorkspaceCanvas('task_1', 'Task Canvas'),
    selection: { type: 'task_canvas', taskId: 'task_1' } as CanvasSelection,
    callables: [],
    workflows: [],
    assistantSessionId: sessionId,
    selectedAuthoringAgentId,
    setAuthoringAgents,
    setSelectedAuthoringAgentId,
    setAssistantInput: setInput,
    setAssistantMessages: setMessages,
    setAssistantProposal: setProposal,
    setAssistantApplyUndo: setUndo,
    setAssistantTurnReason: setTurnReason,
    setAssistantBackendValidation: setBackendValidation,
    setAssistantRequiredActions: setRequiredActions,
    setAssistantGraphOpsReview: setGraphOpsReview,
    setAssistantSessionId: setSessionId,
    setAssistantAgentSession: setAgentSession,
    setAssistantPendingTurn: setPendingTurn,
    setAssistantEvents: setEvents,
    setAssistantSessionStatus: setStatus,
    setAssistantBusy: setBusy,
  });

  latestInput = input;
  latestMessages = messages;
  latestProposal = proposal;
  latestUndo = undo;
  latestTurnReason = turnReason;
  latestBackendValidation = backendValidation;
  latestRequiredActions = requiredActions;
  latestGraphOpsReview = graphOpsReview;
  latestSessionId = sessionId;
  latestAgentSession = agentSession;
  latestPendingTurn = pendingTurn;
  latestEvents = events;
  latestStatus = status;
  latestBusy = busy;
  latestAuthoringAgents = authoringAgents;
  latestSelectedAuthoringAgentId = selectedAuthoringAgentId;

  return <output>{status}</output>;
}

describe('useAssistantAuthoringSessionActions', () => {
  afterEach(() => {
    latestActions = null;
    latestInput = '';
    latestMessages = [];
    latestProposal = null;
    latestUndo = null;
    latestTurnReason = 'workbench_chat';
    latestBackendValidation = null;
    latestRequiredActions = [];
    latestGraphOpsReview = null;
    latestSessionId = null;
    latestAgentSession = null;
    latestPendingTurn = null;
    latestEvents = [];
    latestStatus = '';
    latestBusy = false;
    latestAuthoringAgents = [];
    latestSelectedAuthoringAgentId = '';
    vi.clearAllMocks();
  });

  test('resets assistant conversation state to the disconnected baseline', () => {
    render(<Harness initialSessionId="session_1" initialAgentId="agent_author" />);

    act(() => {
      latestActions?.resetAssistantConversationState();
    });

    expect(latestInput).toBe('');
    expect(latestMessages).toEqual([]);
    expect(latestProposal).toBeNull();
    expect(latestUndo).toBeNull();
    expect(latestTurnReason).toBe('workbench_chat');
    expect(latestBackendValidation).toBeNull();
    expect(latestRequiredActions).toEqual([]);
    expect(latestGraphOpsReview).toBeNull();
    expect(latestSessionId).toBeNull();
    expect(latestAgentSession).toBeNull();
    expect(latestPendingTurn).toBeNull();
    expect(latestEvents).toEqual([]);
    expect(latestStatus).toBe('disconnected');
    expect(latestBusy).toBe(false);
  });

  test('captures the current authoring snapshot from canvas props', () => {
    render(<Harness />);

    const snapshot = latestActions?.currentAuthoringSnapshot();

    expect(snapshot).toMatchObject({
      task_id: 'task_1',
      canvas: { id: 'task_1', name: 'Task Canvas' },
      target: { kind: 'task_canvas', task_id: 'task_1' },
    });
    expect(snapshot?.canonical_graph.id).toBe('task_1');
  });

  test('adds assistant system messages with generated ids', () => {
    render(<Harness />);

    act(() => {
      latestActions?.addAssistantSystemMessage('session failed');
    });

    expect(latestMessages.at(-1)).toMatchObject({
      role: 'system',
      content: 'session failed',
    });
    expect(latestMessages.at(-1)?.id).toMatch(/^assistant_msg_/);
  });

  test('reuses an existing assistant session without backend calls', async () => {
    render(<Harness initialSessionId="session_existing" />);

    await expect(latestActions?.ensureAssistantSession()).resolves.toBe('session_existing');

    expect(apiMock.authoringAgents).not.toHaveBeenCalled();
    expect(apiMock.createWorkbenchAssistantSession).not.toHaveBeenCalled();
  });

  test('creates an assistant session and loads initial messages', async () => {
    apiMock.authoringAgents.mockResolvedValue({
      agents: [{ id: 'author_agent_1', version: '1', kind: 'agent_class' }],
    });
    apiMock.createWorkbenchAssistantSession.mockResolvedValue({
      session_id: 'session_new',
      provider_session_id: 'provider_1',
      status: 'ready',
    });
    apiMock.getAgentSessionMessages.mockResolvedValue({
      messages: [{ role: 'assistant', content: 'ready', turn_id: 'turn_1' }],
    });
    render(<Harness />);

    await act(async () => {
      await expect(latestActions?.ensureAssistantSession()).resolves.toBe('session_new');
    });

    expect(apiMock.createWorkbenchAssistantSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'author_agent_1',
        task_id: 'task_1',
        canvas_hash: expect.any(String),
        canvas_snapshot: expect.objectContaining({ task_id: 'task_1' }),
        selection: { type: 'task_canvas', taskId: 'task_1' },
      }),
    );
    expect(latestAuthoringAgents).toEqual([{ id: 'author_agent_1', version: '1', kind: 'agent_class' }]);
    expect(latestSelectedAuthoringAgentId).toBe('author_agent_1');
    expect(latestSessionId).toBe('session_new');
    expect(latestAgentSession).toMatchObject({ session_id: 'session_new' });
    expect(latestStatus).toBe('ready');
    expect(latestBusy).toBe(false);
    expect(latestMessages).toContainEqual(
      expect.objectContaining({ role: 'assistant', content: 'ready', turnId: 'turn_1' }),
    );
  });

  test('records session creation failures as system messages', async () => {
    apiMock.authoringAgents.mockRejectedValue(new Error('agent catalog failed'));
    render(<Harness />);

    await act(async () => {
      await expect(latestActions?.ensureAssistantSession()).rejects.toThrow('agent catalog failed');
    });

    expect(latestStatus).toBe('error');
    expect(latestBusy).toBe(false);
    expect(latestMessages.at(-1)).toMatchObject({
      role: 'system',
      content: 'agent catalog failed',
    });
  });

  test('exposes assistant backend action wrappers', async () => {
    apiMock.getAgentSession.mockResolvedValue({ session_id: 'session_1' });
    apiMock.submitWorkbenchAssistantTurn.mockResolvedValue({
      session_id: 'session_1',
      turn_id: 'turn_1',
      status: 'queued',
    });
    render(<Harness />);

    await expect(latestActions?.loadWorkbenchAssistantSession('session_1')).resolves.toEqual({
      session_id: 'session_1',
    });
    await expect(
      latestActions?.submitWorkbenchAssistantTurnRequest('session_1', {
        message: 'revise',
        reason: 'canvas_revision',
        canvas_hash: 'hash_1',
        canvas_snapshot: {},
      }),
    ).resolves.toMatchObject({ turn_id: 'turn_1' });

    expect(apiMock.getAgentSession).toHaveBeenCalledWith('session_1');
    expect(apiMock.submitWorkbenchAssistantTurn).toHaveBeenCalledWith(
      'session_1',
      expect.objectContaining({ message: 'revise' }),
    );
  });
});
