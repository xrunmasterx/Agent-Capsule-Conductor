import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { App } from './App';
import {
  addCallableNodeFromPalette,
  addInternalNodeFromPalette,
  addWorkflowFromPalette,
  assistantDisplayStatus,
  buildAssistantTranscriptItems,
  boundedLiveEvents,
  canvasToWorkflowGraph,
  deleteSelectionFromCanvas,
  expandWorkflowToFitChildren,
  expandWorkflowToFitChildrenCenterLocked,
  filterLiveEvents,
  graphToWorkspaceCanvas,
  internalInvocationLabel,
  isExecutableNodeWorkflow,
  layoutCanvasForSelection,
  layoutWorkspaceCanvas,
  liveStateForNodeRun,
  nextRootPalettePosition,
  nodeLiveLogsFor,
  nodeLogDeltaKeys,
  nodeRunForInternalNode,
  normalizeSelectionIntent,
  promptFromInvocationInput,
  selectionCanBeDeleted,
  shouldDisconnectEdgeOnClick,
  staticInputFromInvocationInput,
  workspaceDemoCanvas,
  workflowInvocationLabel,
} from './components/WorkflowViewer';

// Alias object so that existing `helpers.xxx` test patterns keep working.
const helpers: Record<string, any> = {
  addCallableNodeFromPalette,
  addInternalNodeFromPalette,
  addWorkflowFromPalette,
  assistantDisplayStatus,
  buildAssistantTranscriptItems,
  boundedLiveEvents,
  canvasToWorkflowGraph,
  deleteSelectionFromCanvas,
  expandWorkflowToFitChildren,
  expandWorkflowToFitChildrenCenterLocked,
  filterLiveEvents,
  graphToWorkspaceCanvas,
  internalInvocationLabel,
  isExecutableNodeWorkflow,
  layoutCanvasForSelection,
  layoutWorkspaceCanvas,
  liveStateForNodeRun,
  nextRootPalettePosition,
  nodeLiveLogsFor,
  nodeLogDeltaKeys,
  nodeRunForInternalNode,
  normalizeSelectionIntent,
  promptFromInvocationInput,
  selectionCanBeDeleted,
  shouldDisconnectEdgeOnClick,
  staticInputFromInvocationInput,
  workspaceDemoCanvas,
  workflowInvocationLabel,
};

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

const longCodexInputTail = 'FULL_INPUT_TAIL_MARKER';
const longCodexInput = `Company profile ${'Microsoft cloud productivity platform business context. '.repeat(14)}${longCodexInputTail}`;
const codexOutputFixture = JSON.stringify({
  status: 'success',
  summary: 'Codex agent output fixture',
  analysis: 'Readable analysis fixture extracted from output JSON.',
  recommendations: ['Keep deterministic formatter coverage'],
});
const demoRootId = 'core_v2_stock_research_canvas';
const demoRunPrefix = `ui_workflow_${demoRootId}`;
const demoWorkflowNodeId = 'Fundamentals_Workflow';
const demoInternalNodeId = 'business_model_agent';
const demoInternalFlowNodeId = `${demoWorkflowNodeId}__internal__${demoInternalNodeId}`;
const demoInternalNodeLabel = '\u4e1a\u52a1\u6a21\u5f0f\u5206\u6790';
const demoInternalCallableId = 'stock-research-analyst.codex';
const demoInternalRunPath = (runId: string) =>
  `runs/${runId}/nodes/${demoWorkflowNodeId}/internal/${demoInternalNodeId}`;

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
  [`POST /api/workflows/${demoRootId}/validate`]: { status: 'valid', workflow_id: demoRootId },
  [`POST /api/workflows/${demoWorkflowNodeId}/binding/select-directory`]: {
    workflow_id: demoWorkflowNodeId,
    status: 'selected',
    workspace_root: 'D:\\CFH\\EngineSource',
    valid: true,
    error: null,
  },
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
    workflow_id: `${demoRunPrefix}_fixture`,
    status: 'success',
    run_dir: `runs/${demoRunPrefix}_fixture`,
    nodes: [
      {
        node_id: demoWorkflowNodeId,
        callable_id: `${demoRootId}__Fundamentals_Workflow.accflow.json`,
        status: 'success',
        run_dir: `runs/${demoRunPrefix}_fixture/nodes/${demoWorkflowNodeId}`,
        input_path: `runs/${demoRunPrefix}_fixture/nodes/${demoWorkflowNodeId}/input.json`,
        prompt_path: `runs/${demoRunPrefix}_fixture/nodes/${demoWorkflowNodeId}/resolved_prompt.md`,
        output_path: `runs/${demoRunPrefix}_fixture/nodes/${demoWorkflowNodeId}/output.json`,
        artifact_dir: `runs/${demoRunPrefix}_fixture/nodes/${demoWorkflowNodeId}/artifacts`,
        event_log: `runs/${demoRunPrefix}_fixture/nodes/${demoWorkflowNodeId}/events.jsonl`,
        stdout_log: `runs/${demoRunPrefix}_fixture/nodes/${demoWorkflowNodeId}/stdout.log`,
        stderr_log: `runs/${demoRunPrefix}_fixture/nodes/${demoWorkflowNodeId}/stderr.log`,
      },
      {
        node_id: demoInternalNodeId,
        ui_node_id: demoInternalFlowNodeId,
        parent_node_id: demoWorkflowNodeId,
        callable_id: demoInternalCallableId,
        status: 'success',
        run_dir: demoInternalRunPath(`${demoRunPrefix}_fixture`),
        input_path: `${demoInternalRunPath(`${demoRunPrefix}_fixture`)}/input.json`,
        prompt_path: `${demoInternalRunPath(`${demoRunPrefix}_fixture`)}/resolved_prompt.md`,
        output_path: `${demoInternalRunPath(`${demoRunPrefix}_fixture`)}/output.json`,
        artifact_dir: `${demoInternalRunPath(`${demoRunPrefix}_fixture`)}/artifacts`,
        event_log: `${demoInternalRunPath(`${demoRunPrefix}_fixture`)}/events.jsonl`,
        stdout_log: `${demoInternalRunPath(`${demoRunPrefix}_fixture`)}/stdout.log`,
        stderr_log: `${demoInternalRunPath(`${demoRunPrefix}_fixture`)}/stderr.log`,
      },
    ],
    edges: [],
    errors: [],
  },
  [`/api/artifacts/read?path=runs%2F${demoRunPrefix}_fixture%2Fnodes%2F${demoWorkflowNodeId}%2Finput.json`]: {
    path: `runs/${demoRunPrefix}_fixture/nodes/${demoWorkflowNodeId}/input.json`,
    name: 'input.json',
    type: 'json',
    content: '{"topic":"Research input fixture","upstream":"真实上游输入"}',
    size_bytes: 64,
  },
  [`/api/artifacts/read?path=runs%2F${demoRunPrefix}_fixture%2Fnodes%2F${demoWorkflowNodeId}%2Foutput.json`]: {
    path: `runs/${demoRunPrefix}_fixture/nodes/${demoWorkflowNodeId}/output.json`,
    name: 'output.json',
    type: 'json',
    content: '{"status":"success","summary":"Research output fixture"}',
    size_bytes: 56,
  },
  [`/api/artifacts/read?path=runs%2F${demoRunPrefix}_fixture%2Fnodes%2F${demoWorkflowNodeId}%2Finternal%2F${demoInternalNodeId}%2Finput.json`]: {
    path: `${demoInternalRunPath(`${demoRunPrefix}_fixture`)}/input.json`,
    name: 'input.json',
    type: 'json',
    content: JSON.stringify({ topic: '业务模式研究', upstream: '真实上游输入', context: longCodexInput }),
    size_bytes: 49 + longCodexInput.length,
  },
  [`/api/artifacts/read?path=runs%2F${demoRunPrefix}_fixture%2Fnodes%2F${demoWorkflowNodeId}%2Finternal%2F${demoInternalNodeId}%2Foutput.json`]: {
    path: `${demoInternalRunPath(`${demoRunPrefix}_fixture`)}/output.json`,
    name: 'output.json',
    type: 'json',
    content: codexOutputFixture,
    size_bytes: codexOutputFixture.length,
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
    apply_status: 'not_implemented',
    dry_run_only: true,
    governance_mode: 'proposal_dry_run_only',
    semantic_diff: { status: 'valid', added_nodes: ['review'], added_edges: ['a->review'] },
  },
  'POST /api/graphops/dry-run': {
    status: 'dry_run',
    patch_id: 'patch_add_review_node',
    target_type: 'workflow',
    target_path: 'examples/workflows/control_plane_demo.graph.json',
    mutated: false,
    apply_requires_human_approval: true,
    apply_status: 'not_implemented',
    dry_run_only: true,
    governance_mode: 'proposal_dry_run_only',
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
  'POST /api/debugger/diff': {
    run_a: 'runs/ui_acceptance_fake',
    run_b: 'runs/ui_rerun_node_ui_acceptance_fake',
    status: { a: 'success', b: 'success', changed: false },
    changed_nodes: [],
    node_diffs: [],
  },
};

const failedRoutes = new Map<string, { status: number; detail: string }>();
let agentSessionMessages: Array<{ role: string; content: string; turn_id?: string; created_at?: string }> = [];
let agentCurrentOutputTurnId = 'turn_draft_fixture';
let assistantSessionMessages: Array<{ role: string; content: string; turn_id?: string; created_at?: string }> = [];
let assistantCurrentOutputTurnId: string | null = null;
let assistantCanvasHash = 'hash_fixture';
let assistantLastMessage = '';
let assistantLastReason = 'workbench_chat';
let assistantTaskId = 'task_canvas_default';
let assistantPreserveCurrentOutputOnChat = false;

function failRoute(method: string, url: string, detail: string, status = 500) {
  failedRoutes.set(`${method} ${url}`, { status, detail });
}

function workspaceCanvasRunSummary(runId: string) {
  return {
    run_id: runId,
    workflow_id: runId,
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
        node_id: demoWorkflowNodeId,
        callable_id: `${demoRootId}__Fundamentals_Workflow.accflow.json`,
        status: 'success',
        run_dir: `runs/${runId}/nodes/${demoWorkflowNodeId}`,
        input_path: `runs/${runId}/nodes/${demoWorkflowNodeId}/input.json`,
        prompt_path: `runs/${runId}/nodes/${demoWorkflowNodeId}/resolved_prompt.md`,
        output_path: `runs/${runId}/nodes/${demoWorkflowNodeId}/output.json`,
        artifact_dir: `runs/${runId}/nodes/${demoWorkflowNodeId}/artifacts`,
        event_log: `runs/${runId}/nodes/${demoWorkflowNodeId}/events.jsonl`,
        stdout_log: `runs/${runId}/nodes/${demoWorkflowNodeId}/stdout.log`,
        stderr_log: `runs/${runId}/nodes/${demoWorkflowNodeId}/stderr.log`,
      },
      {
        node_id: demoInternalNodeId,
        ui_node_id: demoInternalFlowNodeId,
        parent_node_id: demoWorkflowNodeId,
        callable_id: demoInternalCallableId,
        status: 'success',
        run_dir: demoInternalRunPath(runId),
        input_path: `${demoInternalRunPath(runId)}/input.json`,
        prompt_path: `${demoInternalRunPath(runId)}/resolved_prompt.md`,
        output_path: `${demoInternalRunPath(runId)}/output.json`,
        artifact_dir: `${demoInternalRunPath(runId)}/artifacts`,
        event_log: `${demoInternalRunPath(runId)}/events.jsonl`,
        stdout_log: `${demoInternalRunPath(runId)}/stdout.log`,
        stderr_log: `${demoInternalRunPath(runId)}/stderr.log`,
        log_excerpt: 'Codex live stream fixture line',
        output_preview: {
          status: 'success',
          summary: 'Codex agent output fixture',
          outputs: {},
        },
        binding_manifest: {
          inputs: ['main'],
          bindings: [
            {
              binding_kind: 'control_main_default',
              source_node: 'Research_Flow',
              source_port: 'main',
              target_node: 'research_business',
              target_port: 'main',
            },
          ],
        },
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
      { type: 'node_completed', node_id: demoWorkflowNodeId, status: 'success' },
      {
        type: 'node_completed',
        node_id: demoInternalNodeId,
        ui_node_id: demoInternalFlowNodeId,
        parent_node_id: demoWorkflowNodeId,
        status: 'success',
      },
      { type: 'workflow_completed', status: 'success' },
    ],
  };
}

function agentSessionFixture(runId = `${demoRunPrefix}_fixture_123`) {
  return {
    schema_version: 'acc.agent_session.v1',
    session_id: 'agent_session_research_business',
    task_id: runId,
    node_id: demoInternalNodeId,
    callable_ref: { kind: 'agent_class', id: demoInternalCallableId },
    runtime: 'codex_app_server',
    provider_session_id: 'provider_fixture',
    workspace_ref: 'E:/Agent Capsule Conductor/acc_codex',
    status: 'ready',
    current_output_ref: 'current_output.json',
    published_output_ref: 'published_output.json',
    bound_run_id: runId,
    bound_node_id: demoInternalNodeId,
    bound_node_output_ref: `${demoInternalRunPath(runId)}/output.json`,
    current_output_turn_id: agentCurrentOutputTurnId,
    published_output_turn_id: 'turn_initial_fixture',
    last_turn_id: agentCurrentOutputTurnId,
    created_at: '2026-06-07T00:00:00Z',
    updated_at: '2026-06-07T00:00:01Z',
    session_dir: `runs/_agent_sessions/${runId}/${demoInternalNodeId}`,
    output_schema: { type: 'object', properties: { summary: { type: 'string' } } },
  };
}

