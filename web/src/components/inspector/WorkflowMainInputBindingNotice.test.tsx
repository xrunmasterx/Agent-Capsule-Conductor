import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import type { NodeRunSummary } from '../../types';
import type { WorkflowMainInputBindingState } from '../../types/workbench';
import { WorkflowMainInputBindingNotice } from './WorkflowMainInputBindingNotice';

const binding: WorkflowMainInputBindingState = {
  status: 'bound',
  workflowId: 'research_flow',
  nodeId: 'agent_a',
  sourcePort: 'main',
  targetPort: 'main',
};

function nodeRun(bindingKind?: string): NodeRunSummary {
  return {
    node_id: 'agent_a',
    callable_id: 'agent.template',
    status: 'success',
    run_dir: 'runs/agent_a',
    binding_manifest: bindingKind
      ? {
          bindings: [{ binding_kind: bindingKind }],
        }
      : { bindings: [] },
  };
}

describe('WorkflowMainInputBindingNotice', () => {
  test('renders nothing when binding state is absent', () => {
    const { container } = render(<WorkflowMainInputBindingNotice />);

    expect(container).toBeEmptyDOMElement();
  });

  test('renders unbound state', () => {
    render(
      <WorkflowMainInputBindingNotice
        binding={{
          status: 'unbound',
          workflowId: 'research_flow',
          nodeId: 'agent_a',
          sourcePort: 'main',
          targetPort: 'main',
        }}
      />,
    );

    expect(screen.getByText('当前节点没有 Workflow main 输入绑定。')).toBeInTheDocument();
  });

  test('renders pending evidence state before run', () => {
    render(<WorkflowMainInputBindingNotice binding={binding} />);

    expect(screen.getByText(/research_flow\.main -> agent_a\.main/u)).toBeInTheDocument();
    expect(screen.getByText(/尚未运行/u)).toBeInTheDocument();
  });

  test('renders successful workflow input evidence state', () => {
    render(<WorkflowMainInputBindingNotice binding={binding} nodeRun={nodeRun('workflow_input')} />);

    expect(screen.getByText(/本次运行证据已记录 workflow_input/u)).toBeInTheDocument();
  });

  test('warns when run evidence lacks workflow input binding', () => {
    render(<WorkflowMainInputBindingNotice binding={binding} nodeRun={nodeRun('data_edge')} />);

    expect(screen.getByText(/没有对应 workflow_input 证据/u)).toBeInTheDocument();
  });
});
