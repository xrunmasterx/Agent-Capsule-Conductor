import type {
  ArtifactContent,
  ArtifactList,
  CapsuleDetail,
  CapsuleSummary,
  NodeRunSummary,
  RunIndex,
  RunSummary,
  WorkflowDetail,
  WorkflowGraph,
  WorkflowSummary,
} from './types';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || 'Request failed'}: ${path}`);
  }
  return (await response.json()) as T;
}

async function sendJson<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || 'Request failed'}: ${path}`);
  }
  return (await response.json()) as T;
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
  runWorkflow: (workflowId: string, runDir: string) =>
    sendJson<{ status: string; workflow_id: string }>(
      'POST',
      `/api/workflows/${encodeURIComponent(workflowId)}/run`,
      { run_dir: runDir },
    ),
};