function agentNodeEventsFixture(runId: string) {
  return {
    run_id: runId,
    node_id: demoInternalNodeId,
    event_log: `${demoInternalRunPath(runId)}/events.jsonl`,
    events: [
      { type: 'node_completed', node_id: demoInternalNodeId, status: 'success', timestamp: '2026-06-07T00:00:00Z' },
      {
        type: 'agent_message',
        node_id: demoInternalNodeId,
        session_id: 'agent_session_research_business',
        turn_id: agentCurrentOutputTurnId,
        timestamp: '2026-06-07T00:00:01Z',
        payload: { content: 'Agent session fixture message' },
      },
      {
        type: 'agent_output_draft',
        node_id: demoInternalNodeId,
        session_id: 'agent_session_research_business',
        turn_id: agentCurrentOutputTurnId,
        timestamp: '2026-06-07T00:00:02Z',
        payload: { output_path: `runs/_agent_sessions/${runId}/${demoInternalNodeId}/current_output.json` },
      },
    ],
  };
}

function assistantSessionFixture() {
  return {
    schema_version: 'acc.agent_session.v1',
    session_id: 'agent_session_workbench_assistant',
    task_id: assistantTaskId,
    node_id: 'workbench_assistant',
    callable_ref: { kind: 'agent_class', id: 'echo-test.generic' },
    runtime: 'codex_app_server',
    provider_session_id: 'provider_assistant_fixture',
    workspace_ref: 'E:/Agent Capsule Conductor/acc_codex',
    status: 'ready',
    session_kind: 'workbench_assistant',
    current_output_ref: assistantCurrentOutputTurnId ? 'current_output.json' : null,
    published_output_ref: null,
    bound_run_id: null,
    bound_node_id: null,
    current_output_turn_id: assistantCurrentOutputTurnId,
    published_output_turn_id: null,
    last_turn_id: assistantCurrentOutputTurnId,
    created_at: '2026-06-07T00:00:00Z',
    updated_at: '2026-06-07T00:00:01Z',
    session_dir: 'runs/_agent_sessions/task_canvas_default/workbench_assistant',
    output_schema: { type: 'object' },
  };
}

function assistantDraftFixture() {
  const wantsTemp = assistantLastMessage.toLowerCase().includes('new agent');
  return {
    session_id: 'agent_session_workbench_assistant',
    turn_id: assistantCurrentOutputTurnId || 'turn_assistant_fixture',
    status: 'valid',
    assistant_message: 'Backend generated a proposal.',
    proposal: wantsTemp
      ? {
          proposal_id: 'canvas_proposal_temp',
          base_task_id: 'task_canvas_default',
          base_canvas_hash: assistantCanvasHash,
          target: { kind: 'task_canvas', task_id: 'task_canvas_default' },
          rationale: 'Draft temporary agent',
          operations: [
            {
              op: 'create_temporary_agent_template',
              scope_workflow_id: null,
              draft_id: 'tmp_agent_test',
              node_id: 'tmp_agent_test',
              label: 'Temporary Agent',
              position: { x: 120, y: 180 },
              agent_draft: {
                id: 'tmp_agent_test',
                version: '0.1.0',
                runtime: 'codex_cli',
                name: 'Temporary Agent',
                default_prompt: assistantLastMessage,
                input_ports: { main: { type: 'artifact', required: false } },
                output_ports: { main: { type: 'artifact', required: true } },
                artifact_contract: { output_schema: { type: 'object', properties: { summary: { type: 'string' } } } },
                metadata: { temporary: true },
              },
              input: { user_prompt: assistantLastMessage },
              output_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
            },
          ],
        }
      : {
          proposal_id: 'canvas_proposal_backend',
          base_task_id: 'task_canvas_default',
          base_canvas_hash: assistantCanvasHash,
          target: { kind: 'task_canvas', task_id: 'task_canvas_default' },
          rationale: 'Backend authoring proposal',
          operations: [
            {
              op: 'add_existing_callable_node',
              scope_workflow_id: null,
              node_id: 'Echo_Test',
              callable_id: 'echo-test.generic',
              callable_kind: 'agent_class',
              label: 'Echo Test',
              position: { x: 120, y: 180 },
              input: { user_prompt: assistantLastMessage || 'Create a research and review workflow' },
              input_ports: [{ id: 'main', direction: 'input', required: false }],
              output_ports: [{ id: 'main', direction: 'output', required: true }],
              output_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
            },
          ],
        },
    required_actions: wantsTemp
      ? [
          {
            kind: 'approve_resource_persistence',
            resource_draft_id: 'tmp_agent_test',
            reason: 'Temporary agent must be persisted before run/save',
          },
        ]
      : [{ kind: 'confirm_canvas_apply', reason: 'Review and apply proposal' }],
    questions: [],
    risk_notes: [],
    confidence: 'medium',
  };
}

