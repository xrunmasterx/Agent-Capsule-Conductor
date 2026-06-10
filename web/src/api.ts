import type {
  ArtifactContent,
  ArtifactList,
  AgentMessage,
  AgentAssistantDraftValidation,
  AgentOutputPublishResult,
  AgentSessionRecord,
  AgentTurnEventPayload,
  AgentTurnRecord,
  AuthoringAgentSummary,
  AuthoringMessageResponse,
  AuthoringSessionPayload,
  AuthoringValidation,
  AgentClassDraft,
  CallableDetail,
  CallableSummary,
  GraphOpsApplyManifest,
  GraphOpsDryRunPayload,
  GraphOpsExample,
  GraphOpsProposalPayload,
  GraphOpsTransactionProposal,
  DecisionInbox,
  NodeRunSummary,
  ReplayPayload,
  RunEvent,
  RunDiffPayload,
  RunIndex,
  RunSummary,
  WorkflowDetail,
  WorkflowBindingView,
  WorkflowDirectorySelection,
  WorkflowGraph,
  WorkflowRunResult,
  WorkflowRunSubmitResult,
  WorkflowSummary,
  InteractionList,
  InteractionRequest,
  NodeLogDelta,
  RuntimeConfig,
} from './types';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, path));
  }
  return (await response.json()) as T;
}

async function sendJson<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, path));
  }
  return (await response.json()) as T;
}

