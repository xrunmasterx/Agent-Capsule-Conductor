import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';

import type { AgentSessionRecord, AgentTurnRecord } from '../types';
import type {
  AssistantChatMessage,
  AssistantTurnReason,
  BottomDockMode,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
  AuthoringContextSnapshot,
  CanvasSelection,
} from '../types/workbench';
import type { EvidenceDockState } from './useEvidenceDockActions';
import {
  useAssistantProposalGenerateActions,
  type UseAssistantProposalGenerateActionsResult,
} from './useAssistantProposalGenerateActions';

let latestActions: UseAssistantProposalGenerateActionsResult | null = null;
let latestMessages: AssistantChatMessage[] = [];
let latestMessage = '';
let latestBusy = false;
let latestInput = '';
let latestPendingTurn: AgentTurnRecord | null = null;
let latestSessionStatus = '';
let latestBottomDockMode: BottomDockMode = 'evidence';
let latestEvidenceDock: EvidenceDockState | null = null;
let latestProposal: CanvasAuthoringProposal | null = null;
let latestBackendValidation: CanvasAuthoringValidationResult | null = null;
let latestAgentSession: AgentSessionRecord | null = null;

const ensureAssistantSession = vi.fn();
const loadWorkbenchAssistantSession = vi.fn();
const submitWorkbenchAssistantTurnRequest = vi.fn();

function snapshot(selection: CanvasSelection = { type: 'task_canvas', taskId: 'task_1' }): AuthoringContextSnapshot {
  return {
    snapshot_id: 'hash_1',
    task_id: 'task_1',
    target: { kind: 'task_canvas', task_id: 'task_1' },
    canvas: {
      id: 'task_1',
      name: 'Task Canvas',
      rootWorkflowId: 'task_1',
      workflows: [],
      edges: [],
    },
    canonical_graph: {
      id: 'task_1',
      name: 'Task Canvas',
      version: '1.0.0',
      nodes: [],
      edges: [],
    },
    selection,
    callable_catalog: [],
    workflow_catalog: [],
  };
}

function Harness({
  input = 'revise canvas',
  turnReason = 'canvas_revision',
  selection = { type: 'task_canvas', taskId: 'task_1' } as CanvasSelection,
  agentSession = { session_id: 'session_1', provider_session_id: 'provider_1' },
}: {
  input?: string;
  turnReason?: AssistantTurnReason;
  selection?: CanvasSelection;
  agentSession?: AgentSessionRecord | null;
}) {
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [assistantInput, setAssistantInput] = useState(input);
  const [pendingTurn, setPendingTurn] = useState<AgentTurnRecord | null>(null);
  const [sessionStatus, setSessionStatus] = useState('ready');
  const [bottomDockMode, setBottomDockMode] = useState<BottomDockMode>('evidence');
  const [evidenceDock, setEvidenceDock] = useState<EvidenceDockState>({
    open: false,
    title: '运行证据',
    content: null,
  });
  const [proposal, setProposal] = useState<CanvasAuthoringProposal | null>({
    proposal_id: 'proposal_1',
    base_task_id: 'task_1',
    base_canvas_hash: 'hash_0',
    target: { kind: 'task_canvas', task_id: 'task_1' },
    rationale: 'old proposal',
    operations: [],
  });
  const [backendValidation, setBackendValidation] =
    useState<CanvasAuthoringValidationResult | null>({
      status: 'invalid',
      errors: ['old error'],
      warnings: [],
    });
  const [currentAgentSession, setCurrentAgentSession] =
    useState<AgentSessionRecord | null>(agentSession);

  latestActions = useAssistantProposalGenerateActions({
    assistantInput,
    assistantTurnReason: turnReason,
    selection,
    assistantAgentSession: currentAgentSession,
    currentAuthoringSnapshot: () => snapshot(selection),
    ensureAssistantSession,
    loadWorkbenchAssistantSession,
    submitWorkbenchAssistantTurnRequest,
    setAssistantMessages: setMessages,
    setAssistantBusy: setBusy,
    setAssistantAgentSession: setCurrentAgentSession,
    setAssistantPendingTurn: setPendingTurn,
    setAssistantSessionStatus: setSessionStatus,
    setAssistantInput,
    setAssistantProposal: setProposal,
    setAssistantBackendValidation: setBackendValidation,
    setBottomDockMode,
    setEvidenceDock,
    setMessage,
  });
  latestMessages = messages;
  latestMessage = message;
  latestBusy = busy;
  latestInput = assistantInput;
  latestPendingTurn = pendingTurn;
  latestSessionStatus = sessionStatus;
  latestBottomDockMode = bottomDockMode;
  latestEvidenceDock = evidenceDock;
  latestProposal = proposal;
  latestBackendValidation = backendValidation;
  latestAgentSession = currentAgentSession;

  return <output>{message}</output>;
}

