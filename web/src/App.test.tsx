import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { App } from './App';
import { __workflowViewerTestables } from './components/WorkflowViewer';

const runSummary = {
  run_id: 'ui_acceptance_fake',
  workflow_id: null,
  status: 'success',
  started_at: '2026-05-24T00:00:00Z',
  ended_at: '2026-05-24T00:00:01Z',
  duration_ms: 1000,
  run_dir: 'runs/ui_acceptance_fake',
  node_count: 1,
  failed_nodes: [],
  output_path: 'runs/ui_acceptance_fake/output.json',
  artifact_dir: 'runs/ui_acceptance_fake/artifacts',
  nodes: [
    {
      node_id: 'ui_acceptance_fake',
      callable_id: 'fake-agent.generic',
      session_id: 'session_fixture',
      status: 'success',
      summary: 'Created deterministic report',
      duration_ms: 1000,
      run_dir: 'runs/ui_acceptance_fake',
      input_path: 'runs/ui_acceptance_fake/input.json',
      prompt_path: 'runs/ui_acceptance_fake/resolved_prompt.md',
      output_path: 'runs/ui_acceptance_fake/output.json',
      artifact_dir: 'runs/ui_acceptance_fake/artifacts',
      event_log: 'runs/ui_acceptance_fake/events.jsonl',
      stdout_log: 'runs/ui_acceptance_fake/stdout.log',
      stderr_log: 'runs/ui_acceptance_fake/stderr.log',
      errors: [],
    },
  ],
};