async function responseErrorMessage(response: Response, path: string): Promise<string> {
  const fallback = `${response.status} ${response.statusText || 'Request failed'}: ${path}`;
  try {
    const payload = await response.json();
    const detail = payload?.detail;
    if (typeof detail === 'string') {
      return `${fallback} - ${detail}`;
    }
    if (isRecord(detail) && detail.message) {
      const validationDetails = validationErrorDetails(detail);
      if (validationDetails) {
        return `${fallback} - ${String(detail.message)}: ${validationDetails}`;
      }
      return `${fallback} - ${String(detail.message)}`;
    }
    if (detail) {
      return `${fallback} - ${JSON.stringify(detail)}`;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validationErrorDetails(detail: Record<string, unknown>): string {
  const validation = detail.validation;
  if (!isRecord(validation) || !Array.isArray(validation.errors)) {
    return '';
  }

  const rendered = validation.errors
    .slice(0, 3)
    .map((issue) => {
      if (!isRecord(issue)) {
        return '';
      }
      const code = typeof issue.code === 'string' ? issue.code : '';
      const message = typeof issue.message === 'string' ? issue.message : '';
      const nodeId = typeof issue.node_id === 'string' ? issue.node_id : '';
      const port = typeof issue.port === 'string' ? issue.port : '';
      const location = [nodeId, port].filter(Boolean).join('.');
      return [code, location, message].filter(Boolean).join(' - ');
    })
    .filter(Boolean);

  if (rendered.length === 0) {
    return '';
  }

  const remaining = validation.errors.length - rendered.length;
  return remaining > 0 ? `${rendered.join('; ')}; +${remaining} more` : rendered.join('; ');
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export const api = {
  health: () => getJson<{ status: string }>('/api/health'),
  runtimeConfig: () => getJson<RuntimeConfig>('/api/runtime/config'),
  authoringAgents: () => getJson<{ agents: AuthoringAgentSummary[] }>('/api/authoring/agents'),
  createAuthoringSession: (payload: {
    agent_id?: string | null;
    task_id: string;
    canvas_hash: string;
    canvas_snapshot: Record<string, unknown>;
    selection?: Record<string, unknown> | null;
  }) => sendJson<AuthoringSessionPayload>('POST', '/api/authoring/sessions', payload),
  getAuthoringSession: (sessionId: string) =>
    getJson<AuthoringSessionPayload>(`/api/authoring/sessions/${encodeURIComponent(sessionId)}`),
  sendAuthoringMessage: (
    sessionId: string,
    payload: {
      message: string;
      canvas_hash: string;
      canvas_snapshot: Record<string, unknown>;
      selection?: Record<string, unknown> | null;
    },
  ) =>
    sendJson<AuthoringMessageResponse>(
      'POST',
      `/api/authoring/sessions/${encodeURIComponent(sessionId)}/messages`,
      payload,
    ),
  validateAuthoringProposal: (payload: {
    proposal?: Record<string, unknown> | null;
    task_id: string;
    canvas_hash: string;
    canvas_snapshot: Record<string, unknown>;
    temporary_resources?: Record<string, unknown>;
  }) => sendJson<AuthoringValidation>('POST', '/api/authoring/proposals/validate', payload),
  dryRunAuthoringProposal: (payload: {
    proposal?: Record<string, unknown> | null;
    task_id: string;
    canvas_hash: string;
    canvas_snapshot: Record<string, unknown>;
    temporary_resources?: Record<string, unknown>;
  }) => sendJson<Record<string, unknown>>('POST', '/api/authoring/proposals/dry-run', payload),
  publishWorkbenchCanvasSnapshot: (payload: {
    task_id: string;
    canvas_hash: string;
    canvas_snapshot: Record<string, unknown>;
    selection?: Record<string, unknown>;
    temporary_resources?: Record<string, unknown>;
  }) => sendJson<Record<string, unknown>>('POST', '/api/workbench/canvas-snapshots', payload),
  workbenchCanvasSnapshot: (taskId: string) =>
    getJson<Record<string, unknown>>(
      `/api/workbench/canvas-snapshots/${encodeURIComponent(taskId)}`,
    ),
  runs: () => getJson<RunIndex>('/api/runs'),
  run: (runId: string) => getJson<RunSummary>(`/api/runs/${encodeURIComponent(runId)}`),
  cancelRun: (runId: string) =>
    sendJson<{ run_id: string; status: string }>(
      'POST',
      `/api/runs/${encodeURIComponent(runId)}/cancel`,
      {},
    ),
  node: (runId: string, nodeId: string) =>
    getJson<NodeRunSummary>(
      `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}`,
    ),
  nodeArtifacts: (runId: string, nodeId: string) =>
    getJson<ArtifactList>(
      `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/artifacts`,
    ),
  artifact: (path: string) =>
    getJson<ArtifactContent>(`/api/artifacts/read?path=${encodeURIComponent(path)}`),
  callables: () => getJson<{ callables: CallableSummary[] }>('/api/callables'),
  callable: (callableId: string) =>
    getJson<{ callable: CallableDetail }>(`/api/callables/${encodeURIComponent(callableId)}`),
  createAgentCallable: (draft: AgentClassDraft) =>
    sendJson<{ status: string; callable: CallableDetail }>('POST', '/api/callables/agents', draft),
  updateAgentCallable: (callableId: string, draft: AgentClassDraft) =>
    sendJson<{ status: string; callable: CallableDetail }>(
      'PUT',
      `/api/callables/agents/${encodeURIComponent(callableId)}`,
      draft,
    ),
  deleteAgentCallable: (callableId: string) =>
    sendJson<{ status: string; id: string }>(
      'DELETE',
      `/api/callables/agents/${encodeURIComponent(callableId)}`,
      {},
    ),
  workflows: () => getJson<{ workflows: WorkflowSummary[] }>('/api/workflows'),
  workflow: (workflowId: string) =>
    getJson<WorkflowDetail>(`/api/workflows/${encodeURIComponent(workflowId)}`),
  saveWorkflow: (graph: WorkflowGraph, force = true) =>
    sendJson<{ status: string; workflow_id: string; canonical_preview?: Record<string, unknown> }>(
      'POST',
      '/api/workflows',
      { graph, force },
    ),
  runGraph: (
    graph: WorkflowGraph,
    runDir: string,
    options?: { bindingPath?: string; workspace?: string; input?: Record<string, unknown> },
  ) =>
    sendJson<WorkflowRunResult>('POST', '/api/workflows/run-graph', {
      graph,
      run_dir: runDir,
      ...(options?.bindingPath ? { binding_path: options.bindingPath } : {}),
      ...(options?.workspace ? { workspace: options.workspace } : {}),
      ...(options?.input ? { input: options.input } : {}),
    }),
  submitGraphRun: (
    graph: WorkflowGraph,
    runDir: string,
    options?: {
      taskId?: string;
      bindingPath?: string;
      workspace?: string;
      input?: Record<string, unknown>;
    },
  ) =>
    sendJson<WorkflowRunSubmitResult>('POST', '/api/workflows/run-graph/submit', {
      graph,
      run_dir: runDir,
      ...(options?.taskId ? { task_id: options.taskId } : {}),
      ...(options?.bindingPath ? { binding_path: options.bindingPath } : {}),
      ...(options?.workspace ? { workspace: options.workspace } : {}),
      ...(options?.input ? { input: options.input } : {}),
    }),
  updateWorkflow: (workflowId: string, graph: WorkflowGraph) =>
    sendJson<{ status: string; workflow_id: string }>(
      'PUT',
      `/api/workflows/${encodeURIComponent(workflowId)}`,
      { graph },
    ),
  validateWorkflow: (workflowId: string) =>
    sendJson<{ status: string; workflow_id: string }>(
      'POST',
      `/api/workflows/${encodeURIComponent(workflowId)}/validate`,
      {},
    ),
  workflowBinding: (workflowId: string) =>
    getJson<WorkflowBindingView>(`/api/workflows/${encodeURIComponent(workflowId)}/binding`),
  validateWorkflowBinding: (workflowId: string, workspaceRoot: string) =>
    sendJson<WorkflowBindingView>(
      'POST',
      `/api/workflows/${encodeURIComponent(workflowId)}/binding/validate`,
      { workspace_root: workspaceRoot },
    ),
  saveWorkflowBinding: (workflowId: string, workspaceRoot: string) =>
    sendJson<WorkflowBindingView>(
      'PUT',
      `/api/workflows/${encodeURIComponent(workflowId)}/binding`,
      { workspace_root: workspaceRoot },
    ),
  openWorkflowBindingFolder: (workflowId: string) =>
    sendJson<{ workflow_id: string; path: string; opened: boolean }>(
      'POST',
      `/api/workflows/${encodeURIComponent(workflowId)}/binding/open-folder`,
      {},
    ),
  selectWorkflowBindingDirectory: (
    workflowId: string,
    options?: { initialDir?: string | null },
  ) =>
    sendJson<WorkflowDirectorySelection>(
      'POST',
      `/api/workflows/${encodeURIComponent(workflowId)}/binding/select-directory`,
      { initial_dir: options?.initialDir || undefined },
    ),
  runWorkflow: (
    workflowId: string,
    runDir: string,
    options?: { bindingPath?: string; workspace?: string; input?: Record<string, unknown> },
  ) =>
    sendJson<WorkflowRunResult>(
      'POST',
      `/api/workflows/${encodeURIComponent(workflowId)}/run`,
      {
        run_dir: runDir,
        ...(options?.bindingPath ? { binding_path: options.bindingPath } : {}),
        ...(options?.workspace ? { workspace: options.workspace } : {}),
        ...(options?.input ? { input: options.input } : {}),
      },
    ),
  runEvents: (runId: string, limit = 200) =>
    getJson<{ run_id: string; event_log: string; events: RunEvent[] }>(
      `/api/runs/${encodeURIComponent(runId)}/events?limit=${encodeURIComponent(String(limit))}`,
    ),
  runInteractions: (runId: string) =>
    getJson<InteractionList>(`/api/runs/${encodeURIComponent(runId)}/interactions`),
  answerInteraction: (runId: string, interactionId: string, answer: Record<string, unknown>) =>
    sendJson<InteractionRequest>(
      'POST',
      `/api/runs/${encodeURIComponent(runId)}/interactions/${encodeURIComponent(interactionId)}/answer`,
      { answer },
    ),
  nodeEvents: (runId: string, nodeId: string, limit = 200) =>
    getJson<{ run_id: string; node_id: string; event_log: string; events: RunEvent[] }>(
      `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/events?limit=${encodeURIComponent(String(limit))}`,
    ),
  nodeLog: (runId: string, nodeId: string, stream: 'stdout' | 'stderr', offset = 0, limit = 65536) =>
    getJson<NodeLogDelta>(
      `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/logs/${encodeURIComponent(stream)}?offset=${encodeURIComponent(String(offset))}&limit=${encodeURIComponent(String(limit))}`,
    ),
  createAgentSessionFromRunNode: (
    runId: string,
    nodeId: string,
    options?: { nodeRunDir?: string | null; uiNodeId?: string | null; parentNodeId?: string | null },
  ) =>
    sendJson<AgentSessionRecord>('POST', '/api/agent-sessions', {
      source: {
        type: 'run_node',
        run_id: runId,
        node_id: nodeId,
        ...(options?.nodeRunDir ? { node_run_dir: options.nodeRunDir } : {}),
        ...(options?.uiNodeId ? { ui_node_id: options.uiNodeId } : {}),
        ...(options?.parentNodeId ? { parent_node_id: options.parentNodeId } : {}),
      },
    }),
  createWorkbenchAssistantSession: (payload: {
    task_id: string;
    canvas_hash: string;
    canvas_snapshot: Record<string, unknown>;
    selection?: Record<string, unknown> | null;
    agent_id?: string | null;
    workspace_ref?: string | null;
  }) =>
    sendJson<AgentSessionRecord>('POST', '/api/agent-sessions', {
      source: {
        type: 'workbench_assistant',
        task_id: payload.task_id,
        canvas_hash: payload.canvas_hash,
        canvas_snapshot: payload.canvas_snapshot,
        selection: payload.selection || {},
        ...(payload.agent_id ? { agent_id: payload.agent_id } : {}),
        ...(payload.workspace_ref ? { workspace_ref: payload.workspace_ref } : {}),
      },
    }),
  getAgentSession: (sessionId: string) =>
    getJson<AgentSessionRecord>(`/api/agent-sessions/${encodeURIComponent(sessionId)}`),
  getAgentSessionMessages: (sessionId: string) =>
    getJson<{ session_id: string; messages: AgentMessage[] }>(
      `/api/agent-sessions/${encodeURIComponent(sessionId)}/messages`,
    ),
  submitAgentTurn: (
    sessionId: string,
    payload: {
      message: string;
      reason: 'node_chat' | 'output_revision';
      expected_provider_session_id?: string | null;
    },
  ) =>
    sendJson<AgentTurnRecord>(
      'POST',
      `/api/agent-sessions/${encodeURIComponent(sessionId)}/turns/submit`,
      payload,
    ),
  submitWorkbenchAssistantTurn: (
    sessionId: string,
    payload: {
      message: string;
      reason: 'workbench_chat' | 'canvas_revision' | 'selected_node_revision';
      canvas_hash: string;
      canvas_snapshot: Record<string, unknown>;
      selection?: Record<string, unknown> | null;
      expected_provider_session_id?: string | null;
    },
  ) =>
    sendJson<AgentTurnRecord>(
      'POST',
      `/api/agent-sessions/${encodeURIComponent(sessionId)}/turns/submit`,
      payload,
    ),
  getAgentTurnEvents: (sessionId: string, turnId: string) =>
    getJson<AgentTurnEventPayload>(
      `/api/agent-sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/events`,
    ),
  streamAgentTurnEventsUrl: (sessionId: string, turnId: string, afterSeq = 0) =>
    `/api/agent-sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/stream?after_seq=${encodeURIComponent(String(afterSeq))}`,
  validateAssistantDraft: (sessionId: string, expectedTurnId: string) =>
    sendJson<AgentAssistantDraftValidation>(
      'POST',
      `/api/agent-sessions/${encodeURIComponent(sessionId)}/assistant-draft/validate`,
      { expected_turn_id: expectedTurnId },
    ),
  publishAgentOutput: (sessionId: string, expectedTurnId: string) =>
    sendJson<AgentOutputPublishResult>(
      'POST',
      `/api/agent-sessions/${encodeURIComponent(sessionId)}/output/publish`,
      { expected_turn_id: expectedTurnId },
    ),
  runStreamUrl: (runId: string, afterSeq = 0) =>
    `/api/runs/${encodeURIComponent(runId)}/stream?after_seq=${encodeURIComponent(String(afterSeq))}`,
  decisions: (limit = 100) =>
    getJson<DecisionInbox>(`/api/decisions?limit=${encodeURIComponent(String(limit))}`),
  replayRun: (runId: string, nodeId?: string) =>
    sendJson<ReplayPayload>('POST', `/api/debugger/runs/${encodeURIComponent(runId)}/replay`, {
      node_id: nodeId,
    }),
  diffRuns: (runA: string, runB: string) =>
    sendJson<RunDiffPayload>('POST', '/api/debugger/diff', { run_a: runA, run_b: runB }),
  graphopsExamples: () => getJson<{ patches: GraphOpsExample[] }>('/api/graphops/examples'),
  graphopsValidate: (patchPath: string, semantic = true) =>
    sendJson<Record<string, unknown>>('POST', '/api/graphops/validate', {
      patch_path: patchPath,
      semantic,
    }),
  graphopsDryRun: (patchPath: string, semantic = true) =>
    sendJson<Record<string, unknown>>('POST', '/api/graphops/dry-run', {
      patch_path: patchPath,
      semantic,
    }),
  createGraphOpsProposal: (proposal: GraphOpsTransactionProposal) =>
    sendJson<GraphOpsProposalPayload>('POST', '/api/graphops/proposals', { proposal }),
  validateGraphOpsProposal: (proposalId: string) =>
    sendJson<Record<string, unknown>>(
      'POST',
      `/api/graphops/proposals/${encodeURIComponent(proposalId)}/validate`,
      {},
    ),
  dryRunGraphOpsProposal: (proposalId: string) =>
    sendJson<GraphOpsDryRunPayload>(
      'POST',
      `/api/graphops/proposals/${encodeURIComponent(proposalId)}/dry-run`,
      {},
    ),
  approveGraphOpsProposal: (
    proposalId: string,
    payload: {
      target_paths: string[];
      base_hashes: Record<string, string>;
      dry_run_digest: string;
      approver?: string;
    },
  ) =>
    sendJson<Record<string, unknown>>(
      'POST',
      `/api/graphops/proposals/${encodeURIComponent(proposalId)}/approve`,
      { proposal_id: proposalId, approver: 'workbench_user', ...payload },
    ),
  applyGraphOpsProposal: (proposalId: string) =>
    sendJson<GraphOpsApplyManifest>(
      'POST',
      `/api/graphops/proposals/${encodeURIComponent(proposalId)}/apply`,
      {},
    ),
};
