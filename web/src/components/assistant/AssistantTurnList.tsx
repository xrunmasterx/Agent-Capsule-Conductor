/**
 * AssistantTurnList - renders the AI assistant chat message list.
 *
 * Extracted from WorkflowViewer.tsx inline message list rendering.
 * A thin presentational component so that the message list can be reused
 * across AssistantDrawer (right panel) and AssistantDockContent (bottom dock).
 */

import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AssistantChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssistantTurnList({
  messages,
  emptyText = '等待输入需求',
  className,
}: {
  messages: AssistantChatMessage[];
  emptyText?: string;
  className?: string;
}) {
  return (
    <div
      className={className ? `assistant-message-list ${className}` : 'assistant-message-list'}
      aria-label="AI 助手消息"
    >
      {messages.length ? (
        messages.map((message) => (
          <article key={message.id} className={`assistant-message ${message.role}`}>
            <span>{message.role}</span>
            <p>{message.content}</p>
          </article>
        ))
      ) : (
        <p className="assistant-empty">{emptyText}</p>
      )}
    </div>
  );
}
