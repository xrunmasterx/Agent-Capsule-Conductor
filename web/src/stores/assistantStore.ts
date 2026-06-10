/**
 * Zustand store for AI assistant / authoring session state.
 *
 * Covers: assistant chat messages, proposal, session identity, streaming
 * status, GraphOps review, required-actions queue, and undo tokens.
 */

import { create } from 'zustand';
import type {
  AgentSessionRecord,
  AgentTurnRecord,
  AuthoringRequiredAction,
  RunEvent,
} from '../types';

// ---------------------------------------------------------------------------
// Local type mirrors (will unify with types/workbench.ts in a later step)
// ---------------------------------------------------------------------------

export type AssistantChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type AssistantTurnReason = 'workbench_chat' | 'canvas_revision' | 'selected_node_revision';

export type AssistantGraphOpsReview = {
  resourceDraftId: string;
  callableId: string;
  proposal: unknown;
  validation: Record<string, unknown>;
  dryRun: unknown;
};

export type CanvasAuthoringValidationResult = {
  status: 'valid' | 'invalid';
  errors: string[];
  warnings: string[];
};

export type AssistantApplyUndoToken = {
  proposalId: string;
  taskId: string;
  beforeCanvas: unknown;
  beforeTemporaryResources: unknown;
  beforeSelection: unknown;
  afterCanvasHash: string;
  affectedSelection: unknown;
};

export interface AssistantStoreState {
  // --- chat ---
  assistantInput: string;
  assistantMessages: AssistantChatMessage[];

  // --- proposal ---
  assistantProposal: unknown | null;

  // --- session identity ---
  assistantSessionId: string | null;
  assistantAgentSession: AgentSessionRecord | null;
  assistantPendingTurn: AgentTurnRecord | null;
  assistantEvents: RunEvent[];
  assistantTurnReason: AssistantTurnReason;
  assistantSessionStatus: string;

  // --- validation / review ---
  assistantBackendValidation: CanvasAuthoringValidationResult | null;
  assistantRequiredActions: AuthoringRequiredAction[];
  assistantGraphOpsReview: AssistantGraphOpsReview | null;

  // --- busy / undo ---
  assistantBusy: boolean;
  assistantApplyUndo: AssistantApplyUndoToken | null;

  // --- authoring agents ---
  authoringAgents: unknown[];
  selectedAuthoringAgentId: string;

  // --- actions ---
  setAssistantInput: (input: string) => void;
  addAssistantMessage: (message: AssistantChatMessage) => void;
  setAssistantMessages: (messages: AssistantChatMessage[]) => void;
  setAssistantProposal: (proposal: unknown | null) => void;
  setAssistantSessionId: (id: string | null) => void;
  setAssistantAgentSession: (session: AgentSessionRecord | null) => void;
  setAssistantPendingTurn: (turn: AgentTurnRecord | null) => void;
  setAssistantEvents: (events: RunEvent[]) => void;
  setAssistantTurnReason: (reason: AssistantTurnReason) => void;
  setAssistantSessionStatus: (status: string) => void;
  setAssistantBackendValidation: (validation: CanvasAuthoringValidationResult | null) => void;
  setAssistantRequiredActions: (actions: AuthoringRequiredAction[]) => void;
  setAssistantGraphOpsReview: (review: AssistantGraphOpsReview | null) => void;
  setAssistantBusy: (busy: boolean) => void;
  setAssistantApplyUndo: (token: AssistantApplyUndoToken | null) => void;
  setAuthoringAgents: (agents: unknown[]) => void;
  setSelectedAuthoringAgentId: (id: string) => void;
  resetAssistantSession: () => void;
}

export const useAssistantStore = create<AssistantStoreState>((set) => ({
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
  authoringAgents: [],
  selectedAuthoringAgentId: '',

  // --- actions ---
  setAssistantInput: (input) => set({ assistantInput: input }),
  addAssistantMessage: (message) =>
    set((state) => ({ assistantMessages: [...state.assistantMessages, message] })),
  setAssistantMessages: (messages) => set({ assistantMessages: messages }),
  setAssistantProposal: (proposal) => set({ assistantProposal: proposal }),
  setAssistantSessionId: (id) => set({ assistantSessionId: id }),
  setAssistantAgentSession: (session) => set({ assistantAgentSession: session }),
  setAssistantPendingTurn: (turn) => set({ assistantPendingTurn: turn }),
  setAssistantEvents: (events) => set({ assistantEvents: events }),
  setAssistantTurnReason: (reason) => set({ assistantTurnReason: reason }),
  setAssistantSessionStatus: (status) => set({ assistantSessionStatus: status }),
  setAssistantBackendValidation: (validation) =>
    set({ assistantBackendValidation: validation }),
  setAssistantRequiredActions: (actions) => set({ assistantRequiredActions: actions }),
  setAssistantGraphOpsReview: (review) => set({ assistantGraphOpsReview: review }),
  setAssistantBusy: (busy) => set({ assistantBusy: busy }),
  setAssistantApplyUndo: (token) => set({ assistantApplyUndo: token }),
  setAuthoringAgents: (agents) => set({ authoringAgents: agents }),
  setSelectedAuthoringAgentId: (id) => set({ selectedAuthoringAgentId: id }),

  resetAssistantSession: () =>
    set({
      assistantMessages: [],
      assistantProposal: null,
      assistantSessionId: null,
      assistantAgentSession: null,
      assistantPendingTurn: null,
      assistantEvents: [],
      assistantSessionStatus: 'disconnected',
      assistantBackendValidation: null,
      assistantRequiredActions: [],
      assistantGraphOpsReview: null,
      assistantBusy: false,
      assistantApplyUndo: null,
    }),
}));
