import type {
  ArtifactContent,
  ArtifactList,
  CapsuleDetail,
  CapsuleSummary,
  NodeRunSummary,
  RunIndex,
  RunSummary,
  WorkflowDetail,
  WorkflowSummary,
} from './types';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || 'Request failed'}: ${path}`);
  }
  return (await response.json()) as T;
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
  workflows: () => getJson<{ workflows: WorkflowSummary[] }>('/api/workflows'),
  workflow: (workflowId: string) =>
    getJson<WorkflowDetail>(`/api/workflows/${encodeURIComponent(workflowId)}`),
};

