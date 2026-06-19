/**
 * Zustand store for AI assistant / authoring session state.
 *
 * Assistant state is partitioned by taskId. Async hooks must dispatch with the
 * task/session/turn identifiers they observed, and stale completions are
 * ignored here instead of overwriting the active task.
 */

import { create } from 'zustand';
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
} from '../types/workbench';

export type {
  AssistantApplyUndoToken,
  AssistantChatMessage,
  AssistantGraphOpsReview,
  AssistantTurnReason,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
};

export interface AssistantTaskState {
  assistantInput: string;
  assistantMessages: AssistantChatMessage[];
  assistantProposal: CanvasAuthoringProposal | null;
  assistantSessionId: string | null;
  assistantAgentSession: AgentSessionRecord | null;
  assistantPendingTurn: AgentTurnRecord | null;
  assistantEvents: RunEvent[];
  assistantTurnReason: AssistantTurnReason;
  assistantSessionStatus: string;
  assistantBackendValidation: CanvasAuthoringValidationResult | null;
  assistantRequiredActions: AuthoringRequiredAction[];
  assistantGraphOpsReview: AssistantGraphOpsReview | null;
  assistantBusy: boolean;
  assistantApplyUndo: AssistantApplyUndoToken | null;
  selectedAuthoringAgentId: string;
}

export interface AssistantTurnCompletionPayload {
  taskId: string;
  sessionId: string | null;
  turnId: string | null;
  messages?: AssistantChatMessage[];
  proposal?: CanvasAuthoringProposal | null;
  backendValidation?: CanvasAuthoringValidationResult | null;
  requiredActions?: AuthoringRequiredAction[];
  events?: RunEvent[];
  status?: string;
}

export interface AssistantStoreState {
  assistantByTaskId: Record<string, AssistantTaskState>;
  authoringAgents: AuthoringAgentSummary[];

  ensureAssistantTask: (taskId: string) => void;
  resetAssistantTask: (taskId: string) => void;
  setAssistantInput: (taskId: string, input: string) => void;
  addAssistantMessage: (taskId: string, message: AssistantChatMessage) => void;
  setAssistantMessages: (taskId: string, messages: AssistantChatMessage[]) => void;
  setAssistantProposal: (taskId: string, proposal: CanvasAuthoringProposal | null) => void;
  setAssistantSessionId: (taskId: string, id: string | null) => void;
  setAssistantAgentSession: (taskId: string, session: AgentSessionRecord | null) => void;
  setAssistantPendingTurn: (taskId: string, turn: AgentTurnRecord | null) => void;
  setAssistantEvents: (taskId: string, events: RunEvent[]) => void;
  setAssistantTurnReason: (taskId: string, reason: AssistantTurnReason) => void;
  setAssistantSessionStatus: (taskId: string, status: string) => void;
  setAssistantBackendValidation: (taskId: string, validation: CanvasAuthoringValidationResult | null) => void;
  setAssistantRequiredActions: (taskId: string, actions: AuthoringRequiredAction[]) => void;
  setAssistantGraphOpsReview: (taskId: string, review: AssistantGraphOpsReview | null) => void;
  setAssistantBusy: (taskId: string, busy: boolean) => void;
  setAssistantApplyUndo: (taskId: string, token: AssistantApplyUndoToken | null) => void;
  setSelectedAuthoringAgentId: (taskId: string, id: string) => void;
  setAuthoringAgents: (agents: AuthoringAgentSummary[]) => void;
  applyTurnCompletion: (payload: AssistantTurnCompletionPayload) => boolean;
}

export function emptyAssistantTaskState(): AssistantTaskState {
  return {
    assistantInput: '',
    assistantMessages: [],
    assistantProposal: null,
    assistantSessionId: null,
    assistantAgentSession: null,
    assistantPendingTurn: null,
    assistantEvents: [],
    assistantTurnReason: 'workbench_chat',
    assistantSessionStatus: 'disconnected',
    assistantBackendValidation: null,
    assistantRequiredActions: [],
    assistantGraphOpsReview: null,
    assistantBusy: false,
    assistantApplyUndo: null,
    selectedAuthoringAgentId: '',
  };
}

function taskState(state: AssistantStoreState, taskId: string): AssistantTaskState {
  return state.assistantByTaskId[taskId] || emptyAssistantTaskState();
}

