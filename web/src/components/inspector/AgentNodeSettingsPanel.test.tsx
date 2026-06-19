import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { AgentSessionUiState } from '../../hooks/useSelectedAgentSession';
import type { CallableDetail, RuntimeConfig } from '../../types';
import type { AgentNodeSettingsModel, SelectedEntityDetailsModel } from '../../types/workbench';
import { AgentNodeSettingsPanel, SelectionPropertiesPane } from './AgentNodeSettingsPanel';

const runtimeConfig: RuntimeConfig = {
  run_mode: 'production',
  external_agent_execution_enabled: true,
  real_external_agents_enabled: true,
};

const callableDetail: CallableDetail = {
  id: 'stock-research.codex',
  version: '1.0.0',
  kind: 'agent_class',
  backend: 'codex',
  source_id: 'stock-research.codex',
  name: '股票研究智能体',
  description: '负责股票研究',
  metadata: {
    model: 'gpt-5',
    reasoning_effort: 'high',
    skills: ['finance', 'analysis'],
  },
  input_ports: {},
  output_ports: {},
  artifact_contract: {},
  runtime: 'codex_cli',
  default_prompt: '分析目标公司',
};

function makeNode(overrides: Partial<AgentNodeSettingsModel> = {}): AgentNodeSettingsModel {
  return {
    scopeLabel: '任务画布',
    nodeId: 'agent_a',
    label: '业务模式分析',
    task: '业务模式分析',
    kind: 'Agent',
    status: 'success',
    callableId: 'stock-research.codex',
    codexExecutionMode: 'local_readonly_no_sandbox',
    input: { prompt: '分析目标公司' },
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

function makeAgentSessionState(overrides: Partial<AgentSessionUiState> = {}): AgentSessionUiState {
  return {
    status: 'ready',
    session: {
      session_id: 'session_1',
      provider_session_id: 'provider_1',
      status: 'ready',
      bound_run_id: 'run_1',
      bound_node_id: 'agent_a',
      current_output_turn_id: 'turn_draft',
      published_output_turn_id: null,
      current_output_ref: 'current_output.json',
      session_dir: 'C:/sessions/session_1',
      last_turn_id: 'turn_draft',
    },
    messages: [],
    events: [],
    pendingTurn: null,
    interactions: [],
    error: '',
    ...overrides,
  };
}

function makeDetailModel(overrides: Partial<SelectedEntityDetailsModel> = {}): SelectedEntityDetailsModel {
  return {
    key: 'node:agent_a',
    kind: 'node',
    title: '业务模式分析',
    status: 'success',
    scopeLabel: '基本面工作流',
    log: {
      stdout: '',
      stderr: '',
      excerpt: '',
    },
    properties: [
      {
        title: '基础信息',
        rows: [{ label: '节点', value: '业务模式分析' }],
      },
    ],
    evidenceActions: [],
    events: [],
    ...overrides,
  };
}

describe('AgentNodeSettingsPanel', () => {
  test('renders editable node basics and template summary', () => {
    const onUpdateLabel = vi.fn();
    const onUpdateForwardMainOutput = vi.fn();
    const onUpdateEmptyInputPolicy = vi.fn();
    const onOpenCallableResource = vi.fn();

    render(
      <AgentNodeSettingsPanel
        node={makeNode()}
        runtimeConfig={runtimeConfig}
        callableState={{ status: 'loaded', detail: callableDetail, error: '' }}
        onUpdateInput={vi.fn()}
        onUpdateLabel={onUpdateLabel}
        onUpdateForwardMainOutput={onUpdateForwardMainOutput}
        onUpdateEmptyInputPolicy={onUpdateEmptyInputPolicy}
        onUpdateCodexExecutionMode={vi.fn()}
        onReadEvidence={vi.fn()}
        onOpenCallableResource={onOpenCallableResource}
      />,
    );

    expect(screen.getByText('当前节点')).toBeInTheDocument();
    expect(screen.getAllByText('股票研究智能体')).toHaveLength(2);
    expect(screen.getByText('控制线传递完整输出')).toBeInTheDocument();
    expect(screen.getByText('模板摘要')).toBeInTheDocument();
    expect(screen.getByText('gpt-5')).toBeInTheDocument();
    expect(screen.getByText('高')).toBeInTheDocument();
    expect(screen.getByText('finance')).toBeInTheDocument();
    expect(screen.getByText('本次运行')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '新的节点名' } });
    expect(onUpdateLabel).toHaveBeenCalledWith('新的节点名');

    fireEvent.click(screen.getByLabelText(/控制线传递完整输出/));
    expect(onUpdateForwardMainOutput).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByLabelText(/空输入时阻止运行/));
    expect(onUpdateEmptyInputPolicy).toHaveBeenCalledWith('block');

    fireEvent.click(screen.getByRole('button', { name: '编辑模板' }));
    expect(onOpenCallableResource).toHaveBeenCalledWith('stock-research.codex', '股票研究智能体', 'agent_class');
  });
});

describe('SelectionPropertiesPane', () => {
  test('renders property groups when the selection has no node settings', () => {
    render(
      <SelectionPropertiesPane
        model={makeDetailModel()}
        callableState={{ status: 'idle', detail: null, error: '' }}
        runtimeConfig={runtimeConfig}
        agentSessionState={makeAgentSessionState({ session: null })}
        onReadEvidence={vi.fn()}
        onRefreshAgentSession={vi.fn().mockResolvedValue(undefined)}
        onPublishAgentOutput={vi.fn().mockResolvedValue(undefined)}
        onAnswerAgentInteraction={vi.fn().mockResolvedValue(undefined)}
        onUpdateInput={vi.fn()}
        onUpdateLabel={vi.fn()}
        onUpdateForwardMainOutput={vi.fn()}
        onUpdateEmptyInputPolicy={vi.fn()}
        onUpdateCodexExecutionMode={vi.fn()}
        onOpenCallableResource={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('节点属性')).toBeInTheDocument();
    expect(screen.getByText('基本面工作流')).toBeInTheDocument();
    expect(screen.getByText('基础信息')).toBeInTheDocument();
    expect(screen.getByText('业务模式分析')).toBeInTheDocument();
  });

  test('renders selected node settings with agent session controls', () => {
    render(
      <SelectionPropertiesPane
        model={makeDetailModel({ nodeSettings: makeNode() })}
        callableState={{ status: 'loaded', detail: callableDetail, error: '' }}
        runtimeConfig={runtimeConfig}
        agentSessionState={makeAgentSessionState()}
        onReadEvidence={vi.fn()}
        onRefreshAgentSession={vi.fn().mockResolvedValue(undefined)}
        onPublishAgentOutput={vi.fn().mockResolvedValue(undefined)}
        onAnswerAgentInteraction={vi.fn().mockResolvedValue(undefined)}
        onUpdateInput={vi.fn()}
        onUpdateLabel={vi.fn()}
        onUpdateForwardMainOutput={vi.fn()}
        onUpdateEmptyInputPolicy={vi.fn()}
        onUpdateCodexExecutionMode={vi.fn()}
        onOpenCallableResource={vi.fn()}
      />,
    );

    expect(screen.getByText('Agent 输出')).toBeInTheDocument();
    expect(screen.getByText('有待发布草稿')).toBeInTheDocument();
    expect(screen.getByText('模板摘要')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑模板' })).toBeInTheDocument();
  });
});
