import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { App } from './App';

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
      capsule_id: 'fake-agent.generic',
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
  '/api/capsules': {
    capsules: [
      {
        id: 'echo-test.generic',
        version: '0.1.0',
        name: 'Echo Test',
        description: 'Echo fixture capsule',
        runtime: 'generic_cli',
        workspace: 'existing_dir',
      },
      {
        id: 'nested-workflow.example',
        version: '0.1.0',
        name: 'Nested Workflow',
        description: 'Workflow capsule fixture',
        runtime: 'codex_cli',
        workspace: 'existing_dir',
      },
      {
        id: 'fake-agent.generic',
        version: '0.1.0',
        name: 'Fake Agent',
        description: 'Fixture capsule',
        runtime: 'generic_cli',
        workspace: 'existing_dir',
      },
    ],
  },
  '/api/capsules/echo-test.generic': {
    id: 'echo-test.generic',
    version: '0.1.0',
    name: 'Echo Test',
    description: 'Echo fixture capsule',
    runtime: 'generic_cli',
    workspace: 'existing_dir',
    yaml_path: 'capsules/echo-test.generic/capsule.yaml',
    prompt_template: 'prompt_template.md',
    input_schema: 'input_schema.json',
    output_schema: 'output_schema.json',
    artifact_manifest: 'artifact_manifest.yaml',
    permissions: { sandbox: 'read-only', network: false },
  },
  '/api/capsules/echo-test.generic/files/prompt_template.md': {
    capsule_id: 'echo-test.generic',
    file: 'prompt_template.md',
    path: 'capsules/echo-test.generic/prompt_template.md',
    content: 'Echo {{ input.message }}.',
  },
  '/api/capsules/fake-agent.generic': {
    id: 'fake-agent.generic',
    version: '0.1.0',
    name: 'Fake Agent',
    description: 'Fixture capsule',
    runtime: 'generic_cli',
    workspace: 'existing_dir',
    yaml_path: 'capsules/fake-agent.generic/capsule.yaml',
    prompt_template: 'prompt_template.md',
    input_schema: 'input_schema.json',
    output_schema: 'output_schema.json',
    artifact_manifest: 'artifact_manifest.yaml',
    permissions: { sandbox: 'read-only', network: false },
  },
  '/api/capsules/fake-agent.generic/files/prompt_template.md': {
    capsule_id: 'fake-agent.generic',
    file: 'prompt_template.md',
    path: 'capsules/fake-agent.generic/prompt_template.md',
    content: 'Write about {{ input.topic }}.',
  },
  '/api/workflows': {
    workflows: [
      {
        workflow_id: 'demo_serial',
        file_id: 'demo_serial',
        name: '串行 Demo 工作流',
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
      name: '串行 Demo 工作流',
      description: 'Fixture graph workflow',
      version: '0.2.0',
      nodes: [
        {
          id: 'echo',
          capsule_id: 'echo-test.generic',
          label: '输入回显',
          input: { message: 'hello' },
          input_mapping: {},
          position: { x: 80, y: 160 },
        },
        {
          id: 'fake',
          capsule_id: 'fake-agent.generic',
          label: '下游处理',
          input: {},
          input_mapping: { topic: '{{ nodes.echo.output.summary }}' },
          position: { x: 420, y: 160 },
        },
      ],
      edges: [{ id: 'edge_echo_fake', from: 'echo', to: 'fake', label: '输出给下游' }],
    },
    graph: {
      id: 'demo_serial',
      name: '串行 Demo 工作流',
      description: 'Fixture graph workflow',
      version: '0.2.0',
      nodes: [
        {
          id: 'echo',
          capsule_id: 'echo-test.generic',
          label: '输入回显',
          input: { message: 'hello' },
          input_mapping: {},
          position: { x: 80, y: 160 },
        },
        {
          id: 'fake',
          capsule_id: 'fake-agent.generic',
          label: '下游处理',
          input: {},
          input_mapping: { topic: '{{ nodes.echo.output.summary }}' },
          position: { x: 420, y: 160 },
        },
      ],
      edges: [{ id: 'edge_echo_fake', from: 'echo', to: 'fake', label: '输出给下游' }],
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
        capsule_id: 'echo-test.generic',
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
        capsule_id: 'fake-agent.generic',
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
    operations: [{ op: 'add_node', description: 'Would add node review using capsule critical-review.claude' }],
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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method || 'GET';
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
  vi.unstubAllGlobals();
});

describe('Agent Capsule Workbench editable UI', () => {
  test('Run List and Run Inspector render fixture run from acc-server APIs', async () => {
    render(<App />);

    expect(await screen.findByText('ui_acceptance_fake')).toBeInTheDocument();
    expect(await screen.findByText('fake-agent.generic')).toBeInTheDocument();
    expect(screen.getByLabelText('运行检查器')).toHaveTextContent('session_fixture');
  });

  test('Run Inspector can view JSON output through artifact API', async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText('ui_acceptance_fake');
    await user.click(await screen.findByRole('button', { name: /输出/i }));

    expect(await screen.findByLabelText('runs/ui_acceptance_fake/output.json')).toHaveTextContent(
      '"summary": "ok"',
    );
  });

  test('Artifact Viewer renders markdown artifact fixture', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /产物/i }));
    await user.click(await screen.findByRole('button', { name: /report.md/i }));

    expect(await screen.findByLabelText('产物 report.md')).toHaveTextContent(
      'Semiconductor analysis fixture.',
    );
  });

  test('Capsule Browser renders capsule metadata and permissions', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /节点库/i }));

    const browser = await screen.findByLabelText('节点库');
    expect(within(browser).getByRole('heading', { name: 'Echo Test' })).toBeInTheDocument();
    expect(browser).toHaveTextContent('沙箱');
    expect(browser).toHaveTextContent('read-only');
  });

  test('Workflow Builder renders graph-first workspace canvas', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /工作流/i }));

    const canvas = await screen.findByLabelText('Workspace Canvas');
    expect(canvas).toHaveTextContent('Research_Flow');
    expect(canvas).toHaveTextContent('Implementation_Flow');
    expect(canvas).toHaveTextContent('Review_Flow');
    expect(canvas).toHaveTextContent('Paper_Digest_Pipeline');
    expect(canvas).toHaveTextContent('F:\\UE5_Project_A\\workflows\\research');
    expect(canvas).toHaveTextContent('in_requirements');
    expect(canvas).toHaveTextContent('out_report');
    expect(canvas).toHaveTextContent('Codex CLI');
    expect(canvas).toHaveTextContent('Merge');
  });

  test('Capsule Library exposes create, edit, validate, and test controls', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /节点库/i }));

    expect(await screen.findByLabelText('创建 Capsule')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /高级设置 \/ 原始文件/i }));
    expect(await screen.findByLabelText('Capsule 编辑器')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /保存/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /校验/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /测试/i }).length).toBeGreaterThan(0);
  });

  test('Capsule scaffold defaults stay least-privilege for codex and expand for generic cli', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /节点库/i }));

    const runtime = await screen.findByRole('combobox', { name: 'Capsule 类型' });
    const sandbox = screen.getByRole('combobox', { name: '沙箱' });
    await user.click(screen.getByText('高级设置'));
    const network = screen.getByLabelText('允许网络');
    const writeFiles = screen.getByLabelText('允许写文件');

    expect(runtime).toHaveValue('codex_cli');
    expect(sandbox).toHaveValue('read-only');
    expect(network).toBeChecked();
    expect(writeFiles).not.toBeChecked();

    await user.selectOptions(runtime, 'generic_cli');

    expect(sandbox).toHaveValue('workspace-write');
    expect(network).not.toBeChecked();
    expect(writeFiles).toBeChecked();
  });

  test('New workflow graph saves with parallel-friendly default policy', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /工作流/i }));
    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: /^新建$/i }));
    await user.click(within(toolbar).getByRole('button', { name: /^保存$/i }));

    const calls = vi.mocked(fetch).mock.calls;
    const saveCall = calls.find(([url, init]) => url === '/api/workflows' && init?.method === 'POST');
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

    await user.click(await screen.findByRole('button', { name: /工作流/i }));
    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: /^保存$/i }));

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
    expect(JSON.stringify(savedPayload.graph)).not.toContain('F:\\UE5_Project_A');
    expect(savedPayload.graph.nodes[0].ui.binding_ref).toContain('bindings/');
  });

  /*
  test('Workflow Focus Mode saves runnable internal node defaults', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /宸ヤ綔娴?i }));
    await user.dblClick(await screen.findByTestId('workflow-container-Research_Flow'));
    const toolbar = await screen.findByLabelText('宸ヤ綔娴佸伐鍏锋爮');
    await user.click(within(toolbar).getByRole('button', { name: /^淇濆瓨$/i }));

    const calls = vi.mocked(fetch).mock.calls;
    const saveCall = calls
      .filter(([url, init]) => url === '/api/workflows' && init?.method === 'POST')
      .at(-1);
    expect(saveCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    expect(savedPayload.graph.id).toBe('Research_Flow');
    expect(savedPayload.graph.nodes.length).toBeGreaterThan(0);
    expect(savedPayload.graph.nodes[0].capsule_id).toBe('fake-agent.generic');
    expect(savedPayload.graph.nodes[0].input.topic).toBeTruthy();
    expect(savedPayload.graph.control_edges.length).toBeGreaterThan(0);
  });

  */

  test('Workflow Focus Mode saves runnable internal node defaults', async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByLabelText('Workbench navigation');
    await user.click(within(navigation).getByRole('button', { name: '工作流' }));
    fireEvent.doubleClick(await screen.findByTestId('workflow-container-Research_Flow'));
    await screen.findByText('返回 Workspace');
    await user.click(screen.getAllByRole('button', { name: /^保存$/i })[0]);

    const calls = vi.mocked(fetch).mock.calls;
    const saveCall = calls
      .filter(([url, init]) => url === '/api/workflows' && init?.method === 'POST')
      .at(-1);
    expect(saveCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    expect(savedPayload.graph.id).toBe('Research_Flow');
    expect(savedPayload.graph.nodes.length).toBeGreaterThan(0);
    expect(savedPayload.graph.nodes[0].capsule_id).toBe('fake-agent.generic');
    expect(savedPayload.graph.nodes[0].input.topic).toBeTruthy();
    expect(savedPayload.graph.control_edges.length).toBeGreaterThan(0);
  });

  test('Workflow Builder exposes graph authoring controls', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /工作流/i }));

    const navigator = await screen.findByLabelText('Workspace Navigator');
    expect(navigator).toBeInTheDocument();
    expect(navigator).toHaveTextContent('Fake Agent');
    expect(navigator).toHaveTextContent('file-source.local');
    expect(await screen.findByLabelText('Workspace Canvas')).toBeInTheDocument();
    expect(await screen.findByLabelText('Canvas Toolbar')).toBeInTheDocument();
    expect(await screen.findByLabelText('属性面板')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Last Two/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /保存/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /校验/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /运行/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /自动布局/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^数据$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^控制$/i })).toBeInTheDocument();
  });

  test('Workflow Builder saves, validates, and runs workspace canvas', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /工作流/i }));

    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: /^保存$/i }));
    await user.click(within(toolbar).getByRole('button', { name: /^校验$/i }));
    await user.click(within(toolbar).getByRole('button', { name: /^运行$/i }));

    const calls = vi.mocked(fetch).mock.calls;
    const saveCall = calls.find(([url, init]) => url === '/api/workflows' && init?.method === 'POST');
    const validateCall = calls.find(
      ([url, init]) => url === '/api/workflows/acc_workspace_canvas/validate' && init?.method === 'POST',
    );
    const runCall = calls.find(
      ([url, init]) => url === '/api/workflows/acc_workspace_canvas/run' && init?.method === 'POST',
    );
    expect(saveCall).toBeTruthy();
    expect(validateCall).toBeTruthy();
    expect(runCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    expect(savedPayload.graph.nodes).toHaveLength(5);
    expect(savedPayload.graph.data_edges.length).toBeGreaterThan(0);
    expect(savedPayload.graph.control_edges.length).toBeGreaterThan(0);
    expect(await screen.findByText(/运行 acc_workspace_canvas: 成功/i)).toBeInTheDocument();
  });

  test('Run Inspector exposes debugger actions and diff results', async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText('ui_acceptance_fake');
    await user.click(await screen.findByRole('button', { name: /事件回放/i }));
    await user.click(await screen.findByRole('button', { name: /重跑节点/i }));

    expect(await screen.findByLabelText('replay.json')).toHaveTextContent('node_completed');
    expect(await screen.findByLabelText('run_diff.json')).toHaveTextContent('"changed_nodes": []');
  });

  test('Control Plane renders GraphOps safety flow', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /控制平面/i }));
    await user.click(await screen.findByRole('button', { name: /校验 patch/i }));
    await user.click(await screen.findByRole('button', { name: /dry-run patch/i }));

    expect(await screen.findByLabelText('graphops.dry-run.json')).toHaveTextContent(
      'apply_requires_human_approval',
    );
    expect(screen.getByText(/危险 apply 默认关闭/)).toBeInTheDocument();
  });
});
