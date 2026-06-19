import { useCallback } from 'react';

import { api } from '../api';
import type { AgentMessage, AgentSessionRecord, AuthoringAgentSummary } from '../types';
import type {
  AssistantChatMessage,
} from '../types/workbench';

export type AssistantSessionSnapshotPayload = {
  taskId: string;
  canvasHash: string;
  canvasSnapshot: Record<string, unknown>;
  selection: Record<string, unknown>;
};

export type UseAssistantSessionOptions = {
  sessionId: string | null;
  selectedAuthoringAgentId: string;
  setAuthoringAgents: (agents: AuthoringAgentSummary[]) => void;
  setSelectedAuthoringAgentId: (agentId: string) => void;
  setSessionId: (sessionId: string | null) => void;
  setAgentSession: (session: AgentSessionRecord | null) => void;
  setSessionStatus: (status: string) => void;
  setMessages: (messages: AssistantChatMessage[]) => void;
  setBusy: (busy: boolean) => void;
  addSystemMessage: (content: string) => void;
};

function agentMessagesToAssistantMessages(messages: AgentMessage[]): AssistantChatMessage[] {
  return messages
    .filter((message) => typeof message.content === 'string' && message.content.trim())
    .map((message, index) => ({
      id: `${message.turn_id || 'assistant_msg'}_${index}`,
      role:
        message.role === 'user' || message.role === 'assistant' || message.role === 'system'
          ? message.role
          : 'system',
      content: message.content,
      turnId: typeof message.turn_id === 'string' ? message.turn_id : undefined,
      createdAt: typeof message.created_at === 'string' ? message.created_at : undefined,
    }));
}

export function useAssistantSession({
  sessionId,
  selectedAuthoringAgentId,
  setAuthoringAgents,
  setSelectedAuthoringAgentId,
  setSessionId,
  setAgentSession,
  setSessionStatus,
  setMessages,
  setBusy,
  addSystemMessage,
}: UseAssistantSessionOptions): (snapshot: AssistantSessionSnapshotPayload) => Promise<string> {
  return useCallback(
    async (snapshot: AssistantSessionSnapshotPayload): Promise<string> => {
      if (sessionId) {
        return sessionId;
      }
      setBusy(true);
      setSessionStatus('connecting');
      try {
        const agentsResponse = await api.authoringAgents();
        setAuthoringAgents(agentsResponse.agents);
        const agentId = selectedAuthoringAgentId || agentsResponse.agents[0]?.id || '';
        if (agentId && !selectedAuthoringAgentId) {
          setSelectedAuthoringAgentId(agentId);
        }
        const session = await api.createWorkbenchAssistantSession({
          ...(agentId ? { agent_id: agentId } : {}),
          task_id: snapshot.taskId,
          canvas_hash: snapshot.canvasHash,
          canvas_snapshot: snapshot.canvasSnapshot,
          selection: snapshot.selection,
        });
        setSessionId(session.session_id);
        setAgentSession(session);
        setSessionStatus(session.status || 'ready');
        const messages = await api.getAgentSessionMessages(session.session_id);
        setMessages(agentMessagesToAssistantMessages(messages.messages || []));
        return session.session_id;
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        setSessionStatus('error');
        addSystemMessage(text);
        throw error;
      } finally {
        setBusy(false);
      }
    },
    [
      addSystemMessage,
      selectedAuthoringAgentId,
      sessionId,
      setAgentSession,
      setAuthoringAgents,
      setBusy,
      setMessages,
      setSelectedAuthoringAgentId,
      setSessionId,
      setSessionStatus,
    ],
  );
}
