export type ViewKey = 'runs' | 'capsules' | 'artifacts' | 'workflows' | 'control';

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
  workspace_dir?: string | null;
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

export type RunEvent = {
  event_id?: string;
  type?: string;
  event?: string;
  timestamp?: string;
  workflow_run_id?: string;
  node_id?: string;
  session_id?: string;
  level?: number;
  status?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
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
  prompt_template: string | null;
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
  kind?: 'agent_session' | 'tool' | 'workflow' | string;
  label?: string;
  input?: Record<string, unknown>;
  input_mapping?: Record<string, unknown>;
  cwd_policy?: string;
  relative_cwd?: string;
  input_ports?: WorkflowPort[];
  output_ports?: WorkflowPort[];
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

export type WorkflowPort = {
  id: string;
  direction?: 'input' | 'output' | string;
  required?: boolean;
  cardinality?: 'one' | 'many' | string;
  artifact_types?: string[];
};

export type WorkflowDataEdge = {
  id?: string;
  from: { node: string; port?: string; output?: string; artifact?: string; path?: string };
  to: { node: string; port?: string; input?: string };
  materialization?: string;
  required?: boolean;
};

export type WorkflowGraph = {
  id: string;
  version: string;
  name?: string;
  description?: string;
  input?: Record<string, unknown>;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  control_edges?: WorkflowGraphEdge[];
  data_edges?: WorkflowDataEdge[];
  workspace_policy?: {
    save_mode?: string;
    default_state_mode?: string;
  };
  behavior_pack_policy?: {
    mode?: string;
    precedence?: string;
    snapshot_effective?: boolean;
  };
  exposed_inputs?: WorkflowPort[];
  exposed_outputs?: WorkflowPort[];
  policy?: {
    failure_mode?: string;
    max_concurrency?: number;
  };
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

export type ReplayPayload = {
  run_dir: string;
  status: string;
  workflow_status: string;
  workflow_id?: string | null;
  node_filter?: string | null;
  failed_node?: string | null;
  nodes: Array<Record<string, unknown>>;
  timeline: RunEvent[];
  errors: Array<Record<string, unknown>>;
  event_log: string;
};

export type RunDiffPayload = {
  run_a: string;
  run_b: string;
  status: {
    a: string;
    b: string;
    changed: boolean;
  };
  duration_ms?: {
    a?: number | null;
    b?: number | null;
  };
  changed_nodes: string[];
  node_diffs: Array<Record<string, unknown>>;
};

export type GraphOpsExample = {
  id: string;
  path: string;
  name: string;
};
