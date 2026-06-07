export type ViewKey = 'tasks' | 'resources' | 'runs' | 'artifacts' | 'control' | 'decisions';

export type NodeRunSummary = {
  node_id: string;
  ui_node_id?: string;
  parent_node_id?: string;
  callable_id: string;
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
  log_ref?: string | null;
  log_excerpt?: string | null;
  transcript_ref?: string | null;
  output_preview?: unknown;
  execution_mode?: string | null;
  adapter?: string | null;
  runtime?: Record<string, unknown> | null;
  binding_manifest?: Record<string, unknown> | null;
  binding_resolved?: Array<Record<string, unknown>>;
  steps?: Array<{
    event_id?: string;
    type?: string;
    timestamp?: string;
    status?: string;
    summary?: string;
    log_ref?: string;
  }>;
  workspace_dir?: string | null;
  error?: string | null;
  artifacts_url?: string;
  errors?: Array<{ error_class: string; message: string; paths: Record<string, string> }>;
};

export type NodeLogDelta = {
  type: 'node_log_delta';
  run_id: string;
  node_id: string;
  stream: 'stdout' | 'stderr';
  offset: number;
  next_offset: number;
  text: string;
  timestamp?: string;
  eof?: boolean;
};

export type RuntimeConfig = {
  run_mode: 'hermetic' | 'production' | string;
  external_agent_execution_enabled: boolean;
  real_external_agents_enabled: boolean;
};

export type AgentSessionRecord = {
  schema_version?: string;
  session_id: string;
  task_id?: string;
  node_id?: string;
  callable_ref?: Record<string, unknown>;
  runtime?: string;
  provider_session_id?: string | null;
  workspace_ref?: string;
  status?: string;
  current_output_ref?: string | null;
  published_output_ref?: string | null;
  bound_run_id?: string | null;
  bound_node_id?: string | null;
  bound_node_output_ref?: string | null;
  current_output_turn_id?: string | null;
  published_output_turn_id?: string | null;
  last_turn_id?: string | null;
  last_published_at?: string | null;
  created_at?: string;
  updated_at?: string;
  session_dir?: string;
  output_schema?: Record<string, unknown>;
  [key: string]: unknown;
};

export type AgentTurnRecord = {
  schema_version?: string;
  session_id: string;
  turn_id: string;
  reason?:
    | 'workflow_node'
    | 'node_chat'
    | 'output_revision'
    | 'workbench_chat'
    | 'canvas_revision'
    | 'selected_node_revision'
    | string;
  status?: 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'timeout' | string;
  prompt_ref?: string;
  input_ref?: string;
  draft_output_ref?: string;
  usage_ref?: string;
  started_at?: string | null;
  ended_at?: string | null;
  events_url?: string;
  [key: string]: unknown;
};

export type AgentMessage = {
  role: 'user' | 'assistant' | 'system' | string;
  content: string;
  turn_id?: string;
  created_at?: string;
  [key: string]: unknown;
};

export type AgentTurnEventPayload = {
  session_id: string;
  turn_id: string;
  events: RunEvent[];
};

export type AgentOutputPublishResult = {
  session_id: string;
  status: string;
  published_output_path?: string;
  target_output_path?: string;
};

