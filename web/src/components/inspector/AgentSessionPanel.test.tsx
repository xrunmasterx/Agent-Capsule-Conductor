import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { AgentSessionUiState } from '../../hooks/useSelectedAgentSession';
import type { AgentSessionRecord, InteractionRequest, RunEvent } from '../../types';
import type { AgentNodeSettingsModel } from '../../types/workbench';
import { AgentSessionPanel } from './AgentSessionPanel';

function makeNode(overrides: Partial<AgentNodeSettingsModel> = {}): AgentNodeSettingsModel {
  return {
    scopeLabel: '任务画布',
    nodeId: 'agent_a',
    label: 'Agent A',
    task: 'Agent A',
    kind: 'Agent',
    status: 'success',
    callableId: 'stock-research.codex',
    input: {},
    inputPorts: [],
    outputPorts: [],
    preview: {},
    raw: {},
    run: {
      node_id: 'agent_a',
      callable_id: 'stock-research.codex',
      status: 'success',
      run_dir: 'C:/runs/run_1/nodes/agent_a',
      output_path: 'C:/runs/run_1/nodes/agent_a/output.json',
    },
    ...overrides,
  };
}

function makeSession(overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord {
  return {
    session_id: 'session_1',
    provider_session_id: 'provider_1',
    status: 'ready',
    bound_run_id: 'run_1',
    bound_node_id: 'agent_a',
    current_output_turn_id: 'turn_draft',
    published_output_turn_id: null,
    current_output_ref: 'current_output.json',
    published_output_ref: 'published_output.json',
    session_dir: 'C:/sessions/session_1',
    last_turn_id: 'turn_draft',
    ...overrides,
  };
}

function makeState(overrides: Partial<AgentSessionUiState> = {}): AgentSessionUiState {
  return {
    status: 'ready',
    session: makeSession(),
    messages: [
      {
        role: 'assistant',
        content: JSON.stringify({
          assistant_message: '草稿已准备',
          proposal: { proposal_id: 'proposal_1', rationale: 'because' },
        }),
        turn_id: 'turn_draft',
      },
    ],
    events: [],
    pendingTurn: null,
    interactions: [],
    error: '',
    ...overrides,
  };
}

function renderPanel({
  node = makeNode(),
  state = makeState(),
  events = [{ type: 'agent_tool_result', timestamp: '2026-06-20T00:00:00Z', payload: { summary: 'tool done' } }],
  onReadEvidence = vi.fn(),
  onRefresh = vi.fn().mockResolvedValue(undefined),
  onPublish = vi.fn().mockResolvedValue(undefined),
  onAnswerInteraction = vi.fn().mockResolvedValue(undefined),
}: {
  node?: AgentNodeSettingsModel;
  state?: AgentSessionUiState;
  events?: RunEvent[];
  onReadEvidence?: ReturnType<typeof vi.fn>;
  onRefresh?: ReturnType<typeof vi.fn>;
  onPublish?: ReturnType<typeof vi.fn>;
  onAnswerInteraction?: ReturnType<typeof vi.fn>;
} = {}) {
  const result = render(
    <AgentSessionPanel
      node={node}
      state={state}
      events={events}
      onReadEvidence={onReadEvidence}
      onRefresh={onRefresh}
      onPublish={onPublish}
      onAnswerInteraction={onAnswerInteraction}
    />,
  );
  return { ...result, onReadEvidence, onRefresh, onPublish, onAnswerInteraction };
}

describe('AgentSessionPanel', () => {
  test('does not render for tools or nodes without run evidence', () => {
    const toolResult = renderPanel({ node: makeNode({ kind: 'Tool' }) });
    expect(toolResult.container.firstChild).toBeNull();

    toolResult.unmount();
    const noRunResult = renderPanel({ node: makeNode({ run: undefined }) });
    expect(noRunResult.container.firstChild).toBeNull();
  });

  test('renders publishable session details and artifact actions', async () => {
    const { onReadEvidence, onPublish, onRefresh } = renderPanel();

    expect(screen.getByLabelText('Agent 输出状态')).toBeInTheDocument();
    expect(screen.getByText('有待发布草稿')).toBeInTheDocument();
    expect(screen.getByText('草稿已准备 / proposal=proposal_1 / rationale=because')).toBeInTheDocument();
    expect(screen.getByText('tool done')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /发布为本节点输出/ }));
    await waitFor(() => {
      expect(onPublish).toHaveBeenCalledWith('turn_draft');
    });

    fireEvent.click(screen.getByText('调试详情'));
    fireEvent.click(screen.getByRole('button', { name: /待发布草稿/ }));
    expect(onReadEvidence).toHaveBeenLastCalledWith(
      'C:/sessions/session_1/current_output.json',
      '待发布草稿 current_output.json',
    );

    fireEvent.click(screen.getByRole('button', { name: /已发布输出/ }));
    expect(onReadEvidence).toHaveBeenLastCalledWith(
      'C:/runs/run_1/nodes/agent_a/output.json',
      '已发布输出 output.json',
    );

    fireEvent.click(screen.getByRole('button', { name: /Session 发布副本/ }));
    expect(onReadEvidence).toHaveBeenLastCalledWith(
      'C:/sessions/session_1/published_output.json',
      'session published_output.json',
    );
  });

  test('answers pending approval interactions', async () => {
    const interaction: InteractionRequest = {
      interaction_id: 'interaction_1',
      run_id: 'run_1',
      node_id: 'agent_a',
      kind: 'approval',
      status: 'pending',
      prompt: '允许发布这次输出吗？',
      created_at: '2026-06-20T00:00:00Z',
    };
    const onAnswerInteraction = vi.fn().mockResolvedValue(undefined);

    renderPanel({
      state: makeState({ interactions: [interaction] }),
      onAnswerInteraction,
    });

    expect(screen.getByText('待审批')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '通过' }));
    await waitFor(() => {
      expect(onAnswerInteraction).toHaveBeenCalledWith('interaction_1', { decision: 'approve' });
    });

    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    await waitFor(() => {
      expect(onAnswerInteraction).toHaveBeenCalledWith('interaction_1', { decision: 'reject' });
    });
  });

  test('renders loading, error, and unbound states', () => {
    const loadingState = makeState({ status: 'loading', session: null, messages: [] });
    const { rerender } = renderPanel({ state: loadingState });
    expect(screen.getByText('正在读取 Agent Session...')).toBeInTheDocument();

    rerender(
      <AgentSessionPanel
        node={makeNode()}
        state={makeState({ status: 'error', session: null, messages: [], error: 'session missing' })}
        events={[]}
        onReadEvidence={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onPublish={vi.fn().mockResolvedValue(undefined)}
        onAnswerInteraction={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText('session missing')).toBeInTheDocument();
    expect(screen.getByText('当前 run node 还没有绑定到可读取的 Agent Session。')).toBeInTheDocument();
  });
});