beforeEach(() => {
  agentSessionMessages = [
    {
      role: 'assistant',
      content: 'Agent session fixture message',
      turn_id: 'turn_initial_fixture',
      created_at: '2026-06-07T00:00:01Z',
    },
  ];
  agentCurrentOutputTurnId = 'turn_draft_fixture';
  assistantSessionMessages = [];
  assistantCurrentOutputTurnId = null;
  assistantCanvasHash = 'hash_fixture';
  assistantLastMessage = '';
  assistantLastReason = 'workbench_chat';
  assistantTaskId = 'task_canvas_default';
  assistantPreserveCurrentOutputOnChat = false;
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
      if (method === 'GET' && url === '/api/authoring/agents') {
        return new Response(
          JSON.stringify({
            agents: [
              {
                id: 'echo-test.generic',
                version: '0.1.0',
                kind: 'agent_class',
                runtime: 'generic_cli',
                backend: 'native',
                source_id: 'echo-test.generic',
                source_path: 'callables/agents/echo-test.generic.yaml',
                name: 'Echo Test',
                default_permissions: {
                  workspace_access: 'read_only',
                  network: false,
                  shell: false,
                  dangerous: false,
                  env_policy: 'acc_whitelist',
                  allowed_env: [],
                  timeout_seconds: 60,
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'POST' && url === '/api/authoring/sessions') {
        const body = JSON.parse(String(init?.body || '{}'));
        return new Response(
          JSON.stringify({
            session_id: 'authoring_test_session',
            agent_id: body.agent_id || 'echo-test.generic',
            task_id: body.task_id,
            status: 'ready',
            messages: [],
            last_proposal: null,
            validation: null,
            required_actions: [],
            evidence: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (
        method === 'POST' &&
        /^\/api\/authoring\/sessions\/[^/]+\/messages$/u.test(url)
      ) {
        const body = JSON.parse(String(init?.body || '{}'));
        const wantsTemp = String(body.message || '').toLowerCase().includes('new agent');
        const proposal = wantsTemp
          ? {
              proposal_id: 'canvas_proposal_temp',
              base_task_id: body.canvas_snapshot?.task_id || 'task_canvas_default',
              base_canvas_hash: body.canvas_hash,
              target: { kind: 'task_canvas', task_id: body.canvas_snapshot?.task_id || 'task_canvas_default' },
              rationale: 'Draft temporary agent',
              operations: [
                {
                  op: 'create_temporary_agent_template',
                  scope_workflow_id: null,
                  draft_id: 'tmp_agent_test',
                  node_id: 'tmp_agent_test',
                  label: 'Temporary Agent',
                  position: { x: 120, y: 180 },
                  agent_draft: {
                    id: 'tmp_agent_test',
                    version: '0.1.0',
                    runtime: 'codex_cli',
                    name: 'Temporary Agent',
                    default_prompt: body.message,
                    input_ports: { main: { type: 'artifact', required: false } },
                    output_ports: { main: { type: 'artifact', required: true } },
                    artifact_contract: { output_schema: { type: 'object', properties: { summary: { type: 'string' } } } },
                    metadata: { temporary: true },
                  },
                  input: { user_prompt: body.message },
                  output_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
                },
              ],
            }
          : {
              proposal_id: 'canvas_proposal_backend',
              base_task_id: body.canvas_snapshot?.task_id || 'task_canvas_default',
              base_canvas_hash: body.canvas_hash,
              target: { kind: 'task_canvas', task_id: body.canvas_snapshot?.task_id || 'task_canvas_default' },
              rationale: 'Backend authoring proposal',
              operations: [
                {
                  op: 'add_existing_callable_node',
                  scope_workflow_id: null,
                  node_id: 'Echo_Test',
                  callable_id: 'echo-test.generic',
                  callable_kind: 'agent_class',
                  label: 'Echo Test',
                  position: { x: 120, y: 180 },
                  input: { user_prompt: body.message },
                  input_ports: [{ id: 'main', direction: 'input', required: false }],
                  output_ports: [{ id: 'main', direction: 'output', required: true }],
                  output_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
                },
              ],
            };
        return new Response(
          JSON.stringify({
            session_id: 'authoring_test_session',
            message_id: 'msg_test',
            assistant_message: 'Backend generated a proposal.',
            proposal,
            validation: { status: 'valid', errors: [], warnings: [] },
            required_actions: wantsTemp
              ? [
                  {
                    kind: 'approve_resource_persistence',
                    resource_draft_id: 'tmp_agent_test',
                    reason: 'Temporary agent must be persisted before run/save',
                  },
                ]
              : [{ kind: 'confirm_canvas_apply', reason: 'Review and apply proposal' }],
            questions: [],
            risk_notes: [],
            confidence: 'medium',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'POST' && url === '/api/workbench/canvas-snapshots') {
        const body = JSON.parse(String(init?.body || '{}'));
        return new Response(
          JSON.stringify({
            schema_version: 'acc.workbench.canvas_snapshot.v1',
            task_id: body.task_id,
            canvas_hash: body.canvas_hash,
            canvas_snapshot: body.canvas_snapshot,
            selection: body.selection || {},
            temporary_resources: body.temporary_resources || {},
            published_at: '2026-06-07T00:00:00Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'POST' && url === '/api/graphops/proposals') {
        const body = JSON.parse(String(init?.body || '{}'));
        return new Response(
          JSON.stringify({
            proposal_id: body.proposal.proposal_id,
            status: 'drafted',
            proposal: body.proposal,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const graphopsProposalRoute = url.match(/^\/api\/graphops\/proposals\/([^/]+)\/([^/]+)$/u);
      if (method === 'POST' && graphopsProposalRoute) {
        const proposalId = decodeURIComponent(graphopsProposalRoute[1]);
        const action = graphopsProposalRoute[2];
        if (action === 'validate') {
          return new Response(
            JSON.stringify({ status: 'valid', errors: [], warnings: [] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (action === 'dry-run') {
          return new Response(
            JSON.stringify({
              status: 'dry_run_ready',
              proposal_id: proposalId,
              mutated: false,
              target_paths: ['callables/agents/tmp_agent_test.yaml'],
              dry_run_digest: 'sha256:test-dry-run',
              semantic_diff: {
                created_files: ['callables/agents/tmp_agent_test.yaml'],
                created_callable_ids: ['tmp_agent_test'],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (action === 'approve') {
          return new Response(
            JSON.stringify({ status: 'approved', proposal_id: proposalId }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (action === 'apply') {
          return new Response(
            JSON.stringify({
              status: 'applied',
              proposal_id: proposalId,
              created_files: ['callables/agents/tmp_agent_test.yaml'],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
      }
      if (method === 'POST' && url === '/api/workflows/run-graph/submit') {
        const body = JSON.parse(String(init?.body || '{}'));
        const runId = String(body.run_dir || '').split('/').pop() || body.graph?.id || `${demoRunPrefix}_fixture`;
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
      if (method === 'POST' && url === '/api/callables/agents') {
        const body = JSON.parse(String(init?.body || '{}'));
        return new Response(
          JSON.stringify({
            status: 'saved',
            callable: {
              id: body.id,
              version: body.version || '0.1.0',
              name: body.name,
              description: body.description,
              kind: 'agent_class',
              backend: 'native',
              source_id: body.id,
              source_path: `callables/agents/${body.id}.yaml`,
              metadata: body.metadata || {},
              input_ports: body.input_ports || { main: { type: 'artifact', required: false } },
              output_ports: body.output_ports || { main: { type: 'artifact', required: true } },
              artifact_contract: body.artifact_contract || {},
              runtime: body.runtime || 'codex_cli',
              default_prompt: body.default_prompt || '',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      const workspaceCanvasRun = url.match(/^\/api\/runs\/(ui_workflow_core_v2_stock_research_canvas(?:_fixture)?_\d+)$/u);
      if (method === 'GET' && workspaceCanvasRun) {
        return new Response(JSON.stringify(workspaceCanvasRunSummary(workspaceCanvasRun[1])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const workspaceCanvasEvents = url.match(
        /^\/api\/runs\/(ui_workflow_core_v2_stock_research_canvas(?:_fixture)?_\d+)\/events\?limit=\d+$/u,
      );
      if (method === 'GET' && workspaceCanvasEvents) {
        return new Response(JSON.stringify(workspaceCanvasRunEvents(workspaceCanvasEvents[1])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (
        method === 'GET' &&
          /^\/api\/artifacts\/read\?path=runs%2Fui_workflow_core_v2_stock_research_canvas(?:_fixture)?_\d+%2Fnodes%2FFundamentals_Workflow%2Finternal%2Fbusiness_model_agent%2Finput\.json$/u.test(
          url,
        )
      ) {
        return new Response(
          JSON.stringify({
            path: `${demoInternalRunPath(`${demoRunPrefix}_fixture`)}/input.json`,
            name: 'input.json',
            type: 'json',
            content: JSON.stringify({ topic: demoInternalNodeLabel, upstream: '真实上游输入', context: longCodexInput }),
            size_bytes: 49 + longCodexInput.length,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (
        method === 'GET' &&
          /^\/api\/artifacts\/read\?path=runs%2Fui_workflow_core_v2_stock_research_canvas(?:_fixture)?_\d+%2Fnodes%2FFundamentals_Workflow%2Finternal%2Fbusiness_model_agent%2Foutput\.json$/u.test(
          url,
        )
      ) {
        return new Response(
          JSON.stringify({
            path: `${demoInternalRunPath(`${demoRunPrefix}_fixture`)}/output.json`,
            name: 'output.json',
            type: 'json',
            content: codexOutputFixture,
            size_bytes: codexOutputFixture.length,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'POST' && url === '/api/agent-sessions') {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.source?.type === 'workbench_assistant') {
          const nextAssistantTaskId = String(body.source?.task_id || 'task_canvas_default');
          if (nextAssistantTaskId !== assistantTaskId) {
            assistantSessionMessages = [];
            assistantCurrentOutputTurnId = null;
            assistantLastMessage = '';
          }
          assistantTaskId = nextAssistantTaskId;
          assistantCanvasHash = String(body.source?.canvas_hash || assistantCanvasHash);
          return new Response(JSON.stringify(assistantSessionFixture()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const runId = String(body.source?.run_id || `${demoRunPrefix}_fixture_123`);
        return new Response(JSON.stringify(agentSessionFixture(runId)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && url === '/api/agent-sessions/agent_session_workbench_assistant') {
        return new Response(JSON.stringify(assistantSessionFixture()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && url === '/api/agent-sessions/agent_session_workbench_assistant/messages') {
        return new Response(
          JSON.stringify({ session_id: 'agent_session_workbench_assistant', messages: assistantSessionMessages }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'POST' && url === '/api/agent-sessions/agent_session_workbench_assistant/turns/submit') {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.reason === 'workbench_chat') {
          assistantCurrentOutputTurnId = assistantPreserveCurrentOutputOnChat
            ? assistantCurrentOutputTurnId
            : null;
        } else {
          assistantCurrentOutputTurnId = 'turn_assistant_fixture';
        }
        assistantCanvasHash = String(body.canvas_hash || assistantCanvasHash);
        assistantLastMessage = String(body.message || '');
        assistantLastReason = String(body.reason || 'workbench_chat');
        const assistantReply =
          body.reason === 'workbench_chat' ? '普通聊天回复。' : 'Backend generated a proposal.';
        assistantSessionMessages.push(
          { role: 'user', content: assistantLastMessage, turn_id: 'turn_assistant_fixture' },
          { role: 'assistant', content: assistantReply, turn_id: 'turn_assistant_fixture' },
        );
        return new Response(
          JSON.stringify({
            session_id: 'agent_session_workbench_assistant',
            turn_id: 'turn_assistant_fixture',
            reason: body.reason || 'canvas_revision',
            status: 'queued',
            events_url: '/api/agent-sessions/agent_session_workbench_assistant/turns/turn_assistant_fixture/events',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (
        method === 'GET' &&
        url === '/api/agent-sessions/agent_session_workbench_assistant/turns/turn_assistant_fixture/events'
      ) {
        return new Response(
          JSON.stringify({
            session_id: 'agent_session_workbench_assistant',
            turn_id: 'turn_assistant_fixture',
            events: [
              {
                type: 'agent_message',
                session_id: 'agent_session_workbench_assistant',
                turn_id: 'turn_assistant_fixture',
                timestamp: '2026-06-07T00:00:03Z',
                payload: {
                  content:
                    assistantLastReason === 'workbench_chat'
                      ? '普通聊天回复。'
                      : 'Backend generated a proposal.',
                },
              },
              ...(assistantCurrentOutputTurnId
                ? [
                    {
                      type: 'agent_output_draft',
                      session_id: 'agent_session_workbench_assistant',
                      turn_id: 'turn_assistant_fixture',
                      timestamp: '2026-06-07T00:00:04Z',
                      payload: { output_path: 'runs/_agent_sessions/task_canvas_default/workbench_assistant/current_output.json' },
                    },
                  ]
                : []),
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'POST' && url === '/api/agent-sessions/agent_session_workbench_assistant/assistant-draft/validate') {
        return new Response(JSON.stringify(assistantDraftFixture()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && url === '/api/agent-sessions/agent_session_research_business') {
        return new Response(JSON.stringify(agentSessionFixture()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && url === '/api/agent-sessions/agent_session_research_business/messages') {
        return new Response(
          JSON.stringify({ session_id: 'agent_session_research_business', messages: agentSessionMessages }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'POST' && url === '/api/agent-sessions/agent_session_research_business/turns/submit') {
        const body = JSON.parse(String(init?.body || '{}'));
        agentCurrentOutputTurnId = 'turn_chat_fixture';
        agentSessionMessages.push(
          { role: 'user', content: String(body.message || ''), turn_id: agentCurrentOutputTurnId },
          { role: 'assistant', content: 'Hermetic agent turn completed.', turn_id: agentCurrentOutputTurnId },
        );
        return new Response(
          JSON.stringify({
            session_id: 'agent_session_research_business',
            turn_id: agentCurrentOutputTurnId,
            reason: body.reason || 'node_chat',
            status: 'queued',
            events_url: '/api/agent-sessions/agent_session_research_business/turns/turn_chat_fixture/events',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (
        method === 'GET' &&
        url === '/api/agent-sessions/agent_session_research_business/turns/turn_chat_fixture/events'
      ) {
        return new Response(
          JSON.stringify({
            session_id: 'agent_session_research_business',
            turn_id: 'turn_chat_fixture',
            events: [
              {
                type: 'agent_message',
                session_id: 'agent_session_research_business',
                turn_id: 'turn_chat_fixture',
                timestamp: '2026-06-07T00:00:03Z',
                payload: { content: 'Hermetic agent turn completed.' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (method === 'POST' && url === '/api/agent-sessions/agent_session_research_business/output/publish') {
        const body = JSON.parse(String(init?.body || '{}'));
        return new Response(
          JSON.stringify({
            session_id: 'agent_session_research_business',
            status: 'published',
            published_output_path: `runs/_agent_sessions/${demoRunPrefix}_fixture_123/${demoInternalNodeId}/published_output.json`,
            target_output_path: `${demoInternalRunPath(`${demoRunPrefix}_fixture_123`)}/output.json`,
            expected_turn_id: body.expected_turn_id,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const dynamicNodeEvents = url.match(
        /^\/api\/runs\/(ui_workflow_core_v2_stock_research_canvas(?:_fixture)?_\d+)\/nodes\/business_model_agent\/events\?limit=\d+$/u,
      );
      if (method === 'GET' && dynamicNodeEvents) {
        return new Response(JSON.stringify(agentNodeEventsFixture(dynamicNodeEvents[1])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (
        method === 'GET' &&
        /^\/api\/artifacts\/read\?path=runs%2F_agent_sessions%2Fui_workflow_core_v2_stock_research_canvas(?:_fixture)?_\d+%2Fbusiness_model_agent%2Fcurrent_output\.json$/u.test(url)
      ) {
        return new Response(
          JSON.stringify({
            path: `runs/_agent_sessions/${demoRunPrefix}_fixture_123/${demoInternalNodeId}/current_output.json`,
            name: 'current_output.json',
            type: 'json',
            content: '{"summary":"Draft output fixture"}',
            size_bytes: 34,
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

  async function dropFakeAgentOnCanvas(label = 'Fake Agent') {
    const canvas = await screen.findByLabelText('任务画布');
    fireEvent.drop(canvas, {
      clientX: 980,
      clientY: 180,
      dataTransfer: {
        getData: (key: string) =>
          key === 'application/x-acc-palette'
            ? JSON.stringify({
                kind: 'tool',
                callableId: 'fake-agent.generic',
                label,
              })
            : '',
      },
    });
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

  test('Resource library renders human-facing callable metadata', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 1);

    const browser = await screen.findByLabelText('智能体工具资源库');
    expect(within(browser).getByRole('heading', { name: '智能体工具资源库' })).toBeInTheDocument();
    expect(browser).toHaveTextContent('echo-test.generic');
    expect(within(browser).getAllByText('智能体').length).toBeGreaterThan(0);
    expect(await within(browser).findByText('Echo fixture callable')).toBeInTheDocument();
    expect(browser).not.toHaveTextContent('AgentClassTemplate');
    expect(browser).not.toHaveTextContent('ToolClassTemplate');
    expect(browser).not.toHaveTextContent('input_ports');
  });

  test('Workflow Builder renders graph-first workspace canvas', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    await loadWorkspaceDemo(user);

    await screen.findByRole('heading', { name: 'Core v2 股市调研分析示例' });
    const canvas = document.body;
    expect(canvas).toHaveTextContent('Core v2');
    expect(canvas).toHaveTextContent('stock-research-analyst.codex');
    expect(canvas).toHaveTextContent('stock-research-synthesis.codex');
    expect(canvas).toHaveTextContent('stock-report-writer.codex');
    expect(canvas).toHaveTextContent('stock-publication-reviewer.codex');
    const toolbar = await screen.findByLabelText('工作流工具栏');
    expect(within(toolbar).getByRole('button', { name: /^运行详情$/i })).toBeInTheDocument();
    await user.click(within(await screen.findByLabelText('连接模式')).getByRole('button', { name: '数据' }));
    expect(canvas).toHaveTextContent('main');
    expect(canvas).toHaveTextContent(demoInternalCallableId);
    expect(canvas).toHaveTextContent('workflows/demo/core_v2/fundamentals');
  });

  test('Primary navigation shows readable Chinese icon labels', async () => {
    render(<App />);

    const navigation = await screen.findByLabelText('Workbench navigation');
    for (const label of ['任务', '资源', '运行记录', '产物', '决策']) {
      expect(within(navigation).getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  test('startup keeps task resources usable when run index fails', async () => {
    failRoute('GET', '/api/runs', 'Run index exploded');
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('API 部分可用')).toBeInTheDocument();

    const resourceRail = await screen.findByLabelText('Workbench 资源栏');
    expect(await within(resourceRail).findByText('Fake Agent')).toBeInTheDocument();
    expect((await within(resourceRail).findByText('Demo Workflow')).closest('button')).toHaveClass(
      'resource-kind-workflow',
    );
    expect(within(resourceRail).getByText('Echo Test').closest('button')).toHaveClass('resource-kind-agent');
    expect(within(resourceRail).getByText('Fake Agent').closest('button')).toHaveClass('resource-kind-tool');
    expect(within(resourceRail).getByText('File Source').closest('button')).toHaveClass('resource-kind-file-source');

    await openNavIndex(user, 2);
    expect(await screen.findByText(/运行记录加载失败/)).toHaveTextContent('Run index exploded');
  });

  test('startup keeps runs usable when callable index fails', async () => {
    failRoute('GET', '/api/callables', 'Callable registry exploded');
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('API 部分可用')).toBeInTheDocument();

    await openNavIndex(user, 2);
    expect((await screen.findAllByText('ui_acceptance_fake')).length).toBeGreaterThan(0);

    await openNavIndex(user, 1);
    expect(await screen.findByText(/资源加载失败/)).toHaveTextContent('Callable registry exploded');
  });

  test('startup keeps callable resources usable when workflow index fails', async () => {
    failRoute('GET', '/api/workflows', 'Workflow index exploded');
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('API 部分可用')).toBeInTheDocument();

    await openNavIndex(user, 1);
    expect((await screen.findAllByText('echo-test.generic')).length).toBeGreaterThan(0);

    await openNavIndex(user, 0);
    const resourceRail = await screen.findByLabelText('Workbench 资源栏');
    expect(await within(resourceRail).findByText(/Workflow 模板加载失败/)).toHaveTextContent(
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

    const restoredWorkbench = await screen.findByLabelText('ACC Workbench');
    await user.click(within(restoredWorkbench).getByRole('button', { name: '任务总览' }));
    await screen.findByLabelText('任务列表');
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
    await screen.findByText(new RegExp(`${demoRunPrefix}.*:`, 'i'));

    const runCallsBeforeSwitch = vi.mocked(fetch).mock.calls.filter(
      ([url, init]) => url === '/api/workflows/run-graph/submit' && init?.method === 'POST',
    ).length;

    const workbench = await screen.findByLabelText('ACC Workbench');
    await user.click(within(workbench).getByRole('button', { name: '新建任务' }));
    await waitFor(() =>
      expect(screen.queryByTestId(`workflow-container-${demoWorkflowNodeId}`)).not.toBeInTheDocument(),
    );

    await user.click(within(workbench).getByRole('button', { name: '任务总览' }));
    const taskList = await screen.findByLabelText('任务列表');
    await user.click(within(taskList).getByRole('button', { name: /^选择任务 Core v2/i }));
    await user.click(within(workbench).getByRole('button', { name: '任务蓝图' }));

    const restoredWorkflow = await screen.findByTestId(`workflow-container-${demoWorkflowNodeId}`);
    await waitFor(() => expect(restoredWorkflow).toHaveClass('status-success'));
    await waitFor(() =>
      expect(screen.getByTestId(`agent-tool-node-${demoInternalFlowNodeId}`)).toHaveClass(
        'status-success',
      ),
    );

    const runCallsAfterSwitch = vi.mocked(fetch).mock.calls.filter(
      ([url, init]) => url === '/api/workflows/run-graph/submit' && init?.method === 'POST',
    ).length;
    expect(runCallsAfterSwitch).toBe(runCallsBeforeSwitch);
  });

  test('Workbench resource rail is permanent and does not expose canvas mutation shortcuts', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);

    const workbench = await screen.findByLabelText('ACC Workbench');
    await user.click(within(workbench).getByRole('button', { name: '新建任务' }));
    const toolbar = await screen.findByLabelText('工作流工具栏');
    expect(within(toolbar).queryByRole('button', { name: /^资源$/i })).not.toBeInTheDocument();
    const resourceRail = await screen.findByLabelText('Workbench 资源栏');
    const fakeAgentResource = within(resourceRail).getByText('Fake Agent').closest('button');
    expect(fakeAgentResource).toBeTruthy();
    expect(
      within(fakeAgentResource as HTMLElement).queryByRole('button', {
        name: /加入到选中 Workflow/,
      }),
    ).not.toBeInTheDocument();
    expect(
      within(fakeAgentResource as HTMLElement).queryByRole('button', {
        name: '根画布',
      }),
    ).not.toBeInTheDocument();
    expect(resourceRail).toHaveTextContent('New Workflow');
  });

  test('Blank canvas click selects the task canvas without rendering a canvas selection frame', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    await dropFakeAgentOnCanvas();

    const agentNode = await screen.findByTestId('agent-tool-node-fake_agent_generic');
    fireEvent.click(agentNode);
    expect(screen.queryByLabelText('节点详情浮层')).not.toBeInTheDocument();
    fireEvent.doubleClick(agentNode);
    expect(await screen.findByLabelText('节点详情浮层')).toHaveTextContent('Fake Agent');
    await user.click(screen.getByRole('button', { name: '关闭节点详情' }));

    const workspaceCanvas = await screen.findByLabelText('任务画布');
    const pane = workspaceCanvas.querySelector('.react-flow__pane');
    expect(pane).toBeInTheDocument();
    fireEvent.pointerDown(pane as Element);
    fireEvent.click(pane as Element);
    expect(screen.getByLabelText('选中对象详情')).toHaveTextContent('任务 1');
    expect(screen.queryByLabelText('节点详情浮层')).not.toBeInTheDocument();
    expect(workspaceCanvas.querySelector('.canvas-selection-frame')).not.toBeInTheDocument();
  });

  test('Backspace deletes the selected root agent but not focused prompt text', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    await dropFakeAgentOnCanvas();

    const agentNode = await screen.findByTestId('agent-tool-node-fake_agent_generic');
    fireEvent.click(agentNode);
    fireEvent.doubleClick(agentNode);
    const promptEditor = await screen.findByLabelText('用户提示词');
    await user.clear(promptEditor);
    await user.type(promptEditor, 'abc');
    await user.keyboard('{Backspace}');
    expect(promptEditor).toHaveValue('ab');
    expect(screen.getByTestId('agent-tool-node-fake_agent_generic')).toBeInTheDocument();

    fireEvent.click(agentNode);
    fireEvent.keyDown(window, { key: 'Backspace' });
    await waitFor(() => expect(screen.queryByTestId('agent-tool-node-fake_agent_generic')).not.toBeInTheDocument());
  });

  test('Alt left click maps to edge disconnect and removes the selected edge', () => {
    // helpers alias is at module scope
    const canvas = {
      id: 'root_task',
      name: 'Root Task',
      rootWorkflowId: 'root_task',
      layout: 'workspace-canvas',
      workflows: [
        { id: 'source', status: 'not_run', internalNodes: [], internalEdges: [] },
        { id: 'target', status: 'not_run', internalNodes: [], internalEdges: [] },
      ],
      edges: [
        {
          id: 'control_source_target',
          kind: 'control',
          source: { workflowId: 'source' },
          target: { workflowId: 'target' },
        },
      ],
    };

    expect(helpers.shouldDisconnectEdgeOnClick({ altKey: true, button: 0 })).toBe(true);
    expect(helpers.shouldDisconnectEdgeOnClick({ altKey: false, button: 0 })).toBe(false);
    expect(helpers.shouldDisconnectEdgeOnClick({ altKey: true, button: 2 })).toBe(false);

    const deleted = helpers.deleteSelectionFromCanvas(canvas, { type: 'edge', id: 'control_source_target' });
    expect(deleted.edges).toHaveLength(0);
  });

  test('Internal node run lookup maps node-scoped single-node run evidence', () => {
    // helpers alias is at module scope
    const singleNodeRun = {
      workflow_id: 'Research_Flow_research_business_single_node',
      status: 'running',
      run_dir: 'runs/ui_workflow_Research_Flow_research_business_single_node',
      nodes: [
        {
          node_id: 'research_business',
          callable_id: 'fake-agent.generic',
          status: 'running',
          run_dir: 'runs/ui_workflow_Research_Flow_research_business_single_node/nodes/research_business',
        },
      ],
      edges: [],
      errors: [],
    };

    const nodeRun = helpers.nodeRunForInternalNode(
      singleNodeRun,
      'Research_Flow',
      'research_business',
      {
        scope: 'node',
        targetId: 'research_business',
        parentWorkflowId: 'Research_Flow',
      },
    );
    expect(nodeRun?.node_id).toBe('research_business');

    expect(
      helpers.nodeRunForInternalNode(singleNodeRun, 'Other_Flow', 'research_business', {
        scope: 'node',
        targetId: 'research_business',
        parentWorkflowId: 'Research_Flow',
      }),
    ).toBeUndefined();
    expect(
      helpers.nodeRunForInternalNode(singleNodeRun, 'Research_Flow', 'research_business', {
        scope: 'workflow',
        targetId: 'research_business',
        parentWorkflowId: 'Research_Flow',
      }),
    ).toBeUndefined();
  });

  test('Workbench live output store bounds, sorts, and dedupes events', () => {
    // helpers alias is at module scope
    const events = helpers.boundedLiveEvents(
      [
        {
          event_id: 'evt_2',
          seq: 2,
          source: 'agent_turn',
          type: 'agent_message',
          stream: 'agent',
          text: 'two',
          timestamp: '2026-06-10T00:00:02Z',
        },
      ],
      [
        {
          event_id: 'evt_1',
          seq: 1,
          source: 'agent_turn',
          type: 'node_log_delta',
          stream: 'stdout',
          text: 'one',
          timestamp: '2026-06-10T00:00:01Z',
        },
        {
          event_id: 'evt_2',
          seq: 2,
          source: 'agent_turn',
          type: 'agent_message',
          stream: 'agent',
          text: 'duplicate',
          timestamp: '2026-06-10T00:00:02Z',
        },
        {
          event_id: 'evt_3',
          seq: 3,
          source: 'agent_turn',
          type: 'node_log_delta',
          stream: 'stderr',
          text: 'three',
          timestamp: '2026-06-10T00:00:03Z',
        },
      ],
      2,
      1024,
    );

    expect(events.map((event: any) => event.event_id)).toEqual(['evt_2', 'evt_3']);
    expect(events[0].text).toBe('two');
  });

  test('Workbench live output filters stream and error events', () => {
    // helpers alias is at module scope
    const events = [
      { event_id: 'a', seq: 1, type: 'agent_message', stream: 'agent', text: 'ok' },
      { event_id: 'b', seq: 2, type: 'node_log_delta', stream: 'stdout', text: 'out' },
      { event_id: 'c', seq: 3, type: 'agent_event', stream: 'agent', text: 'error: bad' },
    ];

    expect(helpers.filterLiveEvents(events, 'stdout').map((event: any) => event.event_id)).toEqual([
      'b',
    ]);
    expect(helpers.filterLiveEvents(events, 'errors').map((event: any) => event.event_id)).toEqual([
      'c',
    ]);
  });


  test('Assistant display status separates connecting, running turn, and recoverable failure', () => {
    expect(
      helpers.assistantDisplayStatus({
        sessionStatus: 'creating',
        busy: true,
        pendingTurn: null,
      }),
    ).toMatchObject({ label: '连接中', connecting: true, runningTurn: false });

    expect(
      helpers.assistantDisplayStatus({
        sessionStatus: 'ready',
        busy: false,
        pendingTurn: { turn_id: 'turn_1', status: 'running' },
      }),
    ).toMatchObject({ label: '执行中', connecting: false, runningTurn: true });

    expect(
      helpers.assistantDisplayStatus({
        sessionStatus: 'failed',
        busy: false,
        pendingTurn: null,
      }),
    ).toMatchObject({
      label: '可继续 · 上轮失败',
      connecting: false,
      runningTurn: false,
      lastFailed: true,
    });

    expect(
      helpers.assistantDisplayStatus({
        sessionStatus: 'failed',
        busy: false,
        pendingTurn: null,
        agentSession: {
          session_id: 'agent_session_1',
          can_submit_next_turn: false,
          last_recoverability: 'blocked',
        },
      }),
    ).toMatchObject({
      label: '需处理 · 上轮失败',
      submissionBlocked: true,
    });
  });

  test('Assistant transcript hides provider status noise but keeps turn failures', () => {
    const items = helpers.buildAssistantTranscriptItems({
      messages: [
        { id: 'u1', role: 'user', content: '你好', createdAt: '2026-06-12T00:00:02Z' },
        {
          id: 'a1',
          role: 'assistant',
          content: JSON.stringify({
            schema_version: 'acc.authoring.output.v1',
            assistant_message: '你好，可以继续。',
            proposal_kind: 'canvas',
            proposal: null,
            questions: [],
            risk_notes: [],
            confidence: 'medium',
          }),
          createdAt: '2026-06-12T00:00:03Z',
        },
      ],
      pendingTurn: null,
      assistantEvents: [
        {
          event_id: 'draft_1',
          type: 'agent_output_draft',
          payload: { output_path: 'runs/_agent_sessions/task/turns/turn_1/output_draft.json' },
          timestamp: '2026-06-12T00:00:00Z',
        },
        {
          event_id: 'published_1',
          type: 'agent_output_published',
          payload: { output_path: 'runs/_agent_sessions/task/turns/turn_1/current_output.json' },
          timestamp: '2026-06-12T00:00:00Z',
        },
        {
          event_id: 'status_1',
          type: 'agent_status',
          payload: { method: 'response.output_item.added', item_type: 'reasoning' },
          timestamp: '2026-06-12T00:00:00Z',
        },
        {
          event_id: 'terminal_1',
          type: 'terminal',
          payload: { status: 'closed' },
          timestamp: '2026-06-12T00:00:00Z',
        },
        {
          event_id: 'failed_1',
          type: 'agent_event',
          payload: {
            event_type: 'agent_turn_failed',
            error: 'Authoring agent output confidence must be a string',
          },
          timestamp: '2026-06-12T00:00:01Z',
        },
      ],
      liveState: { status: 'idle', events: [], error: '' },
      proposal: null,
      validation: null,
      graphOpsReview: null,
    });

    expect(items.some((item: any) => item.detail === 'reasoning')).toBe(false);
    expect(JSON.stringify(items)).not.toContain('output_draft.json');
    expect(JSON.stringify(items)).not.toContain('current_output.json');
    expect(items.some((item: any) => item.kind === 'status' && item.label === 'Turn completed')).toBe(false);
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'error',
        content: 'Authoring agent output confidence must be a string',
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({ kind: 'assistant_message', content: '你好，可以继续。' }),
    );
    expect(items.at(-1)).toMatchObject({ kind: 'assistant_message', content: '你好，可以继续。' });
  });

  test('Assistant transcript renders structured failure summary before raw technical detail', () => {
    const items = helpers.buildAssistantTranscriptItems({
      messages: [],
      pendingTurn: null,
      assistantEvents: [
        {
          event_id: 'failed_structured_1',
          type: 'agent_turn_failed',
          payload: {
            user_summary: '本轮结构化输出无效，已保留对话。',
            technical_detail: 'Authoring agent output confidence must be a string',
            error: 'Authoring agent output confidence must be a string',
          },
          projection: {
            schema_version: 'acc.transcript_projection.v1',
            visibility: 'primary',
            category: 'error',
            severity: 'error',
            display_kind: 'error_message',
            summary: '本轮结构化输出无效，已保留对话。',
          },
          timestamp: '2026-06-12T00:00:01Z',
        },
      ],
      liveState: { status: 'idle', events: [], error: '' },
      proposal: null,
      validation: null,
      graphOpsReview: null,
    });

    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'error',
        content: '本轮结构化输出无效，已保留对话。',
        detail: expect.stringContaining('confidence must be a string'),
      }),
    );
    expect(JSON.stringify(items.map((item: any) => item.content))).not.toContain(
      'confidence must be a string',
    );
  });

  test('Assistant transcript keeps result blocks in chronological order instead of pinning them last', () => {
    const items = helpers.buildAssistantTranscriptItems({
      messages: [
        { id: 'u1', role: 'user', content: '生成草稿', createdAt: '2026-06-12T00:00:00Z' },
        { id: 'a1', role: 'assistant', content: '草稿已生成。', createdAt: '2026-06-12T00:00:02Z' },
        { id: 'u2', role: 'user', content: '继续解释', createdAt: '2026-06-12T00:00:05Z' },
        { id: 'a2', role: 'assistant', content: '这是后续回答。', createdAt: '2026-06-12T00:00:06Z' },
      ],
      pendingTurn: null,
      assistantEvents: [
        {
          event_id: 'draft_1',
          type: 'agent_output_draft',
          turn_id: 'turn_draft',
          payload: { output_path: 'runs/_agent_sessions/task/turns/turn_draft/output_draft.json' },
          timestamp: '2026-06-12T00:00:03Z',
        },
      ],
      liveState: { status: 'idle', events: [], error: '' },
      proposal: {
        proposal_id: 'proposal_1',
        base_task_id: 'task',
        base_canvas_hash: 'hash',
        target: { scope: 'canvas' },
        rationale: 'r',
        operations: [],
      },
      validation: { status: 'valid', errors: [], warnings: [] },
      graphOpsReview: null,
      hasResultBlock: true,
      currentOutputTurnId: 'turn_draft',
    });

    expect(items.map((item: any) => item.kind)).toEqual([
      'user_message',
      'assistant_message',
      'result_block',
      'user_message',
      'assistant_message',
    ]);
  });

  test('Assistant transcript keeps optimistic local messages below untimed result blocks', () => {
    const items = helpers.buildAssistantTranscriptItems({
      messages: [
        { id: 'a1', role: 'assistant', content: '已有草稿。', createdAt: '2026-06-12T00:00:02Z' },
        { id: 'u_local', role: 'user', content: '刚刚发送的本地消息' },
      ],
      pendingTurn: null,
      assistantEvents: [],
      liveState: { status: 'idle', events: [], error: '' },
      proposal: {
        proposal_id: 'proposal_1',
        base_task_id: 'task',
        base_canvas_hash: 'hash',
        target: { scope: 'canvas' },
        rationale: 'r',
        operations: [],
      },
      validation: { status: 'valid', errors: [], warnings: [] },
      graphOpsReview: null,
      hasResultBlock: true,
      currentOutputTurnId: 'turn_missing_timestamp',
    });

    expect(items.at(-2)).toMatchObject({ kind: 'result_block' });
    expect(items.at(-1)).toMatchObject({ kind: 'user_message', content: '刚刚发送的本地消息' });
  });

  test('Assistant transcript folds tool and draft process events into one default-collapsed group', () => {
    const items = helpers.buildAssistantTranscriptItems({
      messages: [
        { id: 'u1', role: 'user', content: '生成草稿', turnId: 'turn_1', createdAt: '2026-06-12T00:00:00Z' },
        { id: 'a1', role: 'assistant', content: '草稿已生成。', turnId: 'turn_1', createdAt: '2026-06-12T00:00:04Z' },
      ],
      pendingTurn: null,
      assistantEvents: [
        {
          event_id: 'tool_1',
          type: 'agent_tool_use',
          turn_id: 'turn_1',
          payload: { tool: 'exec_command', input: 'npx tsc --noEmit' },
          timestamp: '2026-06-12T00:00:01Z',
        },
        {
          event_id: 'tool_2',
          type: 'agent_tool_result',
          turn_id: 'turn_1',
          payload: { tool: 'exec_command', summary: 'ok' },
          timestamp: '2026-06-12T00:00:02Z',
        },
        {
          event_id: 'draft_1',
          type: 'agent_output_draft',
          turn_id: 'turn_1',
          payload: { proposal_ready: true, summary: '草稿已就绪' },
          projection: {
            schema_version: 'acc.transcript_projection.v1',
            visibility: 'folded',
            category: 'proposal',
            display_kind: 'artifact_link',
            summary: '草稿已就绪',
          },
          timestamp: '2026-06-12T00:00:03Z',
        },
      ],
      liveState: { status: 'idle', events: [], error: '' },
      proposal: null,
      validation: null,
      graphOpsReview: null,
    });

    expect(items.map((item: any) => item.kind)).toEqual([
      'user_message',
      'process_group',
      'assistant_message',
    ]);
    expect(items[1]).toMatchObject({
      kind: 'process_group',
      turnId: 'turn_1',
      defaultOpen: false,
      label: expect.stringContaining('生成草稿'),
    });
    expect((items[1] as any).events.map((event: any) => event.label)).toEqual([
      '调用工具',
      '工具结果',
      '生成草稿',
    ]);
  });

  test('Assistant transcript uses completed live assistant message instead of delta plus final text', () => {
    const items = helpers.buildAssistantTranscriptItems({
      messages: [],
      pendingTurn: { turn_id: 'turn_stream', status: 'running' },
      assistantEvents: [
        {
          event_id: 'delta_1',
          type: 'agent_message_delta',
          turn_id: 'turn_stream',
          payload: { delta: '你' },
          timestamp: '2026-06-12T00:00:01Z',
        },
        {
          event_id: 'delta_2',
          type: 'agent_message_delta',
          turn_id: 'turn_stream',
          payload: { delta: '好' },
          timestamp: '2026-06-12T00:00:02Z',
        },
        {
          event_id: 'message_1',
          type: 'agent_message',
          turn_id: 'turn_stream',
          payload: { content: '你好' },
          timestamp: '2026-06-12T00:00:03Z',
        },
      ],
      liveState: { status: 'running', events: [], error: '' },
      proposal: null,
      validation: null,
      graphOpsReview: null,
    });

    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'assistant_stream',
        turnId: 'turn_stream',
        content: '你好',
      }),
    );
    expect(JSON.stringify(items)).not.toContain('你好你好');
  });

  test('Assistant transcript suppresses live stream once persisted final message for the same turn exists', () => {
    const items = helpers.buildAssistantTranscriptItems({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          content: '这是最终回复。',
          turnId: 'turn_stream',
          createdAt: '2026-06-12T00:00:04Z',
        },
      ],
      pendingTurn: { turn_id: 'turn_stream', status: 'running' },
      assistantEvents: [
        {
          event_id: 'delta_1',
          type: 'agent_message_delta',
          turn_id: 'turn_stream',
          payload: { delta: '这是最终回复。' },
          timestamp: '2026-06-12T00:00:01Z',
        },
      ],
      liveState: { status: 'running', events: [], error: '' },
      proposal: null,
      validation: null,
      graphOpsReview: null,
    });

    expect(items.some((item: any) => item.kind === 'assistant_stream')).toBe(false);
    expect(items).toEqual([
      expect.objectContaining({ kind: 'assistant_message', content: '这是最终回复。' }),
    ]);
  });

  test('Nested workflow node live logs resolve by UI node id and run dir', () => {
    // helpers alias is at module scope
    const delta = {
      type: 'node_log_delta',
      run_id: 'run_nested',
      node_id: 'research_business',
      ui_node_id: 'Research_Flow__internal__research_business',
      parent_node_id: 'Research_Flow',
      node_run_dir:
        'runs/run_nested/nodes/Research_Flow/nested_workflow/nodes/research_business',
      stream: 'stdout',
      offset: 0,
      next_offset: 15,
      text: 'streamed line\n',
    };
    const keys = helpers.nodeLogDeltaKeys(delta);
    const liveLogs = Object.fromEntries(
      keys.map((key: string) => [
        key,
        { stdout: delta.text, stderr: '', stdoutOffset: delta.next_offset, stderrOffset: 0 },
      ]),
    );
    const nodeRun = {
      node_id: 'research_business',
      ui_node_id: 'Research_Flow__internal__research_business',
      parent_node_id: 'Research_Flow',
      run_dir:
        'runs/run_nested/nodes/Research_Flow/nested_workflow/nodes/research_business',
    };

    expect(keys).toContain('Research_Flow__internal__research_business');
    expect(helpers.nodeLiveLogsFor(liveLogs, nodeRun)?.stdout).toBe('streamed line\n');
  });

  test('Nested workflow live output resolves from unified run events by node identity', () => {
    const events = [
      {
        event_id: 'root_evt',
        seq: 1,
        source: 'run_stream',
        run_id: 'run_nested',
        node_id: 'research_business',
        type: 'node_log_delta',
        stream: 'stdout',
        text: 'root same-name node\n',
        timestamp: '2026-06-10T00:00:01Z',
      },
      {
        event_id: 'nested_evt',
        seq: 2,
        source: 'run_stream',
        run_id: 'run_nested',
        node_id: 'research_business',
        ui_node_id: 'Research_Flow__internal__research_business',
        parent_node_id: 'Research_Flow',
        node_run_dir:
          'runs/run_nested/nodes/Research_Flow/nested_workflow/nodes/research_business',
        type: 'agent_message',
        stream: 'agent',
        text: 'nested live output\n',
        timestamp: '2026-06-10T00:00:02Z',
      },
    ];
    const nodeRun = {
      node_id: 'research_business',
      ui_node_id: 'Research_Flow__internal__research_business',
      parent_node_id: 'Research_Flow',
      run_dir:
        'runs/run_nested/nodes/Research_Flow/nested_workflow/nodes/research_business',
    };

    const state = helpers.liveStateForNodeRun(events, nodeRun);

    expect(state.status).toBe('live');
    expect(state.events.map((event: any) => event.event_id)).toEqual(['nested_evt']);
    expect(state.events[0].text).toBe('nested live output\n');
  });

  test('Internal node run lookup keeps full workflow scoped identity matching', () => {
    // helpers alias is at module scope
    const workflowRun = {
      workflow_id: 'ui_workflow_acc_workspace_canvas_fixture',
      status: 'success',
      run_dir: 'runs/ui_workflow_acc_workspace_canvas_fixture',
      nodes: [
        {
          node_id: 'research_business',
          ui_node_id: 'Research_Flow__internal__research_business',
          parent_node_id: 'Research_Flow',
          callable_id: 'fake-agent.generic',
          status: 'success',
          run_dir: 'runs/ui_workflow_acc_workspace_canvas_fixture/nodes/Research_Flow/internal/research_business',
        },
      ],
      edges: [],
      errors: [],
    };

    const nodeRun = helpers.nodeRunForInternalNode(
      workflowRun,
      'Research_Flow',
      'research_business',
    );
    expect(nodeRun?.ui_node_id).toBe('Research_Flow__internal__research_business');
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
    // helpers alias is at module scope
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

  test('Deleting a workflow container removes its root edges and internal graph', () => {
    // helpers alias is at module scope
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
    const withRootAgent = helpers.addCallableNodeFromPalette(
      withWorkflow,
      { kind: 'agent', callableId: 'fake-agent.generic', label: 'Root Agent' },
      { x: 520, y: 120 },
    );
    const workflowId = 'New_Workflow';
    const rootAgentId = 'fake_agent_generic';
    const withInternal = helpers.addInternalNodeFromPalette(
      withRootAgent,
      workflowId,
      { kind: 'agent', callableId: 'fake-agent.generic', label: 'Inner Agent' },
      { x: 120, y: 130 },
    );
    const canvas = {
      ...withInternal,
      edges: [
        {
          id: 'control_New_Workflow_root_agent',
          kind: 'control',
          source: { workflowId },
          target: { workflowId: rootAgentId },
        },
      ],
    };

    const deleted = helpers.deleteSelectionFromCanvas(canvas, { type: 'workflow', id: workflowId });

    expect(deleted.workflows.some((workflow: { id: string }) => workflow.id === workflowId)).toBe(false);
    expect(deleted.workflows.some((workflow: { id: string }) => workflow.id === rootAgentId)).toBe(true);
    expect(deleted.edges).toHaveLength(0);
  });

  test('Deleting an internal agent keeps its workflow and removes touched internal edges only', () => {
    // helpers alias is at module scope
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
    const workflowId = 'New_Workflow';
    const withFirst = helpers.addInternalNodeFromPalette(
      withWorkflow,
      workflowId,
      { kind: 'agent', callableId: 'fake-agent.generic', label: 'First Agent' },
      { x: 120, y: 130 },
    );
    const withSecond = helpers.addInternalNodeFromPalette(
      withFirst,
      workflowId,
      { kind: 'agent', callableId: 'fake-agent.generic', label: 'Second Agent' },
      { x: 440, y: 130 },
    );
    const firstId = 'fake_agent_generic';
    const secondId = 'fake_agent_generic_2';
    const canvas = {
      ...withSecond,
      workflows: withSecond.workflows.map((workflow: any) =>
        workflow.id === workflowId
          ? {
              ...workflow,
              internalEdges: [
                {
                  id: 'control_first_second',
                  kind: 'control',
                  source: { workflowId: firstId },
                  target: { workflowId: secondId },
                },
              ],
            }
          : workflow,
      ),
    };

    const deleted = helpers.deleteSelectionFromCanvas(canvas, {
      type: 'internal',
      workflowId,
      nodeId: firstId,
    });
    const workflow = deleted.workflows.find((item: { id: string }) => item.id === workflowId);

    expect(workflow).toBeTruthy();
    expect(workflow.internalNodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: secondId })]),
    );
    expect(workflow.internalNodes.some((node: { id: string }) => node.id === firstId)).toBe(false);
    expect(workflow.internalEdges).toHaveLength(0);
  });

  test('Deletion is blocked while the current task is running', () => {
    // helpers alias is at module scope
    const canvas = helpers.addCallableNodeFromPalette(
      {
        id: 'root_task',
        name: 'Root Task',
        rootWorkflowId: 'root_task',
        layout: 'workspace-canvas',
        workflows: [],
        edges: [],
      },
      { kind: 'agent', callableId: 'fake-agent.generic', label: 'Root Agent' },
      { x: 120, y: 130 },
    );

    const result = helpers.selectionCanBeDeleted(canvas, { type: 'workflow', id: 'root_agent' }, true);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/运行中/);
  });

  test('Root resource add position avoids overlapping existing workflow containers', () => {
    // helpers alias is at module scope
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
    // helpers alias is at module scope
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
    // helpers alias is at module scope
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
    // helpers alias is at module scope
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
    // helpers alias is at module scope
    const input = { user_prompt: 'write report', region: 'US', limit: 5 };

    expect(helpers.promptFromInvocationInput(input)).toBe('write report');
    expect(helpers.staticInputFromInvocationInput(input)).toEqual({ region: 'US', limit: 5 });
  });

  test('Repeated palette adds keep internal node positions bounded inside workflow', () => {
    // helpers alias is at module scope
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
    // helpers alias is at module scope
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

  test('Workflow auto layout avoids overlap and reserves container safe area', () => {
    const edge = (from: string, to: string) => ({
      id: `control_${from}_${to}`,
      kind: 'control',
      source: { workflowId: from },
      target: { workflowId: to },
      condition: null,
      context: 'none',
    });
    const workflow: any = {
      id: 'review_flow',
      title: 'Review Flow',
      sourceKind: 'workflow',
      directory: 'workspace',
      status: 'not_run',
      inputPorts: [],
      outputPorts: [],
      internalNodes: [
        { id: 'intake', name: 'Intake', task: 'fake-agent.generic', kind: 'Agent', status: 'not_run', position: { x: 10, y: 10 } },
        { id: 'architecture', name: 'Architecture', task: 'fake-agent.generic', kind: 'Agent', status: 'not_run', position: { x: 20, y: 20 } },
        { id: 'risk', name: 'Risk', task: 'fake-agent.generic', kind: 'Agent', status: 'not_run', position: { x: 30, y: 30 } },
        { id: 'test', name: 'Test', task: 'fake-agent.generic', kind: 'Agent', status: 'not_run', position: { x: 40, y: 40 } },
        { id: 'synthesis', name: 'Synthesis', task: 'fake-agent.generic', kind: 'Agent', status: 'not_run', position: { x: 50, y: 50 } },
        { id: 'review', name: 'Review', task: 'fake-agent.generic', kind: 'Agent', status: 'not_run', position: { x: 60, y: 60 } },
      ],
      internalEdges: [
        edge('intake', 'architecture'),
        edge('intake', 'risk'),
        edge('intake', 'test'),
        edge('architecture', 'synthesis'),
        edge('risk', 'synthesis'),
        edge('test', 'synthesis'),
        edge('synthesis', 'review'),
      ],
      position: { x: 100, y: 100 },
      size: { width: 430, height: 328 },
      warnings: [],
    };
    const canvas: any = {
      id: 'root_task',
      name: 'Root Task',
      rootWorkflowId: 'root_task',
      layout: 'workspace-canvas',
      workflows: [workflow],
      edges: [],
    };

    const laidOut = layoutCanvasForSelection(canvas, {
      type: 'workflow',
      id: workflow.id,
    });
    const nextWorkflow = laidOut.workflows[0];
    const byId = new Map(nextWorkflow.internalNodes.map((node: any) => [node.id, node]));
    const node = (id: string): any => {
      const value = byId.get(id);
      if (!value) {
        throw new Error(`Missing layout node ${id}`);
      }
      return value;
    };
    const rects = nextWorkflow.internalNodes.map((item: any) => ({
      id: item.id,
      left: item.position.x,
      top: item.position.y,
      right: item.position.x + 276,
      bottom: item.position.y + 158,
    }));

    for (let index = 0; index < rects.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < rects.length; otherIndex += 1) {
        const a = rects[index];
        const b = rects[otherIndex];
        const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
    for (const item of nextWorkflow.internalNodes) {
      if (!item.position) {
        throw new Error(`Missing positioned node: ${item.id}`);
      }
      expect(item.position.x).toBeGreaterThanOrEqual(64);
      expect(item.position.y).toBeGreaterThanOrEqual(146);
    }
    expect(node('intake').position.x).toBeLessThan(node('architecture').position.x);
    expect(node('intake').position.x).toBeLessThan(node('risk').position.x);
    expect(node('intake').position.x).toBeLessThan(node('test').position.x);
    expect(Math.abs(node('architecture').position.x - node('risk').position.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(node('risk').position.x - node('test').position.x)).toBeLessThanOrEqual(1);
    expect(node('synthesis').position.x).toBeGreaterThan(node('architecture').position.x);
    expect(node('review').position.x).toBeGreaterThan(node('synthesis').position.x);
    expect(nextWorkflow.size.width).toBeGreaterThanOrEqual(node('review').position.x + 276 + 64);
  });

  test('Workflow auto layout uses boundary edges to rank input and output nodes', () => {
    const workflowId = 'boundary_flow';
    const workflow: any = {
      id: workflowId,
      title: 'Boundary Flow',
      sourceKind: 'workflow',
      directory: 'workspace',
      status: 'not_run',
      inputPorts: [],
      outputPorts: [],
      internalNodes: [
        { id: 'producer', name: 'Producer', task: 'fake-agent.generic', kind: 'Agent', status: 'not_run', position: { x: 300, y: 20 } },
        { id: 'consumer', name: 'Consumer', task: 'fake-agent.generic', kind: 'Agent', status: 'not_run', position: { x: 20, y: 20 } },
      ],
      internalEdges: [
        {
          id: 'input_to_consumer',
          kind: 'data',
          source: { workflowId: `${workflowId}__workflow_inputs`, portId: 'main' },
          target: { workflowId: 'consumer', portId: 'main' },
          materialization: 'reference',
        },
        {
          id: 'consumer_to_producer',
          kind: 'control',
          source: { workflowId: 'consumer' },
          target: { workflowId: 'producer' },
        },
        {
          id: 'producer_to_output',
          kind: 'data',
          source: { workflowId: 'producer', portId: 'main' },
          target: { workflowId: `${workflowId}__workflow_outputs`, portId: 'main' },
          materialization: 'reference',
        },
      ],
      position: { x: 100, y: 100 },
      size: { width: 430, height: 328 },
      warnings: [],
    };
    const laidOut = layoutCanvasForSelection(
      {
        id: 'root_task',
        name: 'Root Task',
        rootWorkflowId: 'root_task',
        layout: 'workspace-canvas',
        workflows: [workflow],
        edges: [],
      } as any,
      { type: 'workflow', id: workflowId },
    );
    const nodes = new Map(laidOut.workflows[0].internalNodes.map((item: any) => [item.id, item.position]));

    expect(nodes.get('producer')?.x).toBeGreaterThan(nodes.get('consumer')?.x || 0);
  });

  test('Workflow auto layout shrinks oversized container to fitted content', () => {
    const workflow: any = {
      id: 'oversized_flow',
      title: 'Oversized Flow',
      sourceKind: 'workflow',
      directory: 'workspace',
      status: 'not_run',
      inputPorts: [],
      outputPorts: [],
      internalNodes: [
        { id: 'first', name: 'First', task: 'fake-agent.generic', kind: 'Agent', status: 'not_run', position: { x: 120, y: 180 } },
        { id: 'second', name: 'Second', task: 'fake-agent.generic', kind: 'Agent', status: 'not_run', position: { x: 520, y: 180 } },
      ],
      internalEdges: [
        {
          id: 'first_second',
          kind: 'control',
          source: { workflowId: 'first' },
          target: { workflowId: 'second' },
        },
      ],
      position: { x: 80, y: 80 },
      size: { width: 1800, height: 920 },
      warnings: [],
    };
    const laidOut = layoutCanvasForSelection(
      {
        id: 'root_task',
        name: 'Root Task',
        rootWorkflowId: 'root_task',
        layout: 'workspace-canvas',
        workflows: [workflow],
        edges: [],
      } as any,
      { type: 'workflow', id: workflow.id },
    );
    const nextWorkflow = laidOut.workflows[0];
    const maxChildX = Math.max(
      ...nextWorkflow.internalNodes.map((node: any) => node.position.x + 276),
    );
    const maxChildY = Math.max(
      ...nextWorkflow.internalNodes.map((node: any) => node.position.y + 158),
    );

    expect(nextWorkflow.size.width).toBeLessThan(workflow.size.width);
    expect(nextWorkflow.size.height).toBeLessThan(workflow.size.height);
    expect(nextWorkflow.size.width).toBeGreaterThanOrEqual(maxChildX + 64);
    expect(nextWorkflow.size.height).toBeGreaterThanOrEqual(maxChildY + 56);
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

    const expanded = expandWorkflowToFitChildren(workflow);
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

    const expanded = expandWorkflowToFitChildren(workflow);

    expect(expanded.position).toEqual(workflow.position);
    expect(expanded.size.width).toBe(800);
    expect(expanded.size.height).toBe(582);
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

    const expanded = expandWorkflowToFitChildrenCenterLocked(workflow);
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

    const laidOut = layoutWorkspaceCanvas(canvas);
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

  test('Workspace auto layout keeps stock research workflow containers from overlapping', () => {
    const controlEdge = (source: string, target: string) => ({
      id: `control_${source}_${target}`,
      kind: 'control',
      source: { workflowId: source },
      target: { workflowId: target },
    });
    const internalNode = (id: string) => ({
      id,
      name: id,
      task: 'fake-agent.generic',
      kind: 'Agent',
      status: 'not_run',
      position: { x: 12, y: 12 },
    });
    const workflow = (id: string, internalNodes: any[], internalEdges: any[]) => ({
      id,
      title: id,
      sourceKind: 'workflow',
      directory: 'workspace',
      status: 'not_run',
      inputPorts: [],
      outputPorts: [],
      position: { x: 120, y: 120 },
      size: { width: 430, height: 328 },
      warnings: [],
      internalNodes,
      internalEdges,
    });
    const canvas: any = {
      id: 'root_task',
      name: 'Root Task',
      rootWorkflowId: 'root_task',
      layout: 'workspace-canvas',
      workflows: [
        {
          id: 'target',
          title: 'Target',
          sourceKind: 'agent_session',
          callableId: 'fake-agent.generic',
          directory: 'workspace',
          status: 'not_run',
          inputPorts: [],
          outputPorts: [],
          internalNodes: [],
          internalEdges: [],
          position: { x: 120, y: 120 },
          size: { width: 300, height: 150 },
          warnings: [],
        },
        workflow(
          'research',
          [internalNode('business'), internalNode('financials'), internalNode('industry'), internalNode('merge')],
          [controlEdge('business', 'merge'), controlEdge('financials', 'merge'), controlEdge('industry', 'merge')],
        ),
        workflow(
          'valuation',
          [internalNode('model'), internalNode('scenario'), internalNode('valuation_merge')],
          [controlEdge('model', 'scenario'), controlEdge('scenario', 'valuation_merge')],
        ),
        workflow(
          'risk',
          [internalNode('macro'), internalNode('company'), internalNode('catalyst'), internalNode('risk_merge')],
          [controlEdge('macro', 'risk_merge'), controlEdge('company', 'risk_merge'), controlEdge('catalyst', 'risk_merge')],
        ),
        workflow(
          'final',
          [internalNode('writer'), internalNode('publish')],
          [controlEdge('writer', 'publish')],
        ),
      ],
      edges: [
        controlEdge('target', 'research'),
        controlEdge('research', 'valuation'),
        controlEdge('research', 'risk'),
        controlEdge('valuation', 'final'),
        controlEdge('risk', 'final'),
      ],
    };

    const laidOut = layoutWorkspaceCanvas(canvas);
    const rootRects = laidOut.workflows.map((item: any) => ({
      id: item.id,
      left: item.position.x,
      top: item.position.y,
      right: item.position.x + item.size.width,
      bottom: item.position.y + item.size.height,
    }));
    for (let index = 0; index < rootRects.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < rootRects.length; otherIndex += 1) {
        const a = rootRects[index];
        const b = rootRects[otherIndex];
        const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
    for (const item of laidOut.workflows) {
      for (const node of item.internalNodes || []) {
        if (!node.position) {
          throw new Error(`Missing positioned node: ${item.id}/${node.id}`);
        }
        expect(node.position.x + 276, `${item.id}/${node.id} overflows width`).toBeLessThanOrEqual(item.size.width);
        expect(node.position.y + 158, `${item.id}/${node.id} overflows height`).toBeLessThanOrEqual(item.size.height);
      }
    }
  });

  test('Loaded workspace demo uses the global layout contract', () => {
    const canvas = layoutWorkspaceCanvas(
      workspaceDemoCanvas(),
    );
    const rootRects = canvas.workflows.map((item: any) => ({
      id: item.id,
      left: item.position.x,
      top: item.position.y,
      right: item.position.x + item.size.width,
      bottom: item.position.y + item.size.height,
    }));

    for (let index = 0; index < rootRects.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < rootRects.length; otherIndex += 1) {
        const a = rootRects[index];
        const b = rootRects[otherIndex];
        const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
    for (const workflow of canvas.workflows) {
      for (const node of workflow.internalNodes || []) {
        if (!node.position) {
          throw new Error(`Missing positioned node: ${workflow.id}/${node.id}`);
        }
        expect(node.position.x, `${workflow.id}/${node.id} left overflow`).toBeGreaterThanOrEqual(0);
        expect(node.position.y, `${workflow.id}/${node.id} top overflow`).toBeGreaterThanOrEqual(0);
        expect(node.position.x + 276, `${workflow.id}/${node.id} right overflow`).toBeLessThanOrEqual(
          workflow.size.width,
        );
        expect(node.position.y + 158, `${workflow.id}/${node.id} bottom overflow`).toBeLessThanOrEqual(
          workflow.size.height,
        );
      }
    }
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

    const laidOut = layoutCanvasForSelection(canvas, {
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

  test('Resource library creates an agent from user-facing fields', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 1);

    const browser = await screen.findByLabelText('智能体工具资源库');
    await user.click(within(browser).getByRole('button', { name: /新建智能体/i }));

    const dialog = await screen.findByLabelText('创建智能体');
    await user.type(within(dialog).getByLabelText('名称'), '深度研究智能体');
    await user.type(within(dialog).getByLabelText('描述'), '分析复杂工程问题');
    await user.selectOptions(within(dialog).getByLabelText('Agent'), 'claude');
    await user.selectOptions(within(dialog).getByLabelText('思考强度'), 'high');
    await user.type(within(dialog).getByLabelText('系统提示词'), '先解释机制，再给验证方式。');
    await user.type(within(dialog).getByPlaceholderText('输入 skill 名称'), 'frontend-design');
    await user.click(within(dialog).getByRole('button', { name: '添加' }));
    await user.click(within(dialog).getByRole('button', { name: '创建' }));

    const calls = vi.mocked(fetch).mock.calls;
    const createCall = calls.find(([url, init]) => url === '/api/callables/agents' && init?.method === 'POST');
    expect(createCall).toBeTruthy();
    const payload = JSON.parse(String(createCall?.[1]?.body));
    expect(payload.name).toBe('深度研究智能体');
    expect(payload.description).toBe('分析复杂工程问题');
    expect(payload.runtime).toBe('claude_sdk');
    expect(payload.default_prompt).toBe('先解释机制，再给验证方式。');
    expect(payload.metadata).toMatchObject({
      agent_provider: 'claude',
      reasoning_effort: 'high',
      skills: ['frontend-design'],
    });
    expect(JSON.stringify(payload)).not.toContain('AgentClassTemplate');
  });

  test('Resource library does not expose legacy scaffold controls', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 1);

    await screen.findByLabelText('智能体工具资源库');
    expect(screen.queryByRole('combobox', { name: /Callable/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^测试$/ })).not.toBeInTheDocument();
  });

  test('New workflow graph saves with parallel-friendly default policy', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: '新建任务' }));
    await user.click(within(toolbar).getByRole('button', { name: /\u4fdd\u5b58/i }));

    const calls = vi.mocked(fetch).mock.calls;
    const workflowSaveCalls = calls.filter(([url, init]) => url === '/api/workflows' && init?.method === 'POST');
    const saveCall = workflowSaveCalls[0];
    expect(saveCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    expect(savedPayload.graph.policy).toEqual({
      failure_mode: 'fail_fast',
      max_concurrency: 8,
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
    expect(savedPayload.graph.nodes).toHaveLength(7);
    expect(savedPayload.graph.nodes.some((node: { kind?: string }) => node.kind === 'agent_session')).toBe(true);
    expect(savedPayload.graph.nodes.some((node: { kind?: string }) => node.kind === 'workflow')).toBe(true);
    expect(savedPayload.graph.nodes.every((node: { input_ports?: unknown[] }) => (node.input_ports || []).length > 0)).toBe(
      true,
    );
    expect(
      savedPayload.graph.nodes.every((node: { output_ports?: unknown[] }) => (node.output_ports || []).length > 0),
    ).toBe(true);
    expect(savedPayload.graph.control_edges.length).toBeGreaterThan(0);
    expect(savedPayload.graph.data_edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: { node: 'Target_Profile_Agent', port: 'main' },
          to: { node: demoWorkflowNodeId, port: 'target' },
        }),
        expect.objectContaining({
          from: { node: demoWorkflowNodeId, port: 'main' },
          to: { node: 'Report_Workflow', port: 'fundamentals' },
        }),
        expect.objectContaining({
          from: { node: 'Report_Workflow', port: 'main' },
          to: { node: 'Final_Review_Agent', port: 'report' },
        }),
      ]),
    );
    expect(savedPayload.graph.metadata.directory_display_only).toBe(true);
    expect(savedPayload.graph.nodes.every((node: { relative_cwd?: string }) => !node.relative_cwd)).toBe(true);
    expect(savedPayload.graph.workspace_policy).toEqual({
      save_mode: 'stateless_template',
      default_state_mode: 'stateless',
    });
    expect(JSON.stringify(savedPayload.graph)).not.toContain('F:\\UE5_Project_A');
    expect(JSON.stringify(savedPayload.graph)).not.toContain('binding_ref');
    expect(savedPayload.graph.nodes.every((node: { status?: unknown }) => node.status === undefined)).toBe(true);
  });

  test('Workflow binding dialog fills workspace root from native directory selection', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    await loadWorkspaceDemo(user);
    const workflow = await screen.findByTestId(`workflow-container-${demoWorkflowNodeId}`);
    const configureButton = workflow.querySelector<HTMLButtonElement>(
      'button[aria-label="配置工作目录"]',
    );
    expect(configureButton).toBeTruthy();
    fireEvent.click(configureButton as HTMLButtonElement);
    const dialog = await screen.findByRole('dialog', { name: '配置工作目录' });

    await user.click(within(dialog).getByRole('button', { name: '选择文件夹' }));

    await waitFor(() => {
      expect(within(dialog).getByLabelText('workspace_root')).toHaveValue(
        'D:\\CFH\\EngineSource',
      );
    });
    const calls = vi.mocked(fetch).mock.calls;
    expect(
      calls.some(
        ([url, init]) =>
          url === `/api/workflows/${demoWorkflowNodeId}/binding/select-directory` &&
          init?.method === 'POST',
      ),
    ).toBe(true);
    expect(
      calls.some(
        ([url, init]) =>
          url === `/api/workflows/${demoWorkflowNodeId}/binding` &&
          init?.method === 'PUT',
      ),
    ).toBe(false);
  });

  test('Workflow Focus Mode saves runnable internal node defaults', async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByLabelText('Workbench navigation');
    await user.click(within(navigation).getAllByRole('button')[0]);
    await loadWorkspaceDemo(user);
    fireEvent.doubleClick(await screen.findByTestId(`workflow-container-${demoWorkflowNodeId}`));
    expect(screen.queryByText('返回 Workspace')).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /\u4fdd\u5b58/i })[0]);

    const calls = vi.mocked(fetch).mock.calls;
    const saveCall = calls
      .filter(([url, init]) => url === '/api/workflows' && init?.method === 'POST')
      .at(-1);
    expect(saveCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    expect(savedPayload.graph.id).toBe(demoRootId);
    expect(savedPayload.graph.nodes.length).toBeGreaterThan(0);
    const savedResearchFlow = savedPayload.graph.nodes.find((node: { id?: string }) => node.id === demoWorkflowNodeId);
    expect(savedResearchFlow?.kind).toBe('workflow');
    expect(savedResearchFlow?.ui.internal_nodes.length).toBeGreaterThan(0);
    expect(savedPayload.graph.control_edges.length).toBeGreaterThan(0);
  });

  test('Workflow Builder drops palette callable into workflow container internals', async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByLabelText('Workbench navigation');
    await user.click(within(navigation).getAllByRole('button')[0]);
    await loadWorkspaceDemo(user);
    const container = await screen.findByTestId(`workflow-container-${demoWorkflowNodeId}`);
    const internalDropZone = container.querySelector('[data-drop-scope="workflow-internal"]');
    expect(internalDropZone).toBeTruthy();
    fireEvent.drop(internalDropZone as Element, {
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
      (node: { id: string }) => node.id === demoWorkflowNodeId,
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

  test('Task overview switches active task and opens the selected blueprint on double click', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    const workbench = await screen.findByLabelText('ACC Workbench');
    await user.click(within(workbench).getByRole('button', { name: '新建任务' }));
    await user.click(within(workbench).getByRole('button', { name: '任务总览' }));

    const taskList = await screen.findByLabelText('任务列表');
    await user.dblClick(within(taskList).getByRole('button', { name: '选择任务 任务 2' }));

    expect((await screen.findAllByText('任务 2')).length).toBeGreaterThan(0);
    expect(await screen.findByLabelText('任务画布')).toBeInTheDocument();
    expect(within(workbench).getByRole('button', { name: '任务蓝图' })).toHaveClass('active');
  });

  test('Workbench resource rail stays visible on task view and hides on resource management view', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    expect(await screen.findByLabelText('Workbench 资源栏')).toHaveTextContent('Fake Agent');

    await openNavIndex(user, 1);
    expect(screen.queryByLabelText('Workbench 资源栏')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('智能体工具资源库')).toBeInTheDocument();
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

  test('Workflow Builder drops palette callable on workflow shell header as root node', async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByLabelText('Workbench navigation');
    await user.click(within(navigation).getAllByRole('button')[0]);
    await loadWorkspaceDemo(user);
    const container = await screen.findByTestId(`workflow-container-${demoWorkflowNodeId}`);
    const header = container.querySelector('.workflow-container-header');
    expect(header).toBeTruthy();
    fireEvent.drop(header as Element, {
      clientX: 760,
      clientY: 220,
      dataTransfer: {
        getData: (key: string) =>
          key === 'application/x-acc-palette'
            ? JSON.stringify({
                kind: 'agent',
                callableId: 'fake-agent.generic',
                label: 'Header Drop Agent',
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
    const rootAgent = savedPayload.graph.nodes.find(
      (node: { label: string }) => node.label === 'Header Drop Agent',
    );
    expect(rootAgent.kind).toBe('agent_session');
    const researchFlow = savedPayload.graph.nodes.find(
      (node: { id: string }) => node.id === demoWorkflowNodeId,
    );
    expect(researchFlow.ui.internal_nodes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Header Drop Agent',
        }),
      ]),
    );
  });

  test('Workflow Builder expands workflow container to fit dropped child node', async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByLabelText('Workbench navigation');
    await user.click(within(navigation).getAllByRole('button')[0]);
    await loadWorkspaceDemo(user);
    const container = await screen.findByTestId(`workflow-container-${demoWorkflowNodeId}`);
    const internalDropZone = container.querySelector('[data-drop-scope="workflow-internal"]');
    expect(internalDropZone).toBeTruthy();
    fireEvent.drop(internalDropZone as Element, {
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
      (node: { id: string }) => node.id === demoWorkflowNodeId,
    );
    const dropped = researchFlow.ui.internal_nodes.find(
      (node: { name: string }) => node.name === 'Wide Tool',
    );
    expect(researchFlow.position).toBeTruthy();
    expect(dropped.position.x + 260).toBeLessThanOrEqual(900);
    expect(JSON.stringify(researchFlow.ui.internal_nodes)).toContain('Wide Tool');
    expect(getComputedStyle(await screen.findByLabelText('基本面工作流 internal nodes')).overflow).not.toBe(
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
      (node: { id: string }) => node.id === demoWorkflowNodeId,
    );
    expect(researchFlow.ui.internal_edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'business_model_agent',
          to: 'fundamentals_synthesis_agent',
          context: 'none',
        }),
        expect.objectContaining({
          from: { node: 'business_model_agent', port: 'main' },
          to: { node: 'fundamentals_synthesis_agent', port: 'business' },
        }),
      ]),
    );
    const researchSynthesis = researchFlow.ui.internal_nodes.find(
      (node: { id: string }) => node.id === 'fundamentals_synthesis_agent',
    );
    expect(researchSynthesis.inputPorts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'business' }),
        expect.objectContaining({ id: 'financials' }),
        expect.objectContaining({ id: 'industry' }),
      ]),
    );
  });

  test('Workflow Builder exposes graph authoring controls', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);

    const resourceRail = await screen.findByLabelText('Workbench 资源栏');
    expect(resourceRail).toBeInTheDocument();
    expect(resourceRail).toHaveTextContent('Fake Agent');
    expect(resourceRail).toHaveTextContent('file-source.local');
    const workspaceCanvas = await screen.findByLabelText('任务画布');
    expect(workspaceCanvas).toBeInTheDocument();
    expect(await screen.findByLabelText('Canvas Toolbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '任务总览' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '任务蓝图' })).toBeInTheDocument();
    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: /^运行详情$/i }));
    const detailsDock = await screen.findByLabelText('选中对象详情');
    expect(detailsDock).toBeInTheDocument();
    expect(detailsDock).not.toHaveTextContent('输入 / 输出');
    expect(detailsDock).not.toHaveTextContent('节点属性');
    expect(screen.queryByRole('button', { name: /Connect Last Two/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /\u4fdd\u5b58/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /校验/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /运行/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /自动布局/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /显示数据边/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /显示控制边/i })).toBeInTheDocument();
    fireEvent.pointerDown(workspaceCanvas);
    fireEvent.click(workspaceCanvas);
    expect(screen.getByLabelText('选中对象详情')).toHaveTextContent('任务 1');
    await user.click(within(detailsDock).getAllByRole('button')[0]);
    expect(within(detailsDock).queryByText('输入 / 输出')).not.toBeInTheDocument();
  });

  test('Workbench AI assistant generates and applies a canvas-local proposal', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);

    await user.click(await screen.findByRole('button', { name: /AI 助手/i }));

    const assistantMessages = await screen.findByLabelText('AI 助手消息');
    expect(assistantMessages).toHaveTextContent('等待输入需求');
    expect(await screen.findByLabelText('AI 助手底部面板')).toBeInTheDocument();
    expect(document.querySelector('.canvas-drawer.assistant-drawer')).toBeNull();
    expect(screen.getByRole('button', { name: '对话模式' })).toHaveClass('active');
    await user.click(screen.getByRole('button', { name: '修改模式' }));

    await user.type(
      screen.getByPlaceholderText('描述要生成或调整的 workflow 草稿'),
      'Create a research and review workflow',
    );
    await user.click(screen.getByRole('button', { name: /生成修改/u }));

    expect(await screen.findByLabelText('CanvasAuthoringProposal')).toHaveTextContent('canvas_proposal_backend');
    const beforeNodeCount = screen.queryAllByTestId(/agent-tool-node-/).length;
    await user.click(screen.getByRole('button', { name: '应用修改' }));

    await waitFor(() => {
      const nodes = screen.getAllByTestId(/agent-tool-node-/);
      expect(nodes.length).toBeGreaterThan(beforeNodeCount);
    });
    expect(screen.queryByLabelText('CanvasAuthoringProposal')).not.toBeInTheDocument();
    const undoButton = screen.getByRole('button', { name: '撤回节点' });
    expect(undoButton).toBeEnabled();
    await user.click(undoButton);
    await waitFor(() => {
      expect(screen.queryAllByTestId(/agent-tool-node-/)).toHaveLength(beforeNodeCount);
    });
    expect(screen.getByLabelText('AI 助手消息')).toHaveTextContent('已撤回上一次 AI 应用到画布的修改。');
  });

  test('Workbench AI chat completion does not validate previous authoring draft', async () => {
    const user = userEvent.setup();
    assistantCurrentOutputTurnId = 'turn_previous_draft';
    assistantPreserveCurrentOutputOnChat = true;
    render(<App />);

    await openNavIndex(user, 0);
    await user.click(await screen.findByRole('button', { name: /AI 助手/i }));
    await user.type(
      screen.getByPlaceholderText('像 Codex CLI 一样和当前画布助手对话'),
      '普通聊天，不要修改画布',
    );
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(screen.getByLabelText('AI 助手消息')).toHaveTextContent('普通聊天回复。');
    });
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/assistant-draft/validate') && init?.method === 'POST',
        ),
    ).toBe(false);
  });

  test('Workbench AI assistant resets conversation state when switching tasks', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    await user.click(await screen.findByRole('button', { name: /AI \u52a9\u624b/i }));
    await user.click(screen.getByRole('button', { name: '修改模式' }));

    const longPrompt = '这是一个很长的旧任务需求'.repeat(24);
    fireEvent.change(
      screen.getByPlaceholderText('\u63cf\u8ff0\u8981\u751f\u6210\u6216\u8c03\u6574\u7684 workflow \u8349\u7a3f'),
      { target: { value: longPrompt } },
    );
    await user.click(screen.getByRole('button', { name: /生成修改/u }));
    await waitFor(() => {
      expect(screen.getByLabelText('AI \u52a9\u624b\u6d88\u606f')).toHaveTextContent(longPrompt.slice(0, 16));
    });

    const workbench = await screen.findByLabelText('ACC Workbench');
    await user.click(within(workbench).getByRole('button', { name: '\u65b0\u5efa\u4efb\u52a1' }));
    if (!screen.queryByLabelText('AI \u52a9\u624b\u6d88\u606f')) {
      await user.click((await screen.findAllByRole('button', { name: /AI \u52a9\u624b/i }))[0]);
    }

    await waitFor(() => {
      expect(screen.getByLabelText('AI \u52a9\u624b\u6d88\u606f')).not.toHaveTextContent(longPrompt.slice(0, 16));
    });
    expect(screen.getByLabelText('AI \u52a9\u624b\u6d88\u606f')).toHaveTextContent('\u7b49\u5f85\u8f93\u5165\u9700\u6c42');
    expect(screen.getByRole('button', { name: /\u63d0\u4ea4 turn|\u53d1\u9001/u })).toBeInTheDocument();
  });

  test('Workbench AI temporary agent blocks save validate and run after task reload', async () => {
    const user = userEvent.setup();
    const view = render(<App />);

    await openNavIndex(user, 0);
    await user.click(await screen.findByRole('button', { name: /AI 助手/i }));
    await user.click(screen.getByRole('button', { name: '修改模式' }));
    await user.type(
      screen.getByPlaceholderText('描述要生成或调整的 workflow 草稿'),
      'create a new agent template for reporting',
    );
    await user.click(screen.getByRole('button', { name: /生成修改/u }));
    await user.click(await screen.findByRole('button', { name: '应用修改' }));
    await waitFor(() => {
      expect(window.localStorage.getItem('acc.workbench.tasks.v2') || '').toContain('tmp_agent_');
    });

    view.unmount();
    vi.mocked(fetch).mockClear();
    render(<App />);
    const toolbar = await screen.findByLabelText('工作流工具栏');
    vi.mocked(fetch).mockClear();

    await user.click(within(toolbar).getByRole('button', { name: /保存/i }));
    await user.click(within(toolbar).getByRole('button', { name: /^校验$/i }));
    await user.click(within(toolbar).getByRole('button', { name: /^运行$/i }));

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.some(([url, init]) => url === '/api/workflows' && init?.method === 'POST')).toBe(false);
    expect(
      calls.some(
        ([url, init]) =>
          typeof url === 'string' &&
          url.startsWith('/api/workflows/') &&
          url.endsWith('/validate') &&
          init?.method === 'POST',
      ),
    ).toBe(false);
    expect(calls.some(([url, init]) => url === '/api/workflows/run-graph/submit' && init?.method === 'POST')).toBe(false);
  });

  test('Workbench AI temporary agent persists through GraphOps proposal approval', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    await user.click(await screen.findByRole('button', { name: /AI \u52a9\u624b/i }));
    await user.click(screen.getByRole('button', { name: '修改模式' }));
    await user.type(
      screen.getByPlaceholderText('\u63cf\u8ff0\u8981\u751f\u6210\u6216\u8c03\u6574\u7684 workflow \u8349\u7a3f'),
      'create a new agent template for reporting',
    );
    await user.click(screen.getByRole('button', { name: /生成修改/u }));
    await user.click(await screen.findByRole('button', { name: '应用修改' }));
    vi.mocked(fetch).mockClear();

    await user.click(await screen.findByRole('button', { name: '保存为资源' }));

    await waitFor(() => {
      expect(screen.getByLabelText('GraphOps 持久化预览')).toHaveTextContent(
        'callables/agents/tmp_agent_test.yaml',
      );
    });
    let calls = vi.mocked(fetch).mock.calls;
    expect(calls.some(([url, init]) => url === '/api/callables/agents' && init?.method === 'POST')).toBe(false);
    expect(calls.some(([url, init]) => url === '/api/graphops/proposals' && init?.method === 'POST')).toBe(true);
    expect(
      calls.some(
        ([url, init]) =>
          typeof url === 'string' &&
          /^\/api\/graphops\/proposals\/[^/]+\/dry-run$/u.test(url) &&
          init?.method === 'POST',
      ),
    ).toBe(true);
    expect(
      calls.some(
        ([url, init]) =>
          typeof url === 'string' &&
          /^\/api\/graphops\/proposals\/[^/]+\/apply$/u.test(url) &&
          init?.method === 'POST',
      ),
    ).toBe(false);

    await user.click(screen.getByRole('button', { name: '批准并写入' }));

    await waitFor(() => {
      expect(screen.getByLabelText('AI \u52a9\u624b\u6d88\u606f')).toHaveTextContent('GraphOps');
    });
    calls = vi.mocked(fetch).mock.calls;
    expect(
      calls.some(
        ([url, init]) =>
          typeof url === 'string' &&
          /^\/api\/graphops\/proposals\/[^/]+\/apply$/u.test(url) &&
          init?.method === 'POST',
      ),
    ).toBe(true);
    expect(window.localStorage.getItem('acc.workbench.tasks.v2') || '').not.toContain(
      '"temporaryResourceId":"tmp_agent_test"',
    );
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
      ([url, init]) => url === `/api/workflows/${demoRootId}/validate` && init?.method === 'POST',
    );
    const runCall = calls.find(([url, init]) => url === '/api/workflows/run-graph/submit' && init?.method === 'POST');
    expect(saveCall).toBeTruthy();
    expect(validateCall).toBeTruthy();
    expect(runCall).toBeTruthy();
    const savedPayload = JSON.parse(String(saveCall?.[1]?.body));
    const runPayload = JSON.parse(String(runCall?.[1]?.body));
    expect(savedPayload.graph.nodes).toHaveLength(7);
    expect(savedPayload.graph.data_edges.length).toBeGreaterThan(0);
    expect(savedPayload.graph.control_edges.length).toBeGreaterThan(0);
    expect(workflowSaveCalls).toHaveLength(2);
    expect(runPayload.graph.id).toMatch(/^ui_workflow_core_v2_stock_research_canvas_/);
    expect(runPayload.graph.workspace_policy).toEqual({
      save_mode: 'local_binding',
      default_state_mode: 'stateful',
    });
    expect(runPayload.graph.policy).toEqual({
      failure_mode: 'fail_fast',
      max_concurrency: 8,
    });
    expect(await screen.findByText(new RegExp(`${demoRunPrefix}.*:`, 'i'))).toBeInTheDocument();
  });

  test('Selected node inspector keeps runtime input out of the middle properties panel', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    await loadWorkspaceDemo(user);

    const researchCodexNode = await screen.findByTestId(`agent-tool-node-${demoInternalFlowNodeId}`);
    fireEvent.click(researchCodexNode);
    fireEvent.doubleClick(researchCodexNode);
    const nodeOverlay = await screen.findByLabelText('节点详情浮层');
    expect(within(nodeOverlay).queryByLabelText('运行时输入 main')).not.toBeInTheDocument();
    expect(within(nodeOverlay).queryByLabelText('运行输入 JSON')).not.toBeInTheDocument();
    expect(nodeOverlay).not.toHaveTextContent('传给当前节点的输入');
    const userPrompt = within(nodeOverlay).getByLabelText('用户提示词');
    await user.clear(userPrompt);
    await user.type(userPrompt, '请分析新的技术方案评审需求');

    await user.click(await screen.findByRole('button', { name: '运行当前任务' }));

    const runCall = vi.mocked(fetch).mock.calls.find(
      ([url, init]) => url === '/api/workflows/run-graph/submit' && init?.method === 'POST',
    );
    expect(runCall).toBeTruthy();
    const runPayload = JSON.parse(String(runCall?.[1]?.body));
    expect(runPayload.input).toBeUndefined();
    const containerNode = runPayload.graph.nodes.find((node: { id?: string }) => node.id === demoWorkflowNodeId);
    const targetNode = containerNode?.ui?.internal_nodes?.find(
      (node: { id?: string }) => node.id === demoInternalNodeId,
    );
    expect(targetNode?.input).toMatchObject({ user_prompt: '请分析新的技术方案评审需求' });
    expect(targetNode?.input).not.toHaveProperty('main', '请分析新的技术方案评审需求');
  });

  test('Workflow node inspector shows real input and output evidence after a run', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    await loadWorkspaceDemo(user);
    const codexNode = await screen.findByTestId(`agent-tool-node-${demoInternalFlowNodeId}`);
    expect(codexNode).toBeTruthy();
    fireEvent.click(codexNode as HTMLElement);
    expect(screen.queryByLabelText('节点详情浮层')).not.toBeInTheDocument();
    fireEvent.doubleClick(codexNode as HTMLElement);
    let nodeOverlay = await screen.findByLabelText('节点详情浮层');
    expect(nodeOverlay).toHaveTextContent('输入');
    expect(nodeOverlay).toHaveTextContent('节点属性');
    expect(nodeOverlay).toHaveTextContent('输出');

    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: /^运行$/i }));
    await screen.findByText(new RegExp(`${demoRunPrefix}.*:`, 'i'));

    nodeOverlay = await screen.findByLabelText('节点详情浮层');

    expect(nodeOverlay).toHaveTextContent('系统提示词');
    expect(within(nodeOverlay).queryByRole('textbox', { name: /系统提示词/ })).not.toBeInTheDocument();
    expect(nodeOverlay).toHaveTextContent('User Prompt');
    expect(nodeOverlay).toHaveTextContent('输出信息到下一节点');
    expect(nodeOverlay).not.toHaveTextContent('通过控制线传递 main 输出');
    expect(nodeOverlay).not.toHaveTextContent('运行状态');
    expect(nodeOverlay).not.toHaveTextContent('Scope');
    expect(nodeOverlay).not.toHaveTextContent('本次任务');
    expect(nodeOverlay).not.toHaveTextContent('任务说明');
    expect((nodeOverlay.textContent || '').indexOf('系统提示词')).toBeLessThan(
      (nodeOverlay.textContent || '').indexOf('User Prompt'),
    );
    expect(nodeOverlay).not.toHaveTextContent('传给当前节点的输入');
    expect(within(nodeOverlay).queryByLabelText('Agent chat composer')).not.toBeInTheDocument();
    expect(within(nodeOverlay).queryByLabelText('Agent node chat message')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Agent 输出状态')).toHaveTextContent('有待发布草稿');
    expect(within(nodeOverlay).getByRole('button', { name: /^最终结果/i })).toBeEnabled();
    expect(nodeOverlay).toHaveTextContent('Codex live stream fixture line');

    const evidencePane = await screen.findByLabelText('输入内容');
    expect(nodeOverlay).toHaveTextContent('input.json');
    expect(evidencePane).toHaveTextContent(demoInternalNodeLabel);
    expect(evidencePane).toHaveTextContent('真实上游输入');
    expect(evidencePane).toHaveTextContent(longCodexInputTail);
    expect(evidencePane).not.toHaveTextContent(`${longCodexInput.slice(0, 420)}...`);

    await user.click(within(nodeOverlay).getByRole('button', { name: /^最终结果/i }));
    const outputPane = await screen.findByLabelText('最终结果内容');
    expect(outputPane).toHaveTextContent('摘要');
    expect(outputPane).toHaveTextContent('Codex agent output fixture');
    expect(outputPane).toHaveTextContent('分析');
    expect(outputPane).toHaveTextContent('Readable analysis fixture extracted from output JSON.');
    expect(outputPane).toHaveTextContent('查看原始 JSON');
  });

  test('Selected agent node exposes output draft publish controls without inline chat composer', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavIndex(user, 0);
    await loadWorkspaceDemo(user);
    const codexNode = await screen.findByTestId(`agent-tool-node-${demoInternalFlowNodeId}`);
    expect(codexNode).toBeTruthy();
    fireEvent.click(codexNode as HTMLElement);
    fireEvent.doubleClick(codexNode as HTMLElement);

    const toolbar = await screen.findByLabelText('工作流工具栏');
    await user.click(within(toolbar).getByRole('button', { name: /^运行$/i }));
    await screen.findByText(new RegExp(`${demoRunPrefix}.*:`, 'i'));

    const outputState = await screen.findByLabelText('Agent 输出状态');
    expect(outputState).toHaveTextContent('有待发布草稿');
    expect(screen.queryByLabelText('Agent chat composer')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Agent node chat message')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /发布为本节点输出/i })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /发布为本节点输出/i }));

    await waitFor(() => {
      const publishCall = vi.mocked(fetch).mock.calls.find(
        ([url, init]) =>
          url === '/api/agent-sessions/agent_session_research_business/output/publish' &&
          init?.method === 'POST',
      );
      expect(publishCall).toBeTruthy();
      const body = JSON.parse(String(publishCall?.[1]?.body));
      expect(body).toEqual({ expected_turn_id: 'turn_draft_fixture' });
      expect(JSON.stringify(body)).not.toContain('target_output_path');
    });
  });

  test('Run Inspector exposes implemented debugger replay action', async () => {
    const user = userEvent.setup();
    render(<App />);

    await openNavigation(user, /运行记录/i);
    await screen.findAllByText('ui_acceptance_fake');
    await user.click(await screen.findByRole('button', { name: /\u4e8b\u4ef6\u56de\u653e/i }));

    expect(await screen.findByLabelText('replay.json')).toHaveTextContent('node_completed');
    expect(screen.queryByRole('button', { name: /\u91cd\u8dd1\u8282\u70b9/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fork/i })).not.toBeInTheDocument();
  });

  test('Control Plane renders GraphOps safety flow', async () => {
    const originalSearch = window.location.search;
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?dev=true' },
      writable: true,
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /\u63a7\u5236\u5e73\u9762/i }));
    await user.click(await screen.findByRole('button', { name: /\u6821\u9a8c patch/i }));
    await user.click(await screen.findByRole('button', { name: /dry-run patch/i }));

    expect(await screen.findByLabelText('graphops.dry-run.json')).toHaveTextContent(
      'not_implemented',
    );
    expect(screen.getByText(/proposal \/ validate \/ dry-run only/)).toBeInTheDocument();

    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: originalSearch },
      writable: true,
    });
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
