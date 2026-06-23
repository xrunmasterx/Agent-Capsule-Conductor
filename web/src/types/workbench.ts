import type { ReactNode } from 'react';

import type {
  AgentClassDraft,
  CallableSummary,
  GraphOpsDryRunPayload,
  GraphOpsTransactionProposal,
  NodeRunSummary,
  RunEvent,
  RunSummary,
  WorkflowBindingView,
  WorkflowGraph,
  WorkflowGraphNode,
  WorkflowRunResult,
  WorkflowSummary,
} from '../types';

export type WorkflowStatus =
  | 'not_run'
  | 'queued'
  | 'scheduled'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'crashed'
  | 'schema_error'
  | 'artifact_error'
  | 'manual_review';

export type ConnectionMode = 'data' | 'control';
export type EdgeViewMode = 'all' | 'control' | 'data';
export type TaskWorkspaceView = 'overview' | 'blueprint';
export type CodexExecutionMode = 'default' | 'local_readonly_no_sandbox' | 'danger_full_access';
export type EmptyInputPolicy = 'allow' | 'block';
export type BottomDockMode = 'evidence' | 'assistant';
export type PortDirection = 'input' | 'output';

export type WorkflowPortView = {
  id: string;
  label: string;
  direction: PortDirection;
  required?: boolean;
  cardinality?: string;
  artifactTypes?: string[];
  description?: string;
  jsonPath?: string;
  schemaType?: string;
  projectionSource?: 'output_schema' | 'manual' | 'template';
  diagnostic?: string;
  readonly?: boolean;
};

export type BoundaryTransferMapping = {
  sourcePort: string;
  targetPort: string;
};

export type BoundaryTransfer = {
  direction: 'workflow_input' | 'workflow_output';
  materialization: 'copy' | 'reference';
  mappings?: BoundaryTransferMapping[];
  inference: 'explicit' | 'same_name' | 'main_compat' | 'single_port';
};

export type WorkflowCanvasEdge =
  | {
      id: string;
      kind: 'data';
      source: { workflowId: string; portId: string };
      target: { workflowId: string; portId: string };
      materialization: 'copy' | 'reference';
    }
  | {
      id: string;
      kind: 'control';
      source: { workflowId: string };
      target: { workflowId: string };
      condition?: string | null;
      context?: 'upstream_output' | 'none';
      boundaryTransfer?: BoundaryTransfer;
    };

export type InternalNodeView = {
  id: string;
  name: string;
  invocationLabel?: string;
  task: string;
  kind: 'Agent' | 'Tool';
  status: WorkflowStatus;
  callableId?: string;
  runtime?: string;
  codexExecutionMode?: CodexExecutionMode;
  input?: Record<string, unknown>;
  inputPorts?: WorkflowPortView[];
  outputPorts?: WorkflowPortView[];
  control?: WorkflowGraphNode['control'];
  outputSchema?: Record<string, unknown>;
  forwardMainOutputOnControl?: boolean | null;
  emptyInputPolicy?: EmptyInputPolicy;
  temporaryResourceId?: string;
  position?: { x: number; y: number };
};

export type WorkflowContainerModel = {
  id: string;
  title: string;
  invocationLabel?: string;
  boundaryKind?: 'workflow_input' | 'workflow_output';
  sourceKind?: WorkflowGraphNode['kind'];
  workflowBodyKind?: 'inline_container' | 'external_ref';
  callableId?: string;
  codexExecutionMode?: CodexExecutionMode;
  staticInput?: Record<string, unknown>;
  sourceInput?: Record<string, unknown>;
  sourceInputMapping?: Record<string, unknown>;
  control?: WorkflowGraphNode['control'];
  outputSchema?: Record<string, unknown>;
  forwardMainOutputOnControl?: boolean | null;
  emptyInputPolicy?: EmptyInputPolicy;
  temporaryResourceId?: string;
  workflowRef?: string;
  directory: string;
  bindingPath?: string;
  relativeCwd?: string;
  status: WorkflowStatus;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  internalNodes: InternalNodeView[];
  internalEdges: WorkflowCanvasEdge[];
  position: { x: number; y: number };
  size: { width: number; height: number };
  warnings: string[];
};

export type WorkspaceCanvasModel = {
  id: string;
  name: string;
  layout?: 'workspace-canvas' | 'workflow-focus';
  focusedWorkflowId?: string;
  rootWorkflowId: string;
  exposedOutputs?: WorkflowPortView[];
  workflowOutputBindings?: NonNullable<WorkflowGraph['workflow_output_bindings']>;
  workflows: WorkflowContainerModel[];
  edges: WorkflowCanvasEdge[];
};

export type CanvasSelection =
  | { type: 'task_canvas'; taskId: string }
  | { type: 'workflow'; id: string }
  | { type: 'port'; workflowId: string; portId: string; direction: PortDirection }
  | { type: 'edge'; id: string; scopeWorkflowId?: string | null }
  | { type: 'internal'; workflowId: string; nodeId: string };