const routes: Record<string, unknown> = {
  '/api/runs': { version: '2.0', runs: [runSummary] },
  '/api/runs/ui_acceptance_fake': runSummary,
  '/api/runs/ui_acceptance_fake/interactions': {
    run_id: 'ui_acceptance_fake',
    interactions: [
      {
        interaction_id: 'ix_pending',
        run_id: 'ui_acceptance_fake',
        node_id: 'ui_acceptance_fake',
        kind: 'approval',
        status: 'pending',
        prompt: '是否继续部署？',
        options: ['approve', 'reject'],
        payload: {},
        created_at: '2026-05-29T00:00:00Z',
      },
    ],
  },
  'POST /api/runs/ui_acceptance_fake/interactions/ix_pending/answer': {
    interaction_id: 'ix_pending',
    run_id: 'ui_acceptance_fake',
    node_id: 'ui_acceptance_fake',
    kind: 'approval',
    status: 'answered',
    prompt: '是否继续部署？',
    options: ['approve', 'reject'],
    payload: {},
    created_at: '2026-05-29T00:00:00Z',
    answered_at: '2026-05-29T00:00:01Z',
    answer: { decision: 'approve' },
  },
  '/api/runs/ui_acceptance_fake/nodes/ui_acceptance_fake/artifacts': {
    run_id: 'ui_acceptance_fake',
    node_id: 'ui_acceptance_fake',
    artifacts: [
      {
        name: 'report.md',
        path: 'runs/ui_acceptance_fake/artifacts/report.md',
        read_url: '/api/artifacts/read?path=runs/ui_acceptance_fake/artifacts/report.md',
        size_bytes: 42,
      },
    ],
  },
  '/api/artifacts/read?path=runs%2Fui_acceptance_fake%2Fartifacts%2Freport.md': {
    path: 'runs/ui_acceptance_fake/artifacts/report.md',
    name: 'report.md',
    type: 'markdown',
    content: '# Report\n\nSemiconductor analysis fixture.',
    size_bytes: 42,
  },
  '/api/artifacts/read?path=runs%2Fui_acceptance_fake%2Foutput.json': {
    path: 'runs/ui_acceptance_fake/output.json',
    name: 'output.json',
    type: 'json',
    content: '{"status":"success","summary":"ok"}',
    size_bytes: 36,
  },
  '/api/artifacts/read?path=runs%2Fui_acceptance_fake%2Finput.json': {
    path: 'runs/ui_acceptance_fake/input.json',
    name: 'input.json',
    type: 'json',
    content: '{"message":"hello from input"}',
    size_bytes: 30,
  },
  '/api/callables': {
    callables: [
      {
        id: 'echo-test.generic',
        version: '0.1.0',
        name: 'Echo Test',
        kind: 'agent_class',
        backend: 'native',
        source_id: 'echo-test.generic',
        source_path: 'callables/agents/echo-test.generic.yaml',
      },
      {
        id: 'nested-workflow.example',
        version: '0.1.0',
        name: 'Nested Workflow',
        kind: 'agent_class',
        backend: 'native',
        source_id: 'nested-workflow.example',
        source_path: 'callables/agents/nested-workflow.example.yaml',
      },
      {
        id: 'fake-agent.generic',
        version: '0.1.0',
        name: 'Fake Agent',
        kind: 'tool_class',
        backend: 'native',
        source_id: 'fake-agent.generic',
        source_path: 'callables/tools/fake-agent.generic.yaml',
      },
    ],
  },
  '/api/callables/echo-test.generic': {
    callable: {
      id: 'echo-test.generic',
      version: '0.1.0',
      name: 'Echo Test',
      kind: 'agent_class',
      backend: 'native',
      source_id: 'echo-test.generic',
      source_path: 'callables/agents/echo-test.generic.yaml',
      metadata: { description: 'Echo fixture callable' },
      input_ports: { main: { type: 'json' } },
      output_ports: { main: { type: 'json' } },
      artifact_contract: {},
      runtime: 'generic_cli',
    },
  },
  '/api/callables/fake-agent.generic': {
    callable: {
      id: 'fake-agent.generic',
      version: '0.1.0',
      name: 'Fake Agent',
      kind: 'tool_class',
      backend: 'native',
      source_id: 'fake-agent.generic',
      source_path: 'callables/tools/fake-agent.generic.yaml',
      metadata: { description: 'Fixture callable' },
      input_ports: { main: { type: 'json' } },
      output_ports: { main: { type: 'json' } },
      artifact_contract: {},
      runner: 'generic_cli',
    },
  },
  '/api/workflows': {
    workflows: [
      {
        workflow_id: 'demo_serial',
        file_id: 'demo_serial',
        name: 'Demo Workflow',
        description: 'Fixture graph workflow',
        version: '0.2.0',
        path: 'workflows/demo_serial.graph.json',
        task_count: 2,
        type: 'graph',
      },
    ],
  },
  '/api/workflows/demo_serial': {
    workflow_id: 'demo_serial',
    file_id: 'demo_serial',
    path: 'workflows/demo_serial.graph.json',
    type: 'graph',
    workflow: {
      id: 'demo_serial',
      name: 'Demo Workflow',
      description: 'Fixture graph workflow',
      version: '0.2.0',
      nodes: [
        {
          id: 'echo',
          callable_id: 'echo-test.generic',
          label: '输入回显',
          input: { message: 'hello' },
          input_mapping: {},
          position: { x: 80, y: 160 },
        },
        {
          id: 'fake',
          callable_id: 'fake-agent.generic',
          label: '下游处理',
          input: {},
          input_mapping: { topic: '{{ nodes.echo.output.summary }}' },
          position: { x: 420, y: 160 },
        },
      ],
      edges: [{ id: 'edge_echo_fake', from: 'echo', to: 'fake', label: 'output to downstream' }],
    },
    graph: {
      id: 'demo_serial',
      name: 'Demo Workflow',
      description: 'Fixture graph workflow',
      version: '0.2.0',
      nodes: [
        {
          id: 'echo',
          callable_id: 'echo-test.generic',
          label: '输入回显',
          input: { message: 'hello' },
          input_mapping: {},
          position: { x: 80, y: 160 },
        },
        {
          id: 'fake',
          callable_id: 'fake-agent.generic',
          label: '下游处理',
          input: {},
          input_mapping: { topic: '{{ nodes.echo.output.summary }}' },
          position: { x: 420, y: 160 },
        },
      ],
      edges: [{ id: 'edge_echo_fake', from: 'echo', to: 'fake', label: 'output to downstream' }],
    },
  },
  'POST /api/workflows': { status: 'saved', workflow_id: 'demo_serial' },
  'POST /api/workflows/demo_serial/validate': { status: 'valid', workflow_id: 'demo_serial' },
  'POST /api/workflows/demo_serial/run': {
    workflow_id: 'demo_serial',
    status: 'success',
    run_dir: 'runs/ui_workflow_demo_serial',
    nodes: [
      {
        node_id: 'echo',
        callable_id: 'echo-test.generic',
        status: 'success',
        run_dir: 'runs/ui_workflow_demo_serial/nodes/echo',
        input_path: 'runs/ui_workflow_demo_serial/nodes/echo/input.json',
        prompt_path: 'runs/ui_workflow_demo_serial/nodes/echo/resolved_prompt.md',
        output_path: 'runs/ui_workflow_demo_serial/nodes/echo/output.json',
        artifact_dir: 'runs/ui_workflow_demo_serial/nodes/echo/artifacts',
        event_log: 'runs/ui_workflow_demo_serial/nodes/echo/events.jsonl',
        stdout_log: 'runs/ui_workflow_demo_serial/nodes/echo/stdout.log',
        stderr_log: 'runs/ui_workflow_demo_serial/nodes/echo/stderr.log',
      },
    ],
    edges: [{ id: 'edge_echo_fake', from: 'echo', to: 'fake' }],
    errors: [],
  },
  'POST /api/workflows/acc_workspace_canvas/validate': { status: 'valid', workflow_id: 'acc_workspace_canvas' },
  'POST /api/workflows/acc_workspace_canvas/run': {
    workflow_id: 'acc_workspace_canvas',
    status: 'success',
    run_dir: 'runs/ui_workflow_acc_workspace_canvas',
    nodes: [
      {
        node_id: 'Research_Flow',
        callable_id: 'fake-agent.generic',
        status: 'success',
        run_dir: 'runs/ui_workflow_acc_workspace_canvas/nodes/Research_Flow',
        input_path: 'runs/ui_workflow_acc_workspace_canvas/nodes/Research_Flow/input.json',
        prompt_path: 'runs/ui_workflow_acc_workspace_canvas/nodes/Research_Flow/resolved_prompt.md',
        output_path: 'runs/ui_workflow_acc_workspace_canvas/nodes/Research_Flow/output.json',
        artifact_dir: 'runs/ui_workflow_acc_workspace_canvas/nodes/Research_Flow/artifacts',
        event_log: 'runs/ui_workflow_acc_workspace_canvas/nodes/Research_Flow/events.jsonl',
        stdout_log: 'runs/ui_workflow_acc_workspace_canvas/nodes/Research_Flow/stdout.log',
        stderr_log: 'runs/ui_workflow_acc_workspace_canvas/nodes/Research_Flow/stderr.log',
      },
    ],
    edges: [],
    errors: [],
  },
  'POST /api/workflows/run-graph': {
    workflow_id: 'ui_workflow_acc_workspace_canvas_fixture',
    status: 'success',
    run_dir: 'runs/ui_workflow_acc_workspace_canvas_fixture',
    nodes: [
      {
        node_id: 'Research_Flow',
        callable_id: 'fake-agent.generic',
        status: 'success',
        run_dir: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow',
        input_path: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/input.json',
        prompt_path: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/resolved_prompt.md',
        output_path: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/output.json',
        artifact_dir: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/artifacts',
        event_log: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/events.jsonl',
        stdout_log: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/stdout.log',
        stderr_log: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/stderr.log',
      },
      {
        node_id: 'research_codex',
        ui_node_id: 'Research_Flow__internal__research_codex',
        parent_node_id: 'Research_Flow',
        callable_id: 'fake-agent.generic',
        status: 'success',
        run_dir: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/internal/research_codex',
        input_path: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/internal/research_codex/input.json',
        prompt_path: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/internal/research_codex/resolved_prompt.md',
        output_path: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/internal/research_codex/output.json',
        artifact_dir: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/internal/research_codex/artifacts',
        event_log: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/internal/research_codex/events.jsonl',
        stdout_log: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/internal/research_codex/stdout.log',
        stderr_log: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/internal/research_codex/stderr.log',
      },
    ],
    edges: [],
    errors: [],
  },
  '/api/artifacts/read?path=runs%2Fui_workflow_acc_workspace_canvas_fixture%2Fnodes%2FResearch_Flow%2Finput.json': {
    path: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/input.json',
    name: 'input.json',
    type: 'json',
    content: '{"topic":"Research input fixture","upstream":"真实上游输入"}',
    size_bytes: 64,
  },
  '/api/artifacts/read?path=runs%2Fui_workflow_acc_workspace_canvas_fixture%2Fnodes%2FResearch_Flow%2Foutput.json': {
    path: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/output.json',
    name: 'output.json',
    type: 'json',
    content: '{"status":"success","summary":"Research output fixture"}',
    size_bytes: 56,
  },
  '/api/artifacts/read?path=runs%2Fui_workflow_acc_workspace_canvas_fixture%2Fnodes%2FResearch_Flow%2Finternal%2Fresearch_codex%2Finput.json': {
    path: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/internal/research_codex/input.json',
    name: 'input.json',
    type: 'json',
    content: '{"topic":"Codex CLI","upstream":"真实上游输入"}',
    size_bytes: 49,
  },
  '/api/artifacts/read?path=runs%2Fui_workflow_acc_workspace_canvas_fixture%2Fnodes%2FResearch_Flow%2Finternal%2Fresearch_codex%2Foutput.json': {
    path: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/internal/research_codex/output.json',
    name: 'output.json',
    type: 'json',
    content: '{"status":"success","summary":"Codex agent output fixture"}',
    size_bytes: 59,
  },
  '/api/graphops/examples': {
    patches: [
      {
        id: 'add-review-node.patch',
        path: 'examples/graphops/add-review-node.patch.json',
        name: 'add-review-node.patch.json',
      },
    ],
  },
  'POST /api/graphops/validate': {
    status: 'valid',
    patch_id: 'patch_add_review_node',
    target_type: 'workflow',
    target_path: 'examples/workflows/control_plane_demo.graph.json',
    operations: 3,
    apply_requires_human_approval: true,
    semantic_diff: { status: 'valid', added_nodes: ['review'], added_edges: ['a->review'] },
  },
  'POST /api/graphops/dry-run': {
    status: 'dry_run',
    patch_id: 'patch_add_review_node',
    target_type: 'workflow',
    target_path: 'examples/workflows/control_plane_demo.graph.json',
    mutated: false,
    apply_requires_human_approval: true,
    operations: [{ op: 'add_node', description: 'Would add node review using callable critical-review.claude' }],
    semantic_diff: { status: 'valid', added_nodes: ['review'], added_edges: ['a->review'] },
  },
  'POST /api/debugger/runs/ui_acceptance_fake/replay': {
    run_dir: 'runs/ui_acceptance_fake',
    status: 'success',
    workflow_status: 'success',
    workflow_id: 'ui_acceptance_fake',
    node_filter: 'ui_acceptance_fake',
    failed_node: null,
    nodes: [{ node_id: 'ui_acceptance_fake', status: 'success' }],
    timeline: [{ type: 'node_completed', node_id: 'ui_acceptance_fake', status: 'success' }],
    errors: [],
    event_log: 'runs/ui_acceptance_fake/events.jsonl',
  },
  'POST /api/debugger/runs/ui_acceptance_fake/nodes/ui_acceptance_fake/rerun': {
    workflow_id: 'ui_acceptance_fake',
    status: 'success',
    run_dir: 'runs/ui_rerun_node_ui_acceptance_fake',
    nodes: [],
    edges: [],
    errors: [],
  },
  'POST /api/debugger/runs/ui_acceptance_fake/nodes/ui_acceptance_fake/rerun-from': {
    workflow_id: 'ui_acceptance_fake',
    status: 'success',
    run_dir: 'runs/ui_rerun_from_ui_acceptance_fake',
    nodes: [],
    edges: [],
    errors: [],
  },
  'POST /api/debugger/runs/ui_acceptance_fake/nodes/ui_acceptance_fake/fork': {
    workflow_id: 'ui_acceptance_fake',
    status: 'success',
    run_dir: 'runs/ui_fork_ui_acceptance_fake',
    nodes: [],
    edges: [],
    errors: [],
  },
  'POST /api/debugger/diff': {
    run_a: 'runs/ui_acceptance_fake',
    run_b: 'runs/ui_rerun_node_ui_acceptance_fake',
    status: { a: 'success', b: 'success', changed: false },
    changed_nodes: [],
    node_diffs: [],
  },
};

const failedRoutes = new Map<string, { status: number; detail: string }>();

function failRoute(method: string, url: string, detail: string, status = 500) {
  failedRoutes.set(`${method} ${url}`, { status, detail });
}

