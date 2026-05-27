import type {
  ArtifactContent,
  ArtifactList,
  CapsuleDetail,
  CapsuleSummary,
  GraphOpsExample,
  DecisionInbox,
  NodeRunSummary,
  ReplayPayload,
  RunEvent,
  RunDiffPayload,
  RunIndex,
  RunSummary,
  WorkflowDetail,
  WorkflowBindingView,
  WorkflowGraph,
  WorkflowRunResult,
  WorkflowSummary,
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
    if (detail?.message) {
      return `${fallback} - ${detail.message}`;
    }
    if (detail) {
      return `${fallback} - ${JSON.stringify(detail)}`;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export const api = {
  health: () => getJson<{ status: string }>('/api/health'),
  runs: () => getJson<RunIndex>('/api/runs'),
  run: (runId: string) => getJson<RunSummary>(`/api/runs/${encodeURIComponent(runId)}`),
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
  capsules: () => getJson<{ capsules: CapsuleSummary[] }>('/api/capsules'),
  capsule: (capsuleId: string) =>
    getJson<CapsuleDetail>(`/api/capsules/${encodeURIComponent(capsuleId)}`),
  scaffoldCapsule: (body: unknown) =>
    sendJson<{ status: string; capsule_id: string }>('POST', '/api/capsules/scaffold', body),
  deleteCapsule: (capsuleId: string, force = false) =>
    sendJson<{ status: string; capsule_id: string }>(
      'DELETE',
      `/api/capsules/${encodeURIComponent(capsuleId)}${force ? '?force=true' : ''}`,
    ),
  capsuleFile: (capsuleId: string, filePath: string) =>
    getJson<{ capsule_id: string; file: string; path: string; content: string }>(
      `/api/capsules/${encodeURIComponent(capsuleId)}/files/${encodePath(filePath)}`,
    ),
  saveCapsuleFile: (capsuleId: string, filePath: string, content: string) =>
    sendJson<{ status: string }>(
      'PUT',
      `/api/capsules/${encodeURIComponent(capsuleId)}/files/${encodePath(filePath)}`,
      { content },
    ),
  validateCapsule: (capsuleId: string) =>
    sendJson<{ status: string; errors?: string[] }>(
      'POST',
      `/api/capsules/${encodeURIComponent(capsuleId)}/validate`,
      {},
    ),
  testCapsule: (capsuleId: string, body: unknown) =>
    sendJson<{ status: string; summary?: string }>(
      'POST',
      `/api/capsules/${encodeURIComponent(capsuleId)}/test`,
      body,
    ),
  workflows: () => getJson<{ workflows: WorkflowSummary[] }>('/api/workflows'),
  workflow: (workflowId: string) =>
    getJson<WorkflowDetail>(`/api/workflows/${encodeURIComponent(workflowId)}`),
  saveWorkflow: (graph: WorkflowGraph, force = true) =>
    sendJson<{ status: string; workflow_id: string }>('POST', '/api/workflows', { graph, force }),
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
  nodeEvents: (runId: string, nodeId: string, limit = 200) =>
    getJson<{ run_id: string; node_id: string; event_log: string; events: RunEvent[] }>(
      `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/events?limit=${encodeURIComponent(String(limit))}`,
    ),
  decisions: (limit = 100) =>
    getJson<DecisionInbox>(`/api/decisions?limit=${encodeURIComponent(String(limit))}`),
  replayRun: (runId: string, nodeId?: string) =>
    sendJson<ReplayPayload>('POST', `/api/debugger/runs/${encodeURIComponent(runId)}/replay`, {
      node_id: nodeId,
    }),
  rerunNode: (runId: string, nodeId: string, outDir: string) =>
    sendJson<WorkflowRunResult>(
      'POST',
      `/api/debugger/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/rerun`,
      { out_dir: outDir },
    ),
  rerunFrom: (runId: string, nodeId: string, outDir: string) =>
    sendJson<WorkflowRunResult>(
      'POST',
      `/api/debugger/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/rerun-from`,
      { out_dir: outDir },
    ),
  forkRun: (runId: string, nodeId: string, outDir: string, override: Record<string, unknown>) =>
    sendJson<WorkflowRunResult>(
      'POST',
      `/api/debugger/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/fork`,
      { out_dir: outDir, override },
    ),
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
};