export type DataConnectionDraft = {
  scopeWorkflowId: string | null;
  sourceNodeId: string;
  sourceNodeLabel: string;
  sourcePortId: string;
  materialization: 'copy' | 'reference';
} | null;

export type SelectedDetailsKind =
  | 'canvas'
  | 'node'
  | 'workflow'
  | 'internal-node'
  | 'edge'
  | 'port'
  | 'empty';

export type SelectedDetailsPropertyGroup = {
  title: string;
  rows: Array<{ label: string; value: ReactNode }>;
};

export type SelectedDetailsEvidenceAction = {
  label: string;
  title: string;
  path?: string | null;
};

export type NodeLiveLogs = {
  stdout: string;
  stderr: string;
  stdoutOffset: number;
  stderrOffset: number;
};

export type WorkflowMainInputBindingState = {
  status: 'bound' | 'unbound';
  workflowId: string;
  nodeId: string;
  edgeId?: string;
  sourcePort: string;
  targetPort: string;
};

export type AgentNodeSettingsModel = {
  scopeLabel: string;
  nodeId: string;
  label: string;
  task: string;
  kind: 'Agent' | 'Tool';
  status: WorkflowStatus;
  callableId: string;
  codexExecutionMode?: CodexExecutionMode;
  temporaryResourceId?: string;
  input: Record<string, unknown>;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  outputSchema?: Record<string, unknown>;
  forwardMainOutputOnControl?: boolean | null;
  emptyInputPolicy?: EmptyInputPolicy;
  run?: NodeRunSummary;
  logs?: NodeLiveLogs;
  workflowMainInputBinding?: WorkflowMainInputBindingState;
  preview: Record<string, unknown>;
  raw: unknown;
};

export type AgentNodeConnectionEditor = {
  canvas: WorkspaceCanvasModel;
  canvasNodeKind: 'workflow' | 'internal';
  scopeWorkflowId: string | null;
  nodeId: string;
  nodeLabel: string;
  callableId: string;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  outputPortsReadonly?: boolean;
  dataConnectionDraft: DataConnectionDraft;
  onBeginDataConnection: (draft: Exclude<DataConnectionDraft, null>) => void;
  onCancelDataConnection: () => void;
  onUpdateDataConnectionMaterialization: (materialization: 'copy' | 'reference') => void;
  onCompleteDataConnection: (
    targetNodeId: string,
    targetPortId: string,
    options?: { replaceExisting?: boolean },
  ) => void;
  onCompleteDataConnectionWithNewInputPort: (targetNodeId: string, requestedPortId: string) => void;
  onAddPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    requestedPortId: string,
  ) => void;
  onRenamePort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
    requestedPortId: string,
  ) => void;
  onDeletePort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
  ) => void;
};

export type SelectedEntityDetailsModel = {
  key: string;
  kind: SelectedDetailsKind;
  title: string;
  subtitle?: string;
  status: WorkflowStatus | string;
  scopeLabel?: string;
  nodeRun?: NodeRunSummary;
  logs?: NodeLiveLogs;
  log: {
    stdout: string;
    stderr: string;
    excerpt: string;
    stdoutPath?: string | null;
    stderrPath?: string | null;
  };
  properties: SelectedDetailsPropertyGroup[];
  evidenceActions: SelectedDetailsEvidenceAction[];
  events: RunEvent[];
  nodeSettings?: AgentNodeSettingsModel;
};

export type TemporaryResourceDraftStatus = 'draft' | 'approved_for_canvas' | 'discarded';

export type TemporaryResourceDraft = {
  draft_id: string;
  kind: 'agent_template';
  status: TemporaryResourceDraftStatus;
  agent_draft: AgentClassDraft;
  referenced_by: string[];
};

export type WorkbenchAuthoringState = {
  temporaryResources: Record<string, TemporaryResourceDraft>;
};

export type CanvasAuthoringTarget =
  | { kind: 'task_canvas'; task_id: string }
  | { kind: 'workflow'; workflow_id: string }
  | { kind: 'internal_node'; workflow_id: string; node_id: string }
  | { kind: 'edge'; edge_id: string; scope_workflow_id: string | null }
  | { kind: 'port'; workflow_id: string; port_id: string; direction: PortDirection };

export type AuthoringContextSnapshot = {
  snapshot_id: string;
  task_id: string;
  target: CanvasAuthoringTarget;
  canvas: WorkspaceCanvasModel;
  canonical_graph: WorkflowGraph;
  selection: CanvasSelection;
  callable_catalog: CallableSummary[];
  workflow_catalog: WorkflowSummary[];
};