function workspaceCanvasRunSummary(runId: string) {
  return {
    run_id: runId,
    workflow_id: 'ui_workflow_acc_workspace_canvas_fixture',
    status: 'success',
    started_at: '2026-05-24T00:00:00Z',
    ended_at: '2026-05-24T00:00:01Z',
    duration_ms: 1000,
    run_dir: `runs/${runId}`,
    node_count: 2,
    failed_nodes: [],
    output_path: `runs/${runId}/workflow_summary.json`,
    artifact_dir: `runs/${runId}/artifacts`,
    nodes: [
      {
        node_id: 'Research_Flow',
        callable_id: 'fake-agent.generic',
        status: 'success',
        run_dir: `runs/${runId}/nodes/Research_Flow`,
        input_path: `runs/${runId}/nodes/Research_Flow/input.json`,
        prompt_path: `runs/${runId}/nodes/Research_Flow/resolved_prompt.md`,
        output_path: `runs/${runId}/nodes/Research_Flow/output.json`,
        artifact_dir: `runs/${runId}/nodes/Research_Flow/artifacts`,
        event_log: `runs/${runId}/nodes/Research_Flow/events.jsonl`,
        stdout_log: `runs/${runId}/nodes/Research_Flow/stdout.log`,
        stderr_log: `runs/${runId}/nodes/Research_Flow/stderr.log`,
      },
      {
        node_id: 'research_codex',
        ui_node_id: 'Research_Flow__internal__research_codex',
        parent_node_id: 'Research_Flow',
        callable_id: 'fake-agent.generic',
        status: 'success',
        run_dir: `runs/${runId}/nodes/Research_Flow/internal/research_codex`,
        input_path: `runs/${runId}/nodes/Research_Flow/internal/research_codex/input.json`,
        prompt_path: `runs/${runId}/nodes/Research_Flow/internal/research_codex/resolved_prompt.md`,
        output_path: `runs/${runId}/nodes/Research_Flow/internal/research_codex/output.json`,
        artifact_dir: `runs/${runId}/nodes/Research_Flow/internal/research_codex/artifacts`,
        event_log: `runs/${runId}/nodes/Research_Flow/internal/research_codex/events.jsonl`,
        stdout_log: `runs/${runId}/nodes/Research_Flow/internal/research_codex/stdout.log`,
        stderr_log: `runs/${runId}/nodes/Research_Flow/internal/research_codex/stderr.log`,
      },
    ],
  };
}