describe('useAssistantProposalGenerateActions', () => {
  afterEach(() => {
    latestActions = null;
    latestMessages = [];
    latestMessage = '';
    latestBusy = false;
    latestInput = '';
    latestPendingTurn = null;
    latestSessionStatus = '';
    latestBottomDockMode = 'evidence';
    latestEvidenceDock = null;
    latestProposal = null;
    latestBackendValidation = null;
    latestAgentSession = null;
    vi.clearAllMocks();
  });

  test('submits assistant turns with current provider session guard', async () => {
    ensureAssistantSession.mockResolvedValue('session_1');
    submitWorkbenchAssistantTurnRequest.mockResolvedValue({
      session_id: 'session_1',
      turn_id: 'turn_1',
      status: 'queued',
    });
    const preventDefault = vi.fn();
    render(<Harness />);

    await act(async () => {
      await latestActions?.generateAssistantProposal({ preventDefault } as never);
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(loadWorkbenchAssistantSession).not.toHaveBeenCalled();
    expect(submitWorkbenchAssistantTurnRequest).toHaveBeenCalledWith(
      'session_1',
      expect.objectContaining({
        message: 'revise canvas',
        reason: 'canvas_revision',
        canvas_hash: 'hash_1',
        expected_provider_session_id: 'provider_1',
      }),
    );
    expect(latestMessages.map((item) => item.role)).toContain('user');
    expect(latestPendingTurn).toMatchObject({ turn_id: 'turn_1' });
    expect(latestSessionStatus).toBe('queued');
    expect(latestInput).toBe('');
    expect(latestBottomDockMode).toBe('assistant');
    expect(latestEvidenceDock?.open).toBe(true);
    expect(latestMessage).toBe('AI 助手 turn turn_1: queued');
  });

  test('loads the assistant session when the cached session id differs', async () => {
    ensureAssistantSession.mockResolvedValue('session_2');
    loadWorkbenchAssistantSession.mockResolvedValue({
      session_id: 'session_2',
      provider_session_id: 'provider_2',
    });
    submitWorkbenchAssistantTurnRequest.mockResolvedValue({
      session_id: 'session_2',
      turn_id: 'turn_2',
      status: 'running',
    });
    render(<Harness />);

    await act(async () => {
      await latestActions?.generateAssistantProposal();
    });

    expect(loadWorkbenchAssistantSession).toHaveBeenCalledWith('session_2');
    expect(submitWorkbenchAssistantTurnRequest).toHaveBeenCalledWith(
      'session_2',
      expect.objectContaining({ expected_provider_session_id: 'provider_2' }),
    );
    expect(latestAgentSession).toMatchObject({ session_id: 'session_2' });
  });

  test('does not submit when the assistant input is blank', async () => {
    render(<Harness input="   " />);

    await act(async () => {
      await latestActions?.generateAssistantProposal();
    });

    expect(ensureAssistantSession).not.toHaveBeenCalled();
    expect(submitWorkbenchAssistantTurnRequest).not.toHaveBeenCalled();
    expect(latestMessage).toBe('Please enter a requirement.');
    expect(latestMessages).toContainEqual(
      expect.objectContaining({ role: 'assistant', content: 'Please enter a requirement.' }),
    );
  });

  test('clears stale proposal state and records a system message on submit failure', async () => {
    ensureAssistantSession.mockRejectedValueOnce(new Error('session failed'));
    render(<Harness />);

    await act(async () => {
      await latestActions?.generateAssistantProposal();
    });

    expect(latestProposal).toBeNull();
    expect(latestBackendValidation).toBeNull();
    expect(latestBusy).toBe(false);
    expect(latestMessage).toBe('session failed');
    expect(latestMessages).toContainEqual(
      expect.objectContaining({ role: 'system', content: 'session failed' }),
    );
  });
});