function patchAssistantTask(
  state: AssistantStoreState,
  taskId: string,
  patch: Partial<AssistantTaskState>,
): Pick<AssistantStoreState, 'assistantByTaskId'> {
  return {
    assistantByTaskId: {
      ...state.assistantByTaskId,
      [taskId]: { ...taskState(state, taskId), ...patch },
    },
  };
}

export const useAssistantStore = create<AssistantStoreState>((set, get) => ({
  assistantByTaskId: {},
  authoringAgents: [],

  ensureAssistantTask: (taskId) => set((state) => patchAssistantTask(state, taskId, {})),
  resetAssistantTask: (taskId) =>
    set((state) => ({
      assistantByTaskId: { ...state.assistantByTaskId, [taskId]: emptyAssistantTaskState() },
    })),
  setAssistantInput: (taskId, input) => set((state) => patchAssistantTask(state, taskId, { assistantInput: input })),
  addAssistantMessage: (taskId, message) =>
    set((state) => {
      const current = taskState(state, taskId);
      return patchAssistantTask(state, taskId, {
        assistantMessages: [...current.assistantMessages, message],
      });
    }),
  setAssistantMessages: (taskId, messages) =>
    set((state) => patchAssistantTask(state, taskId, { assistantMessages: messages })),
  setAssistantProposal: (taskId, proposal) =>
    set((state) => patchAssistantTask(state, taskId, { assistantProposal: proposal })),
  setAssistantSessionId: (taskId, id) =>
    set((state) => patchAssistantTask(state, taskId, { assistantSessionId: id })),
  setAssistantAgentSession: (taskId, session) =>
    set((state) => patchAssistantTask(state, taskId, { assistantAgentSession: session })),
  setAssistantPendingTurn: (taskId, turn) =>
    set((state) => patchAssistantTask(state, taskId, { assistantPendingTurn: turn })),
  setAssistantEvents: (taskId, events) =>
    set((state) => patchAssistantTask(state, taskId, { assistantEvents: events })),
  setAssistantTurnReason: (taskId, reason) =>
    set((state) => patchAssistantTask(state, taskId, { assistantTurnReason: reason })),
  setAssistantSessionStatus: (taskId, status) =>
    set((state) => patchAssistantTask(state, taskId, { assistantSessionStatus: status })),
  setAssistantBackendValidation: (taskId, validation) =>
    set((state) => patchAssistantTask(state, taskId, { assistantBackendValidation: validation })),
  setAssistantRequiredActions: (taskId, actions) =>
    set((state) => patchAssistantTask(state, taskId, { assistantRequiredActions: actions })),
  setAssistantGraphOpsReview: (taskId, review) =>
    set((state) => patchAssistantTask(state, taskId, { assistantGraphOpsReview: review })),
  setAssistantBusy: (taskId, busy) => set((state) => patchAssistantTask(state, taskId, { assistantBusy: busy })),
  setAssistantApplyUndo: (taskId, token) =>
    set((state) => patchAssistantTask(state, taskId, { assistantApplyUndo: token })),
  setSelectedAuthoringAgentId: (taskId, id) =>
    set((state) => patchAssistantTask(state, taskId, { selectedAuthoringAgentId: id })),
  setAuthoringAgents: (agents) => set({ authoringAgents: agents }),

  applyTurnCompletion: (payload) => {
    const current = taskState(get(), payload.taskId);
    const pendingTurn = current.assistantPendingTurn;
    if (
      (payload.sessionId && current.assistantSessionId && payload.sessionId !== current.assistantSessionId) ||
      (payload.turnId && pendingTurn?.turn_id && payload.turnId !== pendingTurn.turn_id)
    ) {
      return false;
    }
    set((state) =>
      patchAssistantTask(state, payload.taskId, {
        ...(payload.messages ? { assistantMessages: payload.messages } : {}),
        ...(payload.proposal !== undefined ? { assistantProposal: payload.proposal } : {}),
        ...(payload.backendValidation !== undefined
          ? { assistantBackendValidation: payload.backendValidation }
          : {}),
        ...(payload.requiredActions ? { assistantRequiredActions: payload.requiredActions } : {}),
        ...(payload.events ? { assistantEvents: payload.events } : {}),
        ...(payload.status ? { assistantSessionStatus: payload.status } : {}),
        assistantBusy: false,
      }),
    );
    return true;
  },
}));

export function selectAssistantForTask(state: AssistantStoreState, taskId: string): AssistantTaskState {
  return taskState(state, taskId);
}