export type AgentAssistantDraftValidation = {
  session_id: string;
  turn_id: string;
  status: 'valid' | 'invalid' | string;
  assistant_message?: string;
  proposal?: Record<string, unknown> | null;
  required_actions?: AuthoringRequiredAction[];
  questions?: string[];
  risk_notes?: string[];
  confidence?: 'low' | 'medium' | 'high' | string;
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

export type WorkflowRunSubmitResult = {
  run_id: string;
  task_id?: string | null;
  status: 'queued' | 'running' | string;
  run_dir: string;
};

export type RunIndex = {
  version: string;
  runs: RunSummary[];
};

export type InteractionKind = 'approval' | 'ask' | 'confirm' | 'suggest';

export type InteractionRequest = {
  interaction_id: string;
  run_id: string;
  node_id?: string | null;
  kind: InteractionKind;
  status: 'pending' | 'answered' | 'expired' | 'cancelled';
  prompt: string;
  options?: string[];
  payload?: Record<string, unknown>;
  created_at: string;
  answered_at?: string | null;
  answer?: Record<string, unknown> | null;
};

export type InteractionList = {
  run_id: string;
  interactions: InteractionRequest[];
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

export type CallableSummary = {
  id: string;
  version: string;
  kind: string;
  backend: string;
  source_id: string;
  source_path?: string | null;
  name?: string;
  description?: string;
  input_ports?: Record<string, unknown>;
  output_ports?: Record<string, unknown>;
  artifact_contract?: Record<string, unknown> | unknown[];
};

export type CallableDetail = CallableSummary & {
  metadata: Record<string, unknown>;
  input_ports: Record<string, unknown>;
  output_ports: Record<string, unknown>;
  artifact_contract: Record<string, unknown> | unknown[];
  runtime?: string;
  runner?: string;
  default_prompt?: string;
};

export type AgentClassDraft = {
  id: string;
  version?: string;
  runtime?: string;
  name?: string;
  description?: string;
  default_prompt?: string;
  input_ports?: Record<string, unknown>;
  output_ports?: Record<string, unknown>;
  artifact_contract?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
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
  callable_ref: {
    kind: 'agent_class' | 'tool_class' | 'workflow_function' | string;
    id: string;
    version?: string;
  };
  kind?: 'workflow' | 'agent_session' | 'tool' | string;
  workflow_ref?: string;
  label?: string;
  input?: Record<string, unknown>;
  input_mapping?: Record<string, unknown>;
  cwd_policy?: string;
  relative_cwd?: string;
  invocation_policy?: {
    timeout_seconds?: number | null;
    permission_profile?: {
      workspace_access?: string;
      network?: boolean;
      shell?: boolean;
      dangerous?: boolean;
      env_policy?: string;
      allowed_env?: string[];
      timeout_seconds?: number;
    };
  };
  input_ports?: WorkflowPort[];
  output_ports?: WorkflowPort[];
  control?: {
    require_human_approval?: boolean;
    approval_prompt?: string | null;
    approval_reject_status?: 'failed' | 'skipped' | string;
    forward_main_output_on_control?: boolean;
  };
  output_schema?: Record<string, unknown>;
  notes?: string;
  position?: { x: number; y: number };
  metadata?: Record<string, unknown>;
  ui?: {
    collapsed?: boolean;
    color?: string;
    semantic_kind?: 'workflow_container' | 'wrapped_callable';
    binding_ref?: string;
    internal_nodes?: unknown[];
    internal_edges?: Array<WorkflowDataEdge | WorkflowGraphEdge>;
  };
};

export type WorkflowGraphEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  mapping?: Record<string, unknown>;
  condition?: string | null;
  context?: 'upstream_output' | 'none' | string;
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

export type CoreV2WorkflowPayload = Record<string, unknown> & {
  schema_version: 'acc.core.v2';
  id: string;
  version: string;
  nodes: Array<Record<string, unknown>>;
  control_edges: Array<Record<string, unknown>>;
  data_edges: Array<Record<string, unknown>>;
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

export type DecisionInboxAction = {
  id: string;
  label: string;
  kind:
    | 'view_run'
    | 'view_node'
    | 'replay'
    | 'rerun_node'
    | 'rerun_from'
    | 'fork'
    | 'validate_patch'
    | 'dry_run_patch'
    | 'validate_graphops_proposal'
    | 'dry_run_graphops_proposal';
  method: 'GET' | 'POST';
  url: string;
  destructive: boolean;
};

export type DecisionInboxItem = {
  id: string;
  kind:
    | 'manual_review'
    | 'run_failed'
    | 'node_failed'
    | 'graphops_proposal'
    | 'graphops_persistence_proposal'
    | 'validation_warning';
  status: 'open';
  severity: 'high' | 'medium' | 'low';
  title: string;
  summary: string;
  run?: {
    run_id: string;
    workflow_id?: string | null;
    status: string;
    run_dir: string;
  };
  node?: {
    node_id: string;
    callable_id: string;
    status: string;
    summary?: string;
  };
  graphops?: {
    patch_id?: string;
    patch_path?: string;
    target_type?: string;
    target_path?: string;
    operation_count: number;
    apply_requires_human_approval: true;
    apply_status?: 'not_implemented';
    dry_run_only?: boolean;
    governance_mode?: 'proposal_dry_run_only' | 'persistence_proposal';
    semantic_status?: 'valid' | 'invalid';
    proposal_id?: string;
    proposal_path?: string;
    target_paths?: string[];
    status?: string;
    requester?: string;
    approver?: string;
    validation_status?: string;
    dry_run_status?: string;
    approved_target_paths?: string[];
  };
  evidence: Array<{
    label: string;
    kind: string;
    path?: string;
    url?: string;
  }>;
  actions: DecisionInboxAction[];
};

export type DecisionInbox = {
  version: '1.0';
  generated_at: string;
  counts: {
    open: number;
    manual_review: number;
    failed_runs: number;
    failed_nodes: number;
    graphops_proposals: number;
  };
  items: DecisionInboxItem[];
};

export type WorkflowBindingView = {
  workflow_id?: string;
  workflowId?: string;
  binding_path?: string;
  bindingPath?: string;
  workspace_root?: string | null;
  workspaceRoot?: string | null;
  exists: boolean;
  status: 'unbound' | 'valid' | 'missing' | 'invalid' | string;
  valid?: boolean;
  error?: string | null;
};

export type WorkflowDirectorySelection = {
  workflow_id: string;
  status: 'selected' | 'cancelled' | 'unsupported' | 'failed' | string;
  workspace_root?: string | null;
  workspaceRoot?: string | null;
  valid?: boolean;
  error?: string | null;
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

export type GraphOpsTransactionProposal = {
  schema_version: 'acc.graphops.transaction.v1';
  proposal_id: string;
  author: string;
  source?: Record<string, unknown>;
  base: {
    content_hashes: Record<string, 'absent' | string>;
  };
  rationale: string;
  targets: Array<{
    target_type: 'agent_class' | 'tool_class' | 'workflow';
    target_path: string;
    operation: 'create_agent_class' | 'create_tool_class' | 'create_workflow';
    template: Record<string, unknown>;
  }>;
};

export type GraphOpsProposalPayload = {
  proposal_id: string;
  status: string;
  proposal: GraphOpsTransactionProposal;
  validation?: Record<string, unknown>;
  dry_run?: GraphOpsDryRunPayload;
  approval?: Record<string, unknown>;
  apply_manifest?: GraphOpsApplyManifest;
  semantic_diff?: Record<string, unknown>;
};

export type GraphOpsDryRunPayload = {
  status: string;
  proposal_id: string;
  mutated: boolean;
  target_paths: string[];
  dry_run_digest: string;
  semantic_diff?: Record<string, unknown>;
};

export type GraphOpsApplyManifest = {
  status: string;
  proposal_id: string;
  created_files: string[];
  semantic_diff?: Record<string, unknown>;
};

export type AuthoringAgentSummary = {
  id: string;
  version: string;
  kind: 'agent_class';
  runtime: 'codex_cli' | 'claude_sdk' | 'generic_cli' | string;
  backend: string;
  source_id: string;
  source_path?: string | null;
  name?: string;
  description?: string | null;
  default_permissions: Record<string, unknown>;
};

export type AuthoringValidation = {
  status: 'valid' | 'invalid' | string;
  errors: Array<{ code?: string; message: string; [key: string]: unknown }>;
  warnings: Array<{ code?: string; message: string; [key: string]: unknown }>;
};

export type AuthoringRequiredAction = {
  kind:
    | 'ask'
    | 'confirm_canvas_apply'
    | 'approve_resource_persistence'
    | 'reject_or_revise'
    | string;
  prompt?: string;
  reason?: string;
  resource_draft_id?: string | null;
  [key: string]: unknown;
};

export type AuthoringSessionPayload = {
  session_id: string;
  agent_id: string;
  task_id?: string;
  status: string;
  messages: Array<{ role: string; content: string; created_at?: string }>;
  last_proposal?: Record<string, unknown> | null;
  validation?: AuthoringValidation | null;
  required_actions?: AuthoringRequiredAction[];
  evidence?: Record<string, string | null>;
};

export type AuthoringMessageResponse = {
  session_id: string;
  message_id: string;
  assistant_message: string;
  proposal?: Record<string, unknown> | null;
  validation: AuthoringValidation;
  required_actions: AuthoringRequiredAction[];
  questions: string[];
  risk_notes: string[];
  confidence: 'low' | 'medium' | 'high' | string;
};
