export type ViewKey = 'runs' | 'capsules' | 'artifacts' | 'workflows';

export type NodeRunSummary = {
  node_id: string;
  capsule_id: string;
  session_id?: string | null;
  status: string;
  summary?: string;
  duration_ms?: number | null;
  run_dir: string;
  input_path?: string | null;
  prompt_path?: string | null;
  output_path?: string | null;
  artifact_dir?: string | null;
  event_log?: string | null;
  stdout_log?: string | null;
  stderr_log?: string | null;
  artifacts_url?: string;
  errors?: Array<{ error_class: string; message: string; paths: Record<string, string> }>;
};

export type RunSummary = {
  run_id: string;
  workflow_id?: string | null;
  status: string;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null;
  run_dir: string;
  node_count: number;
  failed_nodes: string[];
  output_path?: string | null;
  artifact_dir?: string | null;
  nodes: NodeRunSummary[];
};

export type RunIndex = {
  version: string;
  runs: RunSummary[];
};

export type CapsuleSummary = {
  id: string;
  version: string;
  name: string;
  description: string;
  runtime: string;
  workspace: string;
  capsule_dir?: string;
};

export type CapsuleDetail = CapsuleSummary & {
  yaml_path: string;
  prompt_template: string;
  input_schema: string;
  output_schema: string;
  artifact_manifest: string;
  permissions: Record<string, unknown>;
};

export type ArtifactLink = {
  name: string;
  path: string;
  read_url: string;
  size_bytes: number;
};

export type ArtifactList = {
  run_id: string;
  node_id: string;
  artifacts: ArtifactLink[];
};

export type ArtifactContent = {
  path: string;
  name: string;
  type: 'markdown' | 'json' | 'log' | 'patch' | 'text';
  content: string;
  size_bytes: number;
};

export type WorkflowSummary = {
  workflow_id: string;
  file_id: string;
  name?: string;
  description?: string;
  version?: string;
  path: string;
  task_count: number;
};

export type WorkflowDetail = {
  workflow_id: string;
  file_id: string;
  path: string;
  workflow: {
    name?: string;
    description?: string;
    version?: string;
    tasks?: Array<{
      name: string;
      type?: string;
      depends_on?: string[];
      command?: unknown;
    }>;
  };
  graph?: WorkflowGraph;
  type?: 'graph' | string;
};

export type WorkflowGraphNode = {
  id: string;
  capsule_id: string;
  label?: string;
  input?: Record<string, unknown>;
  input_mapping?: Record<string, unknown>;
  notes?: string;
  position?: { x: number; y: number };
  ui?: {
    collapsed?: boolean;
    color?: string;
  };
};

export type WorkflowGraphEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  mapping?: Record<string, unknown>;
  condition?: string | null;
};

export type WorkflowGraph = {
  id: string;
  version: string;
  name?: string;
  description?: string;
  input?: Record<string, unknown>;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  metadata?: Record<string, unknown>;
};

export type WorkflowRunResult = {
  workflow_id: string;
  status: string;
  run_dir: string;
  started_at?: string;
  ended_at?: string;
  nodes: NodeRunSummary[];
  edges: WorkflowGraphEdge[];
  errors?: string[];
};
