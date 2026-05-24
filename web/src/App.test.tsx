import { render, screen, within } from '@testing-library/react';
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
  '/api/capsules': {
    capsules: [
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
  '/api/workflows': {
    workflows: [
      {
        workflow_id: 'engine-architecture-research-v2',
        file_id: 'engine-architecture-research.v2',
        name: 'engine-architecture-research-v2',
        description: 'Fixture workflow',
        version: '0.2.0',
        path: 'workflows/engine-architecture-research.v2.yaml',
        task_count: 1,
      },
    ],
  },
  '/api/workflows/engine-architecture-research-v2': {
    workflow_id: 'engine-architecture-research-v2',
    file_id: 'engine-architecture-research.v2',
    path: 'workflows/engine-architecture-research.v2.yaml',
    workflow: {
      name: 'engine-architecture-research-v2',
      description: 'Fixture workflow',
      version: '0.2.0',
      tasks: [
        {
          name: 'source_reality_check',
          type: 'script',
          command: [
            'uv',
            'run',
            'acc',
            'run',
            'fake-agent.generic',
            '--run-dir',
            'runs/ui_acceptance_fake',
          ],
        },
      ],
    },
  },
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const payload = routes[url];
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

describe('Agent Capsule Workbench read-only UI', () => {
  test('Run List and Run Inspector render fixture run from acc-server APIs', async () => {
    render(<App />);

    expect(await screen.findByText('ui_acceptance_fake')).toBeInTheDocument();
    expect(await screen.findByText('fake-agent.generic')).toBeInTheDocument();
    expect(screen.getByLabelText('Run Inspector')).toHaveTextContent('session_fixture');
  });

  test('Run Inspector can view JSON output through artifact API', async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText('ui_acceptance_fake');
    await user.click(await screen.findByRole('button', { name: /Output/i }));

    expect(await screen.findByLabelText('runs/ui_acceptance_fake/output.json')).toHaveTextContent(
      '"summary": "ok"',
    );
  });

  test('Artifact Viewer renders markdown artifact fixture', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Artifacts/i }));
    await user.click(await screen.findByRole('button', { name: /report.md/i }));

    expect(await screen.findByLabelText('report.md')).toHaveTextContent(
      'Semiconductor analysis fixture.',
    );
  });

  test('Capsule Browser renders capsule metadata and permissions', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Capsules/i }));

    const browser = await screen.findByLabelText('Capsule Browser');
    expect(within(browser).getByRole('heading', { name: 'Fake Agent' })).toBeInTheDocument();
    expect(browser).toHaveTextContent('"sandbox": "read-only"');
  });

  test('Workflow Viewer renders read-only workflow nodes and capsule link text', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Workflows/i }));

    expect(await screen.findByLabelText('Workflow DAG')).toHaveTextContent('source_reality_check');
    expect(screen.getByLabelText('Workflow DAG')).toHaveTextContent('Capsule: fake-agent.generic');
  });

  test('UI exposes no mutation controls', async () => {
    render(<App />);

    await screen.findByText('ui_acceptance_fake');
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
  });
});