export type CanvasAuthoringOperation =
  | {
      op: 'add_existing_callable_node';
      scope_workflow_id: string | null;
      node_id: string;
      callable_id: string;
      callable_kind: 'agent_class' | 'tool_class';
      label: string;
      position: { x: number; y: number };
      input?: Record<string, unknown>;
      input_ports?: WorkflowPortView[];
      output_ports?: WorkflowPortView[];
      output_schema?: Record<string, unknown>;
    }
  | {
      op: 'add_workflow_container';
      scope_workflow_id: null;
      node_id: string;
      label: string;
      workflow_ref?: string;
      position: { x: number; y: number };
    }
  | {
      op: 'update_invocation_input';
      scope_workflow_id: string | null;
      node_id: string;
      input: Record<string, unknown>;
    }
  | {
      op: 'update_invocation_label';
      scope_workflow_id: string | null;
      node_id: string;
      label: string;
    }
  | {
      op: 'update_output_schema';
      scope_workflow_id: string | null;
      node_id: string;
      output_schema: Record<string, unknown>;
    }
  | {
      op: 'set_ports';
      scope_workflow_id: string | null;
      node_id: string;
      input_ports?: WorkflowPortView[];
      output_ports?: WorkflowPortView[];
    }
  | {
      op: 'add_control_edge';
      scope_workflow_id: string | null;
      from: string;
      to: string;
    }
  | {
      op: 'add_data_edge';
      scope_workflow_id: string | null;
      from: { node: string; port: string };
      to: { node: string; port: string };
      materialization: 'copy' | 'reference';
      replace_existing?: boolean;
    }
  | {
      op: 'remove_edge';
      scope_workflow_id: string | null;
      edge_id: string;
    }
  | {
      op: 'create_temporary_agent_template';
      scope_workflow_id: string | null;
      draft_id: string;
      node_id: string;
      label: string;
      position: { x: number; y: number };
      agent_draft: AgentClassDraft;
      input?: Record<string, unknown>;
      output_schema?: Record<string, unknown>;
    }
  | {
      op: 'replace_temporary_template_with_existing_callable';
      scope_workflow_id: string | null;
      node_id: string;
      temporary_resource_id: string;
      callable_id: string;
      callable_kind: 'agent_class' | 'tool_class';
    };

export type CanvasAuthoringProposal = {
  proposal_id: string;
  base_task_id: string;
  base_canvas_hash: string;
  target: CanvasAuthoringTarget;
  rationale: string;
  operations: CanvasAuthoringOperation[];
};

export type CanvasAuthoringValidationResult = {
  status: 'valid' | 'invalid';
  errors: string[];
  warnings: string[];
};

export type CanvasAuthoringApplyResult = {
  canvas: WorkspaceCanvasModel;
  temporaryResources: Record<string, TemporaryResourceDraft>;
  selection: CanvasSelection;
  messages: string[];
};

export type AssistantChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  turnId?: string;
  createdAt?: string;
};

export type AssistantTurnReason = 'workbench_chat' | 'canvas_revision' | 'selected_node_revision';

export type AssistantGraphOpsReview = {
  resourceDraftId: string;
  callableId: string;
  proposal: GraphOpsTransactionProposal;
  validation: Record<string, unknown>;
  dryRun: GraphOpsDryRunPayload;
};

export type WorkbenchChromeState = {
  leftPanel: 'none' | 'tasks' | 'resources';
  rightPanel: 'none' | 'inspector' | 'resourceDetail' | 'runEvidence' | 'assistant';
  inspectorWidth: number;
};

export type WorkbenchTask = {
  taskId: string;
  title: string;
  canvas: WorkspaceCanvasModel;
  authoring?: WorkbenchAuthoringState;
  savedWorkflowRef?: string;
  status: Extract<
    WorkflowStatus,
    'not_run' | 'queued' | 'running' | 'success' | 'failed' | 'cancel_requested' | 'cancelled' | 'crashed'
  >;
  activeRunId?: string;
  latestRunId?: string;
};

export type WorkbenchTaskSummary = Pick<
  WorkbenchTask,
  'taskId' | 'title' | 'status' | 'activeRunId' | 'latestRunId'
>;

export type WorkbenchTaskStorePayload = {
  version: 1;
  activeTaskId: string;
  tasks: WorkbenchTask[];
};

export type RunOverlayProjection = {
  runId: string;
  scope: 'task' | 'workflow' | 'node';
  targetId?: string;
  status: WorkflowStatus;
  nodeStatusById: Record<string, WorkflowStatus>;
  workflowStatusById: Record<string, WorkflowStatus>;
  run?: WorkflowRunResult | null;
};

export type RunProjection = {
  runId: string;
  taskId: string;
  status: WorkflowStatus;
  scope: RunOverlayProjection['scope'];
  targetId: string;
  graph: WorkflowGraph;
  runDir: string;
  summary?: RunSummary;
  run: WorkflowRunResult | null;
  events: RunEvent[];
  overlay: RunOverlayProjection | null;
  pollState: 'idle' | 'polling' | 'error';
};

export type RunProjectionSlim = {
  runId: string;
  taskId: string;
  status: WorkflowStatus;
  pollState: 'idle' | 'polling' | 'error';
};

export type AssistantApplyUndoToken = {
  proposalId: string;
  taskId: string;
  beforeCanvas: WorkspaceCanvasModel;
  beforeTemporaryResources: Record<string, TemporaryResourceDraft>;
  beforeSelection: CanvasSelection;
  afterCanvasHash: string;
  affectedSelection: CanvasSelection;
};

export type WorkflowBindingLookup = Record<string, WorkflowBindingView>;