function workspaceCanvasRunEvents(runId: string) {
  return {
    run_id: runId,
    event_log: `runs/${runId}/workflow_events.jsonl`,
    events: [
      { type: 'workflow_started', status: 'running' },
      { type: 'node_completed', node_id: 'Research_Flow', status: 'success' },
      {
        type: 'node_completed',
        node_id: 'research_codex',
        ui_node_id: 'Research_Flow__internal__research_codex',
        parent_node_id: 'Research_Flow',
        status: 'success',
      },
      { type: 'workflow_completed', status: 'success' },
    ],
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method || 'GET';
      const failedRoute = failedRoutes.get(`${method} ${url}`) ?? failedRoutes.get(url);
      if (failedRoute) {
        return new Response(JSON.stringify({ detail: failedRoute.detail }), {
          status: failedRoute.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'POST' && url === '/api/workflows/run-graph/submit') {
        const body = JSON.parse(String(init?.body || '{}'));
        const runId = String(body.run_dir || '').split('/').pop() || body.graph?.id || 'ui_workflow_acc_workspace_canvas_fixture';
        return new Response(
          JSON.stringify({
            run_id: runId,
            task_id: body.task_id,
            status: 'running',
            run_dir: `runs/${runId}`,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      const workspaceCanvasRun = url.match(/^\/api\/runs\/(ui_workflow_acc_workspace_canvas(?:_fixture)?_\d+)$/u);
      if (method === 'GET' && workspaceCanvasRun) {
        return new Response(JSON.stringify(workspaceCanvasRunSummary(workspaceCanvasRun[1])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const workspaceCanvasEvents = url.match(
        /^\/api\/runs\/(ui_workflow_acc_workspace_canvas(?:_fixture)?_\d+)\/events\?limit=\d+$/u,
      );
      if (method === 'GET' && workspaceCanvasEvents) {
        return new Response(JSON.stringify(workspaceCanvasRunEvents(workspaceCanvasEvents[1])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (
        method === 'GET' &&
        /^\/api\/artifacts\/read\?path=runs%2Fui_workflow_acc_workspace_canvas(?:_fixture)?_\d+%2Fnodes%2FResearch_Flow%2Finternal%2Fresearch_codex%2Finput\.json$/u.test(
          url,
        )
      ) {
        return new Response(
          JSON.stringify({
            path: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/internal/research_codex/input.json',
            name: 'input.json',
            type: 'json',
            content: '{"topic":"Codex CLI","upstream":"真实上游输入"}',
            size_bytes: 49,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (
        method === 'GET' &&
        /^\/api\/artifacts\/read\?path=runs%2Fui_workflow_acc_workspace_canvas(?:_fixture)?_\d+%2Fnodes%2FResearch_Flow%2Finternal%2Fresearch_codex%2Foutput\.json$/u.test(
          url,
        )
      ) {
        return new Response(
          JSON.stringify({
            path: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/internal/research_codex/output.json',
            name: 'output.json',
            type: 'json',
            content: '{"status":"success","summary":"Codex agent output fixture"}',
            size_bytes: 59,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const payload = routes[`${method} ${url}`] ?? routes[url];
      if (!payload) {
        return new Response(JSON.stringify({ detail: `Missing route ${url}` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  failedRoutes.clear();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('Agent Callable Workbench editable UI', () => {
  async function openNavigation(user: ReturnType<typeof userEvent.setup>, name: RegExp | string) {
    const navigation = await screen.findByLabelText('Workbench navigation');
    await user.click(within(navigation).getByRole('button', { name }));
  }

  async function openNavIndex(user: ReturnType<typeof userEvent.setup>, index: number) {
    const navigation = await screen.findByLabelText('Workbench navigation');
    await user.click(within(navigation).getAllByRole('button')[index]);
  }

  async function loadWorkspaceDemo(user: ReturnType<typeof userEvent.setup>) {
    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: '加载示例' }));
  }

  test('Run List and Run Inspector render fixture run from acc-server APIs', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavigation(user, /运行记录/i);
    expect((await screen.findAllByText('ui_acceptance_fake')).length).toBeGreaterThan(0);
    expect(await screen.findByText('fake-agent.generic')).toBeInTheDocument();
    expect(screen.getByLabelText(/\u8fd0\u884c\u68c0\u67e5\u5668/)).toHaveTextContent('session_fixture');
  });

  test('Run Inspector can view JSON output through artifact API', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavigation(user, /运行记录/i);
    await screen.findAllByText('ui_acceptance_fake');
    await user.click(await screen.findByRole('button', { name: /\u8f93\u51fa/i }));

    expect(await screen.findByLabelText('runs/ui_acceptance_fake/output.json')).toHaveTextContent(
      '"summary": "ok"',
    );
  });

  test('Artifact Viewer renders markdown artifact fixture', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /产物/i }));
    await user.click(await screen.findByRole('button', { name: /report.md/i }));

    expect(await screen.findByLabelText(/\u4ea7\u7269 report.md/)).toHaveTextContent(
      'Semiconductor analysis fixture.',
    );
  });

  test('Callable Browser renders callable metadata and ports', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 1);

    const browser = await screen.findByLabelText('Callable 资源库');
    expect(within(browser).getByRole('heading', { name: 'Callable 资源库' })).toBeInTheDocument();
    expect(browser).toHaveTextContent('echo-test.generic');
    expect(within(browser).getAllByText('agent_class').length).toBeGreaterThan(0);
    expect(await within(browser).findByText('callables/agents/echo-test.generic.yaml')).toBeInTheDocument();
  });

  test('Workflow Builder renders graph-first workspace canvas', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    await loadWorkspaceDemo(user);

    const canvas = await screen.findByLabelText('任务画布');
    expect(canvas).toHaveTextContent('Research_Flow');
    expect(canvas).toHaveTextContent('Implementation_Flow');
    expect(canvas).toHaveTextContent('Review_Flow');
    expect(canvas).toHaveTextContent('Paper_Digest_Pipeline');
    expect(canvas).toHaveTextContent('F:\\UE5_Project_A\\workflows\\research');
    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: /^属性$/i }));
    await user.click(within(await screen.findByLabelText('连接模式')).getByRole('button', { name: '数据' }));
    expect(canvas).toHaveTextContent('in_requirements');
    expect(canvas).toHaveTextContent('out_report');
    expect(canvas).toHaveTextContent('Codex CLI');
    expect(canvas).toHaveTextContent('Merge');
  });

  test('Primary navigation shows readable Chinese icon labels', async () => {
    render(<App />);

    const navigation = await screen.findByLabelText('Workbench navigation');
    for (const label of ['任务', '资源', '运行记录', '产物', '决策', '控制平面']) {
      expect(within(navigation).getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(navigation).not.toHaveTextContent('浠诲姟');
    expect(navigation).not.toHaveTextContent('璧勬簮');
  });

  test('startup keeps task resources usable when run index fails', async () => {
    failRoute('GET', '/api/runs', 'Run index exploded');
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('API 部分可用')).toBeInTheDocument();

    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: /^资源$/i }));
    expect(await screen.findByText('Fake Agent')).toBeInTheDocument();
    expect((await screen.findByText('Demo Workflow')).closest('article')).toHaveClass(
      'resource-kind-workflow',
    );
    expect(screen.getByText('Echo Test').closest('article')).toHaveClass('resource-kind-agent');
    expect(screen.getByText('Fake Agent').closest('article')).toHaveClass('resource-kind-tool');
    expect(screen.getByText('File Source').closest('article')).toHaveClass('resource-kind-file-source');

    await openNavIndex(user, 2);
    expect(await screen.findByText(/运行记录加载失败：/)).toHaveTextContent('Run index exploded');
  });

  test('startup keeps runs usable when callable index fails', async () => {
    failRoute('GET', '/api/callables', 'Callable registry exploded');
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('API 部分可用')).toBeInTheDocument();

    await openNavIndex(user, 2);
    expect((await screen.findAllByText('ui_acceptance_fake')).length).toBeGreaterThan(0);

    await openNavIndex(user, 1);
    expect(await screen.findByText(/Callable 模板加载失败：/)).toHaveTextContent(
      'Callable registry exploded',
    );
  });

  test('startup keeps callable resources usable when workflow index fails', async () => {
    failRoute('GET', '/api/workflows', 'Workflow index exploded');
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('API 部分可用')).toBeInTheDocument();

    await openNavIndex(user, 1);
    expect((await screen.findAllByText('echo-test.generic')).length).toBeGreaterThan(0);

    await openNavIndex(user, 0);
    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: /^资源$/i }));
    expect(await screen.findByText(/Workflow 模板加载失败：/)).toHaveTextContent(
      'Workflow index exploded',
    );
  });

  test('Task list persists across navigation switches and supports explicit delete', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    const workbench = await screen.findByLabelText('ACC Workbench');
    expect(await screen.findByLabelText('任务画布')).not.toHaveTextContent('Research_Flow');

    await user.click(within(workbench).getByRole('button', { name: '新建任务' }));
    expect((await screen.findAllByText('任务 2')).length).toBeGreaterThan(0);

    await openNavIndex(user, 1);
    await openNavIndex(user, 0);
    expect((await screen.findAllByText('任务 2')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '删除任务 任务 2' }));
    await waitFor(() => expect(screen.queryByText('任务 2')).not.toBeInTheDocument());
  });

  test('Completed task restores its previous run state when selected again', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    await loadWorkspaceDemo(user);

    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: /^运行$/i }));
    await screen.findByText(/ui_workflow_acc_workspace_canvas_fixture: 成功/i);

    const runCallsBeforeSwitch = vi.mocked(fetch).mock.calls.filter(
      ([url, init]) => url === '/api/workflows/run-graph/submit' && init?.method === 'POST',
    ).length;

    const workbench = await screen.findByLabelText('ACC Workbench');
    await user.click(within(workbench).getByRole('button', { name: '新建任务' }));
    await waitFor(() =>
      expect(screen.queryByTestId('workflow-container-Research_Flow')).not.toBeInTheDocument(),
    );

    const taskRail = await screen.findByLabelText('任务列表');
    await user.click(taskRail.querySelector('.task-rail-select') as HTMLButtonElement);

    const restoredWorkflow = await screen.findByTestId('workflow-container-Research_Flow');
    await waitFor(() => expect(restoredWorkflow).toHaveClass('status-success'));
    await waitFor(() =>
      expect(screen.getByTestId('agent-tool-node-Research_Flow__internal__research_codex')).toHaveClass(
        'status-success',
      ),
    );

    const runCallsAfterSwitch = vi.mocked(fetch).mock.calls.filter(
      ([url, init]) => url === '/api/workflows/run-graph/submit' && init?.method === 'POST',
    ).length;
    expect(runCallsAfterSwitch).toBe(runCallsBeforeSwitch);
  });

  test('Resource drawer can create a workflow and add selected agents into it', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);

    const workbench = await screen.findByLabelText('ACC Workbench');
    await user.click(within(workbench).getByRole('button', { name: '新建任务' }));
    await user.click(within(workbench).getByRole('button', { name: '资源' }));
    const navigator = await screen.findByLabelText('Workspace Navigator');
    await user.click(within(navigator).getByRole('button', { name: '拖入 Workflow' }));

    const workflowNode = await screen.findByTestId('workflow-container-New_Workflow');
    expect(workflowNode).toHaveTextContent('New Workflow');
    const fakeAgentResource = within(navigator).getByText('Fake Agent').closest('article');
    expect(fakeAgentResource).toBeTruthy();
    expect(
      within(fakeAgentResource as HTMLElement).getByRole('button', {
        name: /加入到选中 Workflow/,
      }),
    ).toBeInTheDocument();
  });

  test('Node create menu is dismissed when switching to a new task', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);

    const canvas = await screen.findByLabelText('任务画布');
    fireEvent.contextMenu(canvas, { clientX: 1200, clientY: 600 });
    expect(await screen.findByRole('menu', { name: /新增节点/ })).toBeInTheDocument();

    const workbench = await screen.findByLabelText('ACC Workbench');
    await user.click(within(workbench).getByRole('button', { name: '新建任务' }));

    await waitFor(() =>
      expect(screen.queryByRole('menu', { name: /新增节点/ })).not.toBeInTheDocument(),
    );
  });

  test('Workflow container with one internal agent keeps workflow semantics across graph roundtrip', () => {
    const helpers = __workflowViewerTestables as any;
    const baseCanvas = {
      id: 'root_task',
      name: 'Root Task',
      rootWorkflowId: 'root_task',
      layout: 'workspace-canvas',
      workflows: [],
      edges: [],
    };
    const withWorkflow = helpers.addWorkflowFromPalette(
      baseCanvas,
      { kind: 'workflow', label: 'New Workflow' },
      { x: 100, y: 100 },
    );
    const workflowId = withWorkflow.workflows[0].id;
    const withInternalAgent = helpers.addInternalNodeFromPalette(
      withWorkflow,
      workflowId,
      { kind: 'agent', callableId: 'fake-agent.generic', label: 'Fake Agent' },
      { x: 120, y: 130 },
    );
    const workflow = withInternalAgent.workflows[0];

    expect(workflow.internalNodes).toHaveLength(1);
    expect(helpers.isExecutableNodeWorkflow(workflow)).toBe(false);

    const graph = helpers.canvasToWorkflowGraph(withInternalAgent);
    const graphNode = graph.nodes.find((node: { id: string }) => node.id === workflowId);
    expect(graphNode).toMatchObject({
      kind: 'workflow',
      ui: expect.objectContaining({ semantic_kind: 'workflow_container' }),
    });

    const roundTripped = helpers.graphToWorkspaceCanvas(graph, null);
    const roundTrippedWorkflow = roundTripped.workflows.find((item: { id: string }) => item.id === workflowId);
    expect(roundTrippedWorkflow?.internalNodes).toHaveLength(1);
    expect(helpers.isExecutableNodeWorkflow(roundTrippedWorkflow)).toBe(false);
  });

  test('Root resource add position avoids overlapping existing workflow containers', () => {
    const helpers = __workflowViewerTestables as any;
    const canvas = {
      id: 'root_task',
      name: 'Root Task',
      rootWorkflowId: 'root_task',
      layout: 'workspace-canvas',
      workflows: [
        {
          id: 'workflow',
          title: 'Workflow',
          sourceKind: 'workflow',
          directory: 'workspace',
          status: 'not_run',
          inputPorts: [],
          outputPorts: [],
          internalNodes: [],
          internalEdges: [],
          position: { x: 160, y: 180 },
          size: { width: 430, height: 328 },
          warnings: [],
        },
      ],
      edges: [],
    };

    const position = helpers.nextRootPalettePosition(canvas);

    expect(position.x).toBeGreaterThan(160 + 430);
  });

  test('Root resource add keeps consecutive agents in the visible row before wrapping', () => {
    const helpers = __workflowViewerTestables as any;
    const baseCanvas = {
      id: 'root_task',
      name: 'Root Task',
      rootWorkflowId: 'root_task',
      layout: 'workspace-canvas',
      workflows: [],
      edges: [],
    };
    const first = helpers.addCallableNodeFromPalette(
      baseCanvas,
      { kind: 'agent', callableId: 'semiconductor-stock-news-collector.codex', label: '半导体股市信息收集' },
      helpers.nextRootPalettePosition(baseCanvas),
    );
    const second = helpers.addCallableNodeFromPalette(
      first,
      { kind: 'agent', callableId: 'semiconductor-stock-news-cleaner.codex', label: '半导体股市信息清洗' },
      helpers.nextRootPalettePosition(first),
    );
    const third = helpers.addCallableNodeFromPalette(
      second,
      { kind: 'agent', callableId: 'semiconductor-stock-analysis-advisor.codex', label: '半导体股市分析和建议' },
      helpers.nextRootPalettePosition(second),
    );

    expect(third.workflows.map((workflow: any) => workflow.position)).toEqual([
      { x: 620, y: 180 },
      { x: 620, y: 340 },
      { x: 620, y: 500 },
    ]);
  });

  test('Chinese resource labels use stable callable ids instead of colliding node fallback ids', () => {
    const helpers = __workflowViewerTestables as any;
    const baseCanvas = {
      id: 'root_task',
      name: 'Root Task',
      rootWorkflowId: 'root_task',
      layout: 'workspace-canvas',
      workflows: [],
      edges: [],
    };
    const withWorkflow = helpers.addWorkflowFromPalette(
      baseCanvas,
      { kind: 'workflow', label: 'New Workflow' },
      { x: 100, y: 100 },
    );
    const workflowId = withWorkflow.workflows[0].id;
    const withInternal = helpers.addInternalNodeFromPalette(
      withWorkflow,
      workflowId,
      {
        kind: 'agent',
        callableId: 'semiconductor-stock-news-collector.codex',
        label: '半导体股市信息收集',
      },
      { x: 120, y: 130 },
    );
    const withRoot = helpers.addCallableNodeFromPalette(
      withInternal,
      {
        kind: 'agent',
        callableId: 'semiconductor-stock-analysis-advisor.codex',
        label: '半导体股市分析和建议',
      },
      { x: 700, y: 180 },
    );

    expect(withRoot.workflows[0].internalNodes[0].id).toBe('semiconductor_stock_news_collector_codex');
    expect(withRoot.workflows[1].id).toBe('semiconductor_stock_analysis_advisor_codex');
  });

  test('Repeated callable instances get distinct invocation labels without changing callable identity', () => {
    const helpers = __workflowViewerTestables as any;
    const baseCanvas = {
      id: 'root_task',
      name: 'Root Task',
      rootWorkflowId: 'root_task',
      layout: 'workspace-canvas',
      workflows: [],
      edges: [],
    };
    const item = { kind: 'agent', callableId: 'fake-agent.generic', label: 'Fake Agent' };
    const first = helpers.addCallableNodeFromPalette(baseCanvas, item, { x: 120, y: 180 });
    const second = helpers.addCallableNodeFromPalette(first, item, { x: 500, y: 180 });

    expect(second.workflows.map((workflow: any) => workflow.title)).toEqual(['Fake Agent', 'Fake Agent #2']);
    expect(second.workflows.map((workflow: any) => workflow.callableId)).toEqual([
      'fake-agent.generic',
      'fake-agent.generic',
    ]);
    const graph = helpers.canvasToWorkflowGraph(second);
    expect(graph.nodes.map((node: any) => node.metadata.ui_label)).toEqual(['Fake Agent', 'Fake Agent #2']);
  });

  test('Invocation input helpers keep user prompt separate from static input', () => {
    const helpers = __workflowViewerTestables as any;
    const input = { user_prompt: 'write report', region: 'US', limit: 5 };

    expect(helpers.promptFromInvocationInput(input)).toBe('write report');
    expect(helpers.staticInputFromInvocationInput(input)).toEqual({ region: 'US', limit: 5 });
  });

  test('Repeated palette adds keep internal node positions bounded inside workflow', () => {
    const helpers = __workflowViewerTestables as any;
    const baseCanvas = {
      id: 'root_task',
      name: 'Root Task',
      rootWorkflowId: 'root_task',
      layout: 'workspace-canvas',
      workflows: [],
      edges: [],
    };
    const withWorkflow = helpers.addWorkflowFromPalette(
      baseCanvas,
      { kind: 'workflow', label: 'New Workflow' },
      { x: 100, y: 100 },
    );
    const workflowId = withWorkflow.workflows[0].id;
    const item = { kind: 'agent', callableId: 'fake-agent.generic', label: 'Fake Agent' };
    const positions = [
      { x: 120, y: 130 },
      { x: 460, y: 130 },
      { x: 800, y: 130 },
      { x: 1140, y: 130 },
    ];
    const canvas = positions.reduce(
      (current, position) => helpers.addInternalNodeFromPalette(current, workflowId, item, position),
      withWorkflow,
    );
    const workflow = canvas.workflows[0];

    expect(workflow.position).toEqual({ x: 100, y: 100 });
    expect(workflow.internalNodes.map((node: any) => node.id)).toEqual([
      'fake_agent_generic',
      'fake_agent_generic_2',
      'fake_agent_generic_3',
      'fake_agent_generic_4',
    ]);
    expect(workflow.internalNodes.map((node: any) => node.position.x)).toEqual([120, 460, 800, 1140]);
    for (const node of workflow.internalNodes) {
      expect(node.position.x + 260).toBeLessThanOrEqual(workflow.size.width - 24);
      expect(node.position.y + 72).toBeLessThanOrEqual(workflow.size.height - 24);
    }
  });

  test('Selected workflow auto layout ranks fan-out and fan-in by control edges', () => {
    const helpers = __workflowViewerTestables as any;
    const edge = (from: string, to: string) => ({
      id: `control_${from}_${to}`,
      kind: 'control',
      source: { workflowId: from },
      target: { workflowId: to },
      condition: null,
      context: 'none',
    });
    const workflow = {
      id: 'analysis_flow',
      title: 'Analysis Flow',
      sourceKind: 'workflow',
      directory: 'workspace',
      status: 'not_run',
      inputPorts: [],
      outputPorts: [],
      internalNodes: [
        { id: 'a', name: 'A', task: 'A', kind: 'Agent', status: 'not_run', position: { x: 800, y: 40 } },
        { id: 'b', name: 'B', task: 'B', kind: 'Agent', status: 'not_run', position: { x: 20, y: 260 } },
        { id: 'c', name: 'C', task: 'C', kind: 'Agent', status: 'not_run', position: { x: 40, y: 40 } },
        { id: 'd', name: 'D', task: 'D', kind: 'Agent', status: 'not_run', position: { x: 120, y: 120 } },
      ],
      internalEdges: [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
      position: { x: 100, y: 100 },
      size: { width: 520, height: 280 },
      warnings: [],
    };
    const canvas = {
      id: 'root_task',
      name: 'Root Task',
      rootWorkflowId: 'root_task',
      layout: 'workspace-canvas',
      workflows: [workflow],
      edges: [],
    };

    const laidOut = helpers.layoutCanvasForSelection(canvas, { type: 'workflow', id: workflow.id });
    const nodes = new Map<string, { x: number; y: number }>(
      laidOut.workflows[0].internalNodes.map((node: any) => [node.id, node.position]),
    );
    const position = (id: string) => {
      const value = nodes.get(id);
      if (!value) {
        throw new Error(`Missing node position: ${id}`);
      }
      return value;
    };

    expect(position('a').x).toBeLessThan(position('b').x);
    expect(position('a').x).toBeLessThan(position('c').x);
    expect(Math.abs(position('b').x - position('c').x)).toBeLessThanOrEqual(1);
    expect(position('d').x).toBeGreaterThan(position('b').x);
    expect(position('d').x).toBeGreaterThan(position('c').x);
  });

  test('Workflow container expansion keeps child absolute position when expanding left or up', () => {
    const workflow: any = {
      id: 'Research_Flow',
      title: 'Research_Flow',
      directory: 'workspace',
      status: 'not_run',
      inputPorts: [],
      outputPorts: [],
      internalEdges: [],
      position: { x: 100, y: 100 },
      size: { width: 430, height: 328 },
      warnings: [],
      internalNodes: [
        {
          id: 'codex',
          name: 'Codex',
          task: 'fake-agent.generic',
          kind: 'Agent',
          status: 'not_run',
          position: { x: -30, y: -40 },
        },
        {
          id: 'merge',
          name: 'Merge',
          task: 'fake-agent.generic',
          kind: 'Tool',
          status: 'not_run',
          position: { x: 80, y: 80 },
        },
      ],
    };

    const expanded = __workflowViewerTestables.expandWorkflowToFitChildren(workflow);
    const firstNode = expanded.internalNodes[0];

    expect(expanded.position).toEqual({ x: 62, y: 52 });
    expect(firstNode).toBeDefined();
    expect(firstNode?.position).toEqual({ x: 8, y: 8 });
    expect(expanded.position.x + (firstNode?.position?.x || 0)).toBe(70);
    expect(expanded.position.y + (firstNode?.position?.y || 0)).toBe(60);
    expect(expanded.internalEdges).toBe(workflow.internalEdges);
  });

  test('Workflow container expansion grows right and down without legacy extra bottom padding', () => {
    const workflow: any = {
      id: 'Research_Flow',
      title: 'Research_Flow',
      directory: 'workspace',
      status: 'not_run',
      inputPorts: [],
      outputPorts: [],
      internalEdges: [],
      position: { x: 100, y: 100 },
      size: { width: 430, height: 328 },
      warnings: [],
      internalNodes: [
        {
          id: 'codex',
          name: 'Codex',
          task: 'fake-agent.generic',
          kind: 'Agent',
          status: 'not_run',
          position: { x: 500, y: 400 },
        },
      ],
    };

    const expanded = __workflowViewerTestables.expandWorkflowToFitChildren(workflow);

    expect(expanded.position).toEqual(workflow.position);
    expect(expanded.size.width).toBe(784);
    expect(expanded.size.height).toBe(552);
  });

  test('Center-locked workflow expansion preserves child absolute position', () => {
    const workflow: any = {
      id: 'Research_Flow',
      title: 'Research_Flow',
      directory: 'workspace',
      status: 'not_run',
      inputPorts: [],
      outputPorts: [],
      internalEdges: [],
      position: { x: 100, y: 100 },
      size: { width: 360, height: 260 },
      warnings: [],
      internalNodes: [
        {
          id: 'edge_agent',
          name: 'Edge Agent',
          task: 'fake-agent.generic',
          kind: 'Agent',
          status: 'not_run',
          position: { x: 340, y: 90 },
        },
      ],
    };

    const expanded = __workflowViewerTestables.expandWorkflowToFitChildrenCenterLocked(workflow);
    const node = expanded.internalNodes[0];
    if (!node?.position) {
      throw new Error('center-locked expansion did not preserve node position');
    }

    expect(expanded.position.x + expanded.size.width / 2).toBe(280);
    expect(expanded.position.y + expanded.size.height / 2).toBe(230);
    expect(expanded.position.x + node.position.x).toBe(440);
    expect(expanded.position.y + node.position.y).toBe(190);
    expect(expanded.position.x + expanded.size.width).toBeGreaterThanOrEqual(700);
  });

  test('Workspace auto layout arranges root workflows and nested internal nodes', () => {
    const canvas: any = {
      id: 'root',
      name: 'Root',
      rootWorkflowId: 'root',
      workflows: [
        {
          id: 'research',
          title: 'Research',
          directory: 'workspace',
          status: 'not_run',
          inputPorts: [],
          outputPorts: [],
          position: { x: 900, y: 900 },
          size: { width: 430, height: 328 },
          warnings: [],
          internalNodes: [
            {
              id: 'merge',
              name: 'Merge',
              task: 'fake-agent.generic',
              kind: 'Tool',
              status: 'not_run',
              position: { x: 320, y: 12 },
            },
            {
              id: 'codex',
              name: 'Codex',
              task: 'fake-agent.generic',
              kind: 'Agent',
              status: 'not_run',
              position: { x: 12, y: 240 },
            },
          ],
          internalEdges: [
            {
              id: 'edge_codex_merge',
              kind: 'control',
              source: { workflowId: 'codex' },
              target: { workflowId: 'merge' },
            },
          ],
        },
        {
          id: 'review',
          title: 'Review',
          directory: 'workspace',
          status: 'not_run',
          inputPorts: [],
          outputPorts: [],
          position: { x: 0, y: 0 },
          size: { width: 430, height: 328 },
          warnings: [],
          internalNodes: [],
          internalEdges: [],
        },
      ],
      edges: [
        {
          id: 'edge_research_review',
          kind: 'control',
          source: { workflowId: 'research' },
          target: { workflowId: 'review' },
        },
      ],
    };

    const laidOut = __workflowViewerTestables.layoutWorkspaceCanvas(canvas);
    const research = laidOut.workflows.find((workflow: any) => workflow.id === 'research');
    const review = laidOut.workflows.find((workflow: any) => workflow.id === 'review');
    const codex = research?.internalNodes.find((node: any) => node.id === 'codex');
    const merge = research?.internalNodes.find((node: any) => node.id === 'merge');

    if (!research || !review || !codex || !merge || !codex.position || !merge.position) {
      throw new Error('layout test fixture did not produce expected nodes');
    }
    expect(review.position.x).toBeGreaterThan(research.position.x);
    expect(merge.position.x).toBeGreaterThan(codex.position.x);
    expect(research.size.width).toBeGreaterThanOrEqual(430);
    expect(research.size.height).toBeGreaterThanOrEqual(328);
  });

  test('Selected workflow auto layout only changes that workflow internals', () => {
    const canvas: any = {
      id: 'root',
      name: 'Root',
      rootWorkflowId: 'root',
      workflows: [
        {
          id: 'research',
          title: 'Research',
          directory: 'workspace',
          status: 'not_run',
          inputPorts: [],
          outputPorts: [],
          position: { x: 100, y: 100 },
          size: { width: 430, height: 328 },
          warnings: [],
          internalNodes: [
            {
              id: 'b',
              name: 'B',
              task: 'fake-agent.generic',
              kind: 'Agent',
              status: 'not_run',
              position: { x: 20, y: 200 },
            },
            {
              id: 'a',
              name: 'A',
              task: 'fake-agent.generic',
              kind: 'Agent',
              status: 'not_run',
              position: { x: 280, y: 20 },
            },
            {
              id: 'c',
              name: 'C',
              task: 'fake-agent.generic',
              kind: 'Agent',
              status: 'not_run',
              position: { x: 20, y: 20 },
            },
          ],
          internalEdges: [
            {
              id: 'a_b',
              kind: 'control',
              source: { workflowId: 'a' },
              target: { workflowId: 'b' },
            },
            {
              id: 'a_c',
              kind: 'control',
              source: { workflowId: 'a' },
              target: { workflowId: 'c' },
            },
          ],
        },
        {
          id: 'review',
          title: 'Review',
          directory: 'workspace',
          status: 'not_run',
          inputPorts: [],
          outputPorts: [],
          position: { x: 900, y: 500 },
          size: { width: 430, height: 328 },
          warnings: [],
          internalNodes: [],
          internalEdges: [],
        },
      ],
      edges: [
        {
          id: 'research_review',
          kind: 'control',
          source: { workflowId: 'research' },
          target: { workflowId: 'review' },
        },
      ],
    };

    const laidOut = __workflowViewerTestables.layoutCanvasForSelection(canvas, {
      type: 'workflow',
      id: 'research',
    });
    const research = laidOut.workflows.find((workflow: any) => workflow.id === 'research');
    const review = laidOut.workflows.find((workflow: any) => workflow.id === 'review');
    if (!research || !review) {
      throw new Error('selected-layout fixture did not produce expected workflows');
    }
    const a = research.internalNodes.find((node: any) => node.id === 'a');
    const b = research.internalNodes.find((node: any) => node.id === 'b');
    const c = research.internalNodes.find((node: any) => node.id === 'c');
    if (!a?.position || !b?.position || !c?.position) {
      throw new Error('selected-layout fixture did not produce expected node positions');
    }

    expect(review.position).toEqual({ x: 900, y: 500 });
    expect(b.position.x).toBeGreaterThan(a.position.x);
    expect(c.position.x).toBeGreaterThan(a.position.x);
    expect(b.position.y).not.toBe(c.position.y);
  });

  test('Callable Library is a read-only Core v2 template browser', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 1);

    const browser = await screen.findByLabelText('Callable 资源库');
    expect(browser).toHaveTextContent('AgentClassTemplate / ToolClassTemplate');
    expect(screen.queryByLabelText('创建 Callable')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Callable 编辑器')).not.toBeInTheDocument();
  });

  test('Callable Library does not expose legacy scaffold controls', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 1);

    await screen.findByLabelText('Callable 资源库');
    expect(screen.queryByRole('combobox', { name: /Callable/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^测试$/ })).not.toBeInTheDocument();
  });

  test('New workflow graph saves with parallel-friendly default policy', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: '新建任务（工具栏）' }));
    await user.click(within(toolbar).getByRole('button', { name: /\u4fdd\u5b58/i }));

    const calls = vi.mocked(fetch).mock.calls;
    const workflowSaveCalls = calls.filter(([url, init]) => url === '/api/workflows' && init?.method === 'POST');
    const saveCall = workflowSaveCalls[0];
    expect(saveCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    expect(savedPayload.graph.policy).toEqual({
      failure_mode: 'fail_fast',
      max_concurrency: 4,
    });
  });

  test('New workflow graph saves workflow containers and semantic edges', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    await loadWorkspaceDemo(user);
    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: /\u4fdd\u5b58/i }));

    const calls = vi.mocked(fetch).mock.calls;
    const saveCall = calls
      .filter(([url, init]) => url === '/api/workflows' && init?.method === 'POST')
      .at(-1);
    expect(saveCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    expect(savedPayload.graph.nodes).toHaveLength(5);
    expect(savedPayload.graph.nodes[0].kind).toBe('workflow');
    expect(savedPayload.graph.nodes[0].input_ports.length).toBeGreaterThan(0);
    expect(savedPayload.graph.nodes[0].output_ports.length).toBeGreaterThan(0);
    expect(savedPayload.graph.control_edges.length).toBeGreaterThan(0);
    expect(savedPayload.graph.data_edges.length).toBeGreaterThan(0);
    expect(savedPayload.graph.metadata.directory_display_only).toBe(true);
    expect(savedPayload.graph.nodes.every((node: { relative_cwd?: string }) => !node.relative_cwd)).toBe(true);
    expect(savedPayload.graph.workspace_policy).toEqual({
      save_mode: 'stateless_template',
      default_state_mode: 'stateless',
    });
    expect(JSON.stringify(savedPayload.graph)).not.toContain('F:\\UE5_Project_A');
    expect(JSON.stringify(savedPayload.graph)).not.toContain('binding_ref');
    expect(JSON.stringify(savedPayload.graph)).not.toContain('"status"');
  });

  /*
  test('Workflow Builder saves workflow internals without Focus Mode navigation', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /瀹搞儰缍斿ù?i }));
    await user.dblClick(await screen.findByTestId('workflow-container-Research_Flow'));
    const toolbar = await screen.findByLabelText('瀹搞儰缍斿ù浣镐紣閸忛攱鐖?);
    await user.click(within(toolbar).getByRole('button', { name: /^娣囨繂鐡?/i }));

    const calls = vi.mocked(fetch).mock.calls;
    const saveCall = calls
      .filter(([url, init]) => url === '/api/workflows' && init?.method === 'POST')
      .at(-1);
    expect(saveCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    expect(savedPayload.graph.id).toBe('Research_Flow');
    expect(savedPayload.graph.nodes.length).toBeGreaterThan(0);
    expect(savedPayload.graph.nodes[0].callable_ref.id).toBe('fake-agent.generic');
    expect(savedPayload.graph.nodes[0].input.topic).toBeTruthy();
    expect(savedPayload.graph.control_edges.length).toBeGreaterThan(0);
  });

  */

  test('Workflow Focus Mode saves runnable internal node defaults', async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByLabelText('Workbench navigation');
    await user.click(within(navigation).getAllByRole('button')[0]);
    await loadWorkspaceDemo(user);
    fireEvent.doubleClick(await screen.findByTestId('workflow-container-Research_Flow'));
    expect(screen.queryByText('返回 Workspace')).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /\u4fdd\u5b58/i })[0]);

    const calls = vi.mocked(fetch).mock.calls;
    const saveCall = calls
      .filter(([url, init]) => url === '/api/workflows' && init?.method === 'POST')
      .at(-1);
    expect(saveCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    expect(savedPayload.graph.id).toBe('acc_workspace_canvas');
    expect(savedPayload.graph.nodes.length).toBeGreaterThan(0);
    expect(savedPayload.graph.nodes[0].kind).toBe('workflow');
    expect(savedPayload.graph.nodes[0].ui.internal_nodes.length).toBeGreaterThan(0);
    expect(savedPayload.graph.control_edges.length).toBeGreaterThan(0);
  });

  test('Workflow Builder drops palette callable into workflow container internals', async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByLabelText('Workbench navigation');
    await user.click(within(navigation).getAllByRole('button')[0]);
    await loadWorkspaceDemo(user);
    const container = await screen.findByTestId('workflow-container-Research_Flow');
    fireEvent.drop(container, {
      clientX: 180,
      clientY: 240,
      dataTransfer: {
        getData: (key: string) =>
          key === 'application/x-acc-palette'
            ? JSON.stringify({
                kind: 'agent',
                callableId: 'fake-agent.generic',
                label: 'Dropped Agent',
              })
            : '',
      },
    });
    await user.click(screen.getAllByRole('button', { name: /\u4fdd\u5b58/i })[0]);

    const calls = vi.mocked(fetch).mock.calls;
    const saveCall = calls
      .filter(([url, init]) => url === '/api/workflows' && init?.method === 'POST')
      .at(-1);
    expect(saveCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    const researchFlow = savedPayload.graph.nodes.find(
      (node: { id: string }) => node.id === 'Research_Flow',
    );
    expect(researchFlow.ui.internal_nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Dropped Agent',
          callableId: 'fake-agent.generic',
          position: expect.objectContaining({
            x: expect.any(Number),
            y: expect.any(Number),
          }),
        }),
      ]),
    );
    const dropped = researchFlow.ui.internal_nodes.find(
      (node: { name: string }) => node.name === 'Dropped Agent',
    );
    expect(dropped.position.x).toBeGreaterThanOrEqual(0);
    expect(dropped.position.y).toBeGreaterThanOrEqual(0);
  });

  test('Palette add targets the newly created selected workflow container', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: '资源' }));
    await user.click(await screen.findByRole('button', { name: '拖入 Workflow' }));

    const fakeAgentCard = screen.getByText('Fake Agent').closest('article');
    expect(fakeAgentCard).toBeTruthy();
    await user.click(
      within(fakeAgentCard as HTMLElement).getByRole('button', {
        name: /加入到选中 Workflow/,
      }),
    );
    await user.click(within(toolbar).getByRole('button', { name: /\u4fdd\u5b58/i }));

    const calls = vi.mocked(fetch).mock.calls;
    const saveCall = calls
      .filter(([url, init]) => url === '/api/workflows' && init?.method === 'POST')
      .at(-1);
    expect(saveCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    const workflow = savedPayload.graph.nodes.find((node: { id: string }) => node.id === 'New_Workflow');
    expect(workflow).toBeTruthy();
    expect(workflow.ui.internal_nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          callableId: 'fake-agent.generic',
          name: 'Fake Agent',
        }),
      ]),
    );
    expect(
      savedPayload.graph.nodes.some((node: { id: string }) => node.id === 'fake_agent_generic'),
    ).toBe(false);
  });

  test('Palette can add a root node while a workflow container is selected', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: '资源' }));
    await user.click(await screen.findByRole('button', { name: '拖入 Workflow' }));

    const fakeAgentCard = screen.getByText('Fake Agent').closest('article');
    expect(fakeAgentCard).toBeTruthy();
    await user.click(
      within(fakeAgentCard as HTMLElement).getByRole('button', {
        name: /加入到选中 Workflow/,
      }),
    );
    await user.click(
      within(fakeAgentCard as HTMLElement).getByRole('button', {
        name: '根画布',
      }),
    );
    await user.click(within(toolbar).getByRole('button', { name: /\u4fdd\u5b58/i }));

    const calls = vi.mocked(fetch).mock.calls;
    const saveCall = calls
      .filter(([url, init]) => url === '/api/workflows' && init?.method === 'POST')
      .at(-1);
    expect(saveCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    const workflow = savedPayload.graph.nodes.find((node: { id: string }) => node.id === 'New_Workflow');
    expect(workflow.ui.internal_nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          callableId: 'fake-agent.generic',
          name: 'Fake Agent',
        }),
      ]),
    );
    expect(savedPayload.graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'fake_agent_generic',
          callable_ref: expect.objectContaining({ id: 'fake-agent.generic' }),
          label: 'Fake Agent',
        }),
      ]),
    );
  });

  test('Workflow Builder drops palette callable on root as plain executable node', async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByLabelText('Workbench navigation');
    await user.click(within(navigation).getAllByRole('button')[0]);
    const canvas = await screen.findByLabelText('任务画布');
    fireEvent.drop(canvas, {
      clientX: 980,
      clientY: 180,
      dataTransfer: {
        getData: (key: string) =>
          key === 'application/x-acc-palette'
            ? JSON.stringify({
                kind: 'agent',
                callableId: 'fake-agent.generic',
                label: 'Root Agent',
              })
            : '',
      },
    });
    await user.click(screen.getAllByRole('button', { name: /保存/ })[0]);

    const calls = vi.mocked(fetch).mock.calls;
    const saveCall = calls
      .filter(([url, init]) => url === '/api/workflows' && init?.method === 'POST')
      .at(-1);
    expect(saveCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    const rootAgent = savedPayload.graph.nodes.find(
      (node: { label: string }) => node.label === 'Root Agent',
    );
    expect(rootAgent.kind).toBe('agent_session');
    expect(rootAgent.callable_ref.id).toBe('fake-agent.generic');
    expect(rootAgent.ui).toBeUndefined();
  });

  test('Workflow Builder expands workflow container to fit dropped child node', async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByLabelText('Workbench navigation');
    await user.click(within(navigation).getAllByRole('button')[0]);
    await loadWorkspaceDemo(user);
    const container = await screen.findByTestId('workflow-container-Research_Flow');
    fireEvent.drop(container, {
      clientX: 720,
      clientY: 520,
      dataTransfer: {
        getData: (key: string) =>
          key === 'application/x-acc-palette'
            ? JSON.stringify({
                kind: 'tool',
                callableId: 'fake-agent.generic',
                label: 'Wide Tool',
              })
            : '',
      },
    });
    await user.click(screen.getAllByRole('button', { name: /保存/ })[0]);

    const calls = vi.mocked(fetch).mock.calls;
    const saveCall = calls
      .filter(([url, init]) => url === '/api/workflows' && init?.method === 'POST')
      .at(-1);
    expect(saveCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    const researchFlow = savedPayload.graph.nodes.find(
      (node: { id: string }) => node.id === 'Research_Flow',
    );
    const dropped = researchFlow.ui.internal_nodes.find(
      (node: { name: string }) => node.name === 'Wide Tool',
    );
    expect(researchFlow.position).toBeTruthy();
    expect(dropped.position.x + 260).toBeLessThanOrEqual(900);
    expect(JSON.stringify(researchFlow.ui.internal_nodes)).toContain('Wide Tool');
    expect(getComputedStyle(await screen.findByLabelText('Research_Flow internal nodes')).overflow).not.toBe(
      'auto',
    );
  });

  test('Workflow Builder saves existing internal control edges for workflow children', async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByLabelText('Workbench navigation');
    await user.click(within(navigation).getAllByRole('button')[0]);
    await loadWorkspaceDemo(user);
    await user.click(screen.getAllByRole('button', { name: /保存/ })[0]);

    const calls = vi.mocked(fetch).mock.calls;
    const saveCall = calls
      .filter(([url, init]) => url === '/api/workflows' && init?.method === 'POST')
      .at(-1);
    expect(saveCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    const researchFlow = savedPayload.graph.nodes.find(
      (node: { id: string }) => node.id === 'Research_Flow',
    );
    expect(researchFlow.ui.internal_edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'research_codex',
          to: 'research_merge',
          context: 'none',
        }),
      ]),
    );
  });

  test('Workflow Builder exposes graph authoring controls', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);

    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: /^资源$/i }));
    const navigator = await screen.findByLabelText('Workspace Navigator');
    expect(navigator).toBeInTheDocument();
    expect(navigator).toHaveTextContent('Fake Agent');
    expect(navigator).toHaveTextContent('file-source.local');
    const workspaceCanvas = await screen.findByLabelText('任务画布');
    expect(workspaceCanvas).toBeInTheDocument();
    expect(await screen.findByLabelText('Canvas Toolbar')).toBeInTheDocument();
    await user.click(within(toolbar).getByRole('button', { name: /^属性$/i }));
    expect(await screen.findByLabelText('属性面板')).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: '调整属性面板宽度' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Last Two/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /\u4fdd\u5b58/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /校验/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /运行/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /自动布局/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /显示数据边/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /显示控制边/i })).toBeInTheDocument();
    fireEvent.pointerDown(workspaceCanvas);
    fireEvent.click(workspaceCanvas);
    await waitFor(() => expect(screen.queryByLabelText('属性面板')).not.toBeInTheDocument());
  });

  test('Workflow Builder saves, validates, and runs workspace canvas', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    await loadWorkspaceDemo(user);

    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: /\u4fdd\u5b58/i }));
    await user.click(within(toolbar).getByRole('button', { name: /^校验$/i }));
    await user.click(within(toolbar).getByRole('button', { name: /^运行$/i }));

    const calls = vi.mocked(fetch).mock.calls;
    const workflowSaveCalls = calls.filter(([url, init]) => url === '/api/workflows' && init?.method === 'POST');
    const saveCall = workflowSaveCalls[0];
    const validateCall = calls.find(
      ([url, init]) => url === '/api/workflows/acc_workspace_canvas/validate' && init?.method === 'POST',
    );
    const runCall = calls.find(([url, init]) => url === '/api/workflows/run-graph/submit' && init?.method === 'POST');
    expect(saveCall).toBeTruthy();
    expect(validateCall).toBeTruthy();
    expect(runCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    const runPayload = JSON.parse(String(runCall?.[1]?.body));
    expect(savedPayload.graph.nodes).toHaveLength(5);
    expect(savedPayload.graph.data_edges.length).toBeGreaterThan(0);
    expect(savedPayload.graph.control_edges.length).toBeGreaterThan(0);
    expect(workflowSaveCalls).toHaveLength(2);
    expect(runPayload.graph.id).toMatch(/^ui_workflow_acc_workspace_canvas_/);
    expect(runPayload.graph.workspace_policy).toEqual({
      save_mode: 'local_binding',
      default_state_mode: 'stateful',
    });
    expect(await screen.findByText(/ui_workflow_acc_workspace_canvas_fixture: 成功/i)).toBeInTheDocument();
  });

  test('Workflow node inspector shows real input and output evidence after a run', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    await loadWorkspaceDemo(user);
    const codexLabel = (await screen.findAllByText('Codex CLI'))[0];
    const codexNode = codexLabel.closest('[role="group"]');
    expect(codexNode).toBeTruthy();
    fireEvent.click(codexNode as HTMLElement);

    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: /^运行$/i }));
    await screen.findByText(/ui_workflow_acc_workspace_canvas_fixture: 成功/i);

    const inspector = await screen.findByLabelText('属性面板');

    expect(inspector).toHaveTextContent(/系统提示词.*资源库/);
    expect(within(inspector).queryByRole('textbox', { name: /系统提示词/ })).not.toBeInTheDocument();
    expect(await within(inspector).findByLabelText(/output\.json/)).toHaveTextContent(
      'Codex agent output fixture',
    );

    await user.click(within(inspector).getByRole('button', { name: '产物' }));
    const inputEvidence = await within(inspector).findByRole('button', { name: /输入/i });
    await user.click(inputEvidence);
    expect(await screen.findByLabelText(/input\.json/)).toHaveTextContent('Codex CLI');
    expect(screen.getByLabelText(/input\.json/)).toHaveTextContent('真实上游输入');
  });

  test('Run Inspector exposes debugger actions and diff results', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavigation(user, /运行记录/i);
    await screen.findAllByText('ui_acceptance_fake');
    await user.click(await screen.findByRole('button', { name: /\u4e8b\u4ef6\u56de\u653e/i }));
    await user.click(await screen.findByRole('button', { name: /\u91cd\u8dd1\u8282\u70b9/i }));

    expect(await screen.findByLabelText('replay.json')).toHaveTextContent('node_completed');
    expect(await screen.findByLabelText('run_diff.json')).toHaveTextContent('"changed_nodes": []');
  });

  test('Control Plane renders GraphOps safety flow', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /\u63a7\u5236\u5e73\u9762/i }));
    await user.click(await screen.findByRole('button', { name: /\u6821\u9a8c patch/i }));
    await user.click(await screen.findByRole('button', { name: /dry-run patch/i }));

    expect(await screen.findByLabelText('graphops.dry-run.json')).toHaveTextContent(
      'apply_requires_human_approval',
    );
    expect(screen.getByText(/\u5371\u9669 apply \u9ed8\u8ba4\u5173\u95ed/)).toBeInTheDocument();
  });

  test('Run Inspector renders pending interaction approval card', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavigation(user, /运行记录/i);
    expect(await screen.findByText('是否继续部署？')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '通过' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '通过' }));
    await waitFor(() => {
      expect(screen.queryByText('是否继续部署？')).not.toBeInTheDocument();
    });
  });
});

