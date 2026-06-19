import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap as ReactFlowMiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ChevronDown,
  ChevronUp,
  CircleDot,
  Database,
  FileText,
  FolderCog,
  GitBranch,
  LayoutDashboard,
  Link2,
  Bot,
  Play,
  RefreshCw,
  Save,
  TestTube,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import {
  Fragment,
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
  type TouchEvent as ReactTouchEvent,
} from 'react';

import { api, runnerApi } from '../api';
import { shortPath, statusTone } from '../format';
import type {
  AgentMessage,
  AgentSessionRecord,
  AgentTurnRecord,
  ArtifactContent,
  AuthoringAgentSummary,
  AuthoringRequiredAction,
  AuthoringValidation,
  CallableDetail,
  CallableSummary,
  GraphOpsDryRunPayload,
  GraphOpsTransactionProposal,
  InteractionRequest,
  NodeLogDelta,
  NodeRunSummary,
  RunEvent,
  RuntimeConfig,
  RunSummary,
  WorkbenchLiveEvent,
  BoundaryTransferPreview,
  WorkflowDataEdge,
  WorkflowBindingView,
  WorkflowDirectorySelection,
  WorkflowDetail,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowPort,
  WorkflowRunResult,
  WorkflowSummary,
} from '../types';
import {
  AGENT_CONTROL_HANDLE_FALLBACK_TOP,
  AGENT_CONTROL_HANDLE_TOP,
  AGENT_DATA_PORT_GAP,
  AGENT_MAX_DATA_PORTS,
  AGENT_PORT_VERTICAL_PADDING,
  AGENT_TOOL_NODE_SIZE,
  BOUNDARY_NODE_SIZE,
  DEFAULT_CONTAINER_SIZE,
  DEFAULT_TASK_ID,
  DEFAULT_WORKFLOW_MAX_CONCURRENCY,
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  INTERNAL_AGENT_TOOL_NODE_SIZE,
  MAX_LOG_PREVIEW_LINES,
  TASK_STORE_KEY,
  TEMPORARY_CALLABLE_ID_PREFIX,
  WORKFLOW_CONTAINER_Z_INDEX,
  WORKFLOW_INNER_HANDLE_X,
  WORKFLOW_INTERNAL_NODE_Z_INDEX,
  WORKFLOW_INTERNAL_SELECTED_NODE_Z_INDEX,
  agentDataPortMaxOffset,
  agentDataPortTop,
} from '../workbench/constants';
import {
  createEmptyTask,
  defaultTaskStorePayload,
  emptyInputPolicyFromMetadata,
  emptyWorkbenchAuthoringState,
  emptyWorkspaceCanvas,
  isActiveRunStatus,
  isActiveTaskStatus,
  nextTaskTitle,
  normalizeTaskRunStatus,
  normalizeWorkbenchAuthoringState,
  normalizedCodexExecutionMode,
  taskStatusFromRunStatus,
  taskStorePayloadFromSerialized,
} from '../workbench/model/taskModel';
import {
  addPortToDataConnectNode,
  canvasEdgesAreEquivalent,
  connectionCandidatesFromPendingEndpoint,
  connectionFromPendingEndpoint,
  controlSlotLimitIssue,
  controlSourceTokenId,
  controlTargetTokenId,
  createDataEdgeCommand,
  dataConnectEdges,
  dataConnectNodes,
  dataEdgesForNode,
  describeEndpoint,
  deletePortFromDataConnectNode,
  edgeDiagnosticsForCanvasEdge,
  edgeDiagnosticsForWorkflowEdge,
  endpointCanSource,
  findDataConnectNode,
  isWorkflowBoundaryEdge,
  isWorkflowInputBoundaryControlBinding,
  isWorkflowOutputBoundaryControlBinding,
  parsePortToken,
  portTokenId,
  renamePortOnDataConnectNode,
  resolveScopedConnection,
  reverseConnection,
  tryCommitResolvedConnection,
  uniqueCanvasEdges,
  uniqueInputPortIdForNode,
  workflowInputInnerSourceTokenId,
  workflowInputOuterTargetTokenId,
  workflowIdForBoundaryMainBinding,
  workflowOutputInnerTargetTokenId,
  workflowOutputOuterSourceTokenId,
  wouldCreateControlCycle,
  type ConnectionEndpoint,
  type ConnectionResolution,
  type DataConnectNodeOption,
  type DataEdgeCommandRequest,
  type DataEdgeCommandResult,
  type EdgeDiagnostic,
  type EndpointDescriptor,
  type EndpointSide,
  type PendingCanvasConnection,
} from '../workbench/model/canvasEdgeOps';
import {
  clamp,
  defaultInternalNodePosition,
  expandWorkflowToFitChildren,
  expandWorkflowToFitChildrenCenterLocked,
  finiteNumber,
  finitePosition,
  layoutCanvasForSelection,
  layoutWorkflowInternalNodes,
  layoutWorkspaceCanvas,
  nextRootPalettePosition,
} from '../workbench/model/canvasLayout';
import {
  deleteSelectionFromCanvas,
  edgeAddressForScope,
  edgeTouchesNode,
  findCanvasEdgeByAddress,
  internalInvocationLabel,
  isActiveCanvasObjectStatus,
  isExecutableNodeWorkflow,
  normalizeSelectionIntent,
  normalizeWorkbenchSelection,
  promptFromInvocationInput,
  selectionCanBeDeleted,
  selectionEdgeAddress,
  selectionForEdgeAddress,
  selectionMatchesEdge,
  shouldDisconnectEdgeOnClick,
  staticInputFromInvocationInput,
  type SelectionIntent,
  workflowInvocationLabel,
} from '../workbench/model/selectionModel';
import {
  bindingDirectory,
  boundaryInputMainConflictMessage,
  boundaryMainBindingLabel,
  combinedLogText,
  controlEdgeMainTransferMode,
  effectiveNodeRunDir,
  latestLogExcerpt,
  nodeLiveLogsFor,
  nodeRunForInternalNode,
  nodeRunForWorkflow,
  normalizeRunDirKey,
  selectedNodeRunForSelection,
  sameRunDir,
  selectedEntityDetailsModel,
  selectedNodeSettingsModel,
  statusLabel,
  uniqueStrings,
  workflowMainInputBindingState,
  workspaceRootOf,
  type NodeRunLookupContext,
} from '../workbench/model/selectedNodeModel';
import {
  graphToWorkspaceCanvas,
} from '../workbench/model/canvasProjection';
import type {
  AgentNodeSettingsModel,
  AssistantApplyUndoToken,
  AssistantChatMessage,
  AssistantGraphOpsReview,
  AssistantTurnReason,
  AuthoringContextSnapshot,
  BoundaryTransfer,
  BoundaryTransferMapping,
  BottomDockMode,
  CanvasAuthoringApplyResult,
  CanvasAuthoringOperation,
  CanvasAuthoringProposal,
  CanvasAuthoringTarget,
  CanvasAuthoringValidationResult,
  CanvasSelection,
  CodexExecutionMode,
  ConnectionMode,
  EdgeViewMode,
  EmptyInputPolicy,
  InternalNodeView,
  NodeLiveLogs,
  PortDirection,
  RunProjection,
  SelectedDetailsEvidenceAction,
  SelectedDetailsPropertyGroup,
  SelectedEntityDetailsModel,
  TaskWorkspaceView,
  TemporaryResourceDraft,
  TemporaryResourceDraftStatus,
  WorkbenchAuthoringState,
  WorkbenchChromeState,
  WorkbenchTask,
  WorkbenchTaskStorePayload,
  WorkflowCanvasEdge,
  WorkflowContainerModel,
  WorkflowMainInputBindingState,
  WorkflowPortView,
  WorkflowStatus,
  WorkspaceCanvasModel,
} from '../types/workbench';
import { CodeBlock } from './CodeBlock';
import {
  boundaryTransferFromGraphEdge,
  boundaryTransferPreviewHasErrors,
  boundaryTransferToGraphMetadata,
  unavailableBoundaryTransferPreview,
} from './canvas/boundaryTransfer';
import {
  buildAccTranscript,
  type AccTranscriptEntry,
  type LiveOutputFilter,
} from '../lib/runTranscript';
import {
  boundedLiveEvents,
  liveEventFromAgentRunEvent,
  liveStateForNodeRun,
  useWorkbenchLiveStream,
  type WorkbenchLiveStreamScope,
  type WorkbenchLiveStreamState,
} from '../hooks/useWorkbenchLiveStream';
import { useBoundaryTransferPreview } from '../hooks/useBoundaryTransferPreview';
import {
  outputSchemaFromArtifactContract,
  paletteItemFromCallable,
  parsePaletteItem,
  workflowPortsFromPortContracts,
  type PaletteItem,
} from './workflow-viewer/palette';
import {
  effectiveOutputPortsForNode,
  hasProjectedOutputPorts,
  isSchemaDerivedOutputPort,
  outputPortTooltip,
  outputPortsFromSchema,
  schemaDerivedOutputFields,
} from '../workbench/model/schemaPorts';
import {
  boundaryPort,
  canvasToWorkflowGraph,
  edgeCanonicalPreview,
  graphForCurrentView,
  internalNodeInputPorts,
  internalNodeInvocationPreview,
  internalNodeOutputPorts,
  internalNodeToGraphNode,
  internalWorkflowToGraph,
  isInlineWorkflowContainer,
  port,
  workflowInvocationPreview,
  workflowOutputPorts,
  workflowOutputPortsReadonly,
} from '../workbench/model/workflowGraphProjection';
import {
  edgeAddressFromFlowEdgeId,
  type EdgeAddress,
} from './workflow-viewer/workflowConnectionState';
import {
  canvasEdgeToFlowEdge,
  toFlowEdges,
} from './canvas/flowProjection';
import {
  flowEndpointForCanvas,
  internalFlowNodeId,
  isWorkflowBoundaryId,
  parseInternalFlowNodeId,
  workflowBoundaryKind,
  workflowInputBoundaryId,
  workflowIdFromBoundaryId,
  workflowOutputBoundaryId,
  type FlowEndpoint,
} from '../workbench/model/workflowNodeModel';
import {
  applyRunOverlayToCanvas,
  liveWorkflowRunFromEvents,
  mergeWorkflowRunWithEvents,
  runOverlayFromRun,
  stripRuntimeStateFromCanvas,
  stripRuntimeStateFromWorkflow,
  workflowRunFailureText,
  type RunOverlayState,
} from './workflow-viewer/runState';

// --- Extracted modules (Feature 01b) ---
import {
  AssistantDrawer as AssistantDrawerExtracted,
  AssistantDockContent as AssistantDockContentExtracted,
  AssistantControlRail as AssistantControlRailExtracted,
  AssistantProposalSummary as AssistantProposalSummaryExtracted,
  SelectedNodeRuntimePane as SelectedNodeRuntimePaneExtracted,
} from './assistant';
import { AssistantTurnList as AssistantTurnListExtracted } from './assistant/AssistantTurnList';
import {
  ExecutionDock as ExecutionDockExtracted,
} from './execution';
import { LiveOutputViewer as LiveOutputViewerExtracted } from './execution/RunOverlay';
import {
  NodeDetailOverlay as NodeDetailOverlayExtracted,
} from './inspector/NodeDetailOverlay';
import {
  SelectionDetailsDock as SelectionDetailsDockExtracted,
  evidenceContentForCurrentSelection,
} from './inspector/SelectionDetailsDock';
import { useAssistantTurnStream } from '../hooks/useAssistantStream';
import { useRunStream } from '../hooks/useRunStream';

type Props = {
  workflows: WorkflowSummary[];
  callables: CallableSummary[];
  resourceErrors?: {
    callables?: string;
    workflows?: string;
  };
  selectedWorkflowId: string;
  onSelect: (workflowId: string) => void;
  onChanged?: () => void;
};

const DEMO_ANALYST_AGENT_ID = 'stock-research-analyst.codex';
const DEMO_SYNTHESIS_AGENT_ID = 'stock-research-synthesis.codex';
const DEMO_REPORT_AGENT_ID = 'stock-report-writer.codex';
const DEMO_REVIEW_AGENT_ID = 'stock-publication-reviewer.codex';
const DEMO_DATA_AGENT_ID = 'stock-data-collector.codex';

type PaletteDropTarget =
  | { kind: 'root_canvas'; position: { x: number; y: number } }
  | { kind: 'workflow_internal'; workflowId: string; position: { x: number; y: number } }
  | { kind: 'rejected'; reason: string };

type DataDropTargetPreview = {
  flowNodeId: string;
  portId: string;
};

type ConnectPreviewState = {
  start: { x: number; y: number };
  end: { x: number; y: number };
  snapped?: boolean;
};

type NodeCreateMenuState = {
  x: number;
  y: number;
  position: { x: number; y: number };
  pendingConnection?: PendingCanvasConnection;
} | null;

type CanvasInteractionCommand =
  | { type: 'select'; intent: SelectionIntent }
  | { type: 'port-click'; workflowId: string; portId: string; direction: PortDirection }
  | { type: 'edge-click'; address: EdgeAddress; altKey: boolean }
  | { type: 'blank-pane-click' };

type DataConnectionDraft = {
  scopeWorkflowId: string | null;
  sourceNodeId: string;
  sourceNodeLabel: string;
  sourcePortId: string;
  materialization: 'copy' | 'reference';
} | null;

type BodyDropDataEdgePlan = {
  canvasWithTargetPort: WorkspaceCanvasModel;
  request: DataEdgeCommandRequest;
  targetPortId: string;
  createdTargetPort: boolean;
};

type DomConnectionEndpoint = ConnectionEndpoint;

type ConnectionTraceEvent = {
  event: string;
  detail: Record<string, unknown>;
  timestamp: number;
};

type EvidenceDockState = {
  open: boolean;
  title: string;
  content: ArtifactContent | null;
  owner?: {
    kind: 'validation' | 'run' | 'node' | 'artifact';
    taskId?: string;
    runId?: string;
    nodeId?: string;
    createdAt?: string;
  };
};

type AgentSessionUiState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  session: AgentSessionRecord | null;
  messages: AgentMessage[];
  events: RunEvent[];
  pendingTurn: AgentTurnRecord | null;
  interactions: InteractionRequest[];
  error: string;
};

type SaveWorkflowDialogState = {
  name: string;
  saving: boolean;
  error: string | null;
};

type AssistantProcessEvent = {
  id: string;
  label: string;
  detail?: string;
  createdAt?: string;
};

type AssistantTranscriptItem =
  | { kind: 'user_message'; id: string; content: string; turnId?: string; createdAt?: string }
  | { kind: 'assistant_message'; id: string; content: string; turnId?: string; createdAt?: string }
  | { kind: 'assistant_stream'; id: string; turnId: string; content: string; status: string }
  | { kind: 'status'; id: string; label: string; detail?: string; createdAt?: string }
  | { kind: 'tool_event'; id: string; label: string; detail?: string; createdAt?: string }
  | {
      kind: 'process_group';
      id: string;
      turnId: string;
      label: string;
      events: AssistantProcessEvent[];
      createdAt?: string;
      defaultOpen?: boolean;
    }
  | { kind: 'proposal'; id: string; proposalId?: string; status: 'draft' | 'valid' | 'invalid' }
  | { kind: 'graphops_review'; id: string; status: 'ready' | 'blocked' }
  | { kind: 'result_block'; id: string; createdAt?: string }
  | { kind: 'error'; id: string; content: string; detail?: string; createdAt?: string };

type AssistantDisplayStatus = {
  label: string;
  tone: string;
  connecting: boolean;
  runningTurn: boolean;
  lastFailed: boolean;
  submissionBlocked: boolean;
};

type ResourceTemplate =
  | { kind: 'workflow_class'; workflowId: string; path: string; name: string }
  | { kind: 'agent_class'; callableId: string; name: string }
  | { kind: 'tool_class'; callableId: string; name: string };

type WorkbenchViewProjection = {
  blueprintActive: boolean;
  rightPanelVisible: boolean;
  resourceDetailOpen: boolean;
  inspectorOpen: boolean;
  assistantOpen: boolean;
  detailsOpen: boolean;
};

type WorkflowNodeData = {
  workflow: WorkflowContainerModel;
  binding?: WorkflowBindingView;
  selection: CanvasSelection;
  connectionMode: ConnectionMode;
  edgeViewMode: EdgeViewMode;
  selected: boolean;
  dataDropHint?: string;
  showDataPorts: boolean;
  showDataPortLabels?: boolean;
  onSelectEdge: (address: EdgeAddress, altKey?: boolean) => void;
  onSelectPort: (workflowId: string, port: WorkflowPortView) => void;
  onSelectInternal: (workflowId: string, nodeId: string) => void;
  onOpenNodeDetails: (selection: CanvasSelection) => void;
  onOpenFocus: (workflowId: string) => void;
  onConfigureWorkflow: (workflowId: string) => void;
  onResize: (workflowId: string, size: { width: number; height: number }) => void;
  onMoveInternal: (
    workflowId: string,
    nodeId: string,
    position: { x: number; y: number },
  ) => void;
  onControlHandleMouseDown: (
    nodeId: string,
    handleId: string,
    side: EndpointSide,
    mode?: ConnectionMode,
  ) => void;
};

type AgentToolNodeData = {
  id: string;
  title: string;
  subtitle?: string;
  scopeLabel?: string;
  kind: 'Agent' | 'Tool';
  status: WorkflowStatus;
  callableId?: string;
  temporaryResourceId?: string;
  workflowId?: string;
  internalNodeId?: string;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  size: { width: number; height: number };
  selected: boolean;
  dataDropHint?: string;
  showDataPorts: boolean;
  showDataPortLabels?: boolean;
  onSelect: () => void;
  onSelectPort: (workflowId: string, port: WorkflowPortView) => void;
  onControlHandleMouseDown: (
    nodeId: string,
    handleId: string,
    side: EndpointSide,
    mode?: ConnectionMode,
  ) => void;
};

type WorkflowFlowNode = Node<WorkflowNodeData, 'workflowContainer'>;
type AgentToolFlowNode = Node<AgentToolNodeData, 'agentToolNode'>;
type CanvasFlowNode = WorkflowFlowNode | AgentToolFlowNode;
const FlowNodeLayoutContext = createContext<CanvasFlowNode[]>([]);

const nodeTypes = { workflowContainer: memo(WorkflowContainer), agentToolNode: memo(AgentToolNode) };

type CanvasPointerEvent =
  | PointerEvent
  | MouseEvent
  | TouchEvent
  | ReactPointerEvent<Element>
  | ReactMouseEvent<Element>
  | ReactTouchEvent<Element>;

function visibleAgentDataPorts(ports: WorkflowPortView[]): WorkflowPortView[] {
  return ports.slice(0, AGENT_MAX_DATA_PORTS);
}

function trimLiveLog(value: string): string {
  const lines = value.split(/\r?\n/);
  if (lines.length <= MAX_LOG_PREVIEW_LINES) {
    return value;
  }
  return lines.slice(-MAX_LOG_PREVIEW_LINES).join('\n');
}

function isTemporaryCallableId(callableId: string | null | undefined): boolean {
  return Boolean(callableId && callableId.startsWith(TEMPORARY_CALLABLE_ID_PREFIX));
}

function authoringId(prefix: string): string {
  const randomId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '_')
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomId}`;
}

function graphOpsProposalId(prefix = 'graphops_tx'): string {
  return authoringId(prefix).replace(/[^A-Za-z0-9_.-]/g, '_');
}

function persistentCallableIdForDraft(draft: TemporaryResourceDraft): string {
  const requestedId = draft.agent_draft.id || draft.draft_id.replace(/^tmp_agent_/, 'agent_');
  const safeId = requestedId
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safeId || draft.draft_id.replace(/^tmp_agent_/, 'agent');
}

function graphOpsTransactionForTemporaryAgent(
  draft: TemporaryResourceDraft,
): GraphOpsTransactionProposal {
  const callableId = persistentCallableIdForDraft(draft);
  const targetPath = `callables/agents/${callableId}.yaml`;
  return {
    schema_version: 'acc.graphops.transaction.v1',
    proposal_id: graphOpsProposalId('graphops_tx_tmp_agent'),
    author: 'workbench_ai_assistant',
    source: {
      kind: 'workbench_temporary_resource',
      id: draft.draft_id,
    },
    base: {
      content_hashes: {
        [targetPath]: 'absent',
      },
    },
    rationale: `Persist temporary agent template ${draft.draft_id}.`,
    targets: [
      {
        target_type: 'agent_class',
        target_path: targetPath,
        operation: 'create_agent_class',
        template: {
          ...draft.agent_draft,
          id: callableId,
        },
      },
    ],
  };
}

function captureAuthoringSnapshot({
  taskId,
  canvas,
  selection,
  callables,
  workflows,
}: {
  taskId: string;
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  callables: CallableSummary[];
  workflows: WorkflowSummary[];
}): AuthoringContextSnapshot {
  const strippedCanvas = stripRuntimeStateFromCanvas(canvas);
  return {
    snapshot_id: canvasAuthoringHash(taskId, strippedCanvas),
    task_id: taskId,
    target: authoringTargetFromSelection(selection, taskId),
    canvas: strippedCanvas,
    canonical_graph: canvasToWorkflowGraph(strippedCanvas),
    selection,
    callable_catalog: callables,
    workflow_catalog: workflows,
  };
}

function boundaryTransferPreviewSnapshot(canvas: WorkspaceCanvasModel): Record<string, unknown> {
  const strippedCanvas = stripRuntimeStateFromCanvas(canvas);
  return {
    ...strippedCanvas,
    canonical_graph: canvasToWorkflowGraph(strippedCanvas),
  };
}

function canvasAuthoringHash(taskId: string, canvas: WorkspaceCanvasModel): string {
  return `canvas_hash_v1:${hashString(stableJsonStringify({ taskId, canvas }))}`;
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function authoringTargetFromSelection(
  selection: CanvasSelection,
  taskId: string,
): CanvasAuthoringTarget {
  if (selection.type === 'workflow') {
    return { kind: 'workflow', workflow_id: selection.id };
  }
  if (selection.type === 'internal') {
    return {
      kind: 'internal_node',
      workflow_id: selection.workflowId,
      node_id: selection.nodeId,
    };
  }
  if (selection.type === 'edge') {
    return {
      kind: 'edge',
      edge_id: selection.id,
      scope_workflow_id: selection.scopeWorkflowId || null,
    };
  }
  if (selection.type === 'port') {
    return {
      kind: 'port',
      workflow_id: selection.workflowId,
      port_id: selection.portId,
      direction: selection.direction,
    };
  }
  return { kind: 'task_canvas', task_id: selection.taskId || taskId };
}

function buildDeterministicCanvasAuthoringProposal({
  message,
  snapshot,
}: {
  message: string;
  snapshot: AuthoringContextSnapshot;
}): { proposal: CanvasAuthoringProposal | null; errors: string[]; warnings: string[] } {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return { proposal: null, errors: ['请输入需求描述。'], warnings: [] };
  }
  const proposalId = authoringId('canvas_proposal');
  if (wantsTemporaryAgentTemplate(trimmedMessage)) {
    return {
      proposal: {
        proposal_id: proposalId,
        base_task_id: snapshot.task_id,
        base_canvas_hash: snapshot.snapshot_id,
        target: snapshot.target,
        rationale: 'Draft a temporary agent template on the current canvas only.',
        operations: [temporaryAgentTemplateOperation(trimmedMessage, snapshot.canvas)],
      },
      errors: [],
      warnings: ['临时 agent template 只能应用到当前 task canvas，不能 run/save。'],
    };
  }

  const selectedNode = selectedAuthoringNode(snapshot.canvas, snapshot.selection);
  if (selectedNode) {
    return {
      proposal: {
        proposal_id: proposalId,
        base_task_id: snapshot.task_id,
        base_canvas_hash: snapshot.snapshot_id,
        target: snapshot.target,
        rationale: 'Adjust the selected invocation input and output schema.',
        operations: [
          {
            op: 'update_invocation_input',
            scope_workflow_id: selectedNode.scopeWorkflowId,
            node_id: selectedNode.nodeId,
            input: { ...selectedNode.input, user_prompt: trimmedMessage },
          },
          {
            op: 'update_output_schema',
            scope_workflow_id: selectedNode.scopeWorkflowId,
            node_id: selectedNode.nodeId,
            output_schema: genericOutputSchema(trimmedMessage),
          },
        ],
      },
      errors: [],
      warnings: [],
    };
  }

  return taskCanvasSkeletonProposal(trimmedMessage, snapshot, proposalId);
}

function wantsTemporaryAgentTemplate(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes('new agent') ||
    lowered.includes('agent template') ||
    lowered.includes('create agent') ||
    lowered.includes('temporary agent') ||
    /(?:新建|创建|临时).*(?:agent|智能体)/u.test(message) ||
    /(?:agent|智能体).*模板/u.test(message)
  );
}

function selectedAuthoringNode(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
): { scopeWorkflowId: string | null; nodeId: string; input: Record<string, unknown> } | null {
  if (selection.type === 'workflow') {
    const workflow = canvas.workflows.find((item) => item.id === selection.id);
    if (workflow && isExecutableNodeWorkflow(workflow)) {
      return {
        scopeWorkflowId: null,
        nodeId: workflow.id,
        input: workflow.sourceInput || {},
      };
    }
  }
  if (selection.type === 'internal') {
    const workflow = canvas.workflows.find((item) => item.id === selection.workflowId);
    const node = workflow?.internalNodes.find((item) => item.id === selection.nodeId);
    if (node) {
      return {
        scopeWorkflowId: workflow?.id || null,
        nodeId: node.id,
        input: node.input || {},
      };
    }
  }
  return null;
}

function effectiveAssistantTurnReason(
  requestedReason: AssistantTurnReason,
  selection: CanvasSelection,
): AssistantTurnReason {
  if (requestedReason === 'workbench_chat') {
    return 'workbench_chat';
  }
  return isInspectableNodeSelection(selection) ? 'selected_node_revision' : 'canvas_revision';
}

function taskCanvasSkeletonProposal(
  message: string,
  snapshot: AuthoringContextSnapshot,
  proposalId: string,
): { proposal: CanvasAuthoringProposal | null; errors: string[]; warnings: string[] } {
  const callableItems = snapshot.callable_catalog
    .filter((callable) => callable.kind === 'agent_class' || callable.kind === 'tool_class')
    .slice(0, 2);
  if (!callableItems.length) {
    return { proposal: null, errors: ['当前资源库没有可用 agent/tool callable。'], warnings: [] };
  }

  const existingIds = new Set(snapshot.canvas.workflows.map((workflow) => workflow.id));
  const operations: CanvasAuthoringOperation[] = [];
  callableItems.forEach((callable, index) => {
    const item = paletteItemFromCallable(callable);
    const nodeId = uniqueId(paletteItemBaseId(item), existingIds);
    existingIds.add(nodeId);
    operations.push({
      op: 'add_existing_callable_node',
      scope_workflow_id: null,
      node_id: nodeId,
      callable_id: callable.id,
      callable_kind: callable.kind === 'tool_class' ? 'tool_class' : 'agent_class',
      label: callable.name || callable.id,
      position: nextAuthoringRootPosition(snapshot.canvas, index),
      input: {
        user_prompt:
          index === 0
            ? message
            : `Review and synthesize the upstream result for this request: ${message}`,
      },
      input_ports: workflowPortsFromPortContracts(callable.input_ports, 'input'),
      output_ports: workflowPortsFromPortContracts(callable.output_ports, 'output'),
      output_schema: outputSchemaFromArtifactContract(callable.artifact_contract) || genericOutputSchema(message),
    });
  });
  if (callableItems.length >= 2) {
    operations.push({
      op: 'add_control_edge',
      scope_workflow_id: null,
      from: (operations[0] as Extract<CanvasAuthoringOperation, { op: 'add_existing_callable_node' }>).node_id,
      to: (operations[1] as Extract<CanvasAuthoringOperation, { op: 'add_existing_callable_node' }>).node_id,
    });
  }

  return {
    proposal: {
      proposal_id: proposalId,
      base_task_id: snapshot.task_id,
      base_canvas_hash: snapshot.snapshot_id,
      target: snapshot.target,
      rationale: 'Create a canvas-local workflow draft from existing callable templates.',
      operations,
    },
    errors: [],
    warnings: callableItems.length < 2 ? ['只有一个可用 callable，已生成单节点草稿。'] : [],
  };
}

function temporaryAgentTemplateOperation(
  message: string,
  canvas: WorkspaceCanvasModel,
): Extract<CanvasAuthoringOperation, { op: 'create_temporary_agent_template' }> {
  const draftId = authoringId(TEMPORARY_CALLABLE_ID_PREFIX.slice(0, -1));
  const nodeId = uniqueId(draftId, new Set(canvas.workflows.map((workflow) => workflow.id)));
  const outputSchema = genericOutputSchema(message);
  return {
    op: 'create_temporary_agent_template',
    scope_workflow_id: null,
    draft_id: draftId,
    node_id: nodeId,
    label: 'Temporary Agent',
    position: nextAuthoringRootPosition(canvas, 0),
    input: { user_prompt: message },
    output_schema: outputSchema,
    agent_draft: {
      id: draftId,
      version: '0.1.0',
      runtime: 'codex_cli',
      name: 'Temporary Agent',
      description: 'Canvas-local draft generated by the Phase 1 assistant.',
      default_prompt: message,
      input_ports: { main: { type: 'artifact', required: false } },
      output_ports: { main: { type: 'artifact', required: true } },
      artifact_contract: { output_schema: outputSchema },
      metadata: {
        temporary: true,
        generated_by: 'workbench_authoring_phase_1',
      },
    },
  };
}

function genericOutputSchema(message: string): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      summary: { type: 'string', description: `Result for: ${message.slice(0, 120)}` },
      artifacts: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['summary'],
  };
}

function nextAuthoringRootPosition(
  canvas: WorkspaceCanvasModel,
  index: number,
): { x: number; y: number } {
  if (!canvas.workflows.length) {
    return { x: 120 + index * 420, y: 180 };
  }
  const maxX = Math.max(...canvas.workflows.map((workflow) => workflow.position.x));
  return { x: maxX + 420 + index * 420, y: 180 };
}

function validateCanvasAuthoringProposal(
  proposal: CanvasAuthoringProposal,
  context: {
    canvas: WorkspaceCanvasModel;
    taskId: string;
    temporaryResources: Record<string, TemporaryResourceDraft>;
    callables: CallableSummary[];
    workflows: WorkflowSummary[];
  },
): CanvasAuthoringValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (proposal.base_task_id !== context.taskId) {
    errors.push('Proposal 属于另一个 task，不能应用到当前画布。');
  }
  const currentHash = canvasAuthoringHash(context.taskId, stripRuntimeStateFromCanvas(context.canvas));
  if (proposal.base_canvas_hash !== currentHash) {
    errors.push('画布已变化，proposal 已过期。');
  }
  const allowedOps = new Set<CanvasAuthoringOperation['op']>([
    'add_existing_callable_node',
    'add_workflow_container',
    'update_invocation_input',
    'update_invocation_label',
    'update_output_schema',
    'set_ports',
    'add_control_edge',
    'add_data_edge',
    'remove_edge',
    'create_temporary_agent_template',
    'replace_temporary_template_with_existing_callable',
  ]);
  for (const operation of proposal.operations) {
    if (!allowedOps.has(operation.op)) {
      errors.push(`Unsupported authoring operation: ${(operation as { op?: string }).op || '<unknown>'}`);
    }
  }
  errors.push(...authoringOperationContractIssues(proposal, context));
  if (!errors.length) {
    try {
      applyCanvasAuthoringOperations({
        canvas: context.canvas,
        proposal,
        temporaryResources: context.temporaryResources,
        callables: context.callables,
        workflows: context.workflows,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { status: errors.length ? 'invalid' : 'valid', errors, warnings };
}

function mergeAuthoringValidation(
  localValidation: CanvasAuthoringValidationResult | null,
  backendValidation: CanvasAuthoringValidationResult | null,
): CanvasAuthoringValidationResult | null {
  if (!localValidation && !backendValidation) {
    return null;
  }
  const errors = [
    ...(backendValidation?.errors || []),
    ...(localValidation?.errors || []).filter(
      (error) => !(backendValidation?.errors || []).includes(error),
    ),
  ];
  const warnings = [
    ...(backendValidation?.warnings || []),
    ...(localValidation?.warnings || []).filter(
      (warning) => !(backendValidation?.warnings || []).includes(warning),
    ),
  ];
  return {
    status:
      backendValidation?.status === 'invalid' || localValidation?.status === 'invalid'
        ? 'invalid'
        : 'valid',
    errors,
    warnings,
  };
}

function authoringValidationFromBackend(
  validation: AuthoringValidation | null | undefined,
): CanvasAuthoringValidationResult | null {
  if (!validation) {
    return null;
  }
  return {
    status: validation.status === 'valid' ? 'valid' : 'invalid',
    errors: (validation.errors || []).map((error) => error.message || String(error.code || error)),
    warnings: (validation.warnings || []).map(
      (warning) => warning.message || String(warning.code || warning),
    ),
  };
}

function authoringBackendCanvasSnapshot(snapshot: AuthoringContextSnapshot): Record<string, unknown> {
  return {
    task_id: snapshot.task_id,
    id: snapshot.canvas.id,
    name: snapshot.canvas.name,
    workflows: snapshot.canvas.workflows,
    edges: snapshot.canvas.edges,
    canonical_graph: snapshot.canonical_graph,
    callable_catalog: snapshot.callable_catalog,
    workflow_catalog: snapshot.workflow_catalog,
  };
}

function authoringSelectionPayload(selection: CanvasSelection): Record<string, unknown> {
  return selection as unknown as Record<string, unknown>;
}

function authoringOperationContractIssues(
  proposal: CanvasAuthoringProposal,
  context: {
    canvas: WorkspaceCanvasModel;
    temporaryResources: Record<string, TemporaryResourceDraft>;
    callables: CallableSummary[];
    workflows: WorkflowSummary[];
  },
): string[] {
  const errors: string[] = [];
  const callableMap = new Map(context.callables.map((callable) => [callable.id, callable]));
  const workflowMap = new Map(context.workflows.map((workflow) => [workflow.path, workflow]));
  const rootNodeIds = new Set(context.canvas.workflows.map((workflow) => workflow.id));
  const workflowContainerScopeIds = new Set(
    context.canvas.workflows
      .filter((workflow) => !isExecutableNodeWorkflow(workflow))
      .map((workflow) => workflow.id),
  );
  const internalNodeIdsByWorkflow = new Map(
    context.canvas.workflows.map((workflow) => [
      workflow.id,
      new Set([
        ...workflow.internalNodes.map((node) => node.id),
        workflowInputBoundaryId(workflow.id),
        workflowOutputBoundaryId(workflow.id),
      ]),
    ]),
  );

  const scopeIssue = (scopeWorkflowId: string | null): string | null => {
    if (scopeWorkflowId === null) {
      return null;
    }
    if (!rootNodeIds.has(scopeWorkflowId)) {
      return `Authoring scope 不存在: ${scopeWorkflowId}`;
    }
    if (!workflowContainerScopeIds.has(scopeWorkflowId)) {
      return `Authoring scope 不是 workflow container: ${scopeWorkflowId}`;
    }
    return null;
  };

  const reserveNodeId = (scopeWorkflowId: string | null, nodeId: string): boolean => {
    if (!nodeId) {
        errors.push('节点 id 不能为空');
      return false;
    }
    if (scopeWorkflowId === null) {
      if (rootNodeIds.has(nodeId)) {
        errors.push(`节点 id 已存在: ${nodeId}`);
        return false;
      }
      rootNodeIds.add(nodeId);
      return true;
    }
    const ids = internalNodeIdsByWorkflow.get(scopeWorkflowId);
    if (!ids) {
      errors.push(`Authoring scope 不存在: ${scopeWorkflowId}`);
      return false;
    }
    if (ids.has(nodeId)) {
        errors.push(`节点 id 已存在: ${scopeWorkflowId}.${nodeId}`);
      return false;
    }
    ids.add(nodeId);
    return true;
  };

  const nodeExists = (scopeWorkflowId: string | null, nodeId: string): boolean => {
    if (scopeWorkflowId === null) {
      return rootNodeIds.has(nodeId);
    }
    return Boolean(internalNodeIdsByWorkflow.get(scopeWorkflowId)?.has(nodeId));
  };

  for (const operation of proposal.operations) {
    if ('scope_workflow_id' in operation) {
      const issue = scopeIssue(operation.scope_workflow_id);
      if (issue) {
        errors.push(issue);
        continue;
      }
    }

    if (operation.op === 'add_existing_callable_node') {
      const callable = callableMap.get(operation.callable_id);
      if (!callable) {
        errors.push(`Callable 不存在: ${operation.callable_id}`);
      } else if (operation.callable_kind !== callable.kind) {
        errors.push(`Callable kind 不匹配: ${operation.callable_id}`);
      }
      reserveNodeId(operation.scope_workflow_id, operation.node_id);
      continue;
    }

    if (operation.op === 'add_workflow_container') {
      if (operation.workflow_ref && !workflowMap.has(operation.workflow_ref)) {
        errors.push(`Workflow 模板不存在: ${operation.workflow_ref}`);
      }
      if (reserveNodeId(null, operation.node_id)) {
        workflowContainerScopeIds.add(operation.node_id);
        internalNodeIdsByWorkflow.set(
          operation.node_id,
          new Set([
            workflowInputBoundaryId(operation.node_id),
            workflowOutputBoundaryId(operation.node_id),
          ]),
        );
      }
      continue;
    }

    if (operation.op === 'create_temporary_agent_template') {
      if (!isTemporaryCallableId(operation.draft_id)) {
        errors.push(`临时 agent draft id 必须使用 ${TEMPORARY_CALLABLE_ID_PREFIX} 前缀`);
      }
      if (context.temporaryResources[operation.draft_id]) {
        errors.push(`临时 agent draft 已存在: ${operation.draft_id}`);
      }
      reserveNodeId(operation.scope_workflow_id, operation.node_id);
      continue;
    }

    if (
      operation.op === 'update_invocation_input' ||
      operation.op === 'update_invocation_label' ||
      operation.op === 'update_output_schema' ||
      operation.op === 'set_ports'
    ) {
      if (!nodeExists(operation.scope_workflow_id, operation.node_id)) {
        errors.push(`节点不存在: ${operation.scope_workflow_id ? `${operation.scope_workflow_id}.` : ''}${operation.node_id}`);
      }
      continue;
    }

    if (operation.op === 'add_control_edge') {
      if (!nodeExists(operation.scope_workflow_id, operation.from)) {
        errors.push(`控制线来源节点不存在: ${operation.from}`);
      }
      if (!nodeExists(operation.scope_workflow_id, operation.to)) {
        errors.push(`控制线目标节点不存在: ${operation.to}`);
      }
      continue;
    }

    if (operation.op === 'add_data_edge') {
      if (!nodeExists(operation.scope_workflow_id, operation.from.node)) {
        errors.push(`Data Edge 来源节点不存在: ${operation.from.node}`);
      }
      if (!nodeExists(operation.scope_workflow_id, operation.to.node)) {
        errors.push(`Data Edge 目标节点不存在: ${operation.to.node}`);
      }
      continue;
    }

    if (operation.op === 'remove_edge') {
      if (!authoringEdgeExists(context.canvas, operation.scope_workflow_id, operation.edge_id)) {
        errors.push(`连线不存在: ${operation.scope_workflow_id ? `${operation.scope_workflow_id}.` : ''}${operation.edge_id}`);
      }
      continue;
    }

    if (operation.op === 'replace_temporary_template_with_existing_callable') {
      const callable = callableMap.get(operation.callable_id);
      if (!callable) {
        errors.push(`Callable 不存在: ${operation.callable_id}`);
      } else if (operation.callable_kind !== callable.kind) {
        errors.push(`Callable kind 不匹配: ${operation.callable_id}`);
      }
      const node = findAuthoringNode(context.canvas, operation.scope_workflow_id, operation.node_id);
      const resourceId = node?.temporaryResourceId || (isTemporaryCallableId(node?.callableId) ? node?.callableId : '');
      if (!node) {
        errors.push(`节点不存在: ${operation.node_id}`);
      } else if (!resourceId) {
        errors.push(`节点不是临时 agent template: ${operation.node_id}`);
      } else if (resourceId !== operation.temporary_resource_id) {
        errors.push(`临时资源不匹配: ${operation.node_id}`);
      }
      const draft = context.temporaryResources[operation.temporary_resource_id];
      if (!draft) {
        errors.push(`临时资源不存在: ${operation.temporary_resource_id}`);
      } else if (draft.status === 'discarded') {
        errors.push(`临时资源已丢弃: ${operation.temporary_resource_id}`);
      } else if (draft.referenced_by.length && !draft.referenced_by.includes(operation.node_id)) {
        errors.push(`临时资源未引用节点: ${operation.node_id}`);
      }
    }
  }

  return Array.from(new Set(errors));
}

function applyCanvasAuthoringProposal({
  canvas,
  taskId,
  proposal,
  temporaryResources,
  callables,
  workflows,
}: {
  canvas: WorkspaceCanvasModel;
  taskId: string;
  proposal: CanvasAuthoringProposal;
  temporaryResources: Record<string, TemporaryResourceDraft>;
  callables: CallableSummary[];
  workflows: WorkflowSummary[];
}): CanvasAuthoringApplyResult {
  const validation = validateCanvasAuthoringProposal(proposal, {
    canvas,
    taskId,
    temporaryResources,
    callables,
    workflows,
  });
  if (validation.status === 'invalid') {
    throw new Error(validation.errors.join('\n'));
  }
  return applyCanvasAuthoringOperations({ canvas, proposal, temporaryResources, callables, workflows });
}

function applyCanvasAuthoringOperations({
  canvas,
  proposal,
  temporaryResources,
  callables,
  workflows,
}: {
  canvas: WorkspaceCanvasModel;
  proposal: CanvasAuthoringProposal;
  temporaryResources: Record<string, TemporaryResourceDraft>;
  callables: CallableSummary[];
  workflows: WorkflowSummary[];
}): CanvasAuthoringApplyResult {
  const callableMap = new Map(callables.map((callable) => [callable.id, callable]));
  const workflowMap = new Map(workflows.map((workflow) => [workflow.path, workflow]));
  let nextCanvas = stripRuntimeStateFromCanvas(canvas);
  let nextTemporaryResources = { ...temporaryResources };
  let nextSelection: CanvasSelection = { type: 'task_canvas', taskId: canvas.id };
  const messages: string[] = [];
  const layoutScopes = new Set<string | null>();
  let layoutTriggerCount = 0;

  const markLayoutScope = (scopeWorkflowId: string | null) => {
    layoutScopes.add(scopeWorkflowId);
    layoutTriggerCount += 1;
  };

  for (const operation of proposal.operations) {
    if (operation.op === 'add_existing_callable_node') {
      const callable = callableMap.get(operation.callable_id);
      if (!callable) {
        throw new Error(`Callable 不存在: ${operation.callable_id}`);
      }
      nextCanvas = addAuthoringCallableNode(nextCanvas, operation, paletteItemFromCallable(callable));
      nextSelection =
        operation.scope_workflow_id === null
          ? { type: 'workflow', id: operation.node_id }
          : { type: 'internal', workflowId: operation.scope_workflow_id, nodeId: operation.node_id };
      messages.push(`已添加节点 ${operation.node_id}`);
      markLayoutScope(operation.scope_workflow_id);
      continue;
    }
    if (operation.op === 'add_workflow_container') {
      if (operation.workflow_ref && !workflowMap.has(operation.workflow_ref)) {
        throw new Error(`Workflow 模板不存在: ${operation.workflow_ref}`);
      }
      nextCanvas = addAuthoringWorkflowContainer(nextCanvas, operation);
      nextSelection = { type: 'workflow', id: operation.node_id };
      messages.push(`已添加 Workflow ${operation.node_id}`);
      markLayoutScope(null);
      continue;
    }
    if (operation.op === 'create_temporary_agent_template') {
      nextCanvas = addAuthoringTemporaryAgentNode(nextCanvas, operation);
      nextTemporaryResources[operation.draft_id] = {
        draft_id: operation.draft_id,
        kind: 'agent_template',
        status: 'approved_for_canvas',
        agent_draft: operation.agent_draft,
        referenced_by: [operation.node_id],
      };
      nextSelection =
        operation.scope_workflow_id === null
          ? { type: 'workflow', id: operation.node_id }
          : { type: 'internal', workflowId: operation.scope_workflow_id, nodeId: operation.node_id };
      messages.push(`已创建临时 agent 草稿 ${operation.draft_id}`);
      markLayoutScope(operation.scope_workflow_id);
      continue;
    }
    if (operation.op === 'update_invocation_input') {
      nextCanvas = updateAuthoringNode(nextCanvas, operation.scope_workflow_id, operation.node_id, {
        input: operation.input,
      });
      messages.push(`已更新 ${operation.node_id} 的输入`);
      continue;
    }
    if (operation.op === 'update_invocation_label') {
      nextCanvas = updateAuthoringNode(nextCanvas, operation.scope_workflow_id, operation.node_id, {
        label: operation.label,
      });
      messages.push(`已更新 ${operation.node_id} 的标签`);
      continue;
    }
    if (operation.op === 'update_output_schema') {
      nextCanvas = updateAuthoringNode(nextCanvas, operation.scope_workflow_id, operation.node_id, {
        outputSchema: operation.output_schema,
      });
      messages.push(`已更新 ${operation.node_id} 的 output_schema`);
      continue;
    }
    if (operation.op === 'set_ports') {
      nextCanvas = updateAuthoringNode(nextCanvas, operation.scope_workflow_id, operation.node_id, {
        inputPorts: operation.input_ports,
        outputPorts: operation.output_ports,
      });
      messages.push(`已更新 ${operation.node_id} 的端口`);
      continue;
    }
    if (operation.op === 'add_control_edge') {
      nextCanvas = addAuthoringControlEdge(nextCanvas, operation);
      messages.push(`已添加控制线 ${operation.from} -> ${operation.to}`);
      markLayoutScope(operation.scope_workflow_id);
      continue;
    }
    if (operation.op === 'add_data_edge') {
      nextCanvas = createDataEdgeCommand(nextCanvas, {
        scopeWorkflowId: operation.scope_workflow_id,
        sourceNodeId: operation.from.node,
        sourcePortId: operation.from.port,
        targetNodeId: operation.to.node,
        targetPortId: operation.to.port,
        materialization: operation.materialization,
        replaceExisting: operation.replace_existing,
      }).canvas;
      messages.push(`已添加 Data Edge ${operation.from.node}.${operation.from.port} -> ${operation.to.node}.${operation.to.port}`);
      markLayoutScope(operation.scope_workflow_id);
      continue;
    }
    if (operation.op === 'remove_edge') {
      nextCanvas = removeAuthoringEdge(nextCanvas, operation.scope_workflow_id, operation.edge_id);
      messages.push(`已删除连线 ${operation.edge_id}`);
      continue;
    }
    if (operation.op === 'replace_temporary_template_with_existing_callable') {
      const callable = callableMap.get(operation.callable_id);
      if (!callable) {
        throw new Error(`Callable 不存在: ${operation.callable_id}`);
      }
      nextCanvas = replaceTemporaryAuthoringNode(nextCanvas, operation);
      nextTemporaryResources = {
        ...nextTemporaryResources,
        [operation.temporary_resource_id]: {
          ...nextTemporaryResources[operation.temporary_resource_id],
          status: 'discarded',
        },
      };
      messages.push(`已将临时节点 ${operation.node_id} 替换为 ${operation.callable_id}`);
      continue;
    }
  }

  return {
    canvas: layoutCanvasAfterAuthoringApply(normalizeCanvasEdges(nextCanvas), layoutScopes, layoutTriggerCount),
    temporaryResources: nextTemporaryResources,
    selection: nextSelection,
    messages,
  };
}

function layoutCanvasAfterAuthoringApply(
  canvas: WorkspaceCanvasModel,
  layoutScopes: Set<string | null>,
  triggerCount: number,
): WorkspaceCanvasModel {
  if (triggerCount < 2 || layoutScopes.size === 0) {
    return canvas;
  }
  if (layoutScopes.size === 1) {
    const [scopeWorkflowId] = Array.from(layoutScopes);
    if (scopeWorkflowId) {
      return {
        ...canvas,
        workflows: canvas.workflows.map((workflow) =>
          workflow.id === scopeWorkflowId ? layoutWorkflowInternalNodes(workflow) : workflow,
        ),
      };
    }
  }
  return layoutWorkspaceCanvas(canvas);
}

function addAuthoringCallableNode(
  canvas: WorkspaceCanvasModel,
  operation: Extract<CanvasAuthoringOperation, { op: 'add_existing_callable_node' }>,
  item: Exclude<PaletteItem, { kind: 'workflow' }>,
): WorkspaceCanvasModel {
  const beforeCanvas = canvas;
  const nextCanvas =
    operation.scope_workflow_id === null
      ? addCallableNodeFromPalette(canvas, item, operation.position)
      : addInternalNodeFromPalette(canvas, operation.scope_workflow_id, item, operation.position);
  const actualNodeId = addedAuthoringNodeId(beforeCanvas, nextCanvas, operation.scope_workflow_id);
  const canvasWithProposalId = renameAuthoringNodeId(
    nextCanvas,
    operation.scope_workflow_id,
    actualNodeId,
    operation.node_id,
  );
  return updateAuthoringNode(canvasWithProposalId, operation.scope_workflow_id, operation.node_id, {
    label: operation.label,
    input: operation.input,
    inputPorts: operation.input_ports,
    outputPorts: operation.output_ports,
    outputSchema: operation.output_schema,
  });
}

function addAuthoringWorkflowContainer(
  canvas: WorkspaceCanvasModel,
  operation: Extract<CanvasAuthoringOperation, { op: 'add_workflow_container' }>,
): WorkspaceCanvasModel {
  const beforeCanvas = canvas;
  const nextCanvas = addWorkflowFromPalette(
    canvas,
    { kind: 'workflow', workflowRef: operation.workflow_ref, label: operation.label },
    operation.position,
  );
  const actualNodeId = addedAuthoringNodeId(beforeCanvas, nextCanvas, null);
  return renameAuthoringNodeId(nextCanvas, null, actualNodeId, operation.node_id);
}

function addAuthoringTemporaryAgentNode(
  canvas: WorkspaceCanvasModel,
  operation: Extract<CanvasAuthoringOperation, { op: 'create_temporary_agent_template' }>,
): WorkspaceCanvasModel {
  const item: Exclude<PaletteItem, { kind: 'workflow' }> = {
    kind: 'agent',
    callableId: operation.draft_id,
    label: operation.label,
    inputPorts: workflowPortsFromPortContracts(operation.agent_draft.input_ports, 'input'),
    outputPorts: workflowPortsFromPortContracts(operation.agent_draft.output_ports, 'output'),
    outputSchema: operation.output_schema || outputSchemaFromArtifactContract(operation.agent_draft.artifact_contract),
  };
  const beforeCanvas = canvas;
  const nextCanvas =
    operation.scope_workflow_id === null
      ? addCallableNodeFromPalette(canvas, item, operation.position)
      : addInternalNodeFromPalette(canvas, operation.scope_workflow_id, item, operation.position);
  const actualNodeId = addedAuthoringNodeId(beforeCanvas, nextCanvas, operation.scope_workflow_id);
  const canvasWithProposalId = renameAuthoringNodeId(
    nextCanvas,
    operation.scope_workflow_id,
    actualNodeId,
    operation.node_id,
  );
  return updateAuthoringNode(canvasWithProposalId, operation.scope_workflow_id, operation.node_id, {
    label: operation.label,
    input: operation.input,
    outputSchema: operation.output_schema,
    temporaryResourceId: operation.draft_id,
    warnings: ['临时 agent template：不能 run/save，需要替换为真实 callable。'],
  });
}

function addedAuthoringNodeId(
  beforeCanvas: WorkspaceCanvasModel,
  afterCanvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
): string {
  if (scopeWorkflowId === null) {
    const beforeIds = new Set(beforeCanvas.workflows.map((workflow) => workflow.id));
    const added = afterCanvas.workflows.filter((workflow) => !beforeIds.has(workflow.id));
    if (added.length !== 1) {
      throw new Error('无法定位新增节点');
    }
    return added[0].id;
  }
  const beforeWorkflow = beforeCanvas.workflows.find((workflow) => workflow.id === scopeWorkflowId);
  const afterWorkflow = afterCanvas.workflows.find((workflow) => workflow.id === scopeWorkflowId);
  const beforeIds = new Set(beforeWorkflow?.internalNodes.map((node) => node.id) || []);
  const added = (afterWorkflow?.internalNodes || []).filter((node) => !beforeIds.has(node.id));
  if (added.length !== 1) {
    throw new Error(`无法定位新增内部节点: ${scopeWorkflowId}`);
  }
  return added[0].id;
}

function renameAuthoringNodeId(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  actualNodeId: string,
  expectedNodeId: string,
): WorkspaceCanvasModel {
  if (actualNodeId === expectedNodeId) {
    return canvas;
  }
  if (scopeWorkflowId === null) {
    if (canvas.workflows.some((workflow) => workflow.id === expectedNodeId)) {
      throw new Error(`节点 id 已存在: ${expectedNodeId}`);
    }
    return {
      ...canvas,
      rootWorkflowId: canvas.rootWorkflowId === actualNodeId ? expectedNodeId : canvas.rootWorkflowId,
      workflows: canvas.workflows.map((workflow) =>
        workflow.id === actualNodeId ? { ...workflow, id: expectedNodeId } : workflow,
      ),
      edges: canvas.edges.map((edge) => replaceEdgeNodeId(edge, actualNodeId, expectedNodeId)),
    };
  }
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
      if (workflow.id !== scopeWorkflowId) {
        return workflow;
      }
      if (workflow.internalNodes.some((node) => node.id === expectedNodeId)) {
        throw new Error(`节点 id 已存在: ${scopeWorkflowId}.${expectedNodeId}`);
      }
      return {
        ...workflow,
        internalNodes: workflow.internalNodes.map((node) =>
          node.id === actualNodeId ? { ...node, id: expectedNodeId } : node,
        ),
        internalEdges: workflow.internalEdges.map((edge) =>
          replaceEdgeNodeId(edge, actualNodeId, expectedNodeId),
        ),
      };
    }),
  };
}

function updateAuthoringWorkflowId(
  canvas: WorkspaceCanvasModel,
  expectedNodeId: string,
): WorkspaceCanvasModel {
  if (canvas.workflows.some((workflow) => workflow.id === expectedNodeId)) {
    return canvas;
  }
  const lastWorkflow = canvas.workflows[canvas.workflows.length - 1];
  if (!lastWorkflow) {
    throw new Error(`无法创建 Workflow 节点: ${expectedNodeId}`);
  }
  if (canvas.workflows.some((workflow) => workflow.id === expectedNodeId)) {
    throw new Error(`节点 id 已存在: ${expectedNodeId}`);
  }
  return {
    ...canvas,
    rootWorkflowId: canvas.rootWorkflowId === lastWorkflow.id ? expectedNodeId : canvas.rootWorkflowId,
    workflows: canvas.workflows.map((workflow) =>
      workflow.id === lastWorkflow.id ? { ...workflow, id: expectedNodeId } : workflow,
    ),
    edges: canvas.edges.map((edge) => replaceEdgeNodeId(edge, lastWorkflow.id, expectedNodeId)),
  };
}

function updateAuthoringNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
  updates: {
    label?: string;
    input?: Record<string, unknown>;
    inputPorts?: WorkflowPortView[];
    outputPorts?: WorkflowPortView[];
    outputSchema?: Record<string, unknown>;
    temporaryResourceId?: string;
    warnings?: string[];
  },
): WorkspaceCanvasModel {
  if (scopeWorkflowId === null) {
    let found = false;
    const workflows = canvas.workflows.map((workflow) => {
      if (workflow.id !== nodeId) {
        return workflow;
      }
      found = true;
      return {
        ...workflow,
        title: updates.label ?? workflow.title,
        invocationLabel: updates.label ?? workflow.invocationLabel,
        sourceInput: updates.input ?? workflow.sourceInput,
        inputPorts: updates.inputPorts ?? workflow.inputPorts,
        outputPorts: updates.outputPorts ?? workflow.outputPorts,
        outputSchema: updates.outputSchema ?? workflow.outputSchema,
        temporaryResourceId: updates.temporaryResourceId ?? workflow.temporaryResourceId,
        warnings: updates.warnings ?? workflow.warnings,
      };
    });
    if (!found) {
      throw new Error(`节点不存在: ${nodeId}`);
    }
    return { ...canvas, workflows };
  }

  let found = false;
  const workflows = canvas.workflows.map((workflow) => {
    if (workflow.id !== scopeWorkflowId) {
      return workflow;
    }
    return {
      ...workflow,
      internalNodes: workflow.internalNodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }
        found = true;
        return {
          ...node,
          name: updates.label ?? node.name,
          invocationLabel: updates.label ?? node.invocationLabel,
          task: updates.label ?? node.task,
          input: updates.input ?? node.input,
          inputPorts: updates.inputPorts ?? node.inputPorts,
          outputPorts: updates.outputPorts ?? node.outputPorts,
          outputSchema: updates.outputSchema ?? node.outputSchema,
          temporaryResourceId: updates.temporaryResourceId ?? node.temporaryResourceId,
        };
      }),
    };
  });
  if (!found) {
    throw new Error(`节点不存在: ${scopeWorkflowId}.${nodeId}`);
  }
  return { ...canvas, workflows };
}

function addAuthoringControlEdge(
  canvas: WorkspaceCanvasModel,
  operation: Extract<CanvasAuthoringOperation, { op: 'add_control_edge' }>,
): WorkspaceCanvasModel {
  const edge: Extract<WorkflowCanvasEdge, { kind: 'control' }> = controlEdgeWithId(
    uniqueEdgeIdForScope(
      canvas,
      operation.scope_workflow_id,
      'control',
      operation.from,
      operation.to,
    ),
    operation.from,
    operation.to,
  ) as Extract<WorkflowCanvasEdge, { kind: 'control' }>;
  const endpointIssue = authoringControlEndpointIssue(canvas, operation.scope_workflow_id, edge);
  if (endpointIssue) {
    throw new Error(endpointIssue);
  }
  if (wouldCreateControlCycle(canvas, operation.scope_workflow_id, edge)) {
    throw new Error('这条控制线会形成循环');
  }
  const issue = controlSlotLimitIssue(canvas, operation.scope_workflow_id, edge);
  if (issue) {
    throw new Error(issue);
  }
  if (operation.scope_workflow_id) {
    return {
      ...canvas,
      workflows: canvas.workflows.map((workflow) =>
        workflow.id === operation.scope_workflow_id
          ? {
              ...workflow,
              internalEdges: [
                ...workflow.internalEdges.filter((candidate) => !canvasEdgesAreEquivalent(candidate, edge)),
                edge,
              ],
            }
          : workflow,
      ),
    };
  }
  return {
    ...canvas,
    edges: [
      ...canvas.edges.filter((candidate) => !canvasEdgesAreEquivalent(candidate, edge)),
      edge,
    ],
  };
}

function authoringControlEndpointIssue(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  edge: Extract<WorkflowCanvasEdge, { kind: 'control' }>,
): string | null {
  const source = findDataConnectNode(canvas, scopeWorkflowId, edge.source.workflowId);
  const target = findDataConnectNode(canvas, scopeWorkflowId, edge.target.workflowId);
  if (!source || !target) {
    return `控制线端点不存在: ${edge.source.workflowId} -> ${edge.target.workflowId}`;
  }
  if (!scopeWorkflowId) {
    return null;
  }
  const sourceBoundary = workflowBoundaryKind(edge.source.workflowId);
  const targetBoundary = workflowBoundaryKind(edge.target.workflowId);
  if (sourceBoundary === 'workflow_output') {
    return 'Workflow Outputs 只能作为内部控制线目标。';
  }
  if (targetBoundary === 'workflow_input') {
    return 'Workflow Inputs 只能作为内部控制线来源。';
  }
  if (sourceBoundary && targetBoundary) {
    return 'Workflow 边界之间不能直接创建控制线。';
  }
  return null;
}

function removeAuthoringEdge(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  edgeId: string,
): WorkspaceCanvasModel {
  if (!authoringEdgeExists(canvas, scopeWorkflowId, edgeId)) {
    throw new Error(`连线不存在: ${scopeWorkflowId ? `${scopeWorkflowId}.` : ''}${edgeId}`);
  }
  if (scopeWorkflowId) {
    return {
      ...canvas,
      workflows: canvas.workflows.map((workflow) =>
        workflow.id === scopeWorkflowId
          ? { ...workflow, internalEdges: workflow.internalEdges.filter((edge) => edge.id !== edgeId) }
          : workflow,
      ),
    };
  }
  return { ...canvas, edges: canvas.edges.filter((edge) => edge.id !== edgeId) };
}

function replaceTemporaryAuthoringNode(
  canvas: WorkspaceCanvasModel,
  operation: Extract<CanvasAuthoringOperation, { op: 'replace_temporary_template_with_existing_callable' }>,
): WorkspaceCanvasModel {
  const node = findAuthoringNode(canvas, operation.scope_workflow_id, operation.node_id);
  const resourceId = node?.temporaryResourceId || (isTemporaryCallableId(node?.callableId) ? node?.callableId : '');
  if (!node) {
    throw new Error(`节点不存在: ${operation.node_id}`);
  }
  if (!resourceId) {
    throw new Error(`节点不是临时 agent template: ${operation.node_id}`);
  }
  if (resourceId !== operation.temporary_resource_id) {
    throw new Error(`临时资源不匹配: ${operation.node_id}`);
  }
  if (operation.scope_workflow_id === null) {
    return {
      ...canvas,
      workflows: canvas.workflows.map((workflow) =>
        workflow.id === operation.node_id
          ? {
              ...workflow,
              sourceKind: operation.callable_kind === 'tool_class' ? 'tool' : 'agent_session',
              callableId: operation.callable_id,
              temporaryResourceId: undefined,
              warnings: [],
            }
          : workflow,
      ),
    };
  }
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) =>
      workflow.id === operation.scope_workflow_id
        ? {
            ...workflow,
            internalNodes: workflow.internalNodes.map((node) =>
              node.id === operation.node_id
                ? {
                    ...node,
                    kind: operation.callable_kind === 'tool_class' ? 'Tool' : 'Agent',
                    callableId: operation.callable_id,
                    runtime: operation.callable_id,
                    temporaryResourceId: undefined,
                  }
                : node,
            ),
          }
        : workflow,
    ),
  };
}

function replaceTemporaryResourceWithCallable(
  canvas: WorkspaceCanvasModel,
  temporaryResourceId: string,
  callableId: string,
): WorkspaceCanvasModel {
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
      const workflowMatches =
        workflow.temporaryResourceId === temporaryResourceId ||
        workflow.callableId === temporaryResourceId;
      return {
        ...workflow,
        ...(workflowMatches
          ? {
              sourceKind: 'agent_session' as const,
              callableId,
              temporaryResourceId: undefined,
              warnings: [],
            }
          : {}),
        internalNodes: workflow.internalNodes.map((node) => {
          const nodeMatches =
            node.temporaryResourceId === temporaryResourceId ||
            node.callableId === temporaryResourceId;
          return nodeMatches
            ? {
                ...node,
                kind: 'Agent' as const,
                callableId,
                runtime: callableId,
                temporaryResourceId: undefined,
              }
            : node;
        }),
      };
    }),
  };
}

function authoringEdgeExists(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  edgeId: string,
): boolean {
  if (scopeWorkflowId) {
    return Boolean(
      canvas.workflows
        .find((workflow) => workflow.id === scopeWorkflowId)
        ?.internalEdges.some((edge) => edge.id === edgeId),
    );
  }
  return canvas.edges.some((edge) => edge.id === edgeId);
}

function findAuthoringNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
): { temporaryResourceId?: string; callableId?: string } | null {
  if (scopeWorkflowId === null) {
    const workflow = canvas.workflows.find((item) => item.id === nodeId);
    return workflow
      ? { temporaryResourceId: workflow.temporaryResourceId, callableId: workflow.callableId }
      : null;
  }
  const node = canvas.workflows
    .find((workflow) => workflow.id === scopeWorkflowId)
    ?.internalNodes.find((item) => item.id === nodeId);
  return node
    ? { temporaryResourceId: node.temporaryResourceId, callableId: node.callableId || node.runtime }
    : null;
}

function replaceEdgeNodeId(
  edge: WorkflowCanvasEdge,
  previousId: string,
  nextId: string,
): WorkflowCanvasEdge {
  if (edge.kind === 'control') {
    return {
      ...edge,
      source: { workflowId: edge.source.workflowId === previousId ? nextId : edge.source.workflowId },
      target: { workflowId: edge.target.workflowId === previousId ? nextId : edge.target.workflowId },
    };
  }
  return {
    ...edge,
    source: {
      ...edge.source,
      workflowId: edge.source.workflowId === previousId ? nextId : edge.source.workflowId,
    },
    target: {
      ...edge.target,
      workflowId: edge.target.workflowId === previousId ? nextId : edge.target.workflowId,
    },
  };
}

function temporaryResourceIssueForCanvas(
  canvas: WorkspaceCanvasModel,
  authoring: WorkbenchAuthoringState | undefined,
): string | null {
  for (const workflow of canvas.workflows) {
    const resourceId = workflow.temporaryResourceId || (isTemporaryCallableId(workflow.callableId) ? workflow.callableId : '');
    if (resourceId) {
      const draft = authoring?.temporaryResources[resourceId];
      return `节点 ${workflowInvocationLabel(workflow)} 使用临时 agent template ${draft?.agent_draft.name || resourceId}，不能 run/save。请替换为真实 callable。`;
    }
    for (const node of workflow.internalNodes) {
      const internalResourceId = node.temporaryResourceId || (isTemporaryCallableId(node.callableId) ? node.callableId : '');
      if (internalResourceId) {
        const draft = authoring?.temporaryResources[internalResourceId];
        return `节点 ${internalInvocationLabel(node)} 使用临时 agent template ${draft?.agent_draft.name || internalResourceId}，不能 run/save。请替换为真实 callable。`;
      }
    }
  }
  return null;
}

function temporaryResourceIssueForGraph(graph: WorkflowGraph): string | null {
  const node = graph.nodes.find((item) => isTemporaryCallableId(item.callable_ref?.id));
  return node
    ? `Graph 节点 ${node.label || node.id} 绑定临时 callable ${node.callable_ref.id}，不能提交运行。`
    : null;
}

function authoringOperationSummary(operation: CanvasAuthoringOperation): string {
  if (operation.op === 'add_existing_callable_node') {
    return `添加节点 ${operation.node_id} -> ${operation.callable_id}`;
  }
  if (operation.op === 'create_temporary_agent_template') {
    return `创建临时 agent ${operation.draft_id}`;
  }
  if (operation.op === 'add_control_edge') {
    return `控制线 ${operation.from} -> ${operation.to}`;
  }
  if (operation.op === 'add_data_edge') {
    return `Data Edge ${operation.from.node}.${operation.from.port} -> ${operation.to.node}.${operation.to.port}`;
  }
  if ('node_id' in operation) {
    return `${operation.op}: ${operation.node_id}`;
  }
  return operation.op;
}

export function WorkflowViewer({
  workflows,
  callables,
  resourceErrors,
  selectedWorkflowId,
  onSelect,
  onChanged,
}: Props) {
  const initialTaskStore = useMemo(() => loadTaskStore(), []);
  const initialTask = useMemo(
    () =>
      initialTaskStore.tasks.find((task) => task.taskId === initialTaskStore.activeTaskId) ||
      initialTaskStore.tasks[0],
    [initialTaskStore],
  );
  const [tasks, setTasks] = useState<WorkbenchTask[]>(() => initialTaskStore.tasks);
  const [activeTaskId, setActiveTaskId] = useState(initialTaskStore.activeTaskId);
  const durableTaskBootstrapStartedRef = useRef(false);
  const backendTaskPersistTimerRef = useRef<number | null>(null);
  const lastBackendTaskPersistKeyRef = useRef('');
  const callablesRef = useRef(callables);
  const workflowsRef = useRef(workflows);
  const currentTask = useMemo(
    () => tasks.find((task) => task.taskId === activeTaskId) || tasks[0],
    [activeTaskId, tasks],
  );
  const [canvas, setCanvas] = useState<WorkspaceCanvasModel>(() => initialTask.canvas);
  const [layoutSyncVersion, setLayoutSyncVersion] = useState(0);
  const [sourceGraph, setSourceGraph] = useState<WorkflowGraph>(() =>
    canvasToWorkflowGraph(initialTask.canvas),
  );
  const [selection, setSelection] = useState<CanvasSelection>({
    type: 'task_canvas',
    taskId: initialTask.canvas.id,
  });
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('control');
  const [message, setMessage] = useState('已加载工作台');
  const [durableTasksReady, setDurableTasksReady] = useState(false);
  const [runsById, setRunsById] = useState<Record<string, RunProjection>>({});
  const [runLogsById, setRunLogsById] = useState<Record<string, Record<string, NodeLiveLogs>>>({});
  const [runLiveEventsById, setRunLiveEventsById] = useState<Record<string, WorkbenchLiveEvent[]>>({});
  const [nodeRunDetailsByKey, setNodeRunDetailsByKey] = useState<Record<string, NodeRunSummary>>({});
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [openedExternalWorkflow, setOpenedExternalWorkflow] = useState(false);
  const [focusedWorkflowId, setFocusedWorkflowId] = useState<string | null>(null);
  const [dataConnectionDraft, setDataConnectionDraft] = useState<DataConnectionDraft>(null);
  const [chrome, setChrome] = useState<WorkbenchChromeState>({
    leftPanel: 'none',
    rightPanel: 'none',
    inspectorWidth: INSPECTOR_DEFAULT_WIDTH,
  });
  const [edgeViewMode, setEdgeViewMode] = useState<EdgeViewMode>('control');
  const [taskWorkspaceView, setTaskWorkspaceView] = useState<TaskWorkspaceView>('blueprint');

  useEffect(() => {
    callablesRef.current = callables;
  }, [callables]);

  useEffect(() => {
    workflowsRef.current = workflows;
  }, [workflows]);
  const [selectedResource, setSelectedResource] = useState<ResourceTemplate | null>(null);
  const [workflowBindings, setWorkflowBindings] = useState<Record<string, WorkflowBindingView>>({});
  const [bindingEditorWorkflowId, setBindingEditorWorkflowId] = useState<string | null>(null);
  const [evidenceDock, setEvidenceDock] = useState<EvidenceDockState>({
    open: false,
    title: '运行证据',
    content: null,
  });
  const [bottomDockMode, setBottomDockMode] = useState<BottomDockMode>('evidence');
  const [nodeDetailOpen, setNodeDetailOpen] = useState(false);
  const [artifactCacheByPath, setArtifactCacheByPath] = useState<Record<string, ArtifactContent>>({});
  const [saveWorkflowDialog, setSaveWorkflowDialog] = useState<SaveWorkflowDialogState | null>(
    null,
  );
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantMessages, setAssistantMessages] = useState<AssistantChatMessage[]>([]);
  const [assistantProposal, setAssistantProposal] = useState<CanvasAuthoringProposal | null>(null);
  const [authoringAgents, setAuthoringAgents] = useState<AuthoringAgentSummary[]>([]);
  const [selectedAuthoringAgentId, setSelectedAuthoringAgentId] = useState('');
  const [assistantSessionId, setAssistantSessionId] = useState<string | null>(null);
  const [assistantAgentSession, setAssistantAgentSession] = useState<AgentSessionRecord | null>(null);
  const [assistantPendingTurn, setAssistantPendingTurn] = useState<AgentTurnRecord | null>(null);
  const [assistantEvents, setAssistantEvents] = useState<RunEvent[]>([]);
  const [assistantTurnReason, setAssistantTurnReason] = useState<AssistantTurnReason>('workbench_chat');
  const [assistantSessionStatus, setAssistantSessionStatus] = useState('disconnected');
  const [assistantBackendValidation, setAssistantBackendValidation] =
    useState<CanvasAuthoringValidationResult | null>(null);
  const [assistantRequiredActions, setAssistantRequiredActions] = useState<AuthoringRequiredAction[]>([]);
  const [assistantGraphOpsReview, setAssistantGraphOpsReview] =
    useState<AssistantGraphOpsReview | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantApplyUndo, setAssistantApplyUndo] = useState<AssistantApplyUndoToken | null>(null);
  const [agentSessionState, setAgentSessionState] = useState<AgentSessionUiState>({
    status: 'idle',
    session: null,
    messages: [],
    events: [],
    pendingTurn: null,
    interactions: [],
    error: '',
  });
  const graphRef = useRef(sourceGraph);
  const selectedRunId = currentTask?.activeRunId || currentTask?.latestRunId || null;
  const selectedRunProjection = selectedRunId ? runsById[selectedRunId] : undefined;
  const assistantTurnSessionId = assistantSessionId || assistantPendingTurn?.session_id || null;
  const currentAuthoringState = currentTask?.authoring || emptyWorkbenchAuthoringState();
  const workflowRun = selectedRunProjection?.run || null;
  const workflowEvents = selectedRunProjection?.events || [];
  const runOverlay = selectedRunProjection?.overlay || null;
  const isRunning = currentTask ? isActiveTaskStatus(currentTask.status) : false;
  const viewProjection = workbenchViewProjection({
    taskWorkspaceView,
    chrome,
    bottomDockMode,
    evidenceDockOpen: evidenceDock.open,
  });
  const blueprintViewActive = viewProjection.blueprintActive;
  const resourceDetailOpen = viewProjection.resourceDetailOpen;
  const inspectorOpen = viewProjection.inspectorOpen;
  const assistantOpen = viewProjection.assistantOpen;
  const inspectorWidth = chrome.inspectorWidth;
  const workflowBindingKey = useMemo(
    () => [canvas.id, ...canvas.workflows.map((item) => item.id)].sort().join('|'),
    [canvas.id, canvas.workflows],
  );

  function closeEvidenceDock() {
    setEvidenceDock({ open: false, title: '运行证据', content: null });
  }

  function resetAssistantConversationState() {
    setAssistantInput('');
    setAssistantMessages([]);
    setAssistantProposal(null);
    setAssistantApplyUndo(null);
    setAssistantTurnReason('workbench_chat');
    setAssistantBackendValidation(null);
    setAssistantRequiredActions([]);
    setAssistantGraphOpsReview(null);
    setAssistantSessionId(null);
    setAssistantAgentSession(null);
    setAssistantPendingTurn(null);
    setAssistantEvents([]);
    setAssistantSessionStatus('disconnected');
    setAssistantBusy(false);
  }

  function currentAuthoringSnapshot(): AuthoringContextSnapshot {
    return captureAuthoringSnapshot({
      taskId: activeTaskId,
      canvas,
      selection,
      callables,
      workflows,
    });
  }

  async function ensureAssistantSession(snapshot = currentAuthoringSnapshot()): Promise<string> {
    if (assistantSessionId) {
      return assistantSessionId;
    }
    setAssistantBusy(true);
    setAssistantSessionStatus('connecting');
    try {
      const agentsResponse = await api.authoringAgents();
      setAuthoringAgents(agentsResponse.agents);
      const agentId = selectedAuthoringAgentId || agentsResponse.agents[0]?.id || '';
      if (agentId && !selectedAuthoringAgentId) {
        setSelectedAuthoringAgentId(agentId);
      }
      const session = await api.createWorkbenchAssistantSession({
        ...(agentId ? { agent_id: agentId } : {}),
        task_id: snapshot.task_id,
        canvas_hash: snapshot.snapshot_id,
        canvas_snapshot: authoringBackendCanvasSnapshot(snapshot),
        selection: authoringSelectionPayload(snapshot.selection),
      });
      setAssistantSessionId(session.session_id);
      setAssistantAgentSession(session);
      setAssistantSessionStatus(session.status || 'ready');
      const messages = await api.getAgentSessionMessages(session.session_id);
      setAssistantMessages(agentMessagesToAssistantMessages(messages.messages || []));
      return session.session_id;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setAssistantSessionStatus('error');
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'system', content: text },
      ]);
      throw error;
    } finally {
      setAssistantBusy(false);
    }
  }

  const updateRunProjection = useCallback((runId: string, update: (current: RunProjection) => RunProjection) => {
    setRunsById((current) => {
      const projection = current[runId];
      if (!projection) {
        return current;
      }
      return { ...current, [runId]: update(projection) };
    });
  }, []);

  const appendNodeLogDelta = useCallback((delta: NodeLogDelta) => {
    setRunLogsById((current) => {
      const runLogs = current[delta.run_id] || {};
      const logKeys = nodeLogDeltaKeys(delta);
      const primaryKey = logKeys[0] || delta.node_id;
      const previous = runLogs[primaryKey] || {
        stdout: '',
        stderr: '',
        stdoutOffset: 0,
        stderrOffset: 0,
      };
      const nextNodeLogs: NodeLiveLogs =
        delta.stream === 'stdout'
          ? {
              ...previous,
              stdout: trimLiveLog(previous.stdout + delta.text),
              stdoutOffset: delta.next_offset,
            }
          : {
              ...previous,
              stderr: trimLiveLog(previous.stderr + delta.text),
              stderrOffset: delta.next_offset,
            };
      return {
        ...current,
        [delta.run_id]: {
          ...runLogs,
          ...Object.fromEntries(logKeys.map((key) => [key, nextNodeLogs])),
        },
      };
    });
  }, []);

  const appendRunAgentEvent = useCallback((runId: string, event: RunEvent) => {
    const eventNodeId = typeof event.node_id === 'string' ? event.node_id : '';
    setRunsById((current) => {
      const projection = current[runId];
      if (!projection) {
        return current;
      }
      return {
        ...current,
        [runId]: {
          ...projection,
          events: mergeAgentEvents(projection.events, [event]),
        },
      };
    });
    setAgentSessionState((current) => {
      const session = current.session;
      if (!session) {
        return current;
      }
      const matchesSession = event.session_id && event.session_id === session.session_id;
      const matchesBoundNode =
        session.bound_run_id === runId &&
        (!eventNodeId || session.bound_node_id === eventNodeId);
      if (!matchesSession && !matchesBoundNode) {
        return current;
      }
      return {
        ...current,
        events: mergeAgentEvents(current.events, [event]),
      };
    });
  }, []);

  const appendRunLiveEvent = useCallback((runId: string, event: WorkbenchLiveEvent) => {
    setRunLiveEventsById((current) => ({
      ...current,
      [runId]: boundedLiveEvents(current[runId] || [], [event]),
    }));
  }, []);

  useEffect(() => {
    let ignore = false;
    api
      .runtimeConfig()
      .then((config) => {
        if (!ignore) {
          setRuntimeConfig(config);
        }
      })
      .catch(() => {
        if (!ignore) {
          setRuntimeConfig(null);
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (durableTaskBootstrapStartedRef.current) {
      return undefined;
    }
    durableTaskBootstrapStartedRef.current = true;
    let cancelled = false;

    async function bootstrapDurableTasks() {
      try {
        const response = await api.workbenchTasks();
        if (cancelled) {
          return;
        }
        if (response.tasks.length > 0) {
          const loadedTasks = (
            await Promise.all(response.tasks.map((task) => loadWorkbenchTaskFromBackend(task)))
          ).filter((task): task is WorkbenchTask => Boolean(task));
          if (cancelled || loadedTasks.length === 0) {
            return;
          }
          const nextActiveTask =
            loadedTasks.find((task) => task.taskId === initialTaskStore.activeTaskId) ||
            loadedTasks[0];
          const nextCanvas = normalizeCanvasEdges(nextActiveTask.canvas);
          setTasks(loadedTasks);
          setActiveTaskId(nextActiveTask.taskId);
          setCanvas(nextCanvas);
          const nextGraph = canvasToWorkflowGraph(nextCanvas);
          graphRef.current = nextGraph;
          setSourceGraph(nextGraph);
          setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
          setMessage('已从本地 runner 加载持久化任务');
          return;
        }
        await Promise.all(
          initialTaskStore.tasks.map((task) =>
            persistWorkbenchTaskToBackend(task, callablesRef.current, workflowsRef.current),
          ),
        );
        if (!cancelled) {
          setMessage('已迁移浏览器任务缓存到本地 runner');
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setDurableTasksReady(true);
        }
      }
    }

    void bootstrapDurableTasks();
    return () => {
      cancelled = true;
      durableTaskBootstrapStartedRef.current = false;
    };
  }, [initialTaskStore]);

  useEffect(() => {
    if (!assistantOpen || assistantSessionId || assistantBusy) {
      return;
    }
    void ensureAssistantSession().catch(() => {
      // The drawer shows the backend error as a system message.
    });
  }, [assistantBusy, assistantOpen, assistantSessionId]);

  useAssistantTurnStream(assistantTurnSessionId, assistantPendingTurn, assistantTurnReason, {
    setAgentSession: setAssistantAgentSession,
    setSessionStatus: setAssistantSessionStatus,
    setMessages: setAssistantMessages,
    setEvents: setAssistantEvents,
    setProposal: (proposal) =>
      setAssistantProposal((proposal as CanvasAuthoringProposal | null | undefined) || null),
    setBackendValidation: setAssistantBackendValidation,
    setRequiredActions: (actions) => setAssistantRequiredActions(actions as AuthoringRequiredAction[]),
    setPendingTurn: setAssistantPendingTurn,
    setBusy: setAssistantBusy,
    addSystemMessage: (content) =>
      setAssistantMessages((current) => [
        ...current,
        {
          id: authoringId('assistant_msg'),
          role: 'system',
          content,
        },
      ]),
  });

  useEffect(() => {
    if (!durableTasksReady) {
      return undefined;
    }
    const snapshot = currentAuthoringSnapshot();
    const timeout = window.setTimeout(() => {
      void api
        .putWorkbenchTaskCanvas(snapshot.task_id, {
          canvas_hash: snapshot.snapshot_id,
          canvas_snapshot: authoringBackendCanvasSnapshot(snapshot),
          selection: authoringSelectionPayload(snapshot.selection),
          temporary_resources: currentAuthoringState.temporaryResources,
        })
        .catch(() => {
          // Snapshot publishing is an MCP bridge; Workbench editing stays local if it fails.
        });
    }, 400);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    activeTaskId,
    canvas,
    selection,
    callables,
    workflows,
    currentAuthoringState.temporaryResources,
    durableTasksReady,
  ]);

  useRunStream(selectedRunId, {
    appendNodeLogDelta,
    appendRunAgentEvent,
    appendRunLiveEvent,
    updateRunProjection,
  });

  useEffect(() => {
    if (!durableTasksReady) {
      return;
    }
    saveTaskStore({ version: 1, activeTaskId, tasks });
  }, [activeTaskId, durableTasksReady, tasks]);

  const updateCanvas = useCallback((next: SetStateAction<WorkspaceCanvasModel>) => {
    setCanvas((current) => {
      const nextCanvas = normalizeCanvasEdges(
        typeof next === 'function'
          ? (next as (current: WorkspaceCanvasModel) => WorkspaceCanvasModel)(current)
          : next,
      );
      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.taskId === activeTaskId
            ? { ...task, title: nextCanvas.name, canvas: stripRuntimeStateFromCanvas(nextCanvas) }
            : task,
        ),
      );
      return nextCanvas;
    });
  }, [activeTaskId]);

  function resetCanvas(nextCanvas: WorkspaceCanvasModel) {
    const normalizedCanvas = normalizeCanvasEdges(nextCanvas);
    const nextGraph = canvasToWorkflowGraph(normalizedCanvas);
    graphRef.current = nextGraph;
    setSourceGraph(nextGraph);
    setCanvas(normalizedCanvas);
    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.taskId === activeTaskId
          ? {
              ...task,
              title: normalizedCanvas.name,
              canvas: stripRuntimeStateFromCanvas(normalizedCanvas),
              authoring: emptyWorkbenchAuthoringState(),
            }
          : task,
      ),
    );
    setAssistantProposal(null);
  }

  function updateCanvasAndGraph(next: SetStateAction<WorkspaceCanvasModel>) {
    setCanvas((current) => {
      const nextCanvas =
        normalizeCanvasEdges(
          typeof next === 'function'
            ? (next as (current: WorkspaceCanvasModel) => WorkspaceCanvasModel)(current)
            : next,
        );
      const nextGraph = canvasToWorkflowGraph(nextCanvas);
      graphRef.current = nextGraph;
      setSourceGraph(nextGraph);
      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.taskId === activeTaskId
            ? { ...task, title: nextCanvas.name, canvas: stripRuntimeStateFromCanvas(nextCanvas) }
            : task,
        ),
      );
      return nextCanvas;
    });
  }

  useEffect(() => {
    graphRef.current = sourceGraph;
  }, [sourceGraph]);

  useEffect(() => {
    if (!currentTask) {
      return;
    }
    const runId = currentTask.activeRunId || currentTask.latestRunId;
    if (!runId || runsById[runId]?.run) {
      return;
    }

    let ignore = false;
    const taskGraph = canvasToWorkflowGraph(currentTask.canvas);
    api
      .run(runId)
      .then(async (summary) => {
        if (ignore) {
          return;
        }
        const restoredRun = await api
          .runState(runId)
          .then((state) => workflowRunFromRunStateSnapshot(state, taskGraph))
          .catch(() => workflowRunFromRunSummary(summary, taskGraph));
        const events = await api.runEvents(runId).catch(() => null);
        if (ignore) {
          return;
        }
        const liveRun = events
          ? mergeWorkflowRunWithEvents(
              restoredRun,
              liveWorkflowRunFromEvents(taskGraph, summary.run_dir || `runs/${runId}`, events.events || []),
            )
          : restoredRun;
        const overlay = runOverlayFromRun(liveRun, {
          runId,
          scope: 'task',
          targetId: taskGraph.id,
        });
        setRunsById((current) => ({
          ...current,
          [runId]: {
            runId,
            taskId: currentTask.taskId,
            status: normalizeTaskRunStatus(restoredRun.status),
            scope: 'task',
            targetId: taskGraph.id,
            graph: taskGraph,
            runDir: summary.run_dir,
            summary,
            run: liveRun,
            events: events?.events || [],
            overlay,
            pollState: 'idle',
          },
        }));
        setTasks((current) =>
          current.map((task) =>
            task.taskId === currentTask.taskId
              ? {
                  ...task,
                  status: taskStatusFromRunStatus(restoredRun.status),
                  latestRunId: runId,
                  activeRunId: isActiveRunStatus(restoredRun.status) ? runId : undefined,
                }
              : task,
          ),
        );
      })
      .catch(() => {
        if (ignore) {
          return;
        }
        setRunsById((current) => {
          const next = { ...current };
          delete next[runId];
          return next;
        });
      });

    return () => {
      ignore = true;
    };
  }, [currentTask?.activeRunId, currentTask?.latestRunId, currentTask?.taskId, runsById]);

  useEffect(() => {
    let ignore = false;
    const workflowIds = Array.from(new Set([canvas.id, ...canvas.workflows.map((item) => item.id)]));
    Promise.all(
      workflowIds.map((workflowId) =>
        api
          .workflowBinding(workflowId)
          .then((binding) => [workflowId, normalizeBinding(binding, workflowId)] as const)
          .catch(
            () =>
              [
                workflowId,
                {
                  workflowId,
                  bindingPath: `bindings/${workflowId}.binding.local.json`,
                  workspaceRoot: null,
                  exists: false,
                  status: 'unbound',
                },
              ] as const,
          ),
      ),
    ).then((entries) => {
      if (ignore) {
        return;
      }
      setWorkflowBindings(Object.fromEntries(entries));
    });
    return () => {
      ignore = true;
    };
  }, [workflowBindingKey]);

  useEffect(() => {
    if (!openedExternalWorkflow || !selectedWorkflowId) {
      return;
    }
    let ignore = false;
    api.workflow(selectedWorkflowId).then((workflow) => {
      if (ignore) {
        return;
      }
      const nextGraph = normalizeWorkflowGraph(workflow.graph || graphFromLegacyWorkflow(workflow));
      const nextCanvas = normalizeCanvasEdges(graphToWorkspaceCanvas(nextGraph, workflowRun));
      const nextNormalizedGraph = canvasToWorkflowGraph(nextCanvas);
      graphRef.current = nextNormalizedGraph;
      setSourceGraph(nextNormalizedGraph);
      setCanvas(nextCanvas);
      setSelection(
        nextCanvas.workflows[0]
          ? { type: 'workflow', id: nextCanvas.workflows[0].id }
          : { type: 'workflow', id: nextCanvas.rootWorkflowId },
      );
      setMessage(`已打开 ${workflow.workflow_id}`);
      closeEvidenceDock();
    });
    return () => {
      ignore = true;
    };
  }, [openedExternalWorkflow, selectedWorkflowId]);

  const displayCanvas = useMemo(() => applyRunOverlayToCanvas(canvas, runOverlay), [canvas, runOverlay]);
  const selectedWorkflow =
    selection.type === 'workflow'
      ? displayCanvas.workflows.find((workflow) => workflow.id === selection.id)
      : selection.type === 'port' || selection.type === 'internal'
        ? displayCanvas.workflows.find((workflow) => workflow.id === selection.workflowId)
        : undefined;
  const selectedEdgeAddress = selectionEdgeAddress(displayCanvas, selection);
  const selectedEdge = findCanvasEdgeByAddress(displayCanvas, selectedEdgeAddress);
  const selectedPort =
    selection.type === 'port'
      ? selectedWorkflow?.[selection.direction === 'input' ? 'inputPorts' : 'outputPorts'].find(
          (port) => port.id === selection.portId,
        )
      : undefined;
  const selectedInternalNode =
    selection.type === 'internal'
      ? selectedWorkflow?.internalNodes.find((node) => node.id === selection.nodeId)
      : undefined;
  const selectedLiveLogs = selectedRunId ? runLogsById[selectedRunId] || {} : {};
  const selectedRunLiveEvents = selectedRunId ? runLiveEventsById[selectedRunId] || [] : [];
  const selectedNodeRunLookup = useMemo<NodeRunLookupContext>(
    () => ({
      scope: selectedRunProjection?.scope,
      targetId: selectedRunProjection?.targetId,
      parentWorkflowId:
        typeof selectedRunProjection?.graph.metadata?.parent_workflow_id === 'string'
          ? selectedRunProjection.graph.metadata.parent_workflow_id
          : undefined,
    }),
    [
      selectedRunProjection?.graph.metadata,
      selectedRunProjection?.scope,
      selectedRunProjection?.targetId,
    ],
  );
  const rawSelectedNodeRun = useMemo(
    () => selectedNodeRunForSelection(workflowRun, selection, selectedWorkflow, selectedInternalNode, selectedNodeRunLookup),
    [selection, selectedInternalNode, selectedNodeRunLookup, selectedWorkflow, workflowRun],
  );
  const rawSelectedNodeRunDetailKey =
    selectedRunId && rawSelectedNodeRun ? nodeRunDetailCacheKey(selectedRunId, rawSelectedNodeRun) : '';

  useEffect(() => {
    if (!selectedRunId || !rawSelectedNodeRun || !rawSelectedNodeRunDetailKey) {
      return undefined;
    }
    if (nodeRunDetailsByKey[rawSelectedNodeRunDetailKey]) {
      return undefined;
    }
    let cancelled = false;
    api
      .node(selectedRunId, rawSelectedNodeRun.node_id)
      .then((detail) => {
        if (cancelled) {
          return;
        }
        setNodeRunDetailsByKey((current) => ({
          ...current,
          [rawSelectedNodeRunDetailKey]: mergeNodeRunDetail(rawSelectedNodeRun, detail),
        }));
      })
      .catch(() => {
        // The lightweight run summary remains usable if detail projection is not available yet.
      });
    return () => {
      cancelled = true;
    };
  }, [nodeRunDetailsByKey, rawSelectedNodeRun, rawSelectedNodeRunDetailKey, selectedRunId]);

  const enrichedWorkflowRun = useMemo(
    () => mergeWorkflowRunNodeDetails(workflowRun, selectedRunId, nodeRunDetailsByKey),
    [nodeRunDetailsByKey, selectedRunId, workflowRun],
  );
  const selectedNodeSettings = useMemo(
    () =>
      selectedNodeSettingsModel({
        canvas: displayCanvas,
        selection,
        selectedWorkflow,
        selectedInternalNode,
        workflowRun: enrichedWorkflowRun,
        liveLogs: selectedLiveLogs,
        nodeRunLookup: selectedNodeRunLookup,
      }),
    [
      selection,
      selectedWorkflow,
      selectedInternalNode,
      enrichedWorkflowRun,
      selectedLiveLogs,
      selectedNodeRunLookup,
      displayCanvas,
    ],
  );
  const selectedCallableLookupId =
    selectedNodeSettings?.temporaryResourceId || isTemporaryCallableId(selectedNodeSettings?.callableId)
    ? ''
    : selectedNodeSettings?.callableId || '';
  const selectedCallableDetailState = useCallableDetail(selectedCallableLookupId);
  const selectedDetailsModel = useMemo(
    () =>
      selectedEntityDetailsModel({
        canvas: displayCanvas,
        selection,
        selectedWorkflow,
        selectedPort,
        selectedEdge,
        selectedInternalNode,
        selectedNodeSettings,
        workflowRun: enrichedWorkflowRun,
        workflowEvents,
        liveLogs: selectedLiveLogs,
        runtimeConfig,
        binding: selectedWorkflow ? workflowBindings[selectedWorkflow.id] : undefined,
        currentTask,
      }),
    [
      currentTask,
      displayCanvas,
      runtimeConfig,
      selectedEdge,
      selectedInternalNode,
      selectedLiveLogs,
      selectedNodeSettings,
      selectedPort,
      selectedWorkflow,
      selection,
      workflowBindings,
      workflowEvents,
      enrichedWorkflowRun,
    ],
  );
  const selectedAgentNodeRun =
    selectedNodeSettings && selectedNodeSettings.kind !== 'Tool' ? selectedNodeSettings.run : undefined;
  const selectedAgentSessionContext = useMemo(
    () =>
      selectedRunId && selectedAgentNodeRun
        ? {
            runId: selectedRunId,
            nodeId: selectedAgentNodeRun.node_id,
            uiNodeId: selectedAgentNodeRun.ui_node_id || '',
            parentNodeId: selectedAgentNodeRun.parent_node_id || '',
            nodeRunDir: effectiveNodeRunDir(selectedAgentNodeRun) || '',
          }
        : null,
    [selectedAgentNodeRun, selectedRunId],
  );
  const selectedAgentLiveState = useMemo(
    () => liveStateForNodeRun(selectedRunLiveEvents, selectedAgentNodeRun),
    [selectedAgentNodeRun, selectedRunLiveEvents],
  );
  const selectedAgentTurnLiveScope = useMemo<WorkbenchLiveStreamScope | null>(
    () =>
      agentSessionState.session && agentSessionState.pendingTurn
        ? {
            kind: 'turn',
            sessionId: agentSessionState.session.session_id,
            turnId: agentSessionState.pendingTurn.turn_id,
            source: 'agent_turn',
          }
        : null,
    [agentSessionState.pendingTurn, agentSessionState.session],
  );
  const selectedAgentTurnLiveState = useWorkbenchLiveStream(selectedAgentTurnLiveScope);
  const assistantLiveScope = useMemo<WorkbenchLiveStreamScope | null>(
    () =>
      assistantSessionId && assistantPendingTurn
        ? {
            kind: 'turn',
            sessionId: assistantSessionId,
            turnId: assistantPendingTurn.turn_id,
            source: 'assistant_turn',
          }
        : null,
    [assistantPendingTurn, assistantSessionId],
  );
  const assistantLiveState = useWorkbenchLiveStream(assistantLiveScope);
  const selectedAgentEvents =
    selectedAgentSessionContext && (agentSessionState.status === 'ready' || agentSessionState.status === 'loading')
      ? agentSessionState.events
      : selectedDetailsModel.events;
  const selectedDetailsModelWithAgentEvents = useMemo(
    () =>
      selectedDetailsModel.nodeRun
        ? { ...selectedDetailsModel, events: selectedAgentEvents }
        : selectedDetailsModel,
    [selectedAgentEvents, selectedDetailsModel],
  );

  const refreshRunProjection = useCallback(
    async (runId: string) => {
      const current = runsById[runId];
      if (!current) {
        return;
      }
      const [summary, stateSnapshot, result] = await Promise.all([
        api.run(runId),
        api.runState(runId).catch(() => null),
        api.runEvents(runId).catch(() => ({ events: [] as RunEvent[] })),
      ]);
      const snapshotRun = stateSnapshot
        ? workflowRunFromRunStateSnapshot(stateSnapshot, current.graph)
        : workflowRunFromRunSummary(summary, current.graph);
      const liveRun = mergeWorkflowRunWithEvents(
        snapshotRun,
        liveWorkflowRunFromEvents(current.graph, summary.run_dir || current.runDir, result.events),
      );
      const runStatus = normalizeTaskRunStatus(summary.status || liveRun.status);
      const overlay = runOverlayFromRun({ ...liveRun, status: runStatus }, {
        runId,
        scope: current.scope,
        targetId: current.targetId,
      });
      setRunsById((state) => ({
        ...state,
        [runId]: {
          ...current,
          status: runStatus,
          summary,
          run: { ...liveRun, status: runStatus },
          events: result.events,
          overlay,
        },
      }));
    },
    [runsById],
  );

  const refreshAgentSession = useCallback(async () => {
    if (!selectedAgentSessionContext) {
      setAgentSessionState({
        status: 'idle',
        session: null,
        messages: [],
        events: [],
        pendingTurn: null,
        interactions: [],
        error: '',
      });
      return;
    }
    const { runId, nodeId, nodeRunDir, uiNodeId, parentNodeId } = selectedAgentSessionContext;
    setAgentSessionState((current) => ({
      ...current,
      status: current.session ? 'ready' : 'loading',
      error: '',
    }));
    try {
      const session = await api.createAgentSessionFromRunNode(runId, nodeId, {
        nodeRunDir,
        uiNodeId,
        parentNodeId,
      });
      const [messages, nodeEvents, interactions] = await Promise.all([
        api.getAgentSessionMessages(session.session_id).catch(() => ({ messages: [] as AgentMessage[] })),
        api.nodeEvents(runId, nodeId, 200, { nodeRunDir }).catch(() => ({ events: [] as RunEvent[] })),
        api.runInteractions(runId).catch(() => ({ interactions: [] as InteractionRequest[] })),
      ]);
      setAgentSessionState((current) => {
        const pendingTurn =
          current.pendingTurn &&
          current.pendingTurn.turn_id === session.last_turn_id &&
          ['queued', 'running'].includes(String(session.status || ''))
            ? current.pendingTurn
            : null;
        return {
          status: 'ready',
          session,
          messages: messages.messages || [],
          events: nodeEvents.events || [],
          pendingTurn,
          interactions: (interactions.interactions || []).filter(
            (item) => item.status === 'pending' && (!item.node_id || item.node_id === nodeId),
          ),
          error: '',
        };
      });
    } catch (error) {
      setAgentSessionState({
        status: 'error',
        session: null,
        messages: [],
        events: [],
        pendingTurn: null,
        interactions: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [selectedAgentSessionContext]);

  useEffect(() => {
    void refreshAgentSession();
  }, [refreshAgentSession]);

  useEffect(() => {
    const pendingTurn = agentSessionState.pendingTurn;
    const session = agentSessionState.session;
    if (!pendingTurn || !session) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void Promise.all([
        api.getAgentSession(session.session_id),
        api.getAgentSessionMessages(session.session_id).catch(() => ({ messages: [] as AgentMessage[] })),
        api.getAgentTurnEvents(session.session_id, pendingTurn.turn_id).catch(() => ({ events: [] as RunEvent[] })),
      ])
        .then(([nextSession, messages, turnEvents]) => {
          setAgentSessionState((current) => ({
            ...current,
            status: 'ready',
            session: nextSession,
            messages: messages.messages || [],
            events: mergeAgentEvents(current.events, turnEvents.events || []),
            pendingTurn: ['queued', 'running'].includes(String(nextSession.status || ''))
              ? pendingTurn
              : null,
            error: '',
          }));
        })
        .catch(() => {
          void refreshAgentSession();
        });
    }, 1000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [agentSessionState.pendingTurn, agentSessionState.session, refreshAgentSession]);

  const normalizedSelection = useMemo(
    () => normalizeWorkbenchSelection(displayCanvas, selection, focusedWorkflowId),
    [displayCanvas, focusedWorkflowId, selection],
  );
  const paletteTargetWorkflow =
    focusedWorkflowId
      ? canvas.workflows.find((workflow) => workflow.id === focusedWorkflowId)
      : selectedWorkflow &&
          !isExecutableNodeWorkflow(selectedWorkflow)
        ? selectedWorkflow
        : null;
  const canRunSelectedWorkflow = Boolean(selectedWorkflow && !isExecutableNodeWorkflow(selectedWorkflow));
  const canRunSelectedNode = Boolean(
    selectedInternalNode || (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)),
  );
  const assistantLocalValidation = useMemo(
    () =>
      assistantProposal
        ? validateCanvasAuthoringProposal(assistantProposal, {
            canvas,
            taskId: activeTaskId,
            temporaryResources: currentAuthoringState.temporaryResources,
            callables,
            workflows,
          })
        : null,
    [activeTaskId, assistantProposal, callables, canvas, currentAuthoringState.temporaryResources, workflows],
  );
  const assistantValidation = useMemo(
    () => mergeAuthoringValidation(assistantLocalValidation, assistantBackendValidation),
    [assistantBackendValidation, assistantLocalValidation],
  );
  const currentAuthoringCanvasHash = useMemo(
    () => canvasAuthoringHash(activeTaskId, stripRuntimeStateFromCanvas(canvas)),
    [activeTaskId, canvas],
  );
  const canUndoAssistantApply =
    Boolean(assistantApplyUndo) &&
    assistantApplyUndo?.taskId === activeTaskId &&
    assistantApplyUndo.afterCanvasHash === currentAuthoringCanvasHash &&
    !isRunning &&
    !assistantPendingTurn;

  useEffect(() => {
    if (!durableTasksReady || !currentTask) {
      return undefined;
    }
    const persistKey = `${activeTaskId}:${currentAuthoringCanvasHash}`;
    if (lastBackendTaskPersistKeyRef.current === persistKey) {
      return undefined;
    }
    if (backendTaskPersistTimerRef.current) {
      window.clearTimeout(backendTaskPersistTimerRef.current);
    }
    const taskSnapshot: WorkbenchTask = {
      ...currentTask,
      canvas: stripRuntimeStateFromCanvas(canvas),
    };
    backendTaskPersistTimerRef.current = window.setTimeout(() => {
      backendTaskPersistTimerRef.current = null;
      lastBackendTaskPersistKeyRef.current = persistKey;
      void persistWorkbenchTaskToBackend(taskSnapshot, callables, workflows).catch((error) => {
        lastBackendTaskPersistKeyRef.current = '';
        console.warn('Workbench task autosave failed', error);
      });
    }, 700);
    return () => {
      if (backendTaskPersistTimerRef.current) {
        window.clearTimeout(backendTaskPersistTimerRef.current);
        backendTaskPersistTimerRef.current = null;
      }
    };
  }, [
    activeTaskId,
    callables,
    canvas,
    currentAuthoringCanvasHash,
    currentTask,
    durableTasksReady,
    workflows,
  ]);

  useEffect(() => {
    if (selectionKey(normalizedSelection) !== selectionKey(selection)) {
      setSelection(normalizedSelection);
      if (normalizedSelection.type === 'task_canvas') {
        setChrome((current) => ({ ...current, rightPanel: 'none' }));
        setNodeDetailOpen(false);
      }
    }
  }, [normalizedSelection, selection]);

  useEffect(() => {
    if (connectionMode !== 'data') {
      setDataConnectionDraft(null);
    }
  }, [connectionMode]);

  useEffect(() => {
    if (!dataConnectionDraft) {
      return;
    }
    const sourceNode = findDataConnectNode(
      displayCanvas,
      dataConnectionDraft.scopeWorkflowId,
      dataConnectionDraft.sourceNodeId,
    );
    const hasSourcePort = sourceNode?.outputPorts.some(
      (portValue) => portValue.id === dataConnectionDraft.sourcePortId,
    );
    if (!sourceNode || !hasSourcePort) {
      setDataConnectionDraft(null);
    }
  }, [dataConnectionDraft, displayCanvas]);

  function createDemo() {
    const nextCanvas = layoutWorkspaceCanvas(workspaceDemoCanvas());
    resetCanvas(nextCanvas);
    setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
    setOpenedExternalWorkflow(false);
    setMessage('已加载 Core v2 股市调研示例');
  }

  function openWorkflow(workflowId: string) {
    setOpenedExternalWorkflow(true);
    onSelect(workflowId);
  }

  function switchTask(taskId: string) {
    const task = tasks.find((item) => item.taskId === taskId);
    if (!task) {
      return;
    }
    setActiveTaskId(task.taskId);
    const nextCanvas = normalizeCanvasEdges(task.canvas);
    const nextGraph = canvasToWorkflowGraph(nextCanvas);
    graphRef.current = nextGraph;
    setSourceGraph(nextGraph);
    setCanvas(nextCanvas);
    setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
    resetAssistantConversationState();
    setFocusedWorkflowId(null);
    closeEvidenceDock();
  }

  function newTask() {
    const taskId = `task_canvas_${Date.now()}`;
    const task = createEmptyTask(taskId, nextTaskTitle(tasks));
    const nextCanvas = normalizeCanvasEdges(task.canvas);
    setTasks((current) => [...current, { ...task, canvas: nextCanvas }]);
    setActiveTaskId(task.taskId);
    const nextGraph = canvasToWorkflowGraph(nextCanvas);
    graphRef.current = nextGraph;
    setSourceGraph(nextGraph);
    setCanvas(nextCanvas);
    setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
    setFocusedWorkflowId(null);
    resetAssistantConversationState();
    closeEvidenceDock();
    if (durableTasksReady) {
      void api.createWorkbenchTask({ task_id: task.taskId, title: task.title }).catch(() => {
        // The debounced canvas save can recreate the durable task if this request races.
      });
    }
  }

  function deleteTask(taskId: string) {
    const targetTask = tasks.find((task) => task.taskId === taskId);
    if (targetTask && isActiveTaskStatus(targetTask.status)) {
      setMessage('任务正在运行，请先停止后再删除。');
      return;
    }
    const remaining = tasks.filter((task) => task.taskId !== taskId);
    const nextTasks = remaining.length > 0 ? remaining : [createEmptyTask(DEFAULT_TASK_ID, '任务 1')];
    const nextActiveTask =
      taskId === activeTaskId
        ? nextTasks[0]
        : nextTasks.find((task) => task.taskId === activeTaskId) || nextTasks[0];
    setTasks(nextTasks);
    setActiveTaskId(nextActiveTask.taskId);
    const nextCanvas = normalizeCanvasEdges(nextActiveTask.canvas);
    const nextGraph = canvasToWorkflowGraph(nextCanvas);
    graphRef.current = nextGraph;
    setSourceGraph(nextGraph);
    setCanvas(nextCanvas);
    setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
    resetAssistantConversationState();
    setMessage(`已删除任务 ${taskId}`);
    if (durableTasksReady) {
      void api.deleteWorkbenchTask(taskId).catch((error) => {
        setMessage(error instanceof Error ? error.message : String(error));
      });
    }
  }

  function autoLayout() {
    updateCanvasAndGraph((current) => layoutWorkspaceCanvas(current));
    setLayoutSyncVersion((current) => current + 1);
    setMessage('已按连接关系重新布局整个任务');
  }

  const startInspectorResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = inspectorWidth;
      const move = (nextEvent: PointerEvent) => {
        const nextWidth = clamp(startWidth + startX - nextEvent.clientX, INSPECTOR_MIN_WIDTH, INSPECTOR_MAX_WIDTH);
        setChrome((current) => ({ ...current, inspectorWidth: nextWidth }));
      };
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop, { once: true });
    },
    [inspectorWidth],
  );

  const handleCanvasLayoutPointerDown = useCallback(
    (_event: ReactPointerEvent<HTMLDivElement>) => {},
    [],
  );
  const handleCanvasLayoutClick = useCallback(
    (_event: ReactMouseEvent<HTMLDivElement>) => {},
    [],
  );
  const selectCanvasObject = useCallback((nextSelection: CanvasSelection) => {
    setSelection(nextSelection);
    if (!isInspectableNodeSelection(nextSelection)) {
      setNodeDetailOpen(false);
      setChrome((current) => ({ ...current, rightPanel: 'none' }));
      return;
    }
    setChrome((current) => ({ ...current, rightPanel: 'inspector' }));
  }, []);

  const openNodeDetails = useCallback((nextSelection: CanvasSelection) => {
    setSelection(nextSelection);
    if (!isInspectableNodeSelection(nextSelection)) {
      setNodeDetailOpen(false);
      return;
    }
    setNodeDetailOpen(true);
    setChrome((current) => ({
      ...current,
      rightPanel: 'none',
    }));
  }, []);

  const deleteSelectedCanvasObject = useCallback((targetSelection = selection) => {
    const eligibility = selectionCanBeDeleted(canvas, targetSelection, isRunning);
    if (!eligibility.ok) {
      if (eligibility.reason) {
        setMessage(eligibility.reason);
      }
      return;
    }
    updateCanvas((current) => deleteSelectionFromCanvas(current, targetSelection));
    setSelection({ type: 'task_canvas', taskId: canvas.id });
    setMessage('已删除选中的画布对象。');
  }, [canvas, isRunning, selection, updateCanvas]);

  function currentTemporaryResourceIssue(): string | null {
    return temporaryResourceIssueForCanvas(stripRuntimeStateFromCanvas(canvas), currentTask?.authoring);
  }

  async function ensureBoundaryTransfersValid() {
    let preview: BoundaryTransferPreview;
    try {
      preview = await api.boundaryTransferPreview({
        canvas_snapshot: boundaryTransferPreviewSnapshot(canvas),
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      throw new Error(`边界控制线 preview 暂不可用: ${text}`);
    }
    if (!boundaryTransferPreviewHasErrors(preview)) {
      return;
    }
    const messages = preview.diagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
    throw new Error(messages.join('；') || '边界控制线存在无法运行的配置错误。');
  }

  function reportTemporaryResourceIssue(issue: string) {
    setMessage(issue);
    setEvidenceDock({
      open: true,
      title: 'AI 临时资源阻断',
      content: textArtifact('temporary-resource-blocker.log', issue, 'log'),
      owner: {
        kind: 'validation',
        taskId: activeTaskId,
        createdAt: new Date().toISOString(),
      },
    });
  }

  function requestSaveWorkflow() {
    const issue = currentTemporaryResourceIssue();
    if (issue) {
      reportTemporaryResourceIssue(issue);
      return;
    }
    if (isJsdomRuntime()) {
      void saveGraph();
      return;
    }
    const baseGraph = reusableWorkflowClassGraph(
      graphForCurrentView(stripRuntimeStateFromCanvas(canvas), focusedWorkflowId),
    );
    setSaveWorkflowDialog({
      name: baseGraph.name || canvas.name || 'workflow',
      saving: false,
      error: null,
    });
  }

  async function confirmSaveWorkflow() {
    const requestedName = saveWorkflowDialog?.name.trim() || '';
    if (!requestedName) {
      setSaveWorkflowDialog((current) =>
        current ? { ...current, error: 'Workflow 名称不能为空' } : current,
      );
      return;
    }
    setSaveWorkflowDialog((current) =>
      current ? { ...current, saving: true, error: null } : current,
    );
    try {
      await saveGraph({ requestedName });
      setSaveWorkflowDialog(null);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setSaveWorkflowDialog((current) =>
        current ? { ...current, saving: false, error: text } : current,
      );
    }
  }

  async function saveGraph(
    options: {
      selectSavedWorkflow?: boolean;
      refreshIndex?: boolean;
      requestedName?: string | null;
    } = {},
  ) {
    const issue = currentTemporaryResourceIssue();
    if (issue) {
      throw new Error(issue);
    }
    await ensureBoundaryTransfersValid();
    const { selectSavedWorkflow = true, refreshIndex = true, requestedName = null } = options;
    const baseGraph = reusableWorkflowClassGraph(
      graphForCurrentView(stripRuntimeStateFromCanvas(canvas), focusedWorkflowId),
    );
    const graph = requestedName
      ? {
          ...baseGraph,
          id: slugId(requestedName) === 'node' ? `workflow_${Date.now()}` : slugId(requestedName),
          name: requestedName,
        }
      : baseGraph;
    graphRef.current = graph;
    setSourceGraph(graph);
    const result = await api.saveWorkflow(graph, true);
    setMessage(`已保存 ${result.workflow_id}`);
    if (selectSavedWorkflow) {
      onSelect(result.workflow_id);
    }
    if (refreshIndex) {
      closeEvidenceDock();
      onChanged?.();
    }
  }

  async function validateGraph() {
    const issue = currentTemporaryResourceIssue();
    if (issue) {
      reportTemporaryResourceIssue(issue);
      return;
    }
    try {
      await saveGraph({ selectSavedWorkflow: false, refreshIndex: false });
      const result = await api.validateWorkflow(graphRef.current.id);
      setMessage(`校验通过: ${result.workflow_id}`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(`校验失败: ${text}`);
      setEvidenceDock({
        open: true,
        title: '校验错误',
        content: textArtifact('validation-error.log', text, 'log'),
        owner: {
          kind: 'validation',
          taskId: activeTaskId,
          createdAt: new Date().toISOString(),
        },
      });
    }
  }

  async function runGraph() {
    const issue = currentTemporaryResourceIssue();
    if (issue) {
      reportTemporaryResourceIssue(issue);
      return;
    }
    await runWorkflowGraph(graphForCurrentView(stripRuntimeStateFromCanvas(canvas), null), 'task', canvas.id);
  }

  async function runSelectedWorkflow() {
    const issue = currentTemporaryResourceIssue();
    if (issue) {
      reportTemporaryResourceIssue(issue);
      return;
    }
    if (!selectedWorkflow || isExecutableNodeWorkflow(selectedWorkflow)) {
      return;
    }
    try {
      await ensureBoundaryTransfersValid();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(`运行失败: ${text}`);
      return;
    }
    await runWorkflowGraph(internalWorkflowToGraph(stripRuntimeStateFromWorkflow(selectedWorkflow)), 'workflow', selectedWorkflow.id);
  }

  async function runSelectedNode() {
    const issue = currentTemporaryResourceIssue();
    if (issue) {
      reportTemporaryResourceIssue(issue);
      return;
    }
    const node =
      selectedInternalNode ||
      (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)
        ? internalNodeFromExecutableWorkflow(selectedWorkflow, { x: 0, y: 0 })
        : null);
    if (!node) {
      return;
    }
    await runWorkflowGraph(singleNodeWorkflowGraph(node, selectedWorkflow?.id || canvas.id), 'node', node.id);
  }

  async function runWorkflowGraph(graph: WorkflowGraph, scope: RunOverlayState['scope'], targetId: string) {
    const graphIssue = temporaryResourceIssueForGraph(graph);
    if (graphIssue) {
      reportTemporaryResourceIssue(graphIssue);
      return;
    }
    if (scope === 'task') {
      try {
        await ensureBoundaryTransfersValid();
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        setMessage(`运行失败: ${text}`);
        return;
      }
    }
    const runId = `ui_workflow_${graph.id}_${Date.now()}`;
    const runDir = `runs/${runId}`;
    const runnableGraph: WorkflowGraph = {
      ...graph,
      id: runId,
      name: graph.name ? `${graph.name} run` : `${graph.id} run`,
    };
    const binding = workflowBindings[graph.id];
    const bindingPath = binding?.exists ? bindingPathOf(binding) : '';
    const taskId = activeTaskId;

    async function pollRunUntilTerminal() {
      try {
        const [summary, stateSnapshot, result] = await Promise.all([
          api.run(runId),
          api.runState(runId).catch(() => null),
          api.runEvents(runId).catch(() => ({ events: [] as RunEvent[] })),
        ]);
        const snapshotRun = stateSnapshot
          ? workflowRunFromRunStateSnapshot(stateSnapshot, runnableGraph)
          : workflowRunFromRunSummary(summary, runnableGraph);
        const liveRun = mergeWorkflowRunWithEvents(
          snapshotRun,
          liveWorkflowRunFromEvents(runnableGraph, summary.run_dir || runDir, result.events),
        );
        const runStatus = normalizeTaskRunStatus(summary.status || liveRun.status);
        const overlay = runOverlayFromRun({ ...liveRun, status: runStatus }, { runId, scope, targetId });
        setRunsById((current) => ({
          ...current,
          [runId]: {
            ...(current[runId] || {
              runId,
              taskId,
              scope,
              targetId,
              graph: runnableGraph,
              runDir,
            }),
            status: runStatus,
            summary,
            run: { ...liveRun, status: runStatus },
            events: result.events,
            overlay,
            pollState: 'polling',
          },
        }));
        setTasks((current) =>
          current.map((task) =>
            task.taskId === taskId
              ? {
                  ...task,
                  status: taskStatusFromRunStatus(runStatus),
                  activeRunId: isActiveRunStatus(runStatus) ? runId : undefined,
                  latestRunId: runId,
                }
              : task,
          ),
        );
        if (isActiveRunStatus(runStatus)) {
          window.setTimeout(() => {
            void pollRunUntilTerminal();
          }, selectedRunId === runId ? 1000 : 2500);
          return;
        }
        setMessage(`运行 ${liveRun.workflow_id}: ${statusLabel(runStatus)}`);
        onChanged?.();
      } catch {
        updateRunProjection(runId, (current) => ({ ...current, pollState: 'error' }));
        window.setTimeout(() => {
          void pollRunUntilTerminal();
        }, 2500);
      }
    }

    try {
      if (scope === 'task') {
        graphRef.current = graph;
        setSourceGraph(graph);
      }
      const initialRun = liveWorkflowRunFromEvents(runnableGraph, runDir, []);
      const initialOverlay = runOverlayFromRun({ ...initialRun, status: 'queued' }, { runId, scope, targetId });
      setRunsById((current) => ({
        ...current,
        [runId]: {
          runId,
          taskId,
          status: 'queued',
          scope,
          targetId,
          graph: runnableGraph,
          runDir,
          run: { ...initialRun, status: 'queued' },
          events: [],
          overlay: initialOverlay,
          pollState: 'idle',
        },
      }));
      setTasks((current) =>
        current.map((task) =>
          task.taskId === taskId
            ? { ...task, status: 'queued', activeRunId: runId, latestRunId: runId }
            : task,
        ),
      );
      setMessage(`运行 ${graph.id}: 已提交，等待节点事件...`);
      setEvidenceDock((current) => ({
        open: current.open,
        title: '运行证据',
        content: null,
        owner: { kind: 'run', taskId, runId, createdAt: new Date().toISOString() },
      }));
      const submitted = await runnerApi.submitJob(runnableGraph, {
        runId,
        taskId,
        ...(bindingPath ? { bindingRef: bindingRefOfPath(bindingPath) } : {}),
      });
      setTasks((current) =>
        current.map((task) =>
          task.taskId === taskId
            ? {
                ...task,
                status: taskStatusFromRunStatus(submitted.status),
                activeRunId: runId,
                latestRunId: runId,
              }
            : task,
        ),
      );
      void pollRunUntilTerminal();
      setMessage(`运行 ${runId}: 已提交`);
      onChanged?.();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(`运行失败: ${text}`);
      setEvidenceDock({
        open: true,
        title: '运行错误',
        content: textArtifact('run-error.log', text, 'log'),
        owner: { kind: 'run', taskId, runId, createdAt: new Date().toISOString() },
      });
      updateRunProjection(runId, (current) => ({ ...current, status: 'failed', pollState: 'error' }));
      setTasks((current) =>
        current.map((task) =>
          task.taskId === taskId
            ? { ...task, status: 'failed', activeRunId: undefined, latestRunId: runId }
            : task,
        ),
      );
    }
  }

  async function readEvidence(path: string | null | undefined, title = '运行证据') {
    if (!path) {
      return;
    }
    const content = await readEvidenceContent(path, selectedRunId);
    setEvidenceDock({
      open: true,
      title,
      content: truncateLargeLog(content),
      owner: {
        kind: 'artifact',
        taskId: activeTaskId,
        runId: selectedRunId || undefined,
        createdAt: new Date().toISOString(),
      },
    });
  }

  async function ensureArtifactContent(path: string | null | undefined) {
    if (!path || artifactCacheByPath[path]) {
      return;
    }
    try {
      const content = await readEvidenceContent(path, selectedRunId);
      setArtifactCacheByPath((current) => ({
        ...current,
        [path]: truncateLargeLog(content),
      }));
    } catch {
      setArtifactCacheByPath((current) => ({
        ...Object.fromEntries(Object.entries(current).filter(([key]) => key !== path)),
      }));
    }
  }

  async function saveBinding(workflowId: string, workspaceRoot: string) {
    const result = await api.saveWorkflowBinding(workflowId, workspaceRoot);
    const normalized = normalizeBinding(result, workflowId);
    setWorkflowBindings((current) => ({ ...current, [workflowId]: normalized }));
    updateCanvas((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId
          ? { ...workflow, bindingPath: bindingPathOf(normalized), directory: workspaceRootOf(normalized) }
          : workflow,
      ),
    }));
    setMessage(`已保存 ${workflowId} workspace binding`);
    return normalized;
  }

  async function validateBinding(workflowId: string, workspaceRoot: string) {
    const result = await api.validateWorkflowBinding(workflowId, workspaceRoot);
    return normalizeBinding(result, workflowId);
  }

  async function openBindingsFolder(workflowId: string) {
    await api.openWorkflowBindingFolder(workflowId);
    setMessage(`已打开 ${workflowId} 的 bindings 目录`);
  }

  async function selectBindingDirectory(
    workflowId: string,
    initialDir: string,
  ): Promise<WorkflowDirectorySelection> {
    return api.selectWorkflowBindingDirectory(workflowId, { initialDir });
  }

  function updateWorkflowInvocationInput(workflowId: string, input: Record<string, unknown>) {
    updateCanvasAndGraph((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId ? { ...workflow, sourceInput: input } : workflow,
      ),
    }));
  }

  function updateInternalInvocationInput(
    workflowId: string,
    nodeId: string,
    input: Record<string, unknown>,
  ) {
    updateCanvasAndGraph((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId
          ? {
              ...workflow,
              internalNodes: workflow.internalNodes.map((node) =>
                node.id === nodeId ? { ...node, input } : node,
              ),
            }
          : workflow,
      ),
    }));
  }

  function updateWorkflowInvocationLabel(workflowId: string, label: string) {
    const nextLabel = label.trim();
    updateCanvas((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId
          ? {
              ...workflow,
              invocationLabel: nextLabel || workflow.id,
              title: nextLabel || workflow.id,
            }
          : workflow,
      ),
    }));
  }

  function updateInternalInvocationLabel(workflowId: string, nodeId: string, label: string) {
    const nextLabel = label.trim();
    updateCanvas((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId
          ? {
              ...workflow,
              internalNodes: workflow.internalNodes.map((node) =>
                node.id === nodeId
                  ? {
                      ...node,
                      invocationLabel: nextLabel || node.id,
                      name: nextLabel || node.id,
                    }
                  : node,
              ),
            }
          : workflow,
      ),
    }));
  }

  function updateWorkflowForwardMainOutput(workflowId: string, value: boolean) {
    updateCanvasAndGraph((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId
          ? { ...workflow, forwardMainOutputOnControl: value }
          : workflow,
      ),
    }));
  }

  function updateInternalForwardMainOutput(
    workflowId: string,
    nodeId: string,
    value: boolean,
  ) {
    updateCanvasAndGraph((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId
          ? {
              ...workflow,
              internalNodes: workflow.internalNodes.map((node) =>
                node.id === nodeId
                  ? { ...node, forwardMainOutputOnControl: value }
                  : node,
              ),
            }
          : workflow,
      ),
    }));
  }

  function updateWorkflowEmptyInputPolicy(workflowId: string, value: EmptyInputPolicy) {
    updateCanvasAndGraph((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId ? { ...workflow, emptyInputPolicy: value } : workflow,
      ),
    }));
  }

  function updateInternalEmptyInputPolicy(
    workflowId: string,
    nodeId: string,
    value: EmptyInputPolicy,
  ) {
    updateCanvasAndGraph((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId
          ? {
              ...workflow,
              internalNodes: workflow.internalNodes.map((node) =>
                node.id === nodeId ? { ...node, emptyInputPolicy: value } : node,
              ),
            }
          : workflow,
      ),
    }));
  }

  function updateWorkflowCodexExecutionMode(workflowId: string, value: CodexExecutionMode) {
    updateCanvasAndGraph((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId
          ? { ...workflow, codexExecutionMode: normalizedCodexExecutionMode(value) }
          : workflow,
      ),
    }));
  }

  function updateInternalCodexExecutionMode(
    workflowId: string,
    nodeId: string,
    value: CodexExecutionMode,
  ) {
    updateCanvasAndGraph((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) =>
        workflow.id === workflowId
          ? {
              ...workflow,
              internalNodes: workflow.internalNodes.map((node) =>
                node.id === nodeId
                  ? { ...node, codexExecutionMode: normalizedCodexExecutionMode(value) }
                  : node,
              ),
            }
          : workflow,
      ),
    }));
  }

  function beginDataConnection(draft: Exclude<DataConnectionDraft, null>) {
    setConnectionMode('data');
    setDataConnectionDraft(draft);
    setChrome((current) => ({ ...current, rightPanel: 'inspector' }));
    setMessage(`正在连接: ${draft.sourceNodeLabel}.${draft.sourcePortId} -> 请选择目标输入`);
  }

  function cancelDataConnection() {
    setDataConnectionDraft(null);
    setMessage('已取消 Data Edge 连接');
  }

  function updateDataConnectionMaterialization(materialization: 'copy' | 'reference') {
    setDataConnectionDraft((current) => (current ? { ...current, materialization } : current));
  }

  function completeDataConnection(
    targetNodeId: string,
    targetPortId: string,
    options: { replaceExisting?: boolean } = {},
  ) {
    if (!dataConnectionDraft) {
      setMessage('请先选择一个 output port 作为 Data Edge 来源');
      return;
    }
    try {
      const result = createDataEdgeCommand(canvas, {
        ...dataConnectionDraft,
        targetNodeId,
        targetPortId,
        replaceExisting: options.replaceExisting,
      });
      updateCanvasAndGraph(result.canvas);
      setDataConnectionDraft(null);
      setSelection(selectionForEdgeAddress(edgeAddressForScope(dataConnectionDraft.scopeWorkflowId, result.edge.id)));
      setChrome((current) => ({ ...current, rightPanel: 'inspector' }));
      setMessage(
        `已创建 Data Edge: ${dataConnectionDraft.sourceNodeLabel}.${dataConnectionDraft.sourcePortId} -> ${targetNodeId}.${targetPortId}` +
          (result.autoAddedControlEdge ? '；已自动补控制依赖' : ''),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建 Data Edge 失败');
    }
  }

  function completeDataConnectionWithNewInputPort(targetNodeId: string, requestedPortId: string) {
    if (!dataConnectionDraft) {
      setMessage('请先选择一个 output port 作为 Data Edge 来源');
      return;
    }
    try {
      const portId = uniqueInputPortIdForNode(
        canvas,
        dataConnectionDraft.scopeWorkflowId,
        targetNodeId,
        requestedPortId,
      );
      const currentWithPort = addInputPortToDataConnectNode(
        canvas,
        dataConnectionDraft.scopeWorkflowId,
        targetNodeId,
        portId,
      );
      const result = createDataEdgeCommand(currentWithPort, {
        ...dataConnectionDraft,
        targetNodeId,
        targetPortId: portId,
      });
      updateCanvasAndGraph(result.canvas);
      setDataConnectionDraft(null);
      setSelection(selectionForEdgeAddress(edgeAddressForScope(dataConnectionDraft.scopeWorkflowId, result.edge.id)));
      setChrome((current) => ({ ...current, rightPanel: 'inspector' }));
      setMessage(
        `已创建输入端口 ${targetNodeId}.${portId} 并连接 Data Edge` +
          (result.autoAddedControlEdge ? '；已自动补控制依赖' : ''),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建 Data Edge 失败');
    }
  }

  function addDataConnectPort(
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    requestedPortId: string,
  ) {
    const normalizedPortId = slugId(requestedPortId || `${direction}_${Date.now()}`);
    if (!normalizedPortId) {
      setMessage('端口 id 不能为空');
      return;
    }
    try {
      updateCanvasAndGraph((current) =>
        addPortToDataConnectNode(current, scopeWorkflowId, nodeId, direction, normalizedPortId),
      );
      setMessage(`已添加 ${direction} port: ${nodeId}.${normalizedPortId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '添加端口失败');
    }
  }

  function renameDataConnectPort(
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
    requestedPortId: string,
  ) {
    const normalizedPortId = slugId(requestedPortId);
    if (!normalizedPortId) {
      setMessage('端口 id 不能为空');
      return;
    }
    try {
      updateCanvasAndGraph((current) =>
        renamePortOnDataConnectNode(current, scopeWorkflowId, nodeId, direction, portId, normalizedPortId),
      );
      setMessage(`已重命名 ${direction} port: ${nodeId}.${portId} -> ${normalizedPortId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重命名端口失败');
    }
  }

  function deleteDataConnectPort(
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
  ) {
    try {
      updateCanvasAndGraph((current) =>
        deletePortFromDataConnectNode(current, scopeWorkflowId, nodeId, direction, portId),
      );
      setMessage(`已删除 ${direction} port: ${nodeId}.${portId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除端口失败');
    }
  }

  async function generateAssistantProposal(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const snapshot = currentAuthoringSnapshot();
    const userText = assistantInput.trim();
    const effectiveTurnReason = effectiveAssistantTurnReason(assistantTurnReason, selection);
    if (!userText) {
      const text = 'Please enter a requirement.';
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'assistant', content: text },
      ]);
      setMessage(text);
      return;
    }
    setAssistantMessages((current) => [
      ...current,
      { id: authoringId('assistant_msg'), role: 'user', content: userText },
    ]);
    setAssistantBusy(true);
    try {
      const sessionId = await ensureAssistantSession(snapshot);
      const currentSession =
        assistantAgentSession && assistantAgentSession.session_id === sessionId
          ? assistantAgentSession
          : await api.getAgentSession(sessionId);
      setAssistantAgentSession(currentSession);
      const turn = await api.submitWorkbenchAssistantTurn(sessionId, {
        message: userText,
        reason: effectiveTurnReason,
        canvas_hash: snapshot.snapshot_id,
        canvas_snapshot: authoringBackendCanvasSnapshot(snapshot),
        selection: authoringSelectionPayload(snapshot.selection),
        expected_provider_session_id:
          typeof currentSession.provider_session_id === 'string'
            ? currentSession.provider_session_id
            : undefined,
      });
      setAssistantPendingTurn(turn);
      setAssistantSessionStatus(turn.status || 'queued');
      setAssistantInput('');
      setBottomDockMode('assistant');
      setEvidenceDock((current) => ({ ...current, open: true }));
      setMessage(`AI 助手 turn ${turn.turn_id}: ${turn.status || 'queued'}`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setAssistantProposal(null);
      setAssistantBackendValidation(null);
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'system', content: text },
      ]);
      setMessage(text);
      setAssistantBusy(false);
    }
  }

  function applyAssistantProposal() {
    if (!assistantProposal) {
      return;
    }
    const beforeCanvas = stripRuntimeStateFromCanvas(canvas);
    const beforeTemporaryResources = currentAuthoringState.temporaryResources;
    const beforeSelection = selection;
    try {
      const result = applyCanvasAuthoringProposal({
        canvas,
        taskId: activeTaskId,
        proposal: assistantProposal,
        temporaryResources: currentAuthoringState.temporaryResources,
        callables,
        workflows,
      });
      const nextGraph = canvasToWorkflowGraph(result.canvas);
      const afterCanvasHash = canvasAuthoringHash(activeTaskId, stripRuntimeStateFromCanvas(result.canvas));
      graphRef.current = nextGraph;
      setSourceGraph(nextGraph);
      setCanvas(result.canvas);
      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.taskId === activeTaskId
            ? {
                ...task,
                title: result.canvas.name,
                canvas: stripRuntimeStateFromCanvas(result.canvas),
                authoring: { temporaryResources: result.temporaryResources },
              }
            : task,
        ),
      );
      setSelection(result.selection);
      setAssistantApplyUndo({
        proposalId: assistantProposal.proposal_id,
        taskId: activeTaskId,
        beforeCanvas,
        beforeTemporaryResources,
        beforeSelection,
        afterCanvasHash,
        affectedSelection: result.selection,
      });
      setAssistantProposal(null);
      setAssistantBackendValidation(null);
      setAssistantRequiredActions((current) =>
        current.filter((action) => {
          if (action.kind !== 'approve_resource_persistence' || !action.resource_draft_id) {
            return false;
          }
          return Boolean(result.temporaryResources[String(action.resource_draft_id)]);
        }),
      );
      const text = result.messages.join('\n') || 'Proposal 已应用到当前 task canvas。';
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'system', content: text },
      ]);
      setMessage(text);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'system', content: text },
      ]);
      setMessage(text);
    }
  }

  function undoLastAssistantApply() {
    if (!assistantApplyUndo || !canUndoAssistantApply) {
      return;
    }
    const nextCanvas = stripRuntimeStateFromCanvas(assistantApplyUndo.beforeCanvas);
    const nextGraph = canvasToWorkflowGraph(nextCanvas);
    graphRef.current = nextGraph;
    setSourceGraph(nextGraph);
    setCanvas(nextCanvas);
    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.taskId === activeTaskId
          ? {
              ...task,
              title: nextCanvas.name,
              canvas: nextCanvas,
              authoring: { temporaryResources: assistantApplyUndo.beforeTemporaryResources },
            }
          : task,
      ),
    );
    setSelection(assistantApplyUndo.beforeSelection);
    setAssistantApplyUndo(null);
    const text = '已撤回上一次 AI 应用到画布的修改。';
    setAssistantMessages((current) => [
      ...current,
      { id: authoringId('assistant_msg'), role: 'system', content: text },
    ]);
    setMessage(text);
  }

  async function persistTemporaryResourceDraft(resourceDraftId: string) {
    const draft = currentAuthoringState.temporaryResources[resourceDraftId];
    if (!draft || draft.status === 'discarded') {
      const text = `临时资源不存在或已丢弃: ${resourceDraftId}`;
      setMessage(text);
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'system', content: text },
      ]);
      return;
    }
    const transaction = graphOpsTransactionForTemporaryAgent(draft);
    const callableId = persistentCallableIdForDraft(draft);
    setAssistantBusy(true);
    try {
      await api.createGraphOpsProposal(transaction);
      const validation = await api.validateGraphOpsProposal(transaction.proposal_id);
      if (validation.status !== 'valid') {
        throw new Error(`GraphOps validate failed: ${JSON.stringify(validation)}`);
      }
      const dryRun = await api.dryRunGraphOpsProposal(transaction.proposal_id);
      setAssistantGraphOpsReview({
        resourceDraftId,
        callableId,
        proposal: transaction,
        validation,
        dryRun,
      });
      const text = [
        `GraphOps dry-run 已准备: ${transaction.proposal_id}`,
        `Files: ${dryRun.target_paths.join(', ')}`,
        '请检查预览后再批准写入。',
      ].join('\n');
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'system', content: text },
      ]);
      setMessage(`GraphOps proposal 已预览: ${transaction.proposal_id}`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'system', content: text },
      ]);
      setMessage(text);
    } finally {
      setAssistantBusy(false);
    }
  }

  async function applyGraphOpsPersistenceReview(review: AssistantGraphOpsReview) {
    const draft = currentAuthoringState.temporaryResources[review.resourceDraftId];
    if (!draft || draft.status === 'discarded') {
      const text = `临时资源不存在或已丢弃: ${review.resourceDraftId}`;
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'system', content: text },
      ]);
      setMessage(text);
      return;
    }
    setAssistantBusy(true);
    try {
      await api.approveGraphOpsProposal(review.proposal.proposal_id, {
        target_paths: review.dryRun.target_paths,
        base_hashes: review.proposal.base.content_hashes,
        dry_run_digest: review.dryRun.dry_run_digest,
      });
      const manifest = await api.applyGraphOpsProposal(review.proposal.proposal_id);
      const nextCanvas = normalizeCanvasEdges(
        replaceTemporaryResourceWithCallable(
          stripRuntimeStateFromCanvas(canvas),
          review.resourceDraftId,
          review.callableId,
        ),
      );
      graphRef.current = canvasToWorkflowGraph(nextCanvas);
      setSourceGraph(graphRef.current);
      setCanvas(nextCanvas);
      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.taskId === activeTaskId
            ? {
                ...task,
                canvas: stripRuntimeStateFromCanvas(nextCanvas),
                authoring: {
                  temporaryResources: {
                    ...(task.authoring || emptyWorkbenchAuthoringState()).temporaryResources,
                    [review.resourceDraftId]: {
                      ...draft,
                      status: 'discarded',
                    },
                  },
                },
              }
            : task,
        ),
      );
      setAssistantRequiredActions((current) =>
        current.filter((action) => action.resource_draft_id !== review.resourceDraftId),
      );
      setAssistantGraphOpsReview(null);
      const text = [
        `GraphOps 已持久化 ${review.callableId}`,
        `Proposal: ${review.proposal.proposal_id}`,
        `Files: ${manifest.created_files.join(', ')}`,
      ].join('\n');
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'system', content: text },
      ]);
      setMessage(`已保存临时资源为 ${review.callableId}`);
      onChanged?.();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setAssistantMessages((current) => [
        ...current,
        { id: authoringId('assistant_msg'), role: 'system', content: text },
      ]);
      setMessage(text);
    } finally {
      setAssistantBusy(false);
    }
  }

  function discardAssistantProposal() {
    setAssistantProposal(null);
    setAssistantBackendValidation(null);
    setAssistantRequiredActions([]);
    setAssistantMessages((current) => [
      ...current,
      { id: authoringId('assistant_msg'), role: 'system', content: '已丢弃当前 proposal。' },
    ]);
  }

  async function submitSelectedAgentTurn(messageText: string, reason: 'node_chat' | 'output_revision') {
    const session = agentSessionState.session;
    if (!session) {
      throw new Error('当前节点还没有可用的 Agent Session');
    }
    const turn = await api.submitAgentTurn(session.session_id, {
      message: messageText,
      reason,
      expected_provider_session_id:
        typeof session.provider_session_id === 'string' ? session.provider_session_id : undefined,
    });
    setAgentSessionState((current) => ({ ...current, pendingTurn: turn }));
    setMessage(`Agent turn ${turn.turn_id}: ${turn.status || 'queued'}`);
    await refreshAgentSession();
  }

  async function publishSelectedAgentOutput(expectedTurnId: string) {
    const session = agentSessionState.session;
    if (!session) {
      throw new Error('当前节点还没有可用的 Agent Session');
    }
    await api.publishAgentOutput(session.session_id, expectedTurnId);
    if (selectedRunId) {
      await refreshRunProjection(selectedRunId);
    }
    await refreshAgentSession();
    setMessage(`已发布 ${expectedTurnId} 为当前节点 output.json`);
    onChanged?.();
  }

  async function answerSelectedAgentInteraction(interactionId: string, answer: Record<string, unknown>) {
    const runId = selectedAgentSessionContext?.runId;
    if (!runId) {
      throw new Error('当前节点没有绑定 run，无法处理审批');
    }
    await api.answerInteraction(runId, interactionId, answer);
    await refreshAgentSession();
  }

  function openCallableResourceFromNode(callableId: string, name: string, kind: 'agent_class' | 'tool_class') {
    setSelectedResource({
      kind: kind === 'tool_class' ? 'tool_class' : 'agent_class',
      callableId,
      name: name || callableId,
    });
    setChrome((current) => ({ ...current, rightPanel: 'resourceDetail' }));
  }

  return (
    <WorkbenchShell durableTasksReady={durableTasksReady}>
      <TopBar
        title={canvas.name}
        subtitle="WorkflowFunctionTemplate / ScopeFrame / SessionInstance / ArtifactBundle 统一视图"
        isRunning={isRunning}
        onNew={newTask}
        onLoadDemo={createDemo}
        onSave={requestSaveWorkflow}
        onValidate={validateGraph}
        onRun={runGraph}
        onAutoLayout={autoLayout}
        assistantOpen={assistantOpen}
        onToggleAssistant={() => {
          if (!viewProjection.blueprintActive) {
            setTaskWorkspaceView('blueprint');
            setBottomDockMode('assistant');
            setEvidenceDock((current) => ({ ...current, open: true }));
            return;
          }
          const nextOpen = !(bottomDockMode === 'assistant' && evidenceDock.open);
          setBottomDockMode('assistant');
          setEvidenceDock((current) => ({ ...current, open: nextOpen }));
        }}
        detailsOpen={viewProjection.detailsOpen}
        onToggleDetails={() => {
          if (!viewProjection.blueprintActive) {
            setTaskWorkspaceView('blueprint');
            setBottomDockMode('evidence');
            setEvidenceDock((current) => ({ ...current, open: true }));
            return;
          }
          const nextOpen = !(bottomDockMode === 'evidence' && evidenceDock.open);
          setBottomDockMode('evidence');
          setEvidenceDock((current) => ({ ...current, open: nextOpen }));
        }}
      />
      <div
        className={[
          'workspace-canvas-layout',
          viewProjection.rightPanelVisible ? 'inspector-open' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onPointerDownCapture={handleCanvasLayoutPointerDown}
        onClickCapture={handleCanvasLayoutClick}
      >
        <TaskWorkspaceSwitcher value={taskWorkspaceView} onChange={setTaskWorkspaceView} />
        {taskWorkspaceView === 'overview' ? (
          <TaskOverviewPage
            tasks={tasks}
            activeTaskId={activeTaskId}
            onSelectTask={switchTask}
            onOpenBlueprint={() => setTaskWorkspaceView('blueprint')}
            onNewTask={newTask}
            onDeleteTask={deleteTask}
          />
        ) : (
          <>
            <WorkspaceCanvas
              canvas={displayCanvas}
              layoutSyncVersion={layoutSyncVersion}
              selection={selection}
              connectionMode={connectionMode}
              workflowRun={workflowRun}
              focusedWorkflowId={focusedWorkflowId}
              callables={callables}
              workflows={workflows}
              bindings={workflowBindings}
              onFocusedWorkflow={setFocusedWorkflowId}
              onCanvasChange={updateCanvas}
              onSelect={selectCanvasObject}
              onOpenNodeDetails={openNodeDetails}
              onDeleteSelection={deleteSelectedCanvasObject}
              edgeViewMode={edgeViewMode}
              onConnectionMode={setConnectionMode}
              onEdgeViewMode={setEdgeViewMode}
              onBlankCanvas={() => undefined}
              onNotice={setMessage}
              onConfigureWorkflow={(workflowId) => {
                setSelection({ type: 'workflow', id: workflowId });
                setBindingEditorWorkflowId(workflowId);
              }}
            />
            <ExecutionDock
              isRunning={isRunning}
              runtimeConfig={runtimeConfig}
              canRunWorkflow={canRunSelectedWorkflow}
              canRunNode={canRunSelectedNode}
              onRunTask={runGraph}
              onRunWorkflow={runSelectedWorkflow}
              onRunNode={runSelectedNode}
            />
          </>
        )}
        {resourceDetailOpen ? (
          <div
            className="canvas-drawer canvas-drawer-right"
            style={{ width: inspectorWidth }}
          >
            <div
              className="drawer-resize-handle"
              role="separator"
              aria-label="调整节点设置面板宽度"
              aria-orientation="vertical"
              onPointerDown={startInspectorResize}
            />
            <div className="drawer-title-row">
              <strong>{inspectorDrawerTitle(selection)}</strong>
              <button
                type="button"
                onClick={() => setChrome((current) => ({ ...current, rightPanel: 'none' }))}
              >
                收起
              </button>
            </div>
            {selectedResource ? (
              <ResourceInspector resource={selectedResource} />
            ) : null}
          </div>
        ) : null}
        {inspectorOpen ? (
          <div
            className="canvas-drawer canvas-drawer-right"
            style={{ width: inspectorWidth }}
          >
            <div
              className="drawer-resize-handle"
              role="separator"
              aria-label="调整节点设置面板宽度"
              aria-orientation="vertical"
              onPointerDown={startInspectorResize}
            />
            <RightInspector
              canvas={displayCanvas}
              selection={selection}
              selectedWorkflow={selectedWorkflow}
              selectedPort={selectedPort}
              selectedEdge={selectedEdge}
              selectedInternalNode={selectedInternalNode}
              connectionMode={connectionMode}
              dataConnectionDraft={dataConnectionDraft}
              runtimeConfig={runtimeConfig}
              liveLogs={selectedLiveLogs}
              workflowRun={enrichedWorkflowRun}
              workflowEvents={selectedRunLiveEvents}
              workflows={workflows}
              binding={selectedWorkflow ? workflowBindings[selectedWorkflow.id] : undefined}
              onConnectionMode={setConnectionMode}
              onBeginDataConnection={beginDataConnection}
              onCancelDataConnection={cancelDataConnection}
              onUpdateDataConnectionMaterialization={updateDataConnectionMaterialization}
              onCompleteDataConnection={completeDataConnection}
              onCompleteDataConnectionWithNewInputPort={completeDataConnectionWithNewInputPort}
              onAddDataConnectPort={addDataConnectPort}
              onRenameDataConnectPort={renameDataConnectPort}
              onDeleteDataConnectPort={deleteDataConnectPort}
              onReadEvidence={readEvidence}
              onConfigureBinding={setBindingEditorWorkflowId}
              onUpdateWorkflowInput={updateWorkflowInvocationInput}
              onUpdateInternalInput={updateInternalInvocationInput}
              onUpdateWorkflowLabel={updateWorkflowInvocationLabel}
              onUpdateInternalLabel={updateInternalInvocationLabel}
              onUpdateWorkflowForwardMainOutput={updateWorkflowForwardMainOutput}
              onUpdateInternalForwardMainOutput={updateInternalForwardMainOutput}
              onUpdateWorkflowEmptyInputPolicy={updateWorkflowEmptyInputPolicy}
              onUpdateInternalEmptyInputPolicy={updateInternalEmptyInputPolicy}
              onUpdateWorkflowCodexExecutionMode={updateWorkflowCodexExecutionMode}
              onUpdateInternalCodexExecutionMode={updateInternalCodexExecutionMode}
              onOpenCallableResource={openCallableResourceFromNode}
            />
          </div>
        ) : null}
        {blueprintViewActive && nodeDetailOpen && isNodeDetailModel(selectedDetailsModelWithAgentEvents) ? (
          <NodeDetailOverlay
            model={selectedDetailsModelWithAgentEvents}
            callableState={selectedCallableDetailState}
            runtimeConfig={runtimeConfig}
            agentSessionState={agentSessionState}
            agentLiveState={
              selectedAgentTurnLiveState.events.length ? selectedAgentTurnLiveState : selectedAgentLiveState
            }
            artifactCacheByPath={artifactCacheByPath}
            onEnsureArtifactContent={ensureArtifactContent}
            onReadEvidence={readEvidence}
            onRefreshAgentSession={refreshAgentSession}
            onPublishAgentOutput={publishSelectedAgentOutput}
            onAnswerAgentInteraction={answerSelectedAgentInteraction}
            onClose={() => setNodeDetailOpen(false)}
            onUpdateInput={(nextInput) => {
              if (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)) {
                updateWorkflowInvocationInput(selectedWorkflow.id, nextInput);
              }
              if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
                updateInternalInvocationInput(selectedWorkflow.id, selectedInternalNode.id, nextInput);
              }
            }}
            onUpdateLabel={(label) => {
              if (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)) {
                updateWorkflowInvocationLabel(selectedWorkflow.id, label);
              }
              if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
                updateInternalInvocationLabel(selectedWorkflow.id, selectedInternalNode.id, label);
              }
            }}
            onUpdateForwardMainOutput={(value) => {
              if (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)) {
                updateWorkflowForwardMainOutput(selectedWorkflow.id, value);
              }
              if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
                updateInternalForwardMainOutput(selectedWorkflow.id, selectedInternalNode.id, value);
              }
            }}
            onUpdateEmptyInputPolicy={(value) => {
              if (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)) {
                updateWorkflowEmptyInputPolicy(selectedWorkflow.id, value);
              }
              if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
                updateInternalEmptyInputPolicy(selectedWorkflow.id, selectedInternalNode.id, value);
              }
            }}
            onUpdateCodexExecutionMode={(value) => {
              if (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)) {
                updateWorkflowCodexExecutionMode(selectedWorkflow.id, value);
              }
              if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
                updateInternalCodexExecutionMode(selectedWorkflow.id, selectedInternalNode.id, value);
              }
            }}
            onOpenCallableResource={openCallableResourceFromNode}
          />
        ) : null}
      </div>
      {bindingEditorWorkflowId ? (
        <WorkflowBindingDialog
          workflowId={bindingEditorWorkflowId}
          binding={workflowBindings[bindingEditorWorkflowId]}
          onClose={() => setBindingEditorWorkflowId(null)}
          onValidate={validateBinding}
          onSave={saveBinding}
          onOpenFolder={openBindingsFolder}
          onSelectDirectory={selectBindingDirectory}
        />
      ) : null}
      {saveWorkflowDialog ? (
        <SaveWorkflowDialog
          state={saveWorkflowDialog}
          onName={(name) =>
            setSaveWorkflowDialog((current) => (current ? { ...current, name } : current))
          }
          onCancel={() => setSaveWorkflowDialog(null)}
          onConfirm={confirmSaveWorkflow}
        />
      ) : null}
      {blueprintViewActive ? (
        <SelectionDetailsDock
          state={evidenceDock}
          mode={bottomDockMode}
          message={message}
          model={selectedDetailsModelWithAgentEvents}
          currentTaskId={currentTask?.taskId}
          selectedRunId={selectedRunId}
          onToggle={() => setEvidenceDock((current) => ({ ...current, open: !current.open }))}
          onReadEvidence={readEvidence}
          assistantContent={
          <AssistantDockContent
            input={assistantInput}
            messages={assistantMessages}
            proposal={assistantProposal}
            validation={assistantValidation}
            temporaryResources={currentAuthoringState.temporaryResources}
            authoringAgents={authoringAgents}
            selectedAuthoringAgentId={selectedAuthoringAgentId}
            sessionId={assistantSessionId}
            agentSession={assistantAgentSession}
            sessionStatus={assistantSessionStatus}
            pendingTurn={assistantPendingTurn}
            assistantEvents={assistantEvents}
            liveState={assistantLiveState}
            turnReason={assistantTurnReason}
            requiredActions={assistantRequiredActions}
            graphOpsReview={assistantGraphOpsReview}
            busy={assistantBusy}
            targetLabel={authoringSelectionLabel(selection, selectedWorkflow, selectedInternalNode)}
            hasSelectedRunNode={Boolean(selectedAgentSessionContext)}
            model={selectedDetailsModelWithAgentEvents}
            canUndoApply={canUndoAssistantApply}
            onAgentChange={(agentId) => {
              setSelectedAuthoringAgentId(agentId);
              setAssistantSessionId(null);
              setAssistantAgentSession(null);
              setAssistantPendingTurn(null);
              setAssistantEvents([]);
              setAssistantSessionStatus('disconnected');
            }}
            onTurnReasonChange={setAssistantTurnReason}
            onInput={setAssistantInput}
            onSubmit={generateAssistantProposal}
            onApply={applyAssistantProposal}
            onDiscard={discardAssistantProposal}
            onUndoApply={undoLastAssistantApply}
            onPersistTemporaryResource={persistTemporaryResourceDraft}
            onApplyGraphOpsReview={applyGraphOpsPersistenceReview}
            onDiscardGraphOpsReview={() => setAssistantGraphOpsReview(null)}
          />
          }
        />
      ) : null}
    </WorkbenchShell>
  );
}

function WorkbenchShell({
  children,
  durableTasksReady,
}: {
  children: ReactNode;
  durableTasksReady: boolean;
}) {
  return (
    <section
      className="panel workflow-viewer graph-workbench-v2"
      aria-label="ACC Workbench"
      data-durable-tasks-ready={durableTasksReady ? 'true' : 'false'}
    >
      {children}
    </section>
  );
}

function workbenchViewProjection({
  taskWorkspaceView,
  chrome,
  bottomDockMode,
  evidenceDockOpen,
}: {
  taskWorkspaceView: TaskWorkspaceView;
  chrome: WorkbenchChromeState;
  bottomDockMode: BottomDockMode;
  evidenceDockOpen: boolean;
}): WorkbenchViewProjection {
  const blueprintActive = taskWorkspaceView === 'blueprint';
  return {
    blueprintActive,
    rightPanelVisible: blueprintActive && chrome.rightPanel !== 'none' && chrome.rightPanel !== 'assistant',
    resourceDetailOpen: blueprintActive && chrome.rightPanel === 'resourceDetail',
    inspectorOpen: blueprintActive && chrome.rightPanel === 'inspector',
    assistantOpen: blueprintActive && bottomDockMode === 'assistant' && evidenceDockOpen,
    detailsOpen: blueprintActive && bottomDockMode === 'evidence' && evidenceDockOpen,
  };
}

function SaveWorkflowDialog({
  state,
  onName,
  onCancel,
  onConfirm,
}: {
  state: SaveWorkflowDialogState;
  onName: (name: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal-panel save-workflow-dialog"
        aria-label="保存 Workflow"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <div className="modal-title-row">
          <h3>发布为可复用 Workflow</h3>
          <button type="button" onClick={onCancel} disabled={state.saving}>
            关闭
          </button>
        </div>
        <label className="form-field">
          <span>Workflow 名称</span>
          <input
            value={state.name}
            onChange={(event) => onName(event.target.value)}
            disabled={state.saving}
            autoFocus
          />
        </label>
        <p className="form-help">
          发布会写入 canonical <code>.accflow.json</code>，使当前任务蓝图成为可复用的 WorkflowFunctionTemplate。
        </p>
        {state.error ? <p className="form-error">{state.error}</p> : null}
        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={state.saving}>
            取消
          </button>
          <button type="submit" className="primary-action" disabled={state.saving}>
            {state.saving ? '发布中...' : '发布到 canonical .accflow.json'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ExecutionDock({
  isRunning,
  runtimeConfig,
  canRunWorkflow,
  canRunNode,
  onRunTask,
  onRunWorkflow,
  onRunNode,
}: {
  isRunning: boolean;
  runtimeConfig: RuntimeConfig | null;
  canRunWorkflow: boolean;
  canRunNode: boolean;
  onRunTask: () => void;
  onRunWorkflow: () => void;
  onRunNode: () => void;
}) {
  const modeLabel = runtimeConfig?.real_external_agents_enabled
    ? '生产模式：将调用真实外部 Agent'
    : runtimeConfig?.run_mode === 'production'
      ? '生产模式：真实外部 Agent 未启用'
      : '隔离模式：不调用外部 Agent';
  return (
    <div className="execution-dock" aria-label="执行控制">
      <span className="runtime-mode-pill">{modeLabel}</span>
      <span className="execution-scope-pill">运行范围：当前任务</span>
      <button type="button" className="primary-action run-task-action" onClick={onRunTask} disabled={isRunning}>
        <Play aria-hidden="true" size={18} />
        {isRunning ? '运行中...' : '运行当前任务'}
      </button>
      {canRunWorkflow ? (
        <button type="button" onClick={onRunWorkflow} disabled={isRunning}>
          只运行此 Workflow
        </button>
      ) : null}
      {canRunNode ? (
        <button type="button" onClick={onRunNode} disabled={isRunning}>
          只运行此 Agent/Tool
        </button>
      ) : null}
    </div>
  );
}

function TaskWorkspaceSwitcher({
  value,
  onChange,
}: {
  value: TaskWorkspaceView;
  onChange: (value: TaskWorkspaceView) => void;
}) {
  return (
    <div className="task-workspace-switcher" aria-label="Task workspace view">
      <button
        type="button"
        className={value === 'overview' ? 'active' : ''}
        onClick={() => onChange('overview')}
      >
        <LayoutDashboard aria-hidden="true" size={15} />
        任务总览
      </button>
      <button
        type="button"
        className={value === 'blueprint' ? 'active' : ''}
        onClick={() => onChange('blueprint')}
      >
        <GitBranch aria-hidden="true" size={15} />
        任务蓝图
      </button>
    </div>
  );
}

function TaskOverviewPage({
  tasks,
  activeTaskId,
  onSelectTask,
  onOpenBlueprint,
  onNewTask,
  onDeleteTask,
}: {
  tasks: WorkbenchTask[];
  activeTaskId: string;
  onSelectTask: (taskId: string) => void;
  onOpenBlueprint: () => void;
  onNewTask: () => void;
  onDeleteTask: (taskId: string) => void;
}) {
  const activeTask = tasks.find((task) => task.taskId === activeTaskId) || tasks[0];
  const openTaskBlueprint = (taskId: string) => {
    onSelectTask(taskId);
    onOpenBlueprint();
  };
  return (
    <section className="task-overview-page" aria-label="任务总览">
      <aside className="task-overview-list" aria-label="任务列表">
        <div className="task-overview-header">
          <span>任务队列</span>
          <button type="button" onClick={onNewTask}>
            新建任务
          </button>
        </div>
        <div className="task-overview-items">
          {tasks.map((task) => (
            <article
              key={task.taskId}
              className={[
                'task-overview-item',
                task.taskId === activeTaskId ? 'active' : '',
                `status-${task.status}`,
              ]
                .filter(Boolean)
                .join(' ')}
              onDoubleClick={() => openTaskBlueprint(task.taskId)}
            >
              <button
                type="button"
                className="task-overview-select"
                aria-label={`选择任务 ${task.title}`}
                onClick={() => onSelectTask(task.taskId)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  openTaskBlueprint(task.taskId);
                }}
              >
                <strong>{task.title}</strong>
                <small>{task.activeRunId || task.latestRunId || '未运行'}</small>
              </button>
              <button
                type="button"
                className="task-overview-delete"
                aria-label={`删除任务 ${task.title}`}
                title="删除任务"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteTask(task.taskId);
                }}
              >
                <Trash2 aria-hidden="true" size={15} />
              </button>
            </article>
          ))}
        </div>
      </aside>
      <TaskArtifactsPane task={activeTask} />
    </section>
  );
}

function TaskArtifactsPane({ task }: { task?: WorkbenchTask }) {
  return (
    <section className="task-artifacts-pane" aria-label="任务产物">
      <header>
        <span>产物通道</span>
        <strong>{task?.title || '未选择任务'}</strong>
      </header>
      <div className="task-artifacts-empty">
        <FileText aria-hidden="true" size={28} />
        <p>当前任务还没有可展示的产物。</p>
        <small>运行输出、报告和审计文件会在这里归档展示。</small>
      </div>
    </section>
  );
}

function TaskRail({
  tasks,
  activeTaskId,
  onSelectTask,
  onNewTask,
  onDeleteTask,
}: {
  tasks: WorkbenchTask[];
  activeTaskId: string;
  onSelectTask: (taskId: string) => void;
  onNewTask: () => void;
  onDeleteTask: (taskId: string) => void;
}) {
  return (
    <aside className="task-rail" aria-label="任务列表">
      <button type="button" className="task-rail-new" onClick={onNewTask}>
        新建任务
      </button>
      {tasks.map((task) => (
        <article
          key={task.taskId}
          className={[
            'task-rail-item',
            task.taskId === activeTaskId ? 'active' : '',
            `status-${task.status}`,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <button type="button" className="task-rail-select" onClick={() => onSelectTask(task.taskId)}>
            <strong>{task.title}</strong>
            <small>{task.activeRunId || task.latestRunId || '未运行'}</small>
          </button>
          <button
            type="button"
            className="task-rail-delete"
            aria-label={`删除任务 ${task.title}`}
            title="删除任务"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteTask(task.taskId);
            }}
          >
            <Trash2 aria-hidden="true" size={15} />
          </button>
        </article>
      ))}
    </aside>
  );
}

function TopBar({
  title,
  subtitle,
  isRunning,
  onNew,
  onLoadDemo,
  onSave,
  onValidate,
  onRun,
  onAutoLayout,
  assistantOpen,
  onToggleAssistant,
  detailsOpen,
  onToggleDetails,
}: {
  title: string;
  subtitle: string;
  isRunning: boolean;
  onNew: () => void;
  onLoadDemo: () => void;
  onSave: () => void;
  onValidate: () => void;
  onRun: () => void;
  onAutoLayout: () => void;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}) {
  return (
    <header className="workbench-topbar">
      <div className="topbar-title">
        <span className="topbar-kicker">Workspace Canvas</span>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="toolbar-actions" aria-label="工作流工具栏">
        <button
          type="button"
          className={detailsOpen ? 'toggle-action active' : 'toggle-action'}
          onClick={onToggleDetails}
        >
          <Database aria-hidden="true" size={16} />
          运行详情
        </button>
        <button
          type="button"
          className={assistantOpen ? 'toggle-action active' : 'toggle-action'}
          onClick={onToggleAssistant}
        >
          <Bot aria-hidden="true" size={16} />
          AI 助手
        </button>
        <button type="button" onClick={onNew}>
          <GitBranch aria-hidden="true" size={16} />
          新建任务
        </button>
        <button type="button" onClick={onLoadDemo}>
          <LayoutDashboard aria-hidden="true" size={16} />
          加载示例
        </button>
        <button type="button" onClick={onSave} disabled={isRunning}>
          <Save aria-hidden="true" size={16} />
          发布为可复用 Workflow
        </button>
        <button type="button" onClick={onValidate} disabled={isRunning}>
          <TestTube aria-hidden="true" size={16} />
          校验
        </button>
        <button type="button" className="primary-action topbar-run-action" onClick={onRun} disabled={isRunning}>
          <Play aria-hidden="true" size={16} />
          {isRunning ? '运行中...' : '运行'}
        </button>
        <button type="button" onClick={onAutoLayout}>
          <LayoutDashboard aria-hidden="true" size={16} />
          自动布局
        </button>
      </div>
    </header>
  );
}

function authoringSelectionLabel(
  selection: CanvasSelection,
  selectedWorkflow?: WorkflowContainerModel,
  selectedInternalNode?: InternalNodeView,
): string {
  if (selection.type === 'workflow' && selectedWorkflow) {
    return isExecutableNodeWorkflow(selectedWorkflow)
      ? `节点: ${workflowInvocationLabel(selectedWorkflow)}`
      : `Workflow: ${workflowInvocationLabel(selectedWorkflow)}`;
  }
  if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
    return `内部节点: ${workflowInvocationLabel(selectedWorkflow)} / ${internalInvocationLabel(selectedInternalNode)}`;
  }
  if (selection.type === 'edge') {
    return `连线: ${selection.scopeWorkflowId || 'root'} / ${selection.id}`;
  }
  if (selection.type === 'port') {
    return `端口: ${selection.workflowId}.${selection.portId}`;
  }
  return '当前任务画布';
}

function AssistantDrawer({
  width,
  input,
  messages,
  proposal,
  validation,
  temporaryResources,
  authoringAgents,
  selectedAuthoringAgentId,
  sessionId,
  agentSession,
  sessionStatus,
  pendingTurn,
  events,
  turnReason,
  requiredActions,
  graphOpsReview,
  busy,
  targetLabel,
  hasSelectedRunNode,
  onAgentChange,
  onTurnReasonChange,
  onInput,
  onSubmit,
  onApply,
  onDiscard,
  onPersistTemporaryResource,
  onApplyGraphOpsReview,
  onDiscardGraphOpsReview,
  onClose,
  onResize,
}: {
  width: number;
  input: string;
  messages: AssistantChatMessage[];
  proposal: CanvasAuthoringProposal | null;
  validation: CanvasAuthoringValidationResult | null;
  temporaryResources: Record<string, TemporaryResourceDraft>;
  authoringAgents: AuthoringAgentSummary[];
  selectedAuthoringAgentId: string;
  sessionId: string | null;
  agentSession: AgentSessionRecord | null;
  sessionStatus: string;
  pendingTurn: AgentTurnRecord | null;
  events: RunEvent[];
  turnReason: AssistantTurnReason;
  requiredActions: AuthoringRequiredAction[];
  graphOpsReview: AssistantGraphOpsReview | null;
  busy: boolean;
  targetLabel: string;
  hasSelectedRunNode: boolean;
  onAgentChange: (agentId: string) => void;
  onTurnReasonChange: (reason: AssistantTurnReason) => void;
  onInput: (value: string) => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
  onApply: () => void;
  onDiscard: () => void;
  onPersistTemporaryResource: (resourceDraftId: string) => void;
  onApplyGraphOpsReview: (review: AssistantGraphOpsReview) => void;
  onDiscardGraphOpsReview: () => void;
  onClose: () => void;
  onResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const validationErrors = validation?.errors || [];
  const validationWarnings = validation?.warnings || [];
  const temporaryDrafts = Object.values(temporaryResources).filter(
    (draft) => draft.status !== 'discarded',
  );
  const graphOpsDiff = graphOpsReview?.dryRun.semantic_diff || {};
  const graphOpsCreatedFiles =
    graphOpsStringList(graphOpsDiff.created_files).length > 0
      ? graphOpsStringList(graphOpsDiff.created_files)
      : graphOpsReview?.dryRun.target_paths || [];
  const graphOpsCreatedCallables = graphOpsStringList(graphOpsDiff.created_callable_ids);
  const graphOpsCreatedWorkflows = graphOpsStringList(graphOpsDiff.created_workflow_ids);
  const graphOpsWarnings = graphOpsStringList(graphOpsDiff.warnings);
  return (
    <div className="canvas-drawer canvas-drawer-right assistant-drawer" style={{ width }}>
      <div
        className="drawer-resize-handle"
        role="separator"
        aria-label="调整 AI 助手面板宽度"
        aria-orientation="vertical"
        onPointerDown={onResize}
      />
      <div className="drawer-title-row">
        <strong>AI 助手</strong>
        <button type="button" onClick={onClose}>
          收起
        </button>
      </div>
      <div className="assistant-drawer-body">
        <div className="assistant-target-row">
          <span>目标</span>
          <strong>{targetLabel}</strong>
          <small>{hasSelectedRunNode ? '已选中运行节点，可在 Inspector 进入节点会话' : '画布级 Copilot'}</small>
        </div>
        <div className="assistant-session-row">
          <label>
            <span>Agent</span>
            <select
              value={selectedAuthoringAgentId}
              onChange={(event) => onAgentChange(event.target.value)}
              disabled={busy}
            >
              {authoringAgents.length ? (
                authoringAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name || agent.id} · {agent.runtime}
                  </option>
                ))
              ) : (
                <option value="">未连接</option>
              )}
            </select>
          </label>
          <small>
            {sessionId ? `${sessionStatus} · ${sessionId}` : sessionStatus}
            {agentSession?.provider_session_id ? ` · provider ${agentSession.provider_session_id}` : ''}
          </small>
        </div>
        <form className="assistant-compose" onSubmit={onSubmit}>
          <div className="segmented-control compact-tabs" role="tablist" aria-label="AI assistant turn mode">
            <button
              type="button"
              className={turnReason === 'workbench_chat' ? 'active' : ''}
              onClick={() => onTurnReasonChange('workbench_chat')}
            >
              对话
            </button>
            <button
              type="button"
              className={turnReason === 'canvas_revision' ? 'active' : ''}
              onClick={() => onTurnReasonChange('canvas_revision')}
            >
              生成修改
            </button>
            <button
              type="button"
              className={turnReason === 'selected_node_revision' ? 'active' : ''}
              onClick={() => onTurnReasonChange('selected_node_revision')}
            >
              修订当前草稿
            </button>
          </div>
          <textarea
            value={input}
            onChange={(event) => onInput(event.target.value)}
            placeholder={
              turnReason === 'workbench_chat'
                ? '像 Codex CLI 一样和当前画布助手对话'
                : '描述要生成或调整的 workflow 草稿'
            }
            rows={4}
          />
          <button type="submit" className="primary-action" disabled={busy || Boolean(pendingTurn)}>
            {busy || pendingTurn ? '执行中...' : turnReason === 'workbench_chat' ? '发送' : '提交 turn'}
          </button>
        </form>
        {pendingTurn ? (
          <section className="assistant-proposal-panel" aria-label="AI assistant pending turn">
            <header>
              <span>Running turn</span>
              <strong>{pendingTurn.turn_id}</strong>
            </header>
            <p>{pendingTurn.reason || turnReason} · {pendingTurn.status || 'queued'}</p>
          </section>
        ) : null}
        <div className="assistant-message-list" aria-label="AI 助手消息">
          {messages.length ? (
            messages.map((message) => (
              <article key={message.id} className={`assistant-message ${message.role}`}>
                <span>{message.role}</span>
                <p>{message.content}</p>
              </article>
            ))
          ) : (
            <p className="assistant-empty">等待输入需求</p>
          )}
        </div>
        <AgentEventTimeline events={events} maxEvents={4} />
        {proposal ? (
          <section className="assistant-proposal-panel" aria-label="CanvasAuthoringProposal">
            <header>
              <span>待应用草稿</span>
              <strong>{proposal.proposal_id}</strong>
            </header>
            <p>{proposal.rationale}</p>
            <ol>
              {proposal.operations.map((operation, index) => (
                <li key={`${operation.op}-${index}`}>{authoringOperationSummary(operation)}</li>
              ))}
            </ol>
            {validationErrors.length ? (
              <div className="assistant-validation invalid">
                {validationErrors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            ) : null}
            {validationWarnings.length ? (
              <div className="assistant-validation warning">
                {validationWarnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
            <details>
              <summary>JSON</summary>
              <pre>{JSON.stringify(proposal, null, 2)}</pre>
            </details>
            <div className="assistant-proposal-actions">
              <button type="button" onClick={onDiscard}>
                丢弃
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={onApply}
                disabled={validation?.status === 'invalid'}
              >
                应用到当前画布
              </button>
            </div>
          </section>
        ) : null}
        {temporaryDrafts.length ? (
          <section className="assistant-temp-list" aria-label="临时资源">
            <header>临时资源</header>
            {temporaryDrafts.map((draft) => (
              <article key={draft.draft_id}>
                <strong>{draft.agent_draft.name || draft.draft_id}</strong>
                <span>{draft.draft_id}</span>
                <small>不能 run/save</small>
              </article>
            ))}
          </section>
        ) : null}
        {requiredActions.length ? (
          <section className="assistant-required-actions" aria-label="Authoring required actions">
            <header>需要人工动作</header>
            {requiredActions.map((action, index) => (
              <article key={`${action.kind}-${index}`}>
                <strong>{authoringRequiredActionLabel(action.kind)}</strong>
                <span>{action.reason || action.prompt || action.resource_draft_id || 'Review required'}</span>
                {action.kind === 'approve_resource_persistence' && action.resource_draft_id ? (
                  <button
                    type="button"
                    className="secondary-action compact-action"
                    disabled={busy || !temporaryResources[action.resource_draft_id]}
                    onClick={() => onPersistTemporaryResource(String(action.resource_draft_id))}
                  >
                    保存为资源
                  </button>
                ) : null}
              </article>
            ))}
          </section>
        ) : null}
        {graphOpsReview ? (
          <section className="assistant-graphops-review" aria-label="GraphOps 持久化预览">
            <header>
              <span>GraphOps 持久化预览</span>
              <strong>{graphOpsReview.proposal.proposal_id}</strong>
            </header>
            <p>{graphOpsReview.proposal.rationale}</p>
            <div className="assistant-graphops-summary">
              <strong>将创建</strong>
              <ul>
                {graphOpsCreatedFiles.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
              {graphOpsCreatedCallables.length ? (
                <span>Callable: {graphOpsCreatedCallables.join(', ')}</span>
              ) : null}
              {graphOpsCreatedWorkflows.length ? (
                <span>Workflow: {graphOpsCreatedWorkflows.join(', ')}</span>
              ) : null}
              {graphOpsWarnings.length ? <span>Warning: {graphOpsWarnings.join('; ')}</span> : null}
            </div>
            <details>
              <summary>Semantic diff</summary>
              <pre>{JSON.stringify(graphOpsReview.dryRun.semantic_diff || graphOpsReview.dryRun, null, 2)}</pre>
            </details>
            <div className="assistant-proposal-actions">
              <button type="button" onClick={onDiscardGraphOpsReview} disabled={busy}>
                取消
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={() => onApplyGraphOpsReview(graphOpsReview)}
                disabled={busy}
              >
                批准并写入
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function graphOpsStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function buildAssistantTranscriptItems({
  messages,
  pendingTurn,
  assistantEvents,
  liveState,
  proposal,
  validation,
  graphOpsReview,
  hasResultBlock = false,
  currentOutputTurnId = null,
}: {
  messages: AssistantChatMessage[];
  pendingTurn: AgentTurnRecord | null;
  assistantEvents: RunEvent[];
  liveState: WorkbenchLiveStreamState;
  proposal: CanvasAuthoringProposal | null;
  validation: CanvasAuthoringValidationResult | null;
  graphOpsReview: AssistantGraphOpsReview | null;
  hasResultBlock?: boolean;
  currentOutputTurnId?: string | null;
}): AssistantTranscriptItem[] {
  const items: AssistantTranscriptItem[] = messages.map((message) => {
    const content =
      message.role === 'assistant' ? assistantMessageDisplayContent(message.content) : message.content;
    if (message.role === 'user') {
      return {
        kind: 'user_message',
        id: `message_${message.id}`,
        content,
        turnId: message.turnId,
        createdAt: message.createdAt,
      };
    }
    if (message.role === 'assistant') {
      return {
        kind: 'assistant_message',
        id: `message_${message.id}`,
        content,
        turnId: message.turnId,
        createdAt: message.createdAt,
      };
    }
    return {
      kind: 'error',
      id: `message_${message.id}`,
      content,
      createdAt: message.createdAt,
    };
  });
  const liveEvents = assistantTranscriptLiveEvents(assistantEvents, liveState.events);
  const pendingTurnId = pendingTurn?.turn_id || '';
  const assistantMessageTurnIds = new Set(
    messages
      .filter((message) => message.role === 'assistant' && message.turnId)
      .map((message) => message.turnId as string),
  );
  const streamText = pendingTurnId ? assistantStreamTextForTurn(liveEvents, pendingTurnId) : '';
  if (pendingTurn && streamText && !assistantMessageTurnIds.has(pendingTurn.turn_id)) {
    items.push({
      kind: 'assistant_stream',
      id: `stream_${pendingTurn.turn_id}`,
      turnId: pendingTurn.turn_id,
      content: streamText,
      status: pendingTurn.status || liveState.status || 'running',
    });
  }
  const processEventsByTurn = new Map<string, AssistantProcessEvent[]>();
  for (const event of liveEvents) {
    if (event.type === 'agent_message_delta' || event.type === 'agent_message') {
      continue;
    }
    const eventItem = assistantTranscriptItemFromLiveEvent(event);
    if (eventItem) {
      if (eventItem.kind === 'status' || eventItem.kind === 'tool_event') {
        const groupKey = assistantProcessGroupKey(event);
        const currentEvents = processEventsByTurn.get(groupKey) || [];
        currentEvents.push({
          id: eventItem.id,
          label: eventItem.label,
          detail: eventItem.detail,
          createdAt: eventItem.createdAt,
        });
        processEventsByTurn.set(groupKey, currentEvents);
      } else {
        items.push(eventItem);
      }
    }
  }
  for (const [turnId, processEvents] of processEventsByTurn) {
    items.push({
      kind: 'process_group',
      id: `process_${turnId}`,
      turnId,
      label: assistantProcessGroupLabel(processEvents, pendingTurnId === turnId),
      events: processEvents,
      createdAt: assistantProcessGroupTimestamp(processEvents),
      defaultOpen: false,
    });
  }
  if (!proposal && !graphOpsReview) {
    for (const error of validation?.errors || []) {
      items.push({ kind: 'error', id: `validation_error_${error}`, content: error });
    }
    for (const warning of validation?.warnings || []) {
      items.push({ kind: 'status', id: `validation_warning_${warning}`, label: 'Validation warning', detail: warning });
    }
  }
  if (hasResultBlock) {
    items.push({
      kind: 'result_block',
      id: assistantResultBlockId({ proposal, graphOpsReview, currentOutputTurnId }),
      createdAt: assistantResultBlockTimestamp(liveEvents, currentOutputTurnId),
    });
  }
  return sortAssistantTranscriptItems(dedupeAssistantTranscriptItems(items));
}

function assistantStreamTextForTurn(events: WorkbenchLiveEvent[], turnId: string): string {
  const turnMessageEvents = events.filter(
    (event) =>
      event.turn_id === turnId &&
      (event.type === 'agent_message_delta' || event.type === 'agent_message'),
  );
  const completedMessages = turnMessageEvents
    .filter((event) => event.type === 'agent_message')
    .map(assistantLiveEventText)
    .filter(Boolean)
    .map(assistantMessageDisplayContent);
  if (completedMessages.length > 0) {
    return completedMessages.join('\n').trim();
  }
  return turnMessageEvents
    .filter((event) => event.type === 'agent_message_delta')
    .map(assistantLiveEventText)
    .filter(Boolean)
    .join('')
    .trim();
}

function assistantTranscriptLiveEvents(
  assistantEvents: RunEvent[],
  liveEvents: WorkbenchLiveEvent[],
): WorkbenchLiveEvent[] {
  const refilled = assistantEvents.map((event, index) =>
    liveEventFromAgentRunEvent(event, index + 1, 'assistant_turn'),
  );
  return boundedLiveEvents(refilled, liveEvents);
}

function assistantTranscriptItemFromLiveEvent(event: WorkbenchLiveEvent): AssistantTranscriptItem | null {
  const id = `event_${event.event_id || event.seq || event.timestamp || event.type}`;
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const projection = supportedTranscriptProjection(event.projection);
  if (projection) {
    if (projection.visibility === 'hidden' || projection.visibility === 'technical') {
      return null;
    }
    const detail = compactText(
      stringValue(projection.summary) ||
        assistantLiveEventText(event) ||
        assistantLiveEventPayloadSummary(event.payload),
    );
    if (projection.category === 'error' || projection.severity === 'error') {
      const userSummary = compactText(stringValue(payload.user_summary));
      const technicalDetail = assistantFailureTechnicalDetail(payload);
      return {
        kind: 'error',
        id,
        content: userSummary || detail || 'AI 助手 turn 执行失败。',
        detail: technicalDetail,
        createdAt: event.timestamp,
      };
    }
    if (
      projection.category === 'tool' ||
      projection.category === 'artifact' ||
      projection.category === 'proposal' ||
      projection.category === 'approval' ||
      projection.category === 'decision'
    ) {
      return {
        kind: 'tool_event',
        id,
        label: assistantProjectionLabel(projection),
        detail,
        createdAt: event.timestamp,
      };
    }
    if (projection.category === 'status') {
      return {
        kind: 'status',
        id,
        label: assistantProjectionLabel(projection),
        detail,
        createdAt: event.timestamp,
      };
    }
    return null;
  }
  const rawType = assistantLiveEventRawType(event);
  const detail = assistantLiveEventText(event) || assistantLiveEventPayloadSummary(event.payload);
  if (rawType === 'agent_turn_failed') {
    const errorText = compactText(
      stringValue(payload.user_summary) ||
        stringValue(payload.error) ||
        stringValue(payload.message) ||
        detail,
    );
    return {
      kind: 'error',
      id,
      content: errorText || detail || 'AI 助手 turn 执行失败。',
      detail: assistantFailureTechnicalDetail(payload),
      createdAt: event.timestamp,
    };
  }
  if (event.type === 'gap') {
    return { kind: 'error', id, content: detail || '实时输出存在缺口，已回退到轮询刷新。', createdAt: event.timestamp };
  }
  if (
    event.type === 'agent_tool_use' ||
    event.type === 'agent_tool_result' ||
    event.type === 'artifact_ready' ||
    rawType === 'artifact_ready'
  ) {
    return {
      kind: 'tool_event',
      id,
      label: assistantLiveEventLabel(event),
      detail,
      createdAt: event.timestamp,
    };
  }
  return null;
}

function assistantProcessGroupKey(event: WorkbenchLiveEvent): string {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  return event.turn_id || stringValue(payload.acc_turn_id) || stringValue(payload.turn_id) || 'session';
}

function assistantProcessGroupLabel(events: AssistantProcessEvent[], isRunning: boolean): string {
  const hasDraft = events.some((event) => event.label === '生成草稿');
  const hasTool = events.some((event) => event.label === '调用工具' || event.label === '工具结果');
  if (isRunning) {
    return events.length ? `执行中 · ${events.length} 个过程事件` : '执行中';
  }
  if (hasDraft) {
    return events.length > 1 ? `生成草稿 · ${events.length} 个过程事件` : '生成草稿';
  }
  if (hasTool) {
    return events.length > 1 ? `工具调用 · ${events.length} 个过程事件` : '工具调用';
  }
  return events.length > 1 ? `过程详情 · ${events.length} 条` : '过程详情';
}

function assistantProcessGroupTimestamp(events: AssistantProcessEvent[]): string | undefined {
  let first: { timestamp: string; time: number } | null = null;
  for (const event of events) {
    if (!event.createdAt) {
      continue;
    }
    const time = Date.parse(event.createdAt);
    if (!Number.isFinite(time)) {
      continue;
    }
    if (!first || time < first.time) {
      first = { timestamp: event.createdAt, time };
    }
  }
  return first?.timestamp;
}

function supportedTranscriptProjection(
  projection: WorkbenchLiveEvent['projection'],
): WorkbenchLiveEvent['projection'] | null {
  return projection?.schema_version === 'acc.transcript_projection.v1' ? projection : null;
}

function assistantProjectionLabel(projection: NonNullable<WorkbenchLiveEvent['projection']>): string {
  if (projection.display_kind === 'tool_call') {
    return '调用工具';
  }
  if (projection.display_kind === 'tool_result') {
    return '工具结果';
  }
  if (projection.category === 'artifact' || projection.category === 'proposal') {
    return '生成草稿';
  }
  if (projection.category === 'approval') {
    return '等待批准';
  }
  if (projection.category === 'decision') {
    return '审批结果';
  }
  return projection.category === 'status' ? '状态' : projection.category || '状态';
}

function assistantResultBlockId({
  proposal,
  graphOpsReview,
  currentOutputTurnId,
}: {
  proposal: CanvasAuthoringProposal | null;
  graphOpsReview: AssistantGraphOpsReview | null;
  currentOutputTurnId?: string | null;
}): string {
  if (graphOpsReview?.proposal.proposal_id) {
    return `assistant_result_graphops_${graphOpsReview.proposal.proposal_id}`;
  }
  if (proposal?.proposal_id) {
    return `assistant_result_proposal_${proposal.proposal_id}`;
  }
  if (currentOutputTurnId) {
    return `assistant_result_turn_${currentOutputTurnId}`;
  }
  return 'assistant_result_current';
}

function assistantResultBlockTimestamp(
  events: WorkbenchLiveEvent[],
  currentOutputTurnId?: string | null,
): string | undefined {
  const relatedEvents = events.filter((event) => {
    const rawType = assistantLiveEventRawType(event);
    const isResultEvent =
      rawType === 'agent_output_draft' ||
      rawType === 'agent_output_published' ||
      rawType === 'artifact_ready';
    if (!isResultEvent) {
      return false;
    }
    return currentOutputTurnId ? event.turn_id === currentOutputTurnId : true;
  });
  return latestWorkbenchEventTimestamp(relatedEvents);
}

function latestWorkbenchEventTimestamp(events: WorkbenchLiveEvent[]): string | undefined {
  let latest: { timestamp: string; time: number } | null = null;
  for (const event of events) {
    const time = Date.parse(event.timestamp);
    if (!Number.isFinite(time)) {
      continue;
    }
    if (!latest || time > latest.time) {
      latest = { timestamp: event.timestamp, time };
    }
  }
  return latest?.timestamp;
}

function assistantLiveEventRawType(event: WorkbenchLiveEvent): string {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  return stringValue(payload.event_type) || event.type;
}

function assistantLiveEventLabel(event: WorkbenchLiveEvent): string {
  const rawType = assistantLiveEventRawType(event);
  if (event.type === 'agent_tool_use') {
    return '调用工具';
  }
  if (event.type === 'agent_tool_result') {
    return '工具结果';
  }
  if (event.type === 'artifact_ready' || rawType === 'artifact_ready') {
    return '生成草稿';
  }
  if (event.type === 'agent_usage') {
    return '用量';
  }
  if (event.type === 'agent_status') {
    return '状态';
  }
  return event.type;
}

function assistantLiveEventText(event: WorkbenchLiveEvent): string {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  return (
    event.text ||
    stringValue(payload.error) ||
    stringValue(payload.content) ||
    stringValue(payload.delta) ||
    stringValue(payload.message) ||
    stringValue(payload.summary) ||
    stringValue(payload.name) ||
    stringValue(payload.tool) ||
    stringValue(payload.status)
  );
}

function assistantLiveEventPayloadSummary(payload: Record<string, unknown> | undefined): string {
  if (!payload) {
    return '';
  }
  const summary =
    stringValue(payload.error) ||
    stringValue(payload.summary) ||
    stringValue(payload.message) ||
    stringValue(payload.status);
  if (summary) {
    return summary;
  }
  const outputPath = stringValue(payload.output_path) || stringValue(payload.path);
  return outputPath ? shortPath(outputPath) : '';
}

function assistantFailureTechnicalDetail(payload: Record<string, unknown>): string {
  const details = [
    stringValue(payload.technical_detail),
    stringValue(payload.error),
    stringValue(payload.raw_error_ref),
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  return details.join('\n');
}

function dedupeAssistantTranscriptItems(items: AssistantTranscriptItem[]): AssistantTranscriptItem[] {
  const seen = new Set<string>();
  const result: AssistantTranscriptItem[] = [];
  for (const item of items) {
    const key = assistantTranscriptDedupeKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function assistantTranscriptDedupeKey(item: AssistantTranscriptItem): string {
  if (item.kind === 'assistant_stream') {
    return `assistant_stream_${item.turnId}`;
  }
  if (
    (item.kind === 'assistant_message' || item.kind === 'user_message') &&
    item.turnId &&
    item.content
  ) {
    return `${item.kind}_${item.turnId}_${item.content}`;
  }
  return item.id;
}

function sortAssistantTranscriptItems(items: AssistantTranscriptItem[]): AssistantTranscriptItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftTime = assistantTranscriptItemTime(left.item);
      const rightTime = assistantTranscriptItemTime(right.item);
      if (leftTime === rightTime) {
        if (leftTime === null) {
          const leftRank = assistantUntimedItemRank(left.item);
          const rightRank = assistantUntimedItemRank(right.item);
          if (leftRank !== rightRank) {
            return leftRank - rightRank;
          }
        }
        return left.index - right.index;
      }
      if (leftTime === null) {
        return 1;
      }
      if (rightTime === null) {
        return -1;
      }
      return leftTime - rightTime;
    })
    .map(({ item }) => item);
}

function assistantUntimedItemRank(item: AssistantTranscriptItem): number {
  if (item.kind === 'result_block' || item.kind === 'proposal' || item.kind === 'graphops_review') {
    return 1;
  }
  if (
    item.kind === 'status' ||
    item.kind === 'tool_event' ||
    item.kind === 'process_group' ||
    item.kind === 'error'
  ) {
    return 2;
  }
  return 3;
}

function assistantTranscriptItemTime(item: AssistantTranscriptItem): number | null {
  const createdAt =
    'createdAt' in item && typeof item.createdAt === 'string' ? Date.parse(item.createdAt) : NaN;
  return Number.isFinite(createdAt) ? createdAt : null;
}

function assistantDisplayStatus({
  sessionStatus,
  busy,
  pendingTurn,
  agentSession,
}: {
  sessionStatus: string;
  busy: boolean;
  pendingTurn: AgentTurnRecord | null;
  agentSession?: AgentSessionRecord | null;
}): AssistantDisplayStatus {
  const pendingStatus = String(pendingTurn?.status || '');
  if (pendingTurn && (!pendingStatus || pendingStatus === 'queued' || pendingStatus === 'running')) {
    return {
      label: pendingStatus === 'queued' ? '排队中' : '执行中',
      tone: pendingStatus || 'running',
      connecting: false,
      runningTurn: true,
      lastFailed: false,
      submissionBlocked: false,
    };
  }
  if (
    busy &&
    !pendingTurn &&
    (!sessionStatus ||
      sessionStatus === 'idle' ||
      sessionStatus === 'creating' ||
      sessionStatus === 'connecting' ||
      sessionStatus === 'loading')
  ) {
    return {
      label: '连接中',
      tone: 'connecting',
      connecting: true,
      runningTurn: false,
      lastFailed: false,
      submissionBlocked: false,
    };
  }
  if (busy && !pendingTurn && sessionStatus !== 'failed') {
    return {
      label: '执行中',
      tone: 'running',
      connecting: false,
      runningTurn: true,
      lastFailed: false,
      submissionBlocked: false,
    };
  }
  if (sessionStatus === 'failed') {
    const canSubmitNextTurn = agentSession?.can_submit_next_turn;
    const recoverability = stringValue(agentSession?.last_recoverability);
    if (canSubmitNextTurn === false || recoverability === 'blocked') {
      return {
        label: '需处理 · 上轮失败',
        tone: 'failed',
        connecting: false,
        runningTurn: false,
        lastFailed: true,
        submissionBlocked: true,
      };
    }
    return {
      label:
        recoverability === 'user_action_required'
          ? '需处理 · 可继续对话'
          : '可继续 · 上轮失败',
      tone: 'failed',
      connecting: false,
      runningTurn: false,
      lastFailed: true,
      submissionBlocked: false,
    };
  }
  const normalizedStatus = sessionStatus || 'idle';
  return {
    label: normalizedStatus,
    tone: normalizedStatus,
    connecting: false,
    runningTurn: false,
    lastFailed: false,
    submissionBlocked: false,
  };
}

function AssistantDockContent({
  input,
  messages,
  proposal,
  validation,
  temporaryResources,
  authoringAgents,
  selectedAuthoringAgentId,
  sessionId,
  agentSession,
  sessionStatus,
  pendingTurn,
  assistantEvents,
  liveState,
  turnReason,
  requiredActions,
  graphOpsReview,
  busy,
  targetLabel,
  hasSelectedRunNode,
  model,
  canUndoApply,
  onAgentChange,
  onTurnReasonChange,
  onInput,
  onSubmit,
  onApply,
  onDiscard,
  onUndoApply,
  onPersistTemporaryResource,
  onApplyGraphOpsReview,
  onDiscardGraphOpsReview,
}: {
  input: string;
  messages: AssistantChatMessage[];
  proposal: CanvasAuthoringProposal | null;
  validation: CanvasAuthoringValidationResult | null;
  temporaryResources: Record<string, TemporaryResourceDraft>;
  authoringAgents: AuthoringAgentSummary[];
  selectedAuthoringAgentId: string;
  sessionId: string | null;
  agentSession: AgentSessionRecord | null;
  sessionStatus: string;
  pendingTurn: AgentTurnRecord | null;
  assistantEvents: RunEvent[];
  liveState: WorkbenchLiveStreamState;
  turnReason: AssistantTurnReason;
  requiredActions: AuthoringRequiredAction[];
  graphOpsReview: AssistantGraphOpsReview | null;
  busy: boolean;
  targetLabel: string;
  hasSelectedRunNode: boolean;
  model: SelectedEntityDetailsModel;
  canUndoApply: boolean;
  onAgentChange: (agentId: string) => void;
  onTurnReasonChange: (reason: AssistantTurnReason) => void;
  onInput: (value: string) => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
  onApply: () => void;
  onDiscard: () => void;
  onUndoApply: () => void;
  onPersistTemporaryResource: (resourceDraftId: string) => void;
  onApplyGraphOpsReview: (review: AssistantGraphOpsReview) => void;
  onDiscardGraphOpsReview: () => void;
}) {
  const modificationMode = turnReason !== 'workbench_chat';
  const validationErrors = validation?.errors || [];
  const validationWarnings = validation?.warnings || [];
  const temporaryDrafts = Object.values(temporaryResources).filter(
    (draft) => draft.status !== 'discarded',
  );
  const graphOpsDiff = graphOpsReview?.dryRun.semantic_diff || {};
  const graphOpsCreatedFiles =
    graphOpsStringList(graphOpsDiff.created_files).length > 0
      ? graphOpsStringList(graphOpsDiff.created_files)
      : graphOpsReview?.dryRun.target_paths || [];
  const graphOpsWarnings = graphOpsStringList(graphOpsDiff.warnings);
  const assistantEmptyText = modificationMode
    ? '描述要生成或调整的 workflow 草稿。'
    : '等待输入需求';
  const [nodeContextOpen, setNodeContextOpen] = useState(false);
  const canShowNodeContext = model.kind !== 'canvas' && model.kind !== 'empty';
  const hasAssistantResult = Boolean(
    proposal || temporaryDrafts.length || requiredActions.length || graphOpsReview,
  );
  const displayStatus = assistantDisplayStatus({ sessionStatus, busy, pendingTurn, agentSession });
  const transcriptItems = useMemo(
    () =>
      buildAssistantTranscriptItems({
        messages,
        pendingTurn,
        assistantEvents,
        liveState,
        proposal,
        validation,
        graphOpsReview,
        hasResultBlock: hasAssistantResult,
        currentOutputTurnId:
          typeof agentSession?.current_output_turn_id === 'string'
            ? agentSession.current_output_turn_id
            : null,
      }),
    [
      agentSession?.current_output_turn_id,
      assistantEvents,
      graphOpsReview,
      hasAssistantResult,
      liveState,
      messages,
      pendingTurn,
      proposal,
      validation,
    ],
  );
  const assistantResultBlock = hasAssistantResult ? (
    <AssistantProposalSummary
      proposal={proposal}
      validationErrors={validationErrors}
      validationWarnings={validationWarnings}
      temporaryDrafts={temporaryDrafts}
      requiredActions={requiredActions}
      graphOpsReview={graphOpsReview}
      graphOpsCreatedFiles={graphOpsCreatedFiles}
      graphOpsWarnings={graphOpsWarnings}
      busy={busy}
      onDiscard={onDiscard}
      onPersistTemporaryResource={onPersistTemporaryResource}
      onApplyGraphOpsReview={onApplyGraphOpsReview}
      onDiscardGraphOpsReview={onDiscardGraphOpsReview}
    />
  ) : null;

  return (
    <section className="assistant-bottom-dock-body assistant-console" aria-label="AI 助手底部面板">
      <div className="assistant-console-main">
        <header className="assistant-console-header">
          <div>
            <span>AI Console</span>
            <strong>{targetLabel}</strong>
          </div>
          <div className="assistant-console-context" aria-label="当前上下文">
            <span className="assistant-context-chip">{modificationMode ? '修改模式' : '对话模式'}</span>
            <span className="assistant-context-chip">{hasSelectedRunNode ? '选中节点上下文' : '画布级上下文'}</span>
            <span className={`assistant-context-chip status-${displayStatus.tone || 'idle'}`}>
              {displayStatus.label}
            </span>
            {canShowNodeContext ? (
              <button
                type="button"
                className="assistant-context-chip button"
                onClick={() => setNodeContextOpen((current) => !current)}
                aria-expanded={nodeContextOpen}
              >
                {nodeContextOpen ? '收起节点输出' : '选中节点输出'}
              </button>
            ) : null}
          </div>
        </header>

        <details className="assistant-technical-details">
          <summary>技术详情</summary>
          <div className="assistant-session-row compact assistant-session-strip">
            <label>
              <span>Agent</span>
              <select
                value={selectedAuthoringAgentId}
                onChange={(event) => onAgentChange(event.target.value)}
                disabled={busy}
              >
                {authoringAgents.length ? (
                  authoringAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name || agent.id} · {agent.runtime}
                    </option>
                  ))
                ) : (
                  <option value="">未连接</option>
                )}
              </select>
            </label>
            <small>
              {sessionId ? `${sessionStatus} · ${sessionId}` : sessionStatus}
              {agentSession?.provider_session_id ? ` · provider ${agentSession.provider_session_id}` : ''}
            </small>
          </div>
        </details>

        {nodeContextOpen && canShowNodeContext ? (
          <div className="assistant-context-panel">
            <SelectedNodeRuntimePane model={model} />
          </div>
        ) : null}

        <AssistantTranscriptView
          items={transcriptItems}
          emptyText={assistantEmptyText}
          resultBlock={assistantResultBlock}
        />

        <AssistantComposer
          input={input}
          modificationMode={modificationMode}
          displayStatus={displayStatus}
          proposalReady={Boolean(proposal)}
          canUndoApply={canUndoApply}
          validationStatus={validation?.status}
          onInput={onInput}
          onSubmit={onSubmit}
          onApply={onApply}
          onUndoApply={onUndoApply}
          onModeChange={(nextModificationMode) =>
            onTurnReasonChange(nextModificationMode ? 'canvas_revision' : 'workbench_chat')
          }
        />
      </div>
    </section>
  );
}

function AssistantTranscriptView({
  items,
  emptyText,
  resultBlock,
}: {
  items: AssistantTranscriptItem[];
  emptyText: string;
  resultBlock: ReactNode;
}) {
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const hasContent = items.length > 0;
  const latestContentSignature = useMemo(() => assistantTranscriptContentSignature(items), [items]);

  const scrollToBottom = useCallback(() => {
    const element = transcriptRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, []);

  useEffect(() => {
    if (!isPinnedToBottom) {
      return;
    }
    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [isPinnedToBottom, latestContentSignature, scrollToBottom]);

  const onScroll = useCallback(() => {
    const element = transcriptRef.current;
    if (!element) {
      return;
    }
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setIsPinnedToBottom(distanceFromBottom <= 48);
  }, []);

  const jumpToLatest = useCallback(() => {
    setIsPinnedToBottom(true);
    window.requestAnimationFrame(scrollToBottom);
  }, [scrollToBottom]);

  return (
    <section className="assistant-transcript-shell" aria-label="AI 助手对话时间线">
      <div
        ref={transcriptRef}
        className="assistant-transcript"
        role="log"
        aria-label="AI 助手消息"
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={onScroll}
      >
        {hasContent ? (
          <>
            {items.map((item) =>
              item.kind === 'result_block' ? (
                resultBlock ? (
                  <div key={item.id} className="assistant-transcript-result">
                    {resultBlock}
                  </div>
                ) : null
              ) : (
                <AssistantTranscriptEntry key={item.id} item={item} />
              ),
            )}
          </>
        ) : (
          <p className="assistant-empty">{emptyText}</p>
        )}
      </div>
      {hasContent && !isPinnedToBottom ? (
        <button type="button" className="assistant-transcript-jump" onClick={jumpToLatest}>
          跳到底部
        </button>
      ) : null}
    </section>
  );
}

function assistantTranscriptContentSignature(items: AssistantTranscriptItem[]): string {
  return items
    .map((item) => {
      if (item.kind === 'assistant_stream') {
        return `${item.id}:${item.content}:${item.status}`;
      }
      if (item.kind === 'assistant_message' || item.kind === 'user_message' || item.kind === 'error') {
        return `${item.id}:${item.content}`;
      }
      if (item.kind === 'process_group') {
        return `${item.id}:${item.events.map((event) => `${event.id}:${event.detail || ''}`).join(',')}`;
      }
      return item.id;
    })
    .join('|');
}

function AssistantTranscriptEntry({ item }: { item: AssistantTranscriptItem }) {
  if (item.kind === 'result_block') {
    return null;
  }
  if (item.kind === 'proposal' || item.kind === 'graphops_review') {
    return (
      <article className={`assistant-transcript-entry ${item.kind}`}>
        <span>{item.kind === 'proposal' ? 'proposal' : 'graphops'}</span>
        <p>{item.kind === 'proposal' ? `${item.proposalId || '草稿'} · ${item.status}` : item.status}</p>
      </article>
    );
  }
  if (item.kind === 'process_group') {
    return (
      <article className="assistant-transcript-entry process_group">
        <details className="assistant-process-group" {...(item.defaultOpen ? { open: true } : {})}>
          <summary>
            <span>过程</span>
            <strong>{item.label}</strong>
          </summary>
          <div className="assistant-process-events">
            {item.events.map((event) => (
              <div key={event.id} className="assistant-process-event">
                <span>{event.label}</span>
                {event.detail ? <p>{event.detail}</p> : null}
              </div>
            ))}
          </div>
        </details>
      </article>
    );
  }
  if (item.kind === 'status' || item.kind === 'tool_event') {
    return (
      <article className={`assistant-transcript-entry ${item.kind}`}>
        <span>{item.label}</span>
        {item.detail ? <p>{item.detail}</p> : null}
      </article>
    );
  }
  const roleLabel =
    item.kind === 'user_message'
      ? 'user'
      : item.kind === 'assistant_stream'
        ? `assistant · ${item.status}`
        : item.kind === 'error'
          ? 'assistant · failure'
          : 'assistant';
  return (
    <article
      className={`assistant-transcript-entry ${item.kind}`}
      role={item.kind === 'error' ? 'alert' : undefined}
      aria-live={item.kind === 'assistant_stream' ? 'polite' : undefined}
    >
      <span>{roleLabel}</span>
      <p>{item.content}</p>
      {item.kind === 'error' && item.detail ? (
        <details className="assistant-error-detail">
          <summary>技术细节</summary>
          <pre>{item.detail}</pre>
        </details>
      ) : null}
    </article>
  );
}

function AssistantComposer({
  input,
  modificationMode,
  displayStatus,
  proposalReady,
  canUndoApply,
  validationStatus,
  onInput,
  onSubmit,
  onApply,
  onUndoApply,
  onModeChange,
}: {
  input: string;
  modificationMode: boolean;
  displayStatus: AssistantDisplayStatus;
  proposalReady: boolean;
  canUndoApply: boolean;
  validationStatus?: CanvasAuthoringValidationResult['status'];
  onInput: (value: string) => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
  onApply: () => void;
  onUndoApply: () => void;
  onModeChange: (modificationMode: boolean) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const submitDisabled =
    displayStatus.connecting || displayStatus.runningTurn || displayStatus.submissionBlocked;
  const submitLabel = displayStatus.connecting
    ? '连接中...'
    : displayStatus.runningTurn
      ? '执行中...'
      : displayStatus.submissionBlocked
        ? '需处理'
      : modificationMode
        ? proposalReady
          ? '继续微调'
          : '生成修改'
        : '发送';

  const focusComposer = useCallback(() => {
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, []);

  const handleSubmit = useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      if (submitDisabled) {
        event?.preventDefault();
        return;
      }
      onSubmit(event);
      focusComposer();
    },
    [focusComposer, onSubmit, submitDisabled],
  );

  const submitFromKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };
      const isComposing = composingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229;
      if (event.key !== 'Enter' || event.shiftKey || isComposing) {
        return;
      }
      event.preventDefault();
      handleSubmit();
    },
    [handleSubmit],
  );

  return (
    <form className="assistant-compose assistant-console-compose" onSubmit={handleSubmit}>
      <div className="assistant-composer-toolbar">
        <div className="assistant-mode-segment" role="group" aria-label="AI 助手模式">
          <button
            type="button"
            className={!modificationMode ? 'active' : ''}
            aria-pressed={!modificationMode}
            onClick={() => onModeChange(false)}
          >
            对话模式
          </button>
          <button
            type="button"
            className={modificationMode ? 'active' : ''}
            aria-pressed={modificationMode}
            onClick={() => onModeChange(true)}
          >
            修改模式
          </button>
        </div>
        <button
          type="button"
          className="assistant-tertiary-action"
          onClick={onUndoApply}
          disabled={!canUndoApply || submitDisabled}
        >
          撤回节点
        </button>
      </div>
      <div className="assistant-console-input-row">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={submitFromKeyboard}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          placeholder={
            modificationMode
              ? '描述要生成或调整的 workflow 草稿'
              : '像 Codex CLI 一样和当前画布助手对话'
          }
          rows={2}
        />
        <div className="assistant-compose-actions">
          {modificationMode && proposalReady ? (
            <button
              type="button"
              className="primary-action"
              onClick={onApply}
              disabled={submitDisabled || validationStatus === 'invalid'}
            >
              应用修改
            </button>
          ) : null}
          <button type="submit" className="secondary-action" disabled={submitDisabled}>
            {submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

function AssistantControlRail({
  modificationMode,
  canUndoApply,
  busy,
  pendingTurn,
  onModeChange,
  onUndoApply,
}: {
  modificationMode: boolean;
  canUndoApply: boolean;
  busy: boolean;
  pendingTurn: boolean;
  onModeChange: (modificationMode: boolean) => void;
  onUndoApply: () => void;
}) {
  return (
    <div className="assistant-control-rail" aria-label="AI 助手模式控制">
      <button
        type="button"
        className={!modificationMode ? 'active' : ''}
        onClick={() => onModeChange(false)}
      >
        对话模式
      </button>
      <button
        type="button"
        className={modificationMode ? 'active' : ''}
        onClick={() => onModeChange(true)}
      >
        修改模式
      </button>
      <button type="button" onClick={onUndoApply} disabled={!canUndoApply || busy || pendingTurn}>
        撤回节点
      </button>
    </div>
  );
}

function AssistantProposalSummary({
  proposal,
  validationErrors,
  validationWarnings,
  temporaryDrafts,
  requiredActions,
  graphOpsReview,
  graphOpsCreatedFiles,
  graphOpsWarnings,
  busy,
  onDiscard,
  onPersistTemporaryResource,
  onApplyGraphOpsReview,
  onDiscardGraphOpsReview,
}: {
  proposal: CanvasAuthoringProposal | null;
  validationErrors: string[];
  validationWarnings: string[];
  temporaryDrafts: TemporaryResourceDraft[];
  requiredActions: AuthoringRequiredAction[];
  graphOpsReview: AssistantGraphOpsReview | null;
  graphOpsCreatedFiles: string[];
  graphOpsWarnings: string[];
  busy: boolean;
  onDiscard: () => void;
  onPersistTemporaryResource: (resourceDraftId: string) => void;
  onApplyGraphOpsReview: (review: AssistantGraphOpsReview) => void;
  onDiscardGraphOpsReview: () => void;
}) {
  if (!proposal && !temporaryDrafts.length && !requiredActions.length && !graphOpsReview) {
    return null;
  }
  return (
    <div className="assistant-bottom-proposal-stack">
      {proposal ? (
        <section className="assistant-proposal-panel compact" aria-label="CanvasAuthoringProposal">
          <header>
            <span>待应用草稿</span>
            <strong>{proposal.proposal_id}</strong>
          </header>
          <p>{proposal.rationale}</p>
          <ol>
            {proposal.operations.map((operation, index) => (
              <li key={`${operation.op}-${index}`}>{authoringOperationSummary(operation)}</li>
            ))}
          </ol>
          {validationErrors.length ? (
            <div className="assistant-validation invalid">
              {validationErrors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          ) : null}
          {validationWarnings.length ? (
            <div className="assistant-validation warning">
              {validationWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
          <button type="button" onClick={onDiscard}>
            丢弃草稿
          </button>
        </section>
      ) : null}
      {temporaryDrafts.length ? (
        <section className="assistant-temp-list compact" aria-label="临时资源">
          <header>临时资源</header>
          {temporaryDrafts.map((draft) => (
            <article key={draft.draft_id}>
              <strong>{draft.agent_draft.name || draft.draft_id}</strong>
              <span>{draft.draft_id}</span>
            </article>
          ))}
        </section>
      ) : null}
      {requiredActions.length ? (
        <section className="assistant-required-actions compact" aria-label="Authoring required actions">
          <header>需要人工动作</header>
          {requiredActions.map((action, index) => (
            <article key={`${action.kind}-${index}`}>
              <strong>{authoringRequiredActionLabel(action.kind)}</strong>
              <span>{action.reason || action.prompt || action.resource_draft_id || 'Review required'}</span>
              {action.kind === 'approve_resource_persistence' && action.resource_draft_id ? (
                <button
                  type="button"
                  className="secondary-action compact-action"
                  disabled={busy || !action.resource_draft_id}
                  onClick={() => onPersistTemporaryResource(String(action.resource_draft_id))}
                >
                  保存为资源
                </button>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      {graphOpsReview ? (
        <section className="assistant-graphops-review compact" aria-label="GraphOps 持久化预览">
          <header>
            <span>GraphOps 持久化预览</span>
            <strong>{graphOpsReview.proposal.proposal_id}</strong>
          </header>
          <ul>
            {graphOpsCreatedFiles.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
          {graphOpsWarnings.length ? <p>Warning: {graphOpsWarnings.join('; ')}</p> : null}
          <div className="assistant-proposal-actions">
            <button type="button" onClick={onDiscardGraphOpsReview} disabled={busy}>
              取消
            </button>
            <button
              type="button"
              className="primary-action"
              onClick={() => onApplyGraphOpsReview(graphOpsReview)}
              disabled={busy}
            >
              批准并写入
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SelectedNodeRuntimePane({ model }: { model: SelectedEntityDetailsModel }) {
  const [tab, setTab] = useState<'live' | 'schema' | 'error'>('live');

  useEffect(() => {
    setTab('live');
  }, [model.key]);

  if (!isNodeDetailModel(model)) {
    return (
      <section className="selected-node-runtime-pane" aria-label="选中节点输出">
        <header>
          <span>选中节点输出</span>
          <strong>未选择节点</strong>
        </header>
        <p className="empty-state">选择一个 Agent/Tool/Workflow 节点查看输出。</p>
      </section>
    );
  }

  return (
    <section className="selected-node-runtime-pane" aria-label="选中节点输出">
      <header>
        <div>
          <span>选中节点输出</span>
          <strong>{model.title}</strong>
        </div>
        <small className={`evidence-dock-status status-${model.status || 'not_run'}`}>
          {statusLabel(model.status || 'not_run')}
        </small>
      </header>
      <div className="selected-node-runtime-tabs" role="tablist" aria-label="选中节点输出视图">
        <button type="button" className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}>
          实时输出
        </button>
        <button type="button" className={tab === 'schema' ? 'active' : ''} onClick={() => setTab('schema')}>
          output schema
        </button>
        <button type="button" className={tab === 'error' ? 'active' : ''} onClick={() => setTab('error')}>
          error
        </button>
      </div>
      {tab === 'live' ? <SelectionLiveOutput model={model} /> : null}
      {tab === 'schema' ? <NodeOutputSchemaPane model={model} /> : null}
      {tab === 'error' ? <NodeErrorPane model={model} /> : null}
    </section>
  );
}

function SelectionLiveOutput({ model }: { model: SelectedEntityDetailsModel }) {
  const combinedLog = combinedLogText(model.log);
  const agentEventLog = agentEventsLiveText(model.events);
  const visibleLog = [combinedLog || model.log.excerpt, agentEventLog].filter(Boolean).join('\n\n');
  return (
    <div className="selection-log-output selection-live-output assistant-runtime-content" role="log" aria-live="polite">
      {visibleLog.trim() ? <pre>{visibleLog}</pre> : <p className="empty-state">当前节点还没有实时输出。</p>}
    </div>
  );
}

function NodeOutputSchemaPane({ model }: { model: SelectedEntityDetailsModel }) {
  const nodeSettings = model.nodeSettings;
  const fields =
    nodeSettings?.outputSchema && hasProjectedOutputPorts(nodeSettings.outputSchema)
      ? schemaDerivedOutputFields(nodeSettings.outputSchema)
      : dedupeSchemaFields([
          ...(nodeSettings?.outputSchema ? schemaFieldsFromJsonSchema(nodeSettings.outputSchema) : []),
          ...schemaFieldsFromPorts(undefined, nodeSettings?.outputPorts || []),
        ]);
  return (
    <div className="assistant-runtime-content output-schema-content">
      <SchemaFieldCards title="output schema" fields={fields} emptyText="当前节点没有声明 output schema。" />
    </div>
  );
}

function NodeErrorPane({ model }: { model: SelectedEntityDetailsModel }) {
  const failedEvents = model.events
    .filter((event) => String(event.event || '').includes('failed') || String(event.status || '').includes('failed'))
    .map(agentEventLiveLine)
    .filter((line) => line.trim());
  const errorText = [model.log.stderr, ...failedEvents].filter(Boolean).join('\n\n');
  return (
    <div className="selection-log-output assistant-runtime-content error-output" role="log" aria-live="polite">
      {errorText.trim() ? <pre>{errorText}</pre> : <p className="empty-state">当前节点没有错误输出。</p>}
    </div>
  );
}

function authoringRequiredActionLabel(kind: string): string {
  if (kind === 'ask') {
    return '提问';
  }
  if (kind === 'confirm_canvas_apply') {
    return '确认应用';
  }
  if (kind === 'approve_resource_persistence') {
    return '审批资源持久化';
  }
  if (kind === 'reject_or_revise') {
    return '拒绝或修改';
  }
  return kind;
}

function WorkspaceCanvas({
  canvas,
  layoutSyncVersion = 0,
  selection,
  connectionMode,
  edgeViewMode,
  workflowRun,
  focusedWorkflowId,
  callables,
  workflows,
  bindings,
  onFocusedWorkflow,
  onCanvasChange,
  onSelect,
  onOpenNodeDetails,
  onDeleteSelection,
  onConnectionMode,
  onEdgeViewMode,
  onBlankCanvas,
  onNotice,
  onConfigureWorkflow,
}: {
  canvas: WorkspaceCanvasModel;
  layoutSyncVersion?: number;
  selection: CanvasSelection;
  connectionMode: ConnectionMode;
  edgeViewMode: EdgeViewMode;
  workflowRun: WorkflowRunResult | null;
  focusedWorkflowId: string | null;
  callables: CallableSummary[];
  workflows: WorkflowSummary[];
  bindings: Record<string, WorkflowBindingView>;
  onFocusedWorkflow: (workflowId: string | null) => void;
  onCanvasChange: Dispatch<SetStateAction<WorkspaceCanvasModel>>;
  onSelect: (selection: CanvasSelection) => void;
  onOpenNodeDetails: (selection: CanvasSelection) => void;
  onDeleteSelection: (selection?: CanvasSelection) => void;
  onConnectionMode: (mode: ConnectionMode) => void;
  onEdgeViewMode: (mode: EdgeViewMode) => void;
  onBlankCanvas: () => void;
  onNotice?: (message: string) => void;
  onConfigureWorkflow: (workflowId: string) => void;
}) {
  const [flowInstance, setFlowInstance] = useState<{
    screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
    fitView?: (options?: { padding?: number; duration?: number }) => void;
  } | null>(null);
  const [nodeCreateMenu, setNodeCreateMenu] = useState<NodeCreateMenuState>(null);
  const [connectStart, setConnectStart] = useState<PendingCanvasConnection | null>(null);
  const [connectPreview, setConnectPreview] = useState<ConnectPreviewState | null>(null);
  const [dataDropTargetPreview, setDataDropTargetPreview] = useState<DataDropTargetPreview | null>(null);
  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const [flowNodes, setFlowNodes] = useState<CanvasFlowNode[]>([]);
  const flowNodesRef = useRef<CanvasFlowNode[]>([]);
  const connectionModeRef = useRef(connectionMode);
  const connectStartRef = useRef<PendingCanvasConnection | null>(null);
  const connectCompletedRef = useRef(false);
  const connectCommitVersionRef = useRef(0);
  const internalClickConnectRef = useRef<{
    workflowId: string;
    nodeId: string;
    mode: ConnectionMode;
  } | null>(null);
  const nodeDragStartPositionRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const nodeDragEligibleRef = useRef<Map<string, boolean>>(new Map());
  const draggingRef = useRef(false);
  const suppressInternalClickConnectRef = useRef(false);
  const lastDragCommitRef = useRef<string | null>(null);
  const forceCommittedProjectionRef = useRef(false);
  const projectionKeysRef = useRef({ identity: '', layout: '' });
  const layoutSyncVersionRef = useRef(layoutSyncVersion);
  const lastFitViewNodeCountRef = useRef(0);
  const visibleCanvas = useMemo(
    () => focusCanvas(canvas, focusedWorkflowId),
    [canvas, focusedWorkflowId],
  );
  useEffect(() => {
    setNodeCreateMenu(null);
    connectStartRef.current = null;
    internalClickConnectRef.current = null;
    setConnectStart(null);
    setConnectPreview(null);
    setDataDropTargetPreview(null);
  }, [canvas.id]);
  useEffect(() => {
    connectionModeRef.current = connectionMode;
    internalClickConnectRef.current = null;
  }, [connectionMode]);
  useEffect(() => {
    const handleDeleteShortcut = (event: KeyboardEvent) => {
      if ((event.key !== 'Backspace' && event.key !== 'Delete') || isTextEditingKeyboardTarget(event.target)) {
        return;
      }
      event.preventDefault();
      onDeleteSelection();
    };
    window.addEventListener('keydown', handleDeleteShortcut);
    return () => window.removeEventListener('keydown', handleDeleteShortcut);
  }, [onDeleteSelection]);
  useEffect(() => {
    const visibleNodeCount = flowNodes.length;
    if (!flowInstance?.fitView || visibleNodeCount === 0 || visibleNodeCount === lastFitViewNodeCountRef.current) {
      return;
    }
    lastFitViewNodeCountRef.current = visibleNodeCount;
    window.setTimeout(() => flowInstance.fitView?.({ padding: 0.18, duration: 180 }), 0);
  }, [flowInstance, flowNodes.length]);
  const handleSelectPort = useCallback(
    (workflowId: string, portValue: WorkflowPortView) => {
      const nextSelection: CanvasSelection = {
        type: 'port',
        workflowId,
        portId: portValue.id,
        direction: portValue.direction,
      };
      if (connectionMode === 'data' && selection.type === 'port') {
        const endpoints = [selection, nextSelection];
      const source = endpoints.find((item) => item.direction === 'output');
      const target = endpoints.find((item) => item.direction === 'input');
        if (!source || !target) {
          onSelect(nextSelection);
          onNotice?.('Data Edge 必须从 output port 连接到 input port');
          return;
        }
        const resolved = resolveScopedConnection(
          visibleCanvas,
          {
            source: source.workflowId,
            sourceHandle: portTokenId(source.workflowId, 'output', source.portId),
            target: target.workflowId,
            targetHandle: portTokenId(target.workflowId, 'input', target.portId),
          },
          'data',
        );
        if (!resolved.accepted) {
          onSelect(nextSelection);
        onNotice?.(resolved.reason);
        return;
      }
      const preflight = tryCommitResolvedConnection(canvas, resolved);
      if (!preflight.ok) {
        onSelect(nextSelection);
        onNotice?.(preflight.message);
        return;
      }
      let storedEdge = preflight.result.edge;
      onCanvasChange((current) => {
        const committed = tryCommitResolvedConnection(current, resolved);
        if (!committed.ok) {
          return current;
        }
        storedEdge = committed.result.edge;
        return committed.result.canvas;
      });
      onSelect(selectionForEdgeAddress(edgeAddressForScope(resolved.scopeWorkflowId, storedEdge.id)));
      return;
      }
      onSelect(nextSelection);
    },
    [canvas, connectionMode, onCanvasChange, onNotice, onSelect, selection, visibleCanvas],
  );
  const clearTransientInteractionState = useCallback(() => {
    setNodeCreateMenu(null);
    connectStartRef.current = null;
    internalClickConnectRef.current = null;
    setConnectStart(null);
    setConnectPreview(null);
    setDataDropTargetPreview(null);
  }, []);
  const dispatchCanvasInteraction = useCallback(
    (command: CanvasInteractionCommand) => {
      setNodeCreateMenu(null);
      if (command.type === 'blank-pane-click') {
        clearTransientInteractionState();
        onSelect({ type: 'task_canvas', taskId: canvas.id });
        return;
      }
      if (command.type === 'port-click') {
        const workflow = visibleCanvas.workflows.find((item) => item.id === command.workflowId);
        const ports = command.direction === 'input' ? workflow?.inputPorts : workflow ? workflowOutputPorts(workflow) : undefined;
        const portValue = ports?.find((item) => item.id === command.portId);
        if (workflow && portValue) {
          handleSelectPort(command.workflowId, portValue);
        }
        return;
      }
      if (command.type === 'edge-click') {
        const edgeSelection = selectionForEdgeAddress(command.address);
        if (command.altKey) {
          onDeleteSelection(edgeSelection);
          return;
        }
        onSelect(edgeSelection);
        return;
      }
      if (command.intent.kind === 'internal-node' && suppressInternalClickConnectRef.current) {
        internalClickConnectRef.current = null;
      }
      const nextSelection = normalizeSelectionIntent(visibleCanvas, canvas, command.intent, focusedWorkflowId);
      if (nextSelection) {
        onSelect(nextSelection);
      }
    },
    [
      canvas,
      clearTransientInteractionState,
      focusedWorkflowId,
      handleSelectPort,
      onDeleteSelection,
      onSelect,
      visibleCanvas,
    ],
  );
  const handleResizeWorkflow = useCallback(
    (workflowId: string, size: { width: number; height: number }) =>
      onCanvasChange((current) => resizeWorkflowContainer(current, workflowId, size)),
    [onCanvasChange],
  );
  const handleMoveInternal = useCallback(
    (workflowId: string, nodeId: string, position: { x: number; y: number }) =>
      onCanvasChange((current) => moveInternalNode(current, workflowId, nodeId, position)),
    [onCanvasChange],
  );
  const handleControlHandleMouseDown = useCallback(
    (nodeId: string, handleId: string, side: EndpointSide, modeOverride?: ConnectionMode) => {
      const mode = modeOverride || connectionModeRef.current;
      const pending = {
        nodeId,
        handleId,
        mode,
        side,
        endpoint: describeEndpoint(visibleCanvas, nodeId, handleId, side, mode),
      };
      if (!pending.endpoint) {
        onNotice?.('无法识别连接起点');
        recordConnectionTrace('begin_rejected', { nodeId, handleId, side, mode });
        connectStartRef.current = null;
        setConnectStart(null);
        setConnectPreview(null);
        return;
      }
      connectCompletedRef.current = false;
      connectStartRef.current = pending;
      recordConnectionTrace('begin', { nodeId, handleId, side, mode, endpoint: pending.endpoint });
    },
    [onNotice, visibleCanvas],
  );
  const projectedFlowNodes = useMemo(
    () => {
      const dataPortsVisible = connectionMode === 'data' || edgeViewMode === 'all' || edgeViewMode === 'data';
      const dataPortLabelsVisible = connectionMode === 'data';
      return toFlowNodes(
        visibleCanvas,
        selection,
        bindings,
        (workflowId) => dispatchCanvasInteraction({ type: 'select', intent: { kind: 'workflow-shell', workflowId } }),
        (workflowId, portValue) =>
          dispatchCanvasInteraction({
            type: 'port-click',
            workflowId,
            portId: portValue.id,
            direction: portValue.direction,
          }),
        (workflowId, nodeId) =>
          dispatchCanvasInteraction({ type: 'select', intent: { kind: 'internal-node', workflowId, nodeId } }),
        onOpenNodeDetails,
        onFocusedWorkflow,
        onConfigureWorkflow,
        dataPortsVisible,
        dataPortsVisible,
        dataPortLabelsVisible,
        handleResizeWorkflow,
        handleMoveInternal,
        handleControlHandleMouseDown,
        connectionMode,
        edgeViewMode,
        dataDropTargetPreview,
        (address, altKey = false) => dispatchCanvasInteraction({ type: 'edge-click', address, altKey }),
      );
    },
    [
      visibleCanvas,
      selection,
      bindings,
      dispatchCanvasInteraction,
      onOpenNodeDetails,
      onFocusedWorkflow,
      onConfigureWorkflow,
      connectionMode,
      handleResizeWorkflow,
      handleMoveInternal,
      handleControlHandleMouseDown,
      edgeViewMode,
      dataDropTargetPreview,
    ],
  );
  const projectedIdentityKey = useMemo(
    () => flowNodeIdentityKey(projectedFlowNodes),
    [projectedFlowNodes],
  );
  const projectedLayoutKey = useMemo(
    () => flowNodeLayoutKey(projectedFlowNodes),
    [projectedFlowNodes],
  );
  const flowEdges = useMemo(
    () => toFlowEdges(visibleCanvas, selection, connectionMode, edgeViewMode, connectionMode === 'data'),
    [visibleCanvas, selection, connectionMode, edgeViewMode],
  );

  useEffect(() => {
    if (layoutSyncVersionRef.current === layoutSyncVersion) {
      return;
    }
    layoutSyncVersionRef.current = layoutSyncVersion;
    forceCommittedProjectionRef.current = false;
    projectionKeysRef.current = {
      identity: projectedIdentityKey,
      layout: projectedLayoutKey,
    };
    flowNodesRef.current = projectedFlowNodes;
    setFlowNodes(projectedFlowNodes);
  }, [layoutSyncVersion, projectedFlowNodes, projectedIdentityKey, projectedLayoutKey]);

  useEffect(() => {
    setFlowNodes((current) => {
      const previousKeys = projectionKeysRef.current;
      const hasCurrentNodes = current.length > 0;
      const identityChanged = hasCurrentNodes && previousKeys.identity !== projectedIdentityKey;
      const layoutChanged = hasCurrentNodes && previousKeys.layout !== projectedLayoutKey;
      const shouldForceCommittedProjection = forceCommittedProjectionRef.current && layoutChanged;
      if (shouldForceCommittedProjection) {
        forceCommittedProjectionRef.current = false;
      }
      projectionKeysRef.current = {
        identity: projectedIdentityKey,
        layout: projectedLayoutKey,
      };
      const nextNodes =
        !hasCurrentNodes ||
        identityChanged ||
        shouldForceCommittedProjection ||
        layoutChanged
          ? projectedFlowNodes
          : reconcileFlowNodes(current, projectedFlowNodes, { preservePositions: true });
      flowNodesRef.current = nextNodes;
      return nextNodes;
    });
  }, [projectedFlowNodes, projectedIdentityKey, projectedLayoutKey]);

  const commitDraggedFlowNode = useCallback((node: CanvasFlowNode) => {
    const commitKey = dragCommitKey(node);
    if (lastDragCommitRef.current === commitKey) {
      return;
    }
    lastDragCommitRef.current = commitKey;
    forceCommittedProjectionRef.current = true;
    const committedFlowNodes = flowNodesRef.current;
    const nextSelection = selectionForDraggedNodeCommit(
      visibleCanvas,
      committedFlowNodes,
      node,
      selection,
    );
    onCanvasChange((current) =>
      commitDraggedNodeToCanvas(current, committedFlowNodes, node, visibleCanvas.focusedWorkflowId || null),
    );
    if (nextSelection) {
      onSelect(nextSelection);
    }
  }, [onCanvasChange, onSelect, selection, visibleCanvas]);

  const handleNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    const hasRemoveChange = changes.some((change) => change.type === 'remove');
    const completedDragNodeIds = changes.flatMap((change) =>
      change.type === 'position' && change.dragging === false ? [change.id] : [],
    );
    const nextNodes = applyNodeChanges(
      changes,
      flowNodesRef.current.length ? flowNodesRef.current : projectedFlowNodes,
    ) as CanvasFlowNode[];
    flowNodesRef.current = nextNodes;
    setFlowNodes(nextNodes);
    if (completedDragNodeIds.length > 0) {
      draggingRef.current = false;
      setIsDraggingNode(false);
      if (connectStartRef.current) {
        flowNodesRef.current = projectedFlowNodes;
        setFlowNodes(projectedFlowNodes);
        return;
      }
      const nextNodeById = new Map(nextNodes.map((node) => [node.id, node]));
      completedDragNodeIds.forEach((nodeId) => {
        const node = nextNodeById.get(nodeId);
        if (node) {
          commitDraggedFlowNode(node);
        }
        nodeDragStartPositionRef.current.delete(nodeId);
        nodeDragEligibleRef.current.delete(nodeId);
      });
    }
    if (hasRemoveChange) {
      if (isTextEditingKeyboardTarget(document.activeElement)) {
        flowNodesRef.current = projectedFlowNodes;
        setFlowNodes(projectedFlowNodes);
        return;
      }
      onDeleteSelection();
      flowNodesRef.current = projectedFlowNodes;
      setFlowNodes(projectedFlowNodes);
    }
  }, [commitDraggedFlowNode, onDeleteSelection, projectedFlowNodes]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (!changes.some((change) => change.type === 'remove')) {
      return;
    }
    if (isTextEditingKeyboardTarget(document.activeElement)) {
      return;
    }
    onDeleteSelection();
  }, [onDeleteSelection]);

  const commitResolved = useCallback((resolved: Extract<ConnectionResolution, { accepted: true }>) => {
    const preflight = tryCommitResolvedConnection(canvas, resolved);
    if (!preflight.ok) {
      connectCompletedRef.current = false;
      onNotice?.(preflight.message);
      recordConnectionTrace('commit_rejected', { resolved, reason: preflight.message });
      return;
    }
    connectCompletedRef.current = true;
    connectCommitVersionRef.current += 1;
    setConnectPreview(null);
    setDataDropTargetPreview(null);
    recordConnectionTrace('commit', { resolved });
    let storedEdge = preflight.result.edge;
    onCanvasChange((current) => {
      const committed = tryCommitResolvedConnection(current, resolved);
      if (!committed.ok) {
        return current;
      }
      storedEdge = committed.result.edge;
      return committed.result.canvas;
    });
    onSelect(selectionForEdgeAddress(edgeAddressForScope(resolved.scopeWorkflowId, storedEdge.id)));
  }, [canvas, onCanvasChange, onNotice, onSelect]);

  const beginPendingConnection = useCallback(
    (
      nodeId: string,
      handleId: string | null,
      side: EndpointSide,
      mode: ConnectionMode = connectionMode,
    ): boolean => {
      const pending = {
        nodeId,
        handleId,
        mode,
        side,
        endpoint: describeEndpoint(visibleCanvas, nodeId, handleId, side, mode),
      };
      if (!pending.endpoint) {
        onNotice?.('无法识别连接起点');
        recordConnectionTrace('begin_rejected', { nodeId, handleId, side, mode });
        connectStartRef.current = null;
        setConnectStart(null);
        setConnectPreview(null);
        setDataDropTargetPreview(null);
        return false;
      }
      connectCompletedRef.current = false;
      connectStartRef.current = pending;
      setDataDropTargetPreview(null);
      recordConnectionTrace('begin', { nodeId, handleId, side, mode, endpoint: pending.endpoint });
      return true;
    },
    [connectionMode, onNotice, visibleCanvas],
  );

  const handleConnect: OnConnect = useCallback((connection) => {
    const resolved = resolveScopedConnection(visibleCanvas, connection, connectionMode);
    recordConnectionTrace('on_connect', { connection, mode: connectionMode, resolved });
    if (resolved.accepted) {
      commitResolved(resolved);
      return;
    }
    const reversed = reverseConnection(connection);
    if (reversed) {
      const reversedResolved = resolveScopedConnection(visibleCanvas, reversed, connectionMode);
      recordConnectionTrace('on_connect_reversed', { connection: reversed, mode: connectionMode, resolved: reversedResolved });
      if (reversedResolved.accepted) {
        commitResolved(reversedResolved);
        return;
      }
    }
    const pendingConnection = connectStartRef.current || connectStart;
    for (const candidate of connectionCandidatesFromPendingEndpoint(pendingConnection, connection)) {
      const retryResolved = resolveScopedConnection(visibleCanvas, candidate, pendingConnection?.mode || connectionMode);
      recordConnectionTrace('on_connect_retry', {
        connection: candidate,
        mode: pendingConnection?.mode || connectionMode,
        resolved: retryResolved,
      });
      if (retryResolved.accepted) {
        commitResolved(retryResolved);
        return;
      }
    }
    connectCompletedRef.current = false;
    onNotice?.(resolved.reason);
  }, [commitResolved, connectStart, connectionMode, onNotice, visibleCanvas]);

  const commitPendingConnectionAtPoint = useCallback(
    (
      point: { x: number; y: number },
      pendingConnection: PendingCanvasConnection,
      targetEndpointOverride?: DomConnectionEndpoint | null,
      targetElementOverride?: Element | null,
    ): boolean => {
      const targetEndpoint = targetEndpointOverride || domConnectionEndpointAtPoint(point, pendingConnection.mode);
      recordConnectionTrace('release_target', { point, pendingConnection, targetEndpoint });
      const connection = connectionFromPendingEndpoint(pendingConnection, targetEndpoint);
      if (!connection) {
        if (pendingConnection.mode === 'data') {
          const targetFlowNodeId = domFlowNodeIdAtPoint(point, targetElementOverride);
          if (targetFlowNodeId) {
            try {
              const plan = prepareDataEdgeToNodeBodyCommand(
                canvas,
                visibleCanvas,
                pendingConnection,
                targetFlowNodeId,
              );
              const expected = createDataEdgeCommand(plan.canvasWithTargetPort, plan.request);
              connectCompletedRef.current = true;
              connectCommitVersionRef.current += 1;
              if (plan.createdTargetPort) {
                onCanvasChange((current) =>
                  prepareDataEdgeToNodeBodyCommand(
                    current,
                    current === canvas ? visibleCanvas : focusCanvas(current, focusedWorkflowId),
                    pendingConnection,
                    targetFlowNodeId,
                  ).canvasWithTargetPort,
                );
                window.setTimeout(() => {
                  onCanvasChange((current) => {
                    const nextPlan = prepareDataEdgeToNodeBodyCommand(
                      current,
                      focusCanvas(current, focusedWorkflowId),
                      pendingConnection,
                      targetFlowNodeId,
                    );
                    return createDataEdgeCommand(nextPlan.canvasWithTargetPort, nextPlan.request).canvas;
                  });
                  onSelect(selectionForEdgeAddress(edgeAddressForScope(plan.request.scopeWorkflowId, expected.edge.id)));
                }, 0);
              } else {
                onCanvasChange((current) => {
                  if (current === canvas) {
                    return expected.canvas;
                  }
                  return createDataEdgeToNodeBodyCommand(
                    current,
                    focusCanvas(current, focusedWorkflowId),
                    pendingConnection,
                    targetFlowNodeId,
                  ).canvas;
                });
                onSelect(selectionForEdgeAddress(edgeAddressForScope(plan.request.scopeWorkflowId, expected.edge.id)));
              }
              onNotice?.(
                `已创建输入端口 ${plan.request.targetNodeId}.${plan.targetPortId} 并连接 Data Edge` +
                  (expected.autoAddedControlEdge ? '；已自动补控制依赖' : ''),
              );
              setDataDropTargetPreview(null);
              return true;
            } catch (error) {
              connectCompletedRef.current = false;
              onNotice?.(error instanceof Error ? error.message : '创建 Data Edge 失败');
              setDataDropTargetPreview(null);
              return false;
            }
          }
          onNotice?.('Data Edge 请释放到目标节点或 input port');
        }
        recordConnectionTrace('release_no_connection', { point, pendingConnection, targetEndpoint });
        return false;
      }
      const resolved = resolveScopedConnection(visibleCanvas, connection, pendingConnection.mode);
      recordConnectionTrace('release_resolved', { connection, mode: pendingConnection.mode, resolved });
      if (!resolved.accepted) {
        onNotice?.(resolved.reason);
        return false;
      }
      commitResolved(resolved);
      setDataDropTargetPreview(null);
      return true;
    },
    [canvas, commitResolved, focusedWorkflowId, onCanvasChange, onNotice, onSelect, visibleCanvas],
  );

  const beginPendingFromHandleEvent = useCallback(
    (event: CanvasPointerEvent & { button?: number }) => {
      const eventTarget = event.target instanceof Element ? event.target : null;
      const handleElement = closestConnectionHandle(eventTarget);
      if (!(handleElement instanceof HTMLElement)) {
        return false;
      }
      const handleMode = connectionModeForHandleElement(handleElement);
      if (!handleMode) {
        return false;
      }
      if (typeof event.button === 'number' && event.button !== 0) {
        return false;
      }
      const nodeId = handleElement.getAttribute('data-nodeid');
      if (!nodeId) {
        return false;
      }
      const side = connectionSideFromHandleElement(handleElement);
      if (!side) {
        return false;
      }
      const didBegin = beginPendingConnection(
        nodeId,
        handleElement.getAttribute('data-handleid'),
        side,
        handleMode,
      );
      if (didBegin) {
        setConnectPreview(connectionPreviewFromHandle(handleElement, pointerPoint(event)));
        recordConnectionTrace('begin_from_dom', {
          nodeId,
          handleId: handleElement.getAttribute('data-handleid'),
          side,
          mode: handleMode,
        });
      }
      return didBegin;
    },
    [beginPendingConnection],
  );

  const commitPendingFromReleaseEvent = useCallback(
    (event: CanvasPointerEvent): boolean => {
      const point = pointerPoint(event);
      const pendingAtRelease = connectStartRef.current;
      const targetAtRelease =
        pendingAtRelease && event.target instanceof Element
          ? domConnectionEndpointFromElement(event.target, pendingAtRelease.mode)
          : null;
      const targetElementAtRelease = event.target instanceof Element ? event.target : null;
      const commitVersionAtRelease = connectCommitVersionRef.current;
      recordConnectionTrace('release_event', {
        point,
        pendingAtRelease,
        targetAtRelease,
        commitVersionAtRelease,
      });
      window.setTimeout(() => {
        const pendingConnection = pendingAtRelease;
        if (!pendingConnection) {
          return;
        }
        if (connectCommitVersionRef.current === commitVersionAtRelease) {
          commitPendingConnectionAtPoint(point, pendingConnection, targetAtRelease, targetElementAtRelease);
        }
        if (connectStartRef.current === pendingConnection) {
          connectStartRef.current = null;
        }
        connectCompletedRef.current = false;
        setConnectStart(null);
        setConnectPreview(null);
        setDataDropTargetPreview(null);
      }, 0);
      return Boolean(pendingAtRelease);
    },
    [commitPendingConnectionAtPoint],
  );

  const handleNodeDragStart = useCallback((event?: unknown, node?: CanvasFlowNode) => {
    if (connectStartRef.current) {
      draggingRef.current = false;
      setIsDraggingNode(false);
      return;
    }
    draggingRef.current = true;
    lastDragCommitRef.current = null;
    nodeDragStartPositionRef.current.clear();
    nodeDragEligibleRef.current.clear();
    const eventTarget = event && typeof event === 'object' && 'target' in event ? event.target : null;
    const hasBrowserEvent = eventTarget !== null;
    const startsFromHandle =
      eventTarget instanceof Element && Boolean(closestConnectionHandle(eventTarget));
    if (startsFromHandle) {
      draggingRef.current = false;
      setIsDraggingNode(false);
      return;
    }
    connectStartRef.current = null;
    connectCompletedRef.current = false;
    setConnectStart(null);
    setConnectPreview(null);
    setDataDropTargetPreview(null);
    if (!startsFromHandle) {
      internalClickConnectRef.current = null;
      suppressInternalClickConnectRef.current = true;
    }
    if (node) {
      nodeDragStartPositionRef.current.set(node.id, { ...node.position });
      nodeDragEligibleRef.current.set(node.id, !startsFromHandle);
    } else {
      flowNodesRef.current.forEach((item) => {
        nodeDragStartPositionRef.current.set(item.id, { ...item.position });
        nodeDragEligibleRef.current.set(item.id, !hasBrowserEvent && !startsFromHandle);
      });
    }
    setIsDraggingNode(true);
  }, []);

  const handleNodeDragStop = useCallback((node: CanvasFlowNode) => {
    const latestNode = flowNodesRef.current.find((item) => item.id === node.id) || node;
    const startPosition = nodeDragStartPositionRef.current.get(node.id);
    const dragEligible = nodeDragEligibleRef.current.get(node.id) !== false;
    nodeDragStartPositionRef.current.delete(node.id);
    nodeDragEligibleRef.current.delete(node.id);
    draggingRef.current = false;
    setIsDraggingNode(false);
    window.setTimeout(() => {
      suppressInternalClickConnectRef.current = false;
    }, 80);
    if (
      connectStartRef.current ||
      !dragEligible ||
      !startPosition ||
      Math.abs(latestNode.position.x - startPosition.x) + Math.abs(latestNode.position.y - startPosition.y) < 2
    ) {
      return;
    }
    commitDraggedFlowNode(latestNode);
  }, [commitDraggedFlowNode]);

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const item = parsePaletteItem(event.dataTransfer.getData('application/x-acc-palette'));
    if (!item) {
      return;
    }
    const position = flowPositionFromEvent(flowInstance, event);
    if (focusedWorkflowId) {
      if (item.kind === 'workflow') {
        onNotice?.('Workflow 内部不能嵌套拖入新的 Workflow');
        return;
      }
      onCanvasChange((current) => addInternalNodeFromPalette(current, focusedWorkflowId, item, position));
      onSelect(nextPaletteSelection(canvas, item, focusedWorkflowId));
      onNotice?.(`已加入 Workflow: ${focusedWorkflowId} / ${item.label}`);
      return;
    }
    const dropTarget = resolvePaletteDropTarget(canvas, item, event.target, position);
    if (dropTarget.kind === 'rejected') {
      onNotice?.(dropTarget.reason);
      return;
    }
    const nextSelection =
      item.kind === 'workflow'
        ? ({
            type: 'workflow',
            id: uniqueId(
              slugId(item.workflowRef || item.label || 'workflow') || 'workflow',
              new Set(canvas.workflows.map((workflow) => workflow.id)),
            ),
          } as CanvasSelection)
        : nextPaletteSelection(canvas, item, dropTarget.kind === 'workflow_internal' ? dropTarget.workflowId : null);
    onCanvasChange((current) => {
      if (item.kind === 'workflow') {
        return dropTarget.kind === 'root_canvas'
          ? addWorkflowFromPalette(current, item, dropTarget.position)
          : current;
      }
      return dropTarget.kind === 'workflow_internal'
        ? addInternalNodeFromPalette(current, dropTarget.workflowId, item, dropTarget.position)
        : addCallableNodeFromPalette(current, item, dropTarget.position);
    });
    onSelect(nextSelection);
    onNotice?.(
      dropTarget.kind === 'workflow_internal'
        ? `已加入 Workflow: ${dropTarget.workflowId} / ${item.label}`
        : `已加入 Root canvas: ${item.label}`,
    );
  }, [canvas, flowInstance, focusedWorkflowId, onCanvasChange, onNotice, onSelect]);

  const openCreateMenu = useCallback((event: ReactMouseEvent<Element> | MouseEvent) => {
    event.preventDefault();
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
    setNodeCreateMenu({
      x: event.clientX,
      y: event.clientY,
      position: flowPositionFromPoint(flowInstance, { x: event.clientX, y: event.clientY }, target),
    });
  }, [flowInstance]);

  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const pendingConnection = connectStartRef.current || connectStart;
    const point = pointerPoint(event);
    if (!connectCompletedRef.current && pendingConnection) {
      const targetEndpoint = domConnectionEndpointFromElement(target, pendingConnection.mode);
      if (commitPendingConnectionAtPoint(point, pendingConnection, targetEndpoint, target)) {
        connectStartRef.current = null;
        setConnectStart(null);
        setConnectPreview(null);
        setDataDropTargetPreview(null);
        return;
      }
    }
    if (
      connectCompletedRef.current ||
      !pendingConnection ||
      (target && (closestConnectionHandle(target) || target.closest('.react-flow__node')))
    ) {
      connectCompletedRef.current = false;
      connectStartRef.current = null;
      setConnectStart(null);
      setConnectPreview(null);
      setDataDropTargetPreview(null);
      return;
    }
    if (pendingConnection.mode === 'data') {
      onNotice?.('Data Edge 请释放到目标节点或 input port');
      connectStartRef.current = null;
      connectCompletedRef.current = false;
      setConnectStart(null);
      setConnectPreview(null);
      setDataDropTargetPreview(null);
      return;
    }
    setNodeCreateMenu({
      x: point.x,
      y: point.y,
      position: flowPositionFromPoint(flowInstance, point),
      pendingConnection,
    });
    connectStartRef.current = null;
    connectCompletedRef.current = false;
    setConnectStart(null);
    setConnectPreview(null);
    setDataDropTargetPreview(null);
  }, [commitPendingConnectionAtPoint, connectStart, flowInstance, onNotice]);

  const createMenuItem = useCallback((item: PaletteItem) => {
    if (focusedWorkflowId && item.kind === 'workflow') {
      return;
    }
    const menu = nodeCreateMenu;
    if (!menu) {
      return;
    }
    if (focusedWorkflowId && item.kind !== 'workflow') {
      onCanvasChange((current) =>
        addInternalNodeFromPaletteWithConnection(
          current,
          focusedWorkflowId,
          item,
          menu.position,
          menu.pendingConnection,
        ),
      );
      setNodeCreateMenu(null);
      return;
    }
    if (item.kind === 'workflow') {
      onCanvasChange((current) => addWorkflowFromPalette(current, item, menu.position));
    } else {
      onCanvasChange((current) => addCallableNodeFromPalette(current, item, menu.position));
    }
    setNodeCreateMenu(null);
  }, [focusedWorkflowId, nodeCreateMenu, onCanvasChange]);

  const handleConnectStart = useCallback(
    (event: unknown, params: { nodeId?: string | null; handleId?: string | null; handleType?: string | null }) => {
      const nodeId = String(params.nodeId || '');
      const handleId = params.handleId || null;
      const eventTarget = event && typeof event === 'object' && 'target' in event ? event.target : null;
      const handleElement =
        eventTarget instanceof Element ? closestConnectionHandle(eventTarget) : null;
      const handleMode =
        handleElement instanceof HTMLElement ? connectionModeForHandleElement(handleElement) : connectionMode;
      if (!handleMode) {
        connectStartRef.current = null;
        setConnectStart(null);
        return;
      }
      const domSide = handleElement instanceof HTMLElement ? connectionSideFromHandleElement(handleElement) : null;
      const side: EndpointSide =
        domSide ||
        (params.handleType === 'target' || params.handleType === 'source'
          ? params.handleType
          : 'source');
      beginPendingConnection(nodeId, handleId, side, handleMode);
    },
    [beginPendingConnection, connectionMode],
  );

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent | MouseEvent | TouchEvent) => {
      beginPendingFromHandleEvent(event);
    };
    const handlePointerUp = (event: PointerEvent | MouseEvent | TouchEvent) => {
      commitPendingFromReleaseEvent(event);
    };
    const handlePointerMove = (event: PointerEvent | MouseEvent | TouchEvent) => {
      const pendingConnection = connectStartRef.current;
      if (!pendingConnection) {
        return;
      }
      const point = pointerPoint(event);
      const targetEndpoint = domConnectionEndpointAtPoint(point, pendingConnection.mode);
      const connection = connectionFromPendingEndpoint(pendingConnection, targetEndpoint);
      const resolved = connection ? resolveScopedConnection(visibleCanvas, connection, pendingConnection.mode) : null;
      const snapHandle =
        resolved?.accepted && targetEndpoint
          ? connectionHandleElementForEndpoint(targetEndpoint)
          : null;
      const snapRect = snapHandle?.getBoundingClientRect();
      const end = snapRect && (snapRect.width > 0 || snapRect.height > 0)
        ? rectCenter(snapRect)
        : point;
      setConnectPreview((current) => current ? { ...current, end, snapped: Boolean(snapRect) } : null);
      if (pendingConnection.mode === 'data' && !snapRect) {
        const targetFlowNodeId = domFlowNodeIdAtPoint(point, event.target instanceof Element ? event.target : null);
        if (targetFlowNodeId) {
          try {
            const previewPortId = inputPortIdForDataBodyPreview(
              canvas,
              focusCanvas(canvas, focusedWorkflowId),
              pendingConnection,
              targetFlowNodeId,
            );
            setDataDropTargetPreview({ flowNodeId: targetFlowNodeId, portId: previewPortId });
            return;
          } catch {
            setDataDropTargetPreview(null);
            return;
          }
        }
      }
      setDataDropTargetPreview(null);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('mouseup', handlePointerUp, true);
    document.addEventListener('mousemove', handlePointerMove, true);
    document.addEventListener('touchstart', handlePointerDown, true);
    document.addEventListener('touchend', handlePointerUp, true);
    document.addEventListener('touchmove', handlePointerMove, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointerup', handlePointerUp, true);
      document.removeEventListener('pointermove', handlePointerMove, true);
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('mouseup', handlePointerUp, true);
      document.removeEventListener('mousemove', handlePointerMove, true);
      document.removeEventListener('touchstart', handlePointerDown, true);
      document.removeEventListener('touchend', handlePointerUp, true);
      document.removeEventListener('touchmove', handlePointerMove, true);
    };
  }, [beginPendingFromHandleEvent, canvas, commitPendingFromReleaseEvent, focusedWorkflowId, visibleCanvas]);

  const handleInit = useCallback(
    (instance: {
      screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
      fitView?: (options?: { padding?: number; duration?: number }) => void;
    }) =>
      setFlowInstance(instance),
    [],
  );

  const handleNodeClick = useCallback(
    (_: unknown, node: CanvasFlowNode) => {
      dispatchCanvasInteraction({ type: 'select', intent: { kind: 'react-flow-node', flowNodeId: node.id } });
    },
    [dispatchCanvasInteraction],
  );

  const handleNodeDoubleClick = useCallback(
    (event: ReactMouseEvent, node: CanvasFlowNode) => {
      if (isNodeDetailDoubleClickIgnored(event.target)) {
        return;
      }
      const nextSelection = normalizeSelectionIntent(
        visibleCanvas,
        canvas,
        { kind: 'react-flow-node', flowNodeId: node.id },
        focusedWorkflowId,
      );
      if (nextSelection && isInspectableNodeSelection(nextSelection)) {
        event.preventDefault();
        event.stopPropagation();
        onOpenNodeDetails(nextSelection);
      }
    },
    [canvas, focusedWorkflowId, onOpenNodeDetails, visibleCanvas],
  );

  const handleEdgeClick = useCallback(
    (event: ReactMouseEvent, edge: Edge) => {
      const address = edgeAddressFromFlowEdge(edge);
      if (!address) {
        return;
      }
      if (shouldDisconnectEdgeOnClick(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
      dispatchCanvasInteraction({ type: 'edge-click', address, altKey: shouldDisconnectEdgeOnClick(event) });
    },
    [dispatchCanvasInteraction],
  );

  const handlePaneClick = useCallback(() => {
    dispatchCanvasInteraction({ type: 'blank-pane-click' });
    onBlankCanvas();
  }, [dispatchCanvasInteraction, onBlankCanvas]);

  const defaultEdgeOptions = useMemo(() => ({}), []);

  return (
    <main
      className={isDraggingNode ? 'workspace-canvas-surface dragging-node' : 'workspace-canvas-surface'}
      aria-label="任务画布"
      onPointerDownCapture={beginPendingFromHandleEvent}
      onPointerUpCapture={commitPendingFromReleaseEvent}
      onMouseDownCapture={beginPendingFromHandleEvent}
      onMouseUpCapture={commitPendingFromReleaseEvent}
      onTouchStartCapture={beginPendingFromHandleEvent}
      onTouchEndCapture={commitPendingFromReleaseEvent}
      onDrop={handleDrop}
      onDragOver={(event) => event.preventDefault()}
      onContextMenu={openCreateMenu}
    >
      <CanvasToolbar
        connectionMode={connectionMode}
        edgeViewMode={edgeViewMode}
        focusedWorkflowId={focusedWorkflowId}
        workflowRun={workflowRun}
        onConnectionMode={onConnectionMode}
        onEdgeViewMode={onEdgeViewMode}
        onExitFocus={() => onFocusedWorkflow(null)}
      />
      <FlowNodeLayoutContext.Provider value={flowNodes}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onNodeDragStart={(event, node) => handleNodeDragStart(event, node as CanvasFlowNode)}
          onNodeDragStop={(_, node) => handleNodeDragStop(node as CanvasFlowNode)}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          onInit={handleInit}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onEdgeClick={handleEdgeClick}
          onPaneClick={handlePaneClick}
          onPaneContextMenu={openCreateMenu}
          connectOnClick={false}
          fitView
          minZoom={0.18}
          maxZoom={1.7}
          deleteKeyCode={['Backspace', 'Delete']}
          defaultEdgeOptions={defaultEdgeOptions}
        >
          <MiniMap />
          <Controls />
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} />
        </ReactFlow>
      </FlowNodeLayoutContext.Provider>
      {connectPreview ? <ConnectPreviewLine preview={connectPreview} /> : null}
      {nodeCreateMenu ? (
        <NodeCreateMenu
          x={nodeCreateMenu.x}
          y={nodeCreateMenu.y}
          focused={Boolean(focusedWorkflowId)}
          workflows={workflows}
          callables={callables}
          onPick={createMenuItem}
          onClose={() => setNodeCreateMenu(null)}
        />
      ) : null}
    </main>
  );
}

function CanvasToolbar({
  connectionMode,
  edgeViewMode,
  focusedWorkflowId,
  workflowRun,
  onConnectionMode,
  onEdgeViewMode,
  onExitFocus,
}: {
  connectionMode: ConnectionMode;
  edgeViewMode: EdgeViewMode;
  focusedWorkflowId: string | null;
  workflowRun: WorkflowRunResult | null;
  onConnectionMode: (mode: ConnectionMode) => void;
  onEdgeViewMode: (mode: EdgeViewMode) => void;
  onExitFocus: () => void;
}) {
  return (
    <div className="canvas-toolbar" aria-label="Canvas Toolbar">
      <span className="toolbar-group-label">边语义</span>
      <span className="mode-pill control">控制边 = 调度顺序</span>
      <span className="mode-pill data">数据边 = 端口/Artifact 传递</span>
      <span
        className={`mode-pill ${connectionMode === 'data' ? 'data' : 'control'}`}
        title={connectionMode === 'data' ? '当前正在创建数据边' : '当前正在创建控制边'}
      >
        当前连线：{connectionMode === 'data' ? '数据' : '控制'}
      </span>
      <span title={workflowRun ? `runtime status: ${workflowRun.status}` : 'runtime status: not_run'}>
        状态：{workflowRun ? statusLabel(workflowRun.status) : '未运行'}
      </span>
      <div className="segmented-control compact" aria-label="连接模式">
        <button
          type="button"
          className={connectionMode === 'control' ? 'active' : ''}
          aria-label="连接模式：控制"
          onClick={() => onConnectionMode('control')}
        >
          连控制
        </button>
        <button
          type="button"
          className={connectionMode === 'data' ? 'active' : ''}
          aria-label="连接模式：数据"
          onClick={() => onConnectionMode('data')}
        >
          连数据
        </button>
      </div>
      <div className="segmented-control compact" aria-label="边显示模式">
        {(['control', 'data', 'all'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={edgeViewMode === mode ? 'active' : ''}
            aria-label={mode === 'all' ? '显示全部边' : mode === 'control' ? '显示控制边' : '显示数据边'}
            onClick={() => onEdgeViewMode(mode)}
          >
            {mode === 'all' ? '显全部' : mode === 'control' ? '显控制' : '显数据'}
          </button>
        ))}
      </div>
      {focusedWorkflowId ? (
        <button type="button" onClick={onExitFocus}>
          返回 Workspace
        </button>
      ) : null}
    </div>
  );
}

function NodeCreateMenu({
  x,
  y,
  focused,
  workflows,
  callables,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  focused: boolean;
  workflows: WorkflowSummary[];
  callables: CallableSummary[];
  onPick: (item: PaletteItem) => void;
  onClose: () => void;
}) {
  const agentItems = callables.filter((callable) => callable.id !== 'file-source.local').slice(0, 8);
  const workflowItems = workflows.slice(0, 8);
  return (
    <div
      className="node-create-menu"
      style={{
        left: `clamp(12px, ${x}px, calc(100vw - 332px))`,
        top: `clamp(12px, ${y}px, calc(100vh - 492px))`,
      }}
      role="menu"
      aria-label="新增节点"
      onContextMenu={(event) => event.preventDefault()}
    >
      <header>
        <strong>{focused ? '新增 Agent / Tool' : '新增 Workflow'}</strong>
        <button type="button" onClick={onClose} aria-label="关闭新增菜单">
          ×
        </button>
      </header>
      {focused ? (
        <>
          {agentItems.map((callable) => (
            <button
              key={callable.id}
              type="button"
              role="menuitem"
              onClick={() =>
                onPick({ kind: 'agent', callableId: callable.id, label: callable.name || callable.id })
              }
            >
              <CircleDot size={14} aria-hidden="true" />
              <span>{callable.name || callable.id}</span>
              <small>{callable.id}</small>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => onPick({ kind: 'tool', callableId: 'fake-agent.generic', label: 'Generic Tool' })}
          >
            <TestTube size={14} aria-hidden="true" />
            <span>Generic Tool</span>
            <small>fake-agent.generic</small>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onPick({ kind: 'file_source', callableId: 'file-source.local', label: 'File Source' })}
          >
            <FileText size={14} aria-hidden="true" />
            <span>File Source</span>
            <small>file-source.local</small>
          </button>
        </>
      ) : (
        <>
          <button type="button" role="menuitem" onClick={() => onPick({ kind: 'workflow', label: 'New Workflow' })}>
            <GitBranch size={14} aria-hidden="true" />
            <span>New Workflow</span>
            <small>workflow template</small>
          </button>
          {workflowItems.map((workflow) => (
            <button
              key={workflow.workflow_id}
              type="button"
              role="menuitem"
              onClick={() =>
                onPick({
                  kind: 'workflow',
                  workflowRef: workflow.path,
                  label: workflow.name || workflow.workflow_id,
                })
              }
            >
              <GitBranch size={14} aria-hidden="true" />
              <span>{workflow.name || workflow.workflow_id}</span>
              <small>{workflow.path}</small>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

export function WorkflowContainer({
  id,
  data,
}: NodeProps<WorkflowFlowNode>) {
  const workflow = data.workflow;
  const showPortLabels = data.showDataPorts && (data.showDataPortLabels || data.selected);
  return (
    <article
      className={[
        'workflow-container',
        workflow.boundaryKind ? 'workflow-boundary-container' : '',
        `status-${workflow.status}`,
        data.selected ? 'selected' : '',
        data.dataDropHint ? 'data-drop-target' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={`workflow-container-${id}`}
      data-workflow-id={workflow.id}
      style={{ width: workflow.size.width, height: workflow.size.height }}
      onPointerDownCapture={(event) => {
        queueControlHandleConnectionStart(event.target, data.onControlHandleMouseDown);
      }}
      onMouseDownCapture={(event) => {
        queueControlHandleConnectionStart(event.target, data.onControlHandleMouseDown);
      }}
    >
      <NodeResizer
        color="#1d78d6"
        isVisible={data.selected}
        minWidth={260}
        minHeight={190}
        onResize={(_, params) =>
          data.onResize(workflow.id, {
            width: Math.round(params.width),
            height: Math.round(params.height),
          })
        }
      />
      <Handle
        type="target"
        position={Position.Left}
        id={workflowInputOuterTargetTokenId(workflow.id)}
        className="workflow-control-handle input workflow-shell-outer-input"
        data-nodeid={workflow.id}
        data-handleid={workflowInputOuterTargetTokenId(workflow.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="target"
        onPointerDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowInputOuterTargetTokenId(workflow.id), 'target', 'control')
        }
        onMouseDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowInputOuterTargetTokenId(workflow.id), 'target', 'control')
        }
      />
      <ControlConnectHitbox
        nodeId={workflow.id}
        handleId={workflowInputOuterTargetTokenId(workflow.id)}
        side="target"
        className="input workflow-shell-outer-input"
        onStart={data.onControlHandleMouseDown}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={workflowInputInnerSourceTokenId(workflow.id)}
        className="workflow-control-handle input workflow-shell-inner-input workflow-boundary-source"
        data-nodeid={workflow.id}
        data-handleid={workflowInputInnerSourceTokenId(workflow.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="source"
        onPointerDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowInputInnerSourceTokenId(workflow.id), 'source', 'control')
        }
        onMouseDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowInputInnerSourceTokenId(workflow.id), 'source', 'control')
        }
      />
      <ControlConnectHitbox
        nodeId={workflow.id}
        handleId={workflowInputInnerSourceTokenId(workflow.id)}
        side="source"
        className="input workflow-shell-inner-input workflow-boundary-source"
        onStart={data.onControlHandleMouseDown}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={workflowOutputOuterSourceTokenId(workflow.id)}
        className="workflow-control-handle output workflow-shell-outer-output"
        data-nodeid={workflow.id}
        data-handleid={workflowOutputOuterSourceTokenId(workflow.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="source"
        onPointerDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowOutputOuterSourceTokenId(workflow.id), 'source', 'control')
        }
        onMouseDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowOutputOuterSourceTokenId(workflow.id), 'source', 'control')
        }
      />
      <ControlConnectHitbox
        nodeId={workflow.id}
        handleId={workflowOutputOuterSourceTokenId(workflow.id)}
        side="source"
        className="output workflow-shell-outer-output"
        onStart={data.onControlHandleMouseDown}
      />
      <Handle
        type="target"
        position={Position.Left}
        id={workflowOutputInnerTargetTokenId(workflow.id)}
        className="workflow-control-handle output workflow-shell-inner-output workflow-boundary-target"
        data-nodeid={workflow.id}
        data-handleid={workflowOutputInnerTargetTokenId(workflow.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="target"
        onPointerDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowOutputInnerTargetTokenId(workflow.id), 'target', 'control')
        }
        onMouseDown={() =>
          data.onControlHandleMouseDown(workflow.id, workflowOutputInnerTargetTokenId(workflow.id), 'target', 'control')
        }
      />
      <ControlConnectHitbox
        nodeId={workflow.id}
        handleId={workflowOutputInnerTargetTokenId(workflow.id)}
        side="target"
        className="output workflow-shell-inner-output workflow-boundary-target"
        onStart={data.onControlHandleMouseDown}
      />
      <WorkflowHeader
        workflow={workflow}
        directory={bindingDirectory(workflow, data.binding)}
        status={data.binding?.status || 'unbound'}
        onOpenFocus={() => data.onOpenFocus(workflow.id)}
        onConfigure={() => data.onConfigureWorkflow(workflow.id)}
      />
      {data.dataDropHint ? <div className="data-drop-hint">{data.dataDropHint}</div> : null}
      <WorkflowBoundaryPortHandles
        workflow={workflow}
        showDataPorts={data.showDataPorts}
        showDataPortLabels={showPortLabels}
        onSelectPort={data.onSelectPort}
      />
      <div
        className="workflow-nested-canvas"
        data-drop-scope="workflow-internal"
        data-workflow-id={workflow.id}
      >
        <div className="internal-node-grid" aria-label={`${workflow.title} internal nodes`} />
      </div>
    </article>
  );
}

function WorkflowBoundaryPortHandles({
  workflow,
  showDataPorts,
  showDataPortLabels,
  onSelectPort,
}: {
  workflow: WorkflowContainerModel;
  showDataPorts: boolean;
  showDataPortLabels: boolean;
  onSelectPort: (workflowId: string, port: WorkflowPortView) => void;
}) {
  const visibleInputPorts = visibleAgentDataPorts(workflow.inputPorts);
  const visibleOutputPorts = visibleAgentDataPorts(workflow.outputPorts);
  return (
    <div
      className="workflow-hidden-port-handles"
      data-drop-scope="workflow-internal"
      data-workflow-id={workflow.id}
    >
      {visibleInputPorts.map((port, index) => {
        const top = agentDataPortTop(index, visibleInputPorts.length, workflow.size.height);
        const handleId = portTokenId(workflow.id, 'input', port.id);
        return (
          <Fragment key={`input-${port.id}`}>
            <Handle
              type="target"
              position={Position.Left}
              id={handleId}
              className={['workflow-port-handle', showDataPorts ? '' : 'hidden', 'input'].filter(Boolean).join(' ')}
              data-nodeid={workflow.id}
              data-handleid={handleId}
              data-acc-connection-mode="data"
              data-acc-connection-side="target"
              style={{ top }}
              title={`数据输入端口: ${port.id}`}
            />
            {showDataPorts ? (
              <button
                type="button"
                className="workflow-port-click-target input nodrag nopan"
                style={{ top }}
                title={`数据输入端口: ${port.id}`}
                aria-label={`选择数据输入端口 ${port.id}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelectPort(workflow.id, port);
                }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  onSelectPort(workflow.id, port);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectPort(workflow.id, port);
                }}
              />
            ) : null}
            {showDataPortLabels ? (
              <span
                className="workflow-port-label input workflow-boundary-port-label"
                style={{ top }}
                title={`数据输入端口: ${port.id}`}
              >
                {port.id}
              </span>
            ) : null}
          </Fragment>
        );
      })}
      {visibleOutputPorts.map((port, index) => {
        const top = agentDataPortTop(index, visibleOutputPorts.length, workflow.size.height);
        const handleId = portTokenId(workflow.id, 'output', port.id);
        const tooltip = outputPortTooltip(port);
        return (
          <Fragment key={`output-${port.id}`}>
            <Handle
              type="source"
              position={Position.Right}
              id={handleId}
              className={['workflow-port-handle', showDataPorts ? '' : 'hidden', 'output'].filter(Boolean).join(' ')}
              data-nodeid={workflow.id}
              data-handleid={handleId}
              data-acc-connection-mode="data"
              data-acc-connection-side="source"
              style={{ top }}
              title={tooltip || `数据输出端口: ${port.id}`}
            />
            {showDataPorts ? (
              <button
                type="button"
                className="workflow-port-click-target output nodrag nopan"
                style={{ top }}
                title={tooltip || `数据输出端口: ${port.id}`}
                aria-label={`选择数据输出端口 ${port.id}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelectPort(workflow.id, port);
                }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  onSelectPort(workflow.id, port);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectPort(workflow.id, port);
                }}
              />
            ) : null}
            {showDataPortLabels ? (
              <span
                className="workflow-port-label output workflow-boundary-port-label"
                style={{ top }}
                title={tooltip || `数据输出端口: ${port.id}`}
              >
                {port.id}
              </span>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

function ControlConnectHitbox({
  nodeId,
  handleId,
  side,
  className,
  style,
  onStart,
}: {
  nodeId: string;
  handleId: string;
  side: EndpointSide;
  className?: string;
  style?: CSSProperties;
  onStart: (nodeId: string, handleId: string, side: EndpointSide, mode?: ConnectionMode) => void;
}) {
  const startConnection = useCallback(
    (event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement> | ReactTouchEvent<HTMLDivElement>) => {
      if ('button' in event && typeof event.button === 'number' && event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onStart(nodeId, handleId, side, 'control');
    },
    [handleId, nodeId, onStart, side],
  );

  return (
    <div
      aria-hidden="true"
      className={['acc-connect-hitbox', side, className].filter(Boolean).join(' ')}
      data-nodeid={nodeId}
      data-handleid={handleId}
      data-acc-connection-mode="control"
      data-acc-connection-side={side}
      style={style}
      onPointerDown={startConnection}
      onMouseDown={startConnection}
      onTouchStart={startConnection}
    />
  );
}

function ConnectPreviewLine({ preview }: { preview: ConnectPreviewState }) {
  const controlOffset = Math.max(48, Math.abs(preview.end.x - preview.start.x) * 0.45);
  const path = [
    `M ${preview.start.x} ${preview.start.y}`,
    `C ${preview.start.x + controlOffset} ${preview.start.y}`,
    `${preview.end.x - controlOffset} ${preview.end.y}`,
    `${preview.end.x} ${preview.end.y}`,
  ].join(' ');
  return (
    <svg
      className={preview.snapped ? 'acc-connect-preview snapped' : 'acc-connect-preview'}
      aria-hidden="true"
      viewBox={viewportViewBox()}
    >
      <path d={path} />
    </svg>
  );
}

function elementByDataHandleId(handleId: string, nodeId?: string): HTMLElement | null {
  const allHandles = Array.from(document.querySelectorAll<HTMLElement>('[data-handleid]'))
    .filter((handle) => handle.getAttribute('data-handleid') === handleId);
  const handles = nodeId
    ? allHandles.filter((handle) => handle.getAttribute('data-nodeid') === nodeId)
    : allHandles;
  const candidatesForNode = handles.length ? handles : allHandles;
  if (!candidatesForNode.length) {
    return null;
  }
  const visibleHandles = candidatesForNode.filter((handle) => {
    const rect = handle.getBoundingClientRect();
    const style = window.getComputedStyle(handle);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  });
  const candidates = visibleHandles.length ? visibleHandles : candidatesForNode;
  return (
    candidates.find((handle) => handle.classList.contains('workflow-control-handle') || handle.classList.contains('agent-control-handle')) ||
    candidates.find((handle) => handle.classList.contains('workflow-port-handle')) ||
    candidates.find((handle) => handle.classList.contains('acc-connect-hitbox')) ||
    candidates[0] ||
    null
  );
}

function rectCenter(rect: DOMRect): { x: number; y: number } {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function HiddenAgentPortHandles({
  nodeId,
  inputPorts,
  outputPorts,
  nodeHeight,
}: {
  nodeId: string;
  inputPorts: WorkflowPortView[];
  outputPorts: WorkflowPortView[];
  nodeHeight: number;
}) {
  const visibleInputPorts = visibleAgentDataPorts(inputPorts);
  const visibleOutputPorts = visibleAgentDataPorts(outputPorts);
  return (
    <div className="workflow-hidden-port-handles" aria-hidden="true">
      {visibleInputPorts.map((portValue, index) => (
        <Handle
          key={`input-${portValue.id}`}
          id={portTokenId(nodeId, 'input', portValue.id)}
          type="target"
          position={Position.Left}
          className="workflow-port-handle hidden input"
          data-nodeid={nodeId}
          data-handleid={portTokenId(nodeId, 'input', portValue.id)}
          data-acc-connection-mode="data"
          data-acc-connection-side="target"
          style={{ top: agentDataPortTop(index, visibleInputPorts.length, nodeHeight) }}
        />
      ))}
      {visibleOutputPorts.map((portValue, index) => (
        <Handle
          key={`output-${portValue.id}`}
          id={portTokenId(nodeId, 'output', portValue.id)}
          type="source"
          position={Position.Right}
          className="workflow-port-handle hidden output"
          data-nodeid={nodeId}
          data-handleid={portTokenId(nodeId, 'output', portValue.id)}
          data-acc-connection-mode="data"
          data-acc-connection-side="source"
          style={{ top: agentDataPortTop(index, visibleOutputPorts.length, nodeHeight) }}
        />
      ))}
    </div>
  );
}

function AgentToolNode({
  data,
}: NodeProps<AgentToolFlowNode>) {
  const nodeSize = data.size || AGENT_TOOL_NODE_SIZE;
  const visibleInputPorts = visibleAgentDataPorts(data.inputPorts);
  const visibleOutputPorts = visibleAgentDataPorts(data.outputPorts);
  const showPortLabels = data.showDataPorts && (data.showDataPortLabels || data.selected);

  function queuePortSelection(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
      return false;
    }
    const portHandle = target.closest('.workflow-port-handle');
    const parsed = parsePortToken(portHandle?.getAttribute('data-handleid'));
    if (!data.showDataPorts || !parsed || parsed.workflowId !== data.id) {
      return false;
    }
    const ports = parsed.direction === 'input' ? data.inputPorts : data.outputPorts;
    const portValue = ports.find((port) => port.id === parsed.portId);
    if (!portValue) {
      return false;
    }
    window.setTimeout(() => data.onSelectPort(data.id, portValue), 0);
    return true;
  }

  return (
    <div
      role="group"
      tabIndex={0}
      className={[
        'agent-tool-node',
        'nopan',
        data.showDataPorts ? 'data-ports-visible' : '',
        data.kind === 'Tool' ? 'tool' : 'agent',
        `status-${data.status}`,
        data.selected ? 'selected' : '',
        data.dataDropHint ? 'data-drop-target' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={`agent-tool-node-${data.id}`}
      style={{ width: nodeSize.width, minHeight: nodeSize.height }}
      onPointerDownCapture={(event) => {
        if (queuePortSelection(event.target)) {
          return;
        }
        if (!(event.target instanceof Element)) {
          data.onSelect();
          return;
        }
        if (closestConnectionHandle(event.target)) {
          queueControlHandleConnectionStart(event.target, data.onControlHandleMouseDown);
          return;
        }
        data.onSelect();
      }}
      onMouseDownCapture={(event) => {
        if (queueControlHandleConnectionStart(event.target, data.onControlHandleMouseDown)) {
          return;
        }
        queuePortSelection(event.target);
      }}
      onPointerUpCapture={(event) => {
        if (!(event.target instanceof Element) || !data.showDataPorts) {
          return;
        }
        const handle = event.target.closest('.workflow-port-handle');
        const parsed = parsePortToken(handle?.getAttribute('data-handleid'));
        if (!parsed || parsed.workflowId !== data.id) {
          return;
        }
        const ports = parsed.direction === 'input' ? data.inputPorts : data.outputPorts;
        const portValue = ports.find((port) => port.id === parsed.portId);
        if (portValue) {
          data.onSelectPort(data.id, portValue);
        }
      }}
      onFocus={data.onSelect}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        data.onSelect();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (queuePortSelection(event.target)) {
          return;
        }
        data.onSelect();
      }}
    >
      <Handle
        id={controlTargetTokenId(data.id)}
        type="target"
        position={Position.Left}
        className="workflow-control-handle input agent-control-handle"
        data-nodeid={data.id}
        data-handleid={controlTargetTokenId(data.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="target"
        style={{ top: AGENT_CONTROL_HANDLE_TOP }}
        onPointerDown={() => data.onControlHandleMouseDown(data.id, controlTargetTokenId(data.id), 'target', 'control')}
        onMouseDown={() => data.onControlHandleMouseDown(data.id, controlTargetTokenId(data.id), 'target', 'control')}
        title="控制输入：接收运行顺序；是否收到完整输出取决于上游节点的“控制线传递完整输出”开关"
        aria-label="控制输入端口，接收运行顺序和可能的完整输出"
      />
      <ControlConnectHitbox
        nodeId={data.id}
        handleId={controlTargetTokenId(data.id)}
        side="target"
        className="input agent-control-hitbox"
        style={{ top: AGENT_CONTROL_HANDLE_TOP }}
        onStart={data.onControlHandleMouseDown}
      />
      <Handle
        id={controlSourceTokenId(data.id)}
        type="source"
        position={Position.Right}
        className="workflow-control-handle output agent-control-handle"
        data-nodeid={data.id}
        data-handleid={controlSourceTokenId(data.id)}
        data-acc-connection-mode="control"
        data-acc-connection-side="source"
        style={{ top: AGENT_CONTROL_HANDLE_TOP }}
        onPointerDown={() => data.onControlHandleMouseDown(data.id, controlSourceTokenId(data.id), 'source', 'control')}
        onMouseDown={() => data.onControlHandleMouseDown(data.id, controlSourceTokenId(data.id), 'source', 'control')}
        title="控制输出：开启“控制线传递完整输出”时，下游 main input 会收到该节点完整输出"
        aria-label="控制输出端口，连接运行顺序和可能的完整输出"
      />
      <ControlConnectHitbox
        nodeId={data.id}
        handleId={controlSourceTokenId(data.id)}
        side="source"
        className="output agent-control-hitbox"
        style={{ top: AGENT_CONTROL_HANDLE_TOP }}
        onStart={data.onControlHandleMouseDown}
      />
      {!data.showDataPorts ? (
        <HiddenAgentPortHandles
          nodeId={data.id}
          inputPorts={visibleInputPorts}
          outputPorts={visibleOutputPorts}
          nodeHeight={nodeSize.height}
        />
      ) : null}
      {data.showDataPorts
        ? visibleInputPorts.map((portValue, index) => {
            const portTop = agentDataPortTop(index, visibleInputPorts.length, nodeSize.height);
            return (
              <Fragment key={portValue.id}>
                <Handle
                  id={portTokenId(data.id, 'input', portValue.id)}
                  type="target"
                  position={Position.Left}
                  className="workflow-port-handle input"
                  data-nodeid={data.id}
                  data-handleid={portTokenId(data.id, 'input', portValue.id)}
                  data-acc-connection-mode="data"
                  data-acc-connection-side="target"
                  style={{ top: portTop }}
                  title={`数据输入端口: ${portValue.id}`}
                  aria-label={`数据输入端口 ${portValue.id}`}
                />
                <button
                  type="button"
                  className="workflow-port-click-target input nodrag nopan"
                  style={{ top: portTop }}
                  title={`数据输入端口: ${portValue.id}`}
                  aria-label={`选择数据输入端口 ${portValue.id}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    data.onSelectPort(data.id, portValue);
                  }}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    data.onSelectPort(data.id, portValue);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onSelectPort(data.id, portValue);
                  }}
                />
                {showPortLabels ? (
                  <span
                    className="workflow-port-label input"
                    style={{ top: portTop }}
                    title={`数据输入端口: ${portValue.id}`}
                  >
                    {portValue.id}
                  </span>
                ) : null}
              </Fragment>
            );
          })
        : null}
      {data.showDataPorts
        ? visibleOutputPorts.map((portValue, index) => {
            const portTop = agentDataPortTop(index, visibleOutputPorts.length, nodeSize.height);
            const tooltip = outputPortTooltip(portValue);
            return (
              <Fragment key={portValue.id}>
                <Handle
                  id={portTokenId(data.id, 'output', portValue.id)}
                  type="source"
                  position={Position.Right}
                  className="workflow-port-handle output"
                  data-nodeid={data.id}
                  data-handleid={portTokenId(data.id, 'output', portValue.id)}
                  data-acc-connection-mode="data"
                  data-acc-connection-side="source"
                  style={{ top: portTop }}
                  title={tooltip || `数据输出端口: ${portValue.id}`}
                  aria-label={`数据输出端口 ${portValue.id}`}
                />
                <button
                  type="button"
                  className="workflow-port-click-target output nodrag nopan"
                  style={{ top: portTop }}
                  title={tooltip || `数据输出端口: ${portValue.id}`}
                  aria-label={`选择数据输出端口 ${portValue.id}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    data.onSelectPort(data.id, portValue);
                  }}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    data.onSelectPort(data.id, portValue);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onSelectPort(data.id, portValue);
                  }}
                />
                {showPortLabels ? (
                  <span
                    className="workflow-port-label output"
                    style={{ top: portTop }}
                    title={tooltip || `数据输出端口: ${portValue.id}`}
                  >
                    {portValue.id}
                  </span>
                ) : null}
              </Fragment>
            );
          })
        : null}
      <div className="agent-node-topline">
        <span className={`agent-node-icon ${data.kind === 'Tool' ? 'tool' : 'agent'}`}>
          {data.kind === 'Tool' ? <TestTube aria-hidden="true" size={14} /> : <Bot aria-hidden="true" size={14} />}
        </span>
        {data.temporaryResourceId ? <span className="node-badge temporary">临时</span> : null}
        <span className={`node-status-chip ${data.status}`}>{statusLabel(data.status)}</span>
      </div>
      <div className="agent-node-main">
        <strong title={data.title}>{data.title}</strong>
        {data.subtitle || !data.callableId ? (
          <p title={data.subtitle || ''}>{data.subtitle || '未绑定模板'}</p>
        ) : null}
        {data.scopeLabel ? <span className="node-scope-badge">{data.scopeLabel}</span> : null}
      </div>
      {data.dataDropHint ? <div className="data-drop-hint">{data.dataDropHint}</div> : null}
        <div className="agent-node-footer">
          <span className={data.kind === 'Tool' ? 'node-badge tool' : 'node-badge agent'}>
            {data.kind === 'Tool' ? 'Tool' : 'Agent'}
          </span>
          {!data.callableId ? <small>模板缺失</small> : null}
        </div>
    </div>
  );
}

function WorkflowHeader({
  workflow,
  directory,
  status,
  onOpenFocus,
  onConfigure,
}: {
  workflow: WorkflowContainerModel;
  directory: string;
  status: string;
  onOpenFocus: () => void;
  onConfigure: () => void;
}) {
  const inputCount = visibleAgentDataPorts(workflow.inputPorts).length;
  const outputCount = visibleAgentDataPorts(workflow.outputPorts).length;
  const nodeCount = workflow.internalNodes.length;
  return (
    <header className="workflow-container-header">
      <span className={`workflow-status-marker ${workflow.status}`} aria-label={statusLabel(workflow.status)} />
      <h3>{workflowInvocationLabel(workflow)}</h3>
      <div
        className="workflow-stage-meta"
        title={`阶段包含 ${nodeCount} 个节点，${inputCount} 个输入端口，${outputCount} 个输出端口`}
      >
        <span>{nodeCount} 节点</span>
        <span>{inputCount} 输入</span>
        <span>{outputCount} 输出</span>
      </div>
      <div className={`workflow-directory-line ${status}`}>
        <span>{directory}</span>
        {!workflow.boundaryKind ? (
          <button
            type="button"
            aria-label="聚焦此 Workflow"
            title="聚焦此 Workflow"
            onClick={(event) => {
              event.stopPropagation();
              onOpenFocus();
            }}
          >
            <LayoutDashboard size={13} aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label="配置工作目录"
          onClick={(event) => {
            event.stopPropagation();
            onConfigure();
          }}
        >
          <FolderCog size={13} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function InternalNodeCard({
  workflowId,
  node,
  index,
  onClick,
  onMove,
}: {
  workflowId: string;
  node: InternalNodeView;
  index: number;
  onClick: () => void;
  onMove: (workflowId: string, nodeId: string, position: { x: number; y: number }) => void;
}) {
  function startDrag(event: ReactMouseEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const card = event.currentTarget;
    const container = card.closest('.internal-node-grid');
    if (!(container instanceof HTMLElement)) {
      return;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const startPosition = node.position || defaultInternalNodePosition(index);
    const maxX = Math.max(0, container.clientWidth - card.offsetWidth - 8);
    const maxY = Math.max(0, container.clientHeight - card.offsetHeight - 8);
    const move = (nextEvent: MouseEvent) => {
      const nextPosition = {
        x: clamp(startPosition.x + nextEvent.clientX - startX, 8, maxX),
        y: clamp(startPosition.y + nextEvent.clientY - startY, 8, maxY),
      };
      onMove(workflowId, node.id, nextPosition);
    };
    const stop = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop, { once: true });
  }
  return (
    <button
      type="button"
      className={`internal-node-card nodrag nopan status-${node.status}`}
      onClick={onClick}
      onMouseDown={startDrag}
      style={{
        left: finiteNumber(node.position?.x, defaultInternalNodePosition(index).x),
        top: finiteNumber(node.position?.y, defaultInternalNodePosition(index).y),
      }}
    >
      <span className={`status-dot ${node.status}`} />
      <div>
        <strong>{internalInvocationLabel(node)}</strong>
        <p>{node.task}</p>
      </div>
      <span className={node.kind === 'Agent' ? 'node-badge agent' : 'node-badge tool'}>
        {node.kind}
      </span>
    </button>
  );
}

function MiniMap() {
  return <ReactFlowMiniMap pannable zoomable nodeClassName="workflow-minimap-node" />;
}

function ResourceInspector({ resource }: { resource: ResourceTemplate }) {
  const title =
    resource.kind === 'workflow_class'
      ? resource.name
      : resource.kind === 'agent_class'
        ? resource.name
        : resource.name;
  return (
    <aside className="right-inspector" aria-label="资源详情面板">
      <header className="inspector-title-row">
        <h3>{title}</h3>
      </header>
      <dl className="definition-grid compact">
        <dt>绫诲瀷</dt>
        <dd>
          {resource.kind === 'workflow_class'
            ? 'Workflow Class'
            : resource.kind === 'agent_class'
              ? 'Agent Class'
              : 'Tool Class'}
        </dd>
        <dt>ID</dt>
        <dd>{resource.kind === 'workflow_class' ? resource.workflowId : resource.callableId}</dd>
        {resource.kind === 'workflow_class' ? (
          <>
            <dt>璺緞</dt>
            <dd>{resource.path}</dd>
          </>
        ) : null}
      </dl>
      <p className="muted">Resources are reusable classes; dragging one onto the task canvas creates an invocation instance.</p>
    </aside>
  );
}

type CallableDetailLoadState = {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  detail: CallableDetail | null;
  error: string;
};

type AgentNodeConnectionEditor = {
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

type SchemaFieldCard = {
  name: string;
  type: string;
  required: boolean;
  description: string;
  example?: string;
};

function useCallableDetail(callableId: string): CallableDetailLoadState {
  const cacheRef = useRef<Record<string, CallableDetail>>({});
  const [state, setState] = useState<CallableDetailLoadState>({
    status: callableId ? 'loading' : 'idle',
    detail: null,
    error: '',
  });

  useEffect(() => {
    let ignore = false;
    if (!callableId) {
      setState({ status: 'idle', detail: null, error: '' });
      return () => {
        ignore = true;
      };
    }
    const cached = cacheRef.current[callableId];
    if (cached) {
      setState({ status: 'loaded', detail: cached, error: '' });
      return () => {
        ignore = true;
      };
    }
    setState({ status: 'loading', detail: null, error: '' });
    api
      .callable(callableId)
      .then((payload) => {
        if (ignore) {
          return;
        }
        cacheRef.current[callableId] = payload.callable;
        setState({ status: 'loaded', detail: payload.callable, error: '' });
      })
      .catch((error) => {
        if (!ignore) {
          setState({
            status: 'error',
            detail: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      ignore = true;
    };
  }, [callableId]);

  return state;
}

function AgentNodeSettings({
  node,
  connectionEditor,
  runtimeConfig,
  callableState,
  onUpdateInput,
  onUpdateLabel,
  onUpdateForwardMainOutput,
  onUpdateEmptyInputPolicy,
  onUpdateCodexExecutionMode,
  onReadEvidence,
  onOpenCallableResource,
}: {
  node: AgentNodeSettingsModel;
  connectionEditor?: AgentNodeConnectionEditor;
  runtimeConfig: RuntimeConfig | null;
  callableState: CallableDetailLoadState;
  onUpdateInput: (input: Record<string, unknown>) => void;
  onUpdateLabel: (label: string) => void;
  onUpdateForwardMainOutput: (value: boolean) => void;
  onUpdateEmptyInputPolicy: (value: EmptyInputPolicy) => void;
  onUpdateCodexExecutionMode: (value: CodexExecutionMode) => void;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onOpenCallableResource: (callableId: string, name: string, kind: 'agent_class' | 'tool_class') => void;
}) {
  const detail = callableState.detail;
  const templateName = detail ? callableDisplayTitle(detail) : node.callableId || 'Unbound template';
  const templateDescription = detail ? callableDescription(detail) : '';
  const inputFields = schemaFieldsFromPorts(detail?.input_ports, node.inputPorts);
  const outputFields = hasProjectedOutputPorts(node.outputSchema)
    ? schemaDerivedOutputFields(node.outputSchema)
    : [
        ...schemaFieldsFromPorts(detail?.output_ports, node.outputPorts),
        ...schemaFieldsFromArtifactContract(detail?.artifact_contract),
      ];
  const provider = detail ? providerLabelFromCallable(detail) : node.kind === 'Tool' ? 'Tool' : 'Agent';
  const metadata = detail?.metadata || {};
  const skills = skillsFromMetadata(metadata);
  const templateKind = detail?.kind === 'tool_class' ? 'tool_class' : 'agent_class';
  const showCodexMode = isCodexAgentNode(node, detail);

  return (
    <div className="node-settings-content">
      <section className="node-settings-card current-node-card">
        <div className="node-settings-section-header">
          <div>
            <span className="panel-kicker">当前节点</span>
            <h4>{node.label}</h4>
          </div>
          <span className={`node-settings-status status-${node.status}`}>{statusLabel(node.status)}</span>
        </div>
        <label className="node-settings-field">
          <span>节点名称</span>
          <input
            value={node.label}
            onChange={(event) => onUpdateLabel(event.target.value)}
            aria-label="节点名称"
          />
        </label>
        <dl className="node-settings-facts">
          <dt>Node type</dt>
          <dd>{node.kind === 'Tool' ? 'Tool' : 'Agent'}</dd>
          <dt>Template</dt>
          <dd>{templateName}</dd>
        </dl>
        <label className="node-settings-checkbox">
          <input
            type="checkbox"
            checked={node.forwardMainOutputOnControl !== false}
            onChange={(event) => onUpdateForwardMainOutput(event.currentTarget.checked)}
          />
          <span title="开启时，只有 control-only 下游会默认收到该节点完整 main 输出；如果同一上下游已有 Data Edge，控制线只决定运行顺序。关闭后，所有控制线都只决定运行顺序。">
            控制线传递完整输出
          </span>
        </label>
        <label className="node-settings-checkbox">
          <input
            type="checkbox"
            checked={node.emptyInputPolicy === 'block'}
            onChange={(event) =>
              onUpdateEmptyInputPolicy(event.currentTarget.checked ? 'block' : 'allow')
            }
          />
          <span>空输入时阻止运行</span>
        </label>
        {showCodexMode ? (
          <CodexExecutionModeSelector
            value={normalizedCodexExecutionMode(node.codexExecutionMode)}
            onChange={onUpdateCodexExecutionMode}
          />
        ) : null}
      </section>

      <NodePromptEditor
        nodeKey={node.nodeId}
        input={node.input}
        systemPrompt={detail?.default_prompt || ''}
        onChange={onUpdateInput}
      />

      <section className="node-settings-card">
        <div className="node-settings-section-header">
          <div>
            <span className="panel-kicker">Agent template</span>
            <h4>{templateName}</h4>
          </div>
          {node.callableId ? (
            <button
              type="button"
              className="secondary-action compact-action"
              onClick={() => onOpenCallableResource(node.callableId, templateName, templateKind)}
            >
              编辑模板
            </button>
          ) : null}
        </div>
        {callableState.status === 'loading' ? <p className="muted">正在加载模板信息...</p> : null}
        {callableState.status === 'error' ? (
          <p className="notice compact-notice">模板信息暂时不可用: {callableState.error}</p>
        ) : null}
        <p className="template-governance-hint">
          模板是 class-level 资源；修改会影响所有引用，持久化发布需通过 GraphOps 或等效治理路径。
        </p>
        <div className="template-summary-grid">
          <div>
            <span>Agent</span>
            <strong>{provider}</strong>
          </div>
          <div>
            <span>Model</span>
            <strong>{String(metadata.model || 'Default model')}</strong>
          </div>
          <div>
            <span>Reasoning</span>
            <strong>{thinkingLabel(String(metadata.reasoning_effort || 'medium'))}</strong>
          </div>
        </div>
        {templateDescription ? <p className="template-description">{templateDescription}</p> : null}
        <section className="template-readonly-block">
          <h5>Skills</h5>
          {skills.length > 0 ? (
            <div className="skill-chip-row readonly">
              {skills.map((skill) => (
                <span key={skill}>{skill}</span>
              ))}
            </div>
          ) : (
            <p>No fixed skills configured</p>
          )}
        </section>
      </section>

      <section className="node-settings-card">
        <div className="node-settings-section-header">
          <div>
            <span className="panel-kicker">Input / Output</span>
            <h4>Node input and output contract</h4>
          </div>
        </div>
        <SchemaFieldCards title="Input" fields={inputFields} emptyText="No input schema fields declared." />
        <SchemaFieldCards title="Output" fields={dedupeSchemaFields(outputFields)} emptyText="No output schema fields declared." />
      </section>

      {connectionEditor ? (
        <section className="node-settings-card">
          <div className="node-settings-section-header">
            <div>
              <span className="panel-kicker">Data edges</span>
              <h4>连接设置</h4>
            </div>
          </div>
          <DataConnectionsPanel
            canvasNodeKind={connectionEditor.canvasNodeKind}
            canvas={connectionEditor.canvas}
            scopeWorkflowId={connectionEditor.scopeWorkflowId}
            nodeId={connectionEditor.nodeId}
            nodeLabel={connectionEditor.nodeLabel}
            callableId={connectionEditor.callableId}
            inputPorts={connectionEditor.inputPorts}
            outputPorts={connectionEditor.outputPorts}
            outputPortsReadonly={connectionEditor.outputPortsReadonly}
            dataConnectionDraft={connectionEditor.dataConnectionDraft}
            onBeginDataConnection={connectionEditor.onBeginDataConnection}
            onCancelDataConnection={connectionEditor.onCancelDataConnection}
            onUpdateDataConnectionMaterialization={connectionEditor.onUpdateDataConnectionMaterialization}
            onCompleteDataConnection={connectionEditor.onCompleteDataConnection}
            onCompleteDataConnectionWithNewInputPort={connectionEditor.onCompleteDataConnectionWithNewInputPort}
            onAddPort={connectionEditor.onAddPort}
            onRenamePort={connectionEditor.onRenamePort}
            onDeletePort={connectionEditor.onDeletePort}
          />
        </section>
      ) : null}

      <section className="node-settings-card">
        <div className="node-settings-section-header">
          <div>
            <span className="panel-kicker">本次运行</span>
            <h4>{node.run ? '运行证据' : '尚未运行'}</h4>
          </div>
        </div>
        <WorkflowMainInputBindingNotice binding={node.workflowMainInputBinding} nodeRun={node.run} />
        <RunEvidenceCard
          nodeRun={node.run}
          liveLogs={node.logs}
          runtimeConfig={runtimeConfig}
          onReadEvidence={onReadEvidence}
        />
      </section>

      <TechnicalDetailsDisclosure
        node={node}
        runtimeConfig={runtimeConfig}
        callableDetail={detail}
      />
    </div>
  );
}

function NodeDetailOverlay({
  model,
  callableState,
  runtimeConfig,
  agentSessionState,
  agentLiveState,
  artifactCacheByPath,
  onEnsureArtifactContent,
  onClose,
  onReadEvidence,
  onRefreshAgentSession,
  onPublishAgentOutput,
  onAnswerAgentInteraction,
  onUpdateInput,
  onUpdateLabel,
  onUpdateForwardMainOutput,
  onUpdateEmptyInputPolicy,
  onUpdateCodexExecutionMode,
  onOpenCallableResource,
}: {
  model: SelectedEntityDetailsModel;
  callableState: CallableDetailLoadState;
  runtimeConfig: RuntimeConfig | null;
  agentSessionState: AgentSessionUiState;
  agentLiveState: WorkbenchLiveStreamState;
  artifactCacheByPath: Record<string, ArtifactContent>;
  onEnsureArtifactContent: (path: string | null | undefined) => Promise<void>;
  onClose: () => void;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onRefreshAgentSession: () => Promise<void>;
  onPublishAgentOutput: (expectedTurnId: string) => Promise<void>;
  onAnswerAgentInteraction: (interactionId: string, answer: Record<string, unknown>) => Promise<void>;
  onUpdateInput: (input: Record<string, unknown>) => void;
  onUpdateLabel: (label: string) => void;
  onUpdateForwardMainOutput: (value: boolean) => void;
  onUpdateEmptyInputPolicy: (value: EmptyInputPolicy) => void;
  onUpdateCodexExecutionMode: (value: CodexExecutionMode) => void;
  onOpenCallableResource: (callableId: string, name: string, kind: 'agent_class' | 'tool_class') => void;
}) {
  return (
    <section className="node-detail-overlay" aria-label="节点详情浮层">
      <header className="node-detail-overlay-header">
        <div>
          <span className={`evidence-dock-status status-${model.status || 'not_run'}`}>
            {statusLabel(model.status || 'not_run')}
          </span>
          <div>
            <strong>{model.title}</strong>
            {model.subtitle ? <small>{model.subtitle}</small> : null}
          </div>
        </div>
        <button type="button" className="node-detail-close" aria-label="关闭节点详情" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="node-detail-overlay-body">
        <SelectionInputPane
          model={model}
          artifactCacheByPath={artifactCacheByPath}
          onEnsureArtifactContent={onEnsureArtifactContent}
        />
        <SelectionPropertiesPane
          model={model}
          callableState={callableState}
          runtimeConfig={runtimeConfig}
          agentSessionState={agentSessionState}
          agentLiveState={agentLiveState}
          onReadEvidence={onReadEvidence}
          onRefreshAgentSession={onRefreshAgentSession}
          onPublishAgentOutput={onPublishAgentOutput}
          onAnswerAgentInteraction={onAnswerAgentInteraction}
          onUpdateInput={onUpdateInput}
          onUpdateLabel={onUpdateLabel}
          onUpdateForwardMainOutput={onUpdateForwardMainOutput}
          onUpdateEmptyInputPolicy={onUpdateEmptyInputPolicy}
          onUpdateCodexExecutionMode={onUpdateCodexExecutionMode}
          onOpenCallableResource={onOpenCallableResource}
        />
        <SelectionOutputPane
          model={model}
          liveState={agentLiveState}
          artifactCacheByPath={artifactCacheByPath}
          onEnsureArtifactContent={onEnsureArtifactContent}
        />
      </div>
    </section>
  );
}

function SelectionInputPane({
  model,
  artifactCacheByPath,
  onEnsureArtifactContent,
}: {
  model: SelectedEntityDetailsModel;
  artifactCacheByPath: Record<string, ArtifactContent>;
  onEnsureArtifactContent: (path: string | null | undefined) => Promise<void>;
}) {
  const inputAction = evidenceActionByLabel(model.evidenceActions, 'input.json');
  const inputPath = inputAction?.path || '';
  const inputArtifact = inputPath ? artifactCacheByPath[inputPath] || null : null;

  useEffect(() => {
    void onEnsureArtifactContent(inputPath);
  }, [inputPath, onEnsureArtifactContent]);

  return (
    <section className="selection-input-pane" aria-label="输入">
      <header className="selection-pane-header">
        <div>
          <span>输入</span>
          <h3>{model.nodeRun ? shortPath(model.nodeRun.run_dir) : '尚未运行'}</h3>
        </div>
        <small title={inputPath || undefined}>{inputPath ? shortPath(inputPath) : '没有可用证据'}</small>
      </header>
      <section className="selection-open-artifact inline" aria-label="输入内容">
        {inputArtifact ? (
          <SelectionInputArtifact content={inputArtifact} />
        ) : (
          <div className="selection-log-output artifact-empty">
            <p className="empty-state">当前节点还没有真实 input.json。</p>
          </div>
        )}
      </section>
    </section>
  );
}

function SelectionOutputPane({
  model,
  liveState,
  artifactCacheByPath,
  onEnsureArtifactContent,
}: {
  model: SelectedEntityDetailsModel;
  liveState?: WorkbenchLiveStreamState;
  artifactCacheByPath: Record<string, ArtifactContent>;
  onEnsureArtifactContent: (path: string | null | undefined) => Promise<void>;
}) {
  const outputAction = evidenceActionByLabel(model.evidenceActions, 'output.json');
  const outputPath = outputAction?.path || '';
  const outputArtifact = outputPath ? artifactCacheByPath[outputPath] || null : null;
  const defaultOutputView: 'live' = 'live';
  const [outputView, setOutputView] = useState<'live' | 'final'>(defaultOutputView);
  const [logStream, setLogStream] = useState<'all' | 'stdout' | 'stderr'>('all');

  useEffect(() => {
    setOutputView(defaultOutputView);
    setLogStream('all');
  }, [defaultOutputView, model.key]);

  useEffect(() => {
    if (outputView === 'final') {
      void onEnsureArtifactContent(outputPath);
    }
  }, [model.status, onEnsureArtifactContent, outputPath, outputView]);

  const combinedLog = combinedLogText(model.log);
  const agentEventLog = agentEventsLiveText(model.events);
  const visibleLog =
    logStream === 'stdout'
      ? model.log.stdout
      : logStream === 'stderr'
        ? model.log.stderr
        : [combinedLog || model.log.excerpt, agentEventLog].filter(Boolean).join('\n\n');

  return (
    <section className="selection-output-pane" aria-label="输出">
      <header className="selection-pane-header">
        <div>
          <span>输出</span>
          <h3>{outputView === 'final' ? '最终结果' : '实时输出'}</h3>
        </div>
        <small title={outputPath || undefined}>{outputPath ? shortPath(outputPath) : '没有可用证据'}</small>
      </header>
      <div className="selection-output-view-tabs" role="tablist" aria-label="输出视图">
        <button
          type="button"
          className={outputView === 'live' ? 'active' : ''}
          onClick={() => setOutputView('live')}
        >
          实时输出
        </button>
        <button
          type="button"
          className={outputView === 'final' ? 'active' : ''}
          onClick={() => setOutputView('final')}
          disabled={!outputPath}
        >
          最终结果
        </button>
      </div>
      {outputView === 'live' ? (
        <section className="selection-output-content" aria-label="实时输出内容">
          {liveState?.events.length ? (
            <LiveOutputViewer events={liveState.events} status={liveState.status} emptyText="当前节点还没有实时输出。" />
          ) : (
            <>
              <div className="selection-log-stream-tabs" role="tablist" aria-label="Live output stream">
                {(['all', 'stdout', 'stderr'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={logStream === tab ? 'active' : ''}
                    onClick={() => setLogStream(tab)}
                  >
                    {tab === 'all' ? 'all' : tab}
                  </button>
                ))}
              </div>
              <div className="selection-log-output selection-live-output" role="log" aria-live="polite">
                {visibleLog.trim() ? (
                  <pre>{visibleLog}</pre>
                ) : (
                  <p className="empty-state">当前节点还没有实时输出。</p>
                )}
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="selection-open-artifact inline selection-output-final" aria-label="最终结果内容">
          {outputArtifact ? (
            <ReadableOutputResult content={outputArtifact} />
          ) : (
            <div className="selection-log-output artifact-empty">
              <p className="empty-state">当前节点还没有真实 output.json。</p>
            </div>
          )}
        </section>
      )}
    </section>
  );
}

function evidenceIdentityLabel(
  owner: EvidenceDockState['owner'],
  currentTaskId?: string,
  selectedRunId?: string | null,
): string {
  const parts: string[] = [];
  const taskId = owner?.taskId || currentTaskId;
  const runId = owner?.runId || selectedRunId || undefined;
  if (taskId) {
    parts.push(`task_id: ${taskId}`);
  }
  if (runId) {
    parts.push(`run_id: ${runId}`);
  }
  if (owner?.nodeId) {
    parts.push(`node_id: ${owner.nodeId}`);
  }
  return parts.join(' / ');
}

function SelectionDetailsDock({
  state,
  mode,
  message,
  model,
  currentTaskId,
  selectedRunId,
  onToggle,
  onReadEvidence,
  assistantContent,
}: {
  state: EvidenceDockState;
  mode: BottomDockMode;
  message: string;
  model: SelectedEntityDetailsModel;
  currentTaskId?: string;
  selectedRunId?: string | null;
  onToggle: () => void;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  assistantContent: ReactNode;
}) {
  const openedArtifact = evidenceContentForCurrentSelection(state, {
    currentTaskId,
    selectedRunId,
  });
  const evidenceActions = mode === 'assistant' ? [] : model.evidenceActions.filter((action) => action.path);
  const hasEvidenceActions = evidenceActions.length > 0;
  const evidenceIdentity = mode === 'assistant' ? '' : evidenceIdentityLabel(state.owner, currentTaskId, selectedRunId);
  const currentEvidenceTitle =
    mode === 'assistant'
      ? 'AI Console'
      : openedArtifact
        ? openedArtifact.name || state.title || 'Run evidence'
        : hasEvidenceActions
          ? '运行证据可用'
          : '没有 run evidence';
  const currentEvidenceLabel = evidenceIdentity
    ? `${currentEvidenceTitle} · ${evidenceIdentity}`
    : currentEvidenceTitle;
  const bodyClassName =
    mode === 'assistant' ? 'selection-details-body assistant-console-body' : 'selection-details-body';
  return (
    <footer className={state.open ? 'evidence-dock selection-details-dock open' : 'evidence-dock selection-details-dock'} aria-label="选中对象详情">
      <button type="button" className="evidence-dock-toggle selection-details-toggle" onClick={onToggle}>
        <span className={`evidence-dock-status status-${model.status || 'not_run'}`}>
          {statusLabel(model.status || 'not_run')}
        </span>
        <span className="selection-details-title">
          <strong>{mode === 'assistant' ? 'AI 助手' : model.title}</strong>
          <small>{mode === 'assistant' ? model.title : model.subtitle || model.scopeLabel}</small>
        </span>
        <span className="evidence-dock-message">{mode === 'assistant' ? 'AI Console' : message}</span>
        <span className="evidence-dock-current" title={evidenceIdentity || currentEvidenceTitle}>
          {currentEvidenceLabel}
        </span>
        {state.open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {state.open ? (
        <div className={bodyClassName}>
          {mode === 'assistant' ? (
            assistantContent
          ) : (
            <EvidenceDockArtifactContent
              artifact={openedArtifact}
              fallbackTitle={currentEvidenceTitle}
              identity={evidenceIdentity}
              evidenceActions={evidenceActions}
              onReadEvidence={onReadEvidence}
            />
          )}
        </div>
      ) : null}
    </footer>
  );
}

function EvidenceDockArtifactContent({
  artifact,
  fallbackTitle,
  identity,
  evidenceActions = [],
  onReadEvidence,
}: {
  artifact: ArtifactContent | null;
  fallbackTitle: string;
  identity?: string;
  evidenceActions?: SelectedDetailsEvidenceAction[];
  onReadEvidence?: (path: string | null | undefined, title?: string) => void;
}) {
  if (!artifact) {
    const hasEvidenceActions = evidenceActions.some((action) => action.path);
    return (
      <section className="selection-details-empty" aria-label="证据摘要">
        <span>Run evidence</span>
        <h3>{fallbackTitle || '没有 run evidence'}</h3>
        {identity ? <small className="evidence-identity-line">{identity}</small> : null}
        <p>
          {hasEvidenceActions
            ? '已找到当前选中对象的运行证据。打开下面的入口查看真实输入、输出、日志或 run summary。'
            : '没有 run evidence。Workbench 当前选择只是编辑投影，不代表已经产生运行事实。'}
        </p>
        <div className="evidence-entry-list" aria-label="运行证据入口">
          {hasEvidenceActions ? (
            evidenceActions.map((action) => (
              <button
                key={`${action.label}:${action.path || ''}`}
                type="button"
                className="evidence-path-button"
                disabled={!action.path}
                onClick={() => onReadEvidence?.(action.path, action.title)}
              >
                {action.label}
              </button>
            ))
          ) : (
            <>
              <span>Run summary</span>
              <span>Node input/output</span>
              <span>Logs</span>
              <span>Events</span>
              <span>Artifacts</span>
            </>
          )}
        </div>
      </section>
    );
  }
  return (
    <section className="evidence-artifact-pane" aria-label="证据内容">
      <header className="evidence-pane-header">
        <div>
          <span>证据</span>
          <h3>{artifact.name || fallbackTitle}</h3>
        </div>
        <small title={artifact.path}>{shortPath(artifact.path)}</small>
      </header>
      <CodeBlock title={artifact.path} content={artifact.content} variant={artifact.type} />
    </section>
  );
}

function SelectionInputArtifact({ content }: { content: ArtifactContent }) {
  const blocks = inputBlocksFromArtifact(content);
  if (blocks.length === 0) {
    return (
      <div className="selection-input-breakdown empty">
        <p className="empty-state">Current node has no displayable input content.</p>
      </div>
    );
  }
  return (
    <div className="selection-input-breakdown" aria-label="Input sources">
      {blocks.map((block) => (
        <article key={block.id} className="selection-input-source-card">
          <header>
            <span>{block.badge}</span>
            <strong>{block.title}</strong>
          </header>
          <StructuredValueView value={block.value} />
        </article>
      ))}
    </div>
  );
}

type InputSourceBlock = {
  id: string;
  badge: string;
  title: string;
  value: unknown;
};

function inputBlocksFromArtifact(content: ArtifactContent): InputSourceBlock[] {
  let payload: unknown;
  try {
    payload = JSON.parse(content.content) as unknown;
  } catch {
    return [
      {
        id: content.path,
        badge: 'text',
        title: content.name || 'input',
        value: content.content,
      },
    ];
  }
  if (!isPlainRecord(payload)) {
    return [{ id: 'input', badge: 'value', title: 'input', value: payload }];
  }
  const blocks: InputSourceBlock[] = [];
  for (const [portId, value] of Object.entries(payload)) {
    if (isEmptyInputValue(value)) {
      continue;
    }
    if (portId === 'main' && isControlMainAggregate(value)) {
      const order = Array.isArray(value.order) ? value.order.map(String) : Object.keys(value.sources);
      for (const sourceId of order) {
        if (!Object.prototype.hasOwnProperty.call(value.sources, sourceId)) {
          continue;
        }
        blocks.push({
          id: `main:${sourceId}`,
          badge: 'main',
          title: sourceId,
          value: value.sources[sourceId],
        });
      }
      continue;
    }
    blocks.push({
      id: portId,
      badge: portId,
      title: portId === 'main' ? 'main 输入' : `${portId} 输入`,
      value,
    });
  }
  return blocks;
}

function StructuredValueView({ value }: { value: unknown }) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <pre className="selection-readable-text">{String(value) || 'empty'}</pre>;
  }
  if (value === null || value === undefined) {
    return <p className="selection-readable-empty">empty</p>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <p className="selection-readable-empty">empty array</p>;
    }
    return (
      <ol className="selection-readable-list">
        {value.map((item, index) => (
          <li key={`item-${index}`}>
            <StructuredValueView value={item} />
          </li>
        ))}
      </ol>
    );
  }
  if (isPlainRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <p className="selection-readable-empty">empty object</p>;
    }
    return (
      <dl className="selection-readable-fields">
        {entries.map(([key, item]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              <StructuredValueView value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <pre className="selection-readable-text">{String(value)}</pre>;
}

function ReadableOutputResult({ content }: { content: ArtifactContent }) {
  const parsed = parseArtifactPayload(content.content);
  if (!parsed.ok) {
    return (
      <article className="readable-output-result">
        <section className="readable-output-section">
          <h4>文本结果</h4>
          <StructuredValueView value={content.content} />
        </section>
      </article>
    );
  }
  return (
    <article className="readable-output-result">
      <ReadableOutputPayload value={parsed.value} />
      <details className="readable-output-raw">
        <summary>查看原始 JSON</summary>
        <CodeBlock title={content.path} content={content.content} variant={content.type} />
      </details>
    </article>
  );
}

function ReadableOutputPayload({ value }: { value: unknown }) {
  if (!isPlainRecord(value)) {
    return (
      <section className="readable-output-section">
        <h4>结果</h4>
        <StructuredValueView value={value} />
      </section>
    );
  }

  const priorityKeys = [
    'summary',
    'report_markdown',
    'markdown',
    'analysis',
    'conclusion',
    'recommendation',
    'recommendations',
    'findings',
    'next_actions',
    'result',
    'output',
    'outputs',
  ];
  const status = scalarText(value.status);
  const renderedKeys = new Set<string>();
  const priorityEntries = priorityKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(value, key) && !isEmptyInputValue(value[key]))
    .map((key) => {
      renderedKeys.add(key);
      return [key, value[key]] as const;
    });
  const remainingEntries = Object.entries(value).filter(
    ([key, item]) => key !== 'status' && !renderedKeys.has(key) && !isEmptyInputValue(item),
  );

  if (status) {
    renderedKeys.add('status');
  }

  return (
    <>
      {status ? (
        <div className="summary-meta-row">
          <span>状态：{status}</span>
        </div>
      ) : null}
      {priorityEntries.length || remainingEntries.length ? (
        <>
          {priorityEntries.map(([key, item]) => (
            <section key={key} className="readable-output-section">
              <h4>{outputFieldLabel(key)}</h4>
              <StructuredValueView value={item} />
            </section>
          ))}
          {remainingEntries.map(([key, item]) => (
            <section key={key} className="readable-output-section secondary">
              <h4>{outputFieldLabel(key)}</h4>
              <StructuredValueView value={item} />
            </section>
          ))}
        </>
      ) : (
        <section className="readable-output-section">
          <h4>结果</h4>
          <StructuredValueView value={value} />
        </section>
      )}
    </>
  );
}

function parseArtifactPayload(content: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(content) as unknown };
  } catch {
    return { ok: false };
  }
}

function scalarText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}

function outputFieldLabel(key: string): string {
  const labels: Record<string, string> = {
    summary: '摘要',
    report_markdown: '报告',
    markdown: '正文',
    analysis: '分析',
    conclusion: '结论',
    recommendation: '建议',
    recommendations: '建议',
    findings: '发现',
    next_actions: '下一步',
    result: '结果',
    output: '输出',
    outputs: '命名输出',
  };
  return labels[key] || key.replace(/_/gu, ' ');
}

function isControlMainAggregate(
  value: unknown,
): value is { kind?: unknown; order?: unknown; sources: Record<string, unknown> } {
  return (
    isPlainRecord(value) &&
    value.kind === 'control_main_aggregate' &&
    isPlainRecord(value.sources)
  );
}

function isEmptyInputValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return isPlainRecord(value) && Object.keys(value).length === 0;
}

function compactValue(value: unknown): string {
  if (typeof value === 'string') {
    return compactText(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => compactValue(item)).join('; ') : 'empty';
  }
  if (isPlainRecord(value)) {
    const conclusion = value.summary || value.report_markdown;
    if (typeof conclusion === 'string' || typeof conclusion === 'number' || typeof conclusion === 'boolean') {
      return compactText(String(conclusion));
    }
    const status = value.status || value.kind;
    if (typeof status === 'string' || typeof status === 'number' || typeof status === 'boolean') {
      return compactText(String(status));
    }
    const entries = Object.entries(value).filter(([, item]) => !isEmptyInputValue(item));
    return compactText(entries.slice(0, 4).map(([key, item]) => `${key}: ${compactValue(item)}`).join('; '));
  }
  return compactText(String(value ?? ''));
}

function compactText(value: string): string {
  const text = value.replace(/\s+/gu, ' ').trim();
  return text.length > 420 ? `${text.slice(0, 420)}...` : text || 'empty';
}

function SelectionPropertiesPane({
  model,
  callableState,
  runtimeConfig,
  agentSessionState,
  agentLiveState,
  onReadEvidence,
  onRefreshAgentSession,
  onPublishAgentOutput,
  onAnswerAgentInteraction,
  onUpdateInput,
  onUpdateLabel,
  onUpdateForwardMainOutput,
  onUpdateEmptyInputPolicy,
  onUpdateCodexExecutionMode,
  onOpenCallableResource,
}: {
  model: SelectedEntityDetailsModel;
  callableState: CallableDetailLoadState;
  runtimeConfig: RuntimeConfig | null;
  agentSessionState: AgentSessionUiState;
  agentLiveState: WorkbenchLiveStreamState;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onRefreshAgentSession: () => Promise<void>;
  onPublishAgentOutput: (expectedTurnId: string) => Promise<void>;
  onAnswerAgentInteraction: (interactionId: string, answer: Record<string, unknown>) => Promise<void>;
  onUpdateInput: (input: Record<string, unknown>) => void;
  onUpdateLabel: (label: string) => void;
  onUpdateForwardMainOutput: (value: boolean) => void;
  onUpdateEmptyInputPolicy: (value: EmptyInputPolicy) => void;
  onUpdateCodexExecutionMode: (value: CodexExecutionMode) => void;
  onOpenCallableResource: (callableId: string, name: string, kind: 'agent_class' | 'tool_class') => void;
}) {
  return (
    <section className="selection-properties-pane" aria-label="节点属性">
      <header className="selection-pane-header">
        <div>
          <span>节点属性</span>
          <h3>{model.scopeLabel || model.kind}</h3>
        </div>
      </header>
      {model.nodeSettings ? (
        <SelectionNodeProperties
          node={model.nodeSettings}
          callableState={callableState}
          runtimeConfig={runtimeConfig}
          agentSessionState={agentSessionState}
          agentLiveState={agentLiveState}
          onReadEvidence={onReadEvidence}
          onRefreshAgentSession={onRefreshAgentSession}
          onPublishAgentOutput={onPublishAgentOutput}
          onAnswerAgentInteraction={onAnswerAgentInteraction}
          onUpdateInput={onUpdateInput}
          onUpdateLabel={onUpdateLabel}
          onUpdateForwardMainOutput={onUpdateForwardMainOutput}
          onUpdateEmptyInputPolicy={onUpdateEmptyInputPolicy}
          onUpdateCodexExecutionMode={onUpdateCodexExecutionMode}
          onOpenCallableResource={onOpenCallableResource}
        />
      ) : (
        <PropertyGroups groups={model.properties} />
      )}
    </section>
  );
}

function SelectionNodeProperties({
  node,
  callableState,
  runtimeConfig,
  agentSessionState,
  agentLiveState,
  onUpdateInput,
  onUpdateLabel,
  onUpdateForwardMainOutput,
  onUpdateEmptyInputPolicy,
  onUpdateCodexExecutionMode,
  onReadEvidence,
  onRefreshAgentSession,
  onPublishAgentOutput,
  onAnswerAgentInteraction,
  onOpenCallableResource,
}: {
  node: AgentNodeSettingsModel;
  callableState: CallableDetailLoadState;
  runtimeConfig: RuntimeConfig | null;
  agentSessionState: AgentSessionUiState;
  agentLiveState: WorkbenchLiveStreamState;
  onUpdateInput: (input: Record<string, unknown>) => void;
  onUpdateLabel: (label: string) => void;
  onUpdateForwardMainOutput: (value: boolean) => void;
  onUpdateEmptyInputPolicy: (value: EmptyInputPolicy) => void;
  onUpdateCodexExecutionMode: (value: CodexExecutionMode) => void;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onRefreshAgentSession: () => Promise<void>;
  onPublishAgentOutput: (expectedTurnId: string) => Promise<void>;
  onAnswerAgentInteraction: (interactionId: string, answer: Record<string, unknown>) => Promise<void>;
  onOpenCallableResource: (callableId: string, name: string, kind: 'agent_class' | 'tool_class') => void;
}) {
  const detail = callableState.detail;
  const templateName = detail ? callableDisplayTitle(detail) : node.callableId || '未绑定模板';
  const templateDescription = detail ? callableDescription(detail) : '';
  const provider = detail ? providerLabelFromCallable(detail) : node.kind === 'Tool' ? '工具' : '智能体';
  const metadata = detail?.metadata || {};
  const skills = skillsFromMetadata(metadata);
  const templateKind = detail?.kind === 'tool_class' ? 'tool_class' : 'agent_class';
  const showCodexMode = isCodexAgentNode(node, detail);
  return (
    <div className="selection-node-properties">
      <section className="node-settings-card current-node-card">
        <div className="node-settings-section-header">
          <div>
            <span className="panel-kicker">当前节点</span>
            <h4>{node.label}</h4>
          </div>
          <span className={`node-settings-status status-${node.status}`}>{statusLabel(node.status)}</span>
        </div>
        <label className="node-settings-field">
          <span>节点名称</span>
          <input value={node.label} onChange={(event) => onUpdateLabel(event.target.value)} aria-label="节点名称" />
        </label>
        <dl className="node-settings-facts">
          <dt>节点类型</dt>
          <dd>{node.kind === 'Tool' ? '工具' : '智能体'}</dd>
          <dt>使用模板</dt>
          <dd>{templateName}</dd>
        </dl>
        <label className="node-settings-checkbox">
          <input
            type="checkbox"
            checked={node.forwardMainOutputOnControl !== false}
            onChange={(event) => onUpdateForwardMainOutput(event.currentTarget.checked)}
          />
          <span title="开启时，只有 control-only 下游会默认收到该节点完整 main 输出；如果同一上下游已有 Data Edge，控制线只决定运行顺序。关闭后，所有控制线都只决定运行顺序。">
            控制线传递完整输出
          </span>
        </label>
        <label className="node-settings-checkbox">
          <input
            type="checkbox"
            checked={node.emptyInputPolicy === 'block'}
            onChange={(event) =>
              onUpdateEmptyInputPolicy(event.currentTarget.checked ? 'block' : 'allow')
            }
          />
          <span>空输入时阻止运行</span>
        </label>
        {showCodexMode ? (
          <CodexExecutionModeSelector
            value={normalizedCodexExecutionMode(node.codexExecutionMode)}
            onChange={onUpdateCodexExecutionMode}
          />
        ) : null}
      </section>

      <NodePromptEditor
        nodeKey={node.nodeId}
        input={node.input}
        systemPrompt={detail?.default_prompt || ''}
        onChange={onUpdateInput}
      />

      {node.workflowMainInputBinding ? (
        <section className="node-settings-card">
          <div className="node-settings-section-header">
            <div>
              <span className="panel-kicker">Workflow 输入</span>
              <h4>当前画布绑定</h4>
            </div>
          </div>
          <WorkflowMainInputBindingNotice binding={node.workflowMainInputBinding} nodeRun={node.run} />
        </section>
      ) : null}

      <AgentSessionPanel
        node={node}
        state={agentSessionState}
        events={agentSessionState.events}
        onReadEvidence={onReadEvidence}
        onRefresh={onRefreshAgentSession}
        onPublish={onPublishAgentOutput}
        onAnswerInteraction={onAnswerAgentInteraction}
      />

      <section className="node-settings-card">
        <div className="node-settings-section-header">
          <div>
            <span className="panel-kicker">模板摘要</span>
            <h4>{templateName}</h4>
          </div>
          {node.callableId && !node.temporaryResourceId ? (
            <button
              type="button"
              className="secondary-action compact-action"
              onClick={() => onOpenCallableResource(node.callableId, templateName, templateKind)}
            >
              编辑模板
            </button>
          ) : null}
        </div>
        {callableState.status === 'loading' ? <p className="muted">正在加载模板信息...</p> : null}
        {callableState.status === 'error' ? (
          <p className="notice compact-notice">模板信息暂时不可用：{callableState.error}</p>
        ) : null}
        <p className="template-governance-hint">
          模板是 class-level 资源；修改会影响所有引用，持久化发布需通过 GraphOps 或等效治理路径。
        </p>
        <div className="template-summary-grid">
          <div>
            <span>Agent</span>
            <strong>{provider}</strong>
          </div>
          <div>
            <span>模型</span>
            <strong>{String(metadata.model || '默认模型')}</strong>
          </div>
          <div>
            <span>思考程度</span>
            <strong>{thinkingLabel(String(metadata.reasoning_effort || 'medium'))}</strong>
          </div>
        </div>
        {templateDescription ? <p className="template-description">{templateDescription}</p> : null}
        <section className="template-readonly-block">
          <h5>Skills</h5>
          {skills.length > 0 ? (
            <div className="skill-chip-row readonly">
              {skills.map((skill) => (
                <span key={skill}>{skill}</span>
              ))}
            </div>
          ) : (
            <p>未配置固定 skills</p>
          )}
        </section>
      </section>

      <TechnicalDetailsDisclosure node={node} runtimeConfig={runtimeConfig} callableDetail={detail} />
    </div>
  );
}

function AgentSessionPanel({
  node,
  state,
  events,
  onReadEvidence,
  onRefresh,
  onPublish,
  onAnswerInteraction,
}: {
  node: AgentNodeSettingsModel;
  state: AgentSessionUiState;
  events: RunEvent[];
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onRefresh: () => Promise<void>;
  onPublish: (expectedTurnId: string) => Promise<void>;
  onAnswerInteraction: (interactionId: string, answer: Record<string, unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const session = state.session;
  const draftPath = agentSessionArtifactPath(session, session?.current_output_ref);
  const publishedSessionPath = agentSessionArtifactPath(session, session?.published_output_ref);
  const outputStateLabel = session
    ? canPublishAgentOutput(session)
      ? '有待发布草稿'
      : session.published_output_turn_id
        ? '已发布'
        : '等待输出'
    : '未绑定';
  const canPublish = Boolean(
    session?.bound_run_id &&
    session?.bound_node_id &&
    session.current_output_turn_id &&
    session.current_output_turn_id !== session.published_output_turn_id,
  );

  async function publishDraft() {
    if (!session?.current_output_turn_id) {
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      await onPublish(session.current_output_turn_id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function answerInteraction(interactionId: string, answer: Record<string, unknown>) {
    setBusy(true);
    setActionError('');
    try {
      await onAnswerInteraction(interactionId, answer);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (node.kind === 'Tool') {
    return null;
  }

  if (!node.run) {
    return null;
  }

  return (
    <section className="node-settings-card agent-session-card" aria-label="Agent 输出状态">
      <div className="node-settings-section-header">
        <div>
          <span className="panel-kicker">Agent 输出</span>
          <h4>{outputStateLabel}</h4>
        </div>
        <button
          type="button"
          className="secondary-action compact-action"
          disabled={busy || state.status === 'loading'}
          onClick={() => void onRefresh()}
        >
          <RefreshCw aria-hidden="true" size={14} />
          刷新
        </button>
      </div>

      {state.status === 'loading' ? <p className="empty-state">正在读取 Agent Session...</p> : null}
      {state.status === 'error' ? <p className="notice compact-notice">{state.error}</p> : null}
      {actionError ? <p className="notice compact-notice">{actionError}</p> : null}

      {session ? (
        <>
          <div className="agent-session-status-grid">
            <div>
              <span>会话</span>
              <strong>{session.status || 'ready'}</strong>
            </div>
            <div>
              <span>草稿</span>
              <strong>{session.current_output_turn_id ? '可用' : '无'}</strong>
            </div>
            <div>
              <span>正式输出</span>
              <strong>{session.published_output_turn_id ? '已发布' : '未发布'}</strong>
            </div>
          </div>

          {state.interactions.length > 0 ? (
            <section className="agent-session-subsection" aria-label="Agent approval requests">
              <h5>待审批</h5>
              {state.interactions.map((interaction) => (
                <article key={interaction.interaction_id} className="interaction-card compact">
                  <strong>{interaction.kind}</strong>
                  <p>{interaction.prompt}</p>
                  <div className="interaction-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void answerInteraction(interaction.interaction_id, { decision: 'approve' })}
                    >
                      通过
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void answerInteraction(interaction.interaction_id, { decision: 'reject' })}
                    >
                      拒绝
                    </button>
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          <div className="agent-output-primary-actions">
            <button
              type="button"
              className="secondary-action compact-action"
              disabled={!canPublish || busy}
              onClick={() => void publishDraft()}
            >
              <UploadCloud aria-hidden="true" size={14} />
              发布为本节点输出
            </button>
            {!canPublish ? <p className="muted">当前没有新的待发布草稿。</p> : null}
          </div>

          <AgentSessionDebugDetails
            session={session}
            node={node}
            messages={state.messages}
            events={events}
            draftPath={draftPath}
            publishedSessionPath={publishedSessionPath}
            onReadEvidence={onReadEvidence}
          />
        </>
      ) : state.status === 'loading' ? null : (
        <p className="empty-state">当前 run node 还没有绑定到可读取的 Agent Session。</p>
      )}
    </section>
  );
}

function canPublishAgentOutput(session: AgentSessionRecord): boolean {
  return Boolean(
    session.bound_run_id &&
      session.bound_node_id &&
      session.current_output_turn_id &&
      session.current_output_turn_id !== session.published_output_turn_id,
  );
}

function AgentSessionDebugDetails({
  session,
  node,
  messages,
  events,
  draftPath,
  publishedSessionPath,
  onReadEvidence,
}: {
  session: AgentSessionRecord;
  node: AgentNodeSettingsModel;
  messages: AgentMessage[];
  events: RunEvent[];
  draftPath: string | null;
  publishedSessionPath: string | null;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
}) {
  return (
    <details className="agent-session-debug-details">
      <summary>调试详情</summary>
      <div className="agent-session-debug-content">
        <dl className="node-settings-facts agent-session-facts">
          <dt>session_id</dt>
          <dd>{session.session_id}</dd>
          <dt>provider_session_id</dt>
          <dd>{session.provider_session_id || 'n/a'}</dd>
          <dt>bound node</dt>
          <dd>{[session.bound_run_id, session.bound_node_id].filter(Boolean).join(' / ') || 'unbound'}</dd>
          <dt>last turn</dt>
          <dd>{session.last_turn_id || 'n/a'} / {session.status || 'unknown'}</dd>
          <dt>draft turn</dt>
          <dd>{session.current_output_turn_id || 'n/a'}</dd>
          <dt>published turn</dt>
          <dd>{session.published_output_turn_id || 'n/a'}</dd>
        </dl>

        <div className="agent-output-actions">
          <button
            type="button"
            className="path-button"
            disabled={!draftPath}
            onClick={() => onReadEvidence(draftPath, '待发布草稿 current_output.json')}
          >
            <FileText aria-hidden="true" size={16} />
            <span>待发布草稿</span>
            <small>{shortPath(draftPath)}</small>
          </button>
          <button
            type="button"
            className="path-button"
            disabled={!node.run?.output_path}
            onClick={() => onReadEvidence(node.run?.output_path, '已发布输出 output.json')}
          >
            <FileText aria-hidden="true" size={16} />
            <span>已发布输出</span>
            <small>{shortPath(node.run?.output_path)}</small>
          </button>
          <button
            type="button"
            className="path-button"
            disabled={!publishedSessionPath}
            onClick={() => onReadEvidence(publishedSessionPath, 'session published_output.json')}
          >
            <FileText aria-hidden="true" size={16} />
            <span>Session 发布副本</span>
            <small>{shortPath(publishedSessionPath)}</small>
          </button>
        </div>

        <section className="agent-session-subsection" aria-label="Agent messages">
          <h5>会话消息</h5>
          <div className="agent-message-list">
            {messages.length === 0 ? <p className="empty-state">暂无会话消息。</p> : null}
            {messages.slice(-8).map((item, index) => (
              <article key={`${item.turn_id || 'msg'}-${index}`} className={`agent-message role-${item.role}`}>
                <strong>{item.role}</strong>
                <p>{assistantMessageDisplayContent(item.content)}</p>
                {item.turn_id ? <small>{item.turn_id}</small> : null}
              </article>
            ))}
          </div>
        </section>

        <AgentEventTimeline events={events} />
      </div>
    </details>
  );
}

function AgentEventTimeline({ events, maxEvents = 12 }: { events: RunEvent[]; maxEvents?: number }) {
  const agentEvents = events.filter((event) => String(event.type || event.event || '').startsWith('agent_'));
  const visibleEvents = agentEvents.slice(-maxEvents).reverse();
  return (
    <section className="agent-session-subsection" aria-label="Agent timeline">
      <h5>Agent timeline</h5>
      {visibleEvents.length === 0 ? <p className="empty-state">暂无 agent 事件。</p> : null}
      <div className="event-timeline compact">
        {visibleEvents.map((event, index) => (
          <article key={`${event.event_id || event.type || event.event || 'agent_event'}-${index}`}>
            <strong>{String(event.type || event.event || 'agent_event')}</strong>
            <span>{agentEventSummary(event)}</span>
            <small>{event.timestamp || ''}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function agentEventSummary(event: RunEvent): string {
  const payload = isPlainRecord(event.payload) ? event.payload : {};
  const content = stringValue(payload.content);
  if (content) {
    return compactText(assistantMessageDisplayContent(content));
  }
  const summary = stringValue(payload.summary) || stringValue(payload.message) || stringValue(payload.error);
  if (summary) {
    return compactText(summary);
  }
  const toolName = stringValue(payload.name) || stringValue(payload.tool) || stringValue(payload.command);
  if (toolName) {
    return compactText(toolName);
  }
  const outputPath = stringValue(payload.output_path);
  if (outputPath) {
    return shortPath(outputPath);
  }
  return event.status ? String(event.status) : 'canonical agent event';
}

function agentMessagesToAssistantMessages(messages: AgentMessage[]): AssistantChatMessage[] {
  return messages
    .filter((message) => typeof message.content === 'string' && message.content.trim())
    .map((message, index) => ({
      id: `${message.turn_id || 'assistant_msg'}_${index}`,
      role:
        message.role === 'user' || message.role === 'assistant' || message.role === 'system'
          ? message.role
          : 'system',
      content: assistantMessageDisplayContent(message.content),
      turnId: typeof message.turn_id === 'string' ? message.turn_id : undefined,
      createdAt: typeof message.created_at === 'string' ? message.created_at : undefined,
    }));
}

function assistantMessageDisplayContent(content: string): string {
  const payload = parseEmbeddedJsonObject(content);
  if (!payload) {
    return content;
  }
  const assistantMessage = typeof payload.assistant_message === 'string' ? payload.assistant_message : '';
  const proposal = isPlainRecord(payload.proposal) ? payload.proposal : null;
  const proposalId = proposal && typeof proposal.proposal_id === 'string' ? proposal.proposal_id : '';
  const rationale = proposal && typeof proposal.rationale === 'string' ? proposal.rationale : '';
  const lines = [
    assistantMessage || '已生成结构化草稿。',
    proposalId ? `Proposal: ${proposalId}` : '',
    rationale ? `Rationale: ${rationale}` : '',
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : '已生成结构化 JSON 草稿。';
}

function parseEmbeddedJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const candidates = [trimmed];
  if (trimmed.includes('```')) {
    const parts = trimmed.split('```');
    for (let index = 1; index < parts.length; index += 2) {
      const block = parts[index].trim().replace(/^json\s*/iu, '').trim();
      candidates.push(block);
    }
  }
  for (const candidate of candidates) {
    const parsed = parseJsonObject(candidate);
    if (parsed) {
      return parsed;
    }
    for (let offset = 0; offset < candidate.length; offset += 1) {
      if (candidate[offset] !== '{') {
        continue;
      }
      const scanned = scanJsonObject(candidate.slice(offset));
      if (scanned) {
        return scanned;
      }
    }
  }
  return null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function scanJsonObject(value: string): Record<string, unknown> | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return parseJsonObject(value.slice(0, index + 1));
      }
    }
  }
  return null;
}

function mergeAgentEvents(base: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const seen = new Set<string>();
  const merged: RunEvent[] = [];
  for (const event of [...base, ...incoming]) {
    const key = String(event.event_id || `${event.timestamp || ''}:${event.type || event.event || ''}:${event.turn_id || ''}`);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(event);
  }
  return merged.sort((left, right) =>
    String(left.timestamp || '').localeCompare(String(right.timestamp || '')),
  );
}







function nodeLogDeltaKeys(delta: NodeLogDelta): string[] {
  return uniqueStrings([
    delta.ui_node_id,
    normalizeRunDirKey(delta.node_run_dir),
    delta.node_run_dir,
    delta.node_id,
  ]);
}


function parentPath(path: string | null | undefined): string {
  if (!path) {
    return '';
  }
  const normalized = path.replaceAll('\\', '/');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '';
}

function LiveOutputViewer({
  events,
  status,
  emptyText,
}: {
  events: WorkbenchLiveEvent[];
  status: string;
  emptyText: string;
}) {
  const [filter, setFilter] = useState<LiveOutputFilter>('all');
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const visibleEntries = useMemo(() => {
    const entries = buildAccTranscript(events, filter);
    if (filter === 'all' && entries.length === 0) {
      return buildAccTranscript(events, 'logs').slice(-160);
    }
    return entries.slice(-160);
  }, [events, filter]);
  const hasEvents = visibleEntries.length > 0;
  const shouldShowJump = hasEvents && !isPinnedToBottom;

  const scrollToBottom = useCallback(() => {
    const element = outputRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, []);

  useEffect(() => {
    if (!isPinnedToBottom) {
      return;
    }
    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [filter, isPinnedToBottom, scrollToBottom, visibleEntries.length]);

  const onOutputScroll = useCallback(() => {
    const element = outputRef.current;
    if (!element) {
      return;
    }
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setIsPinnedToBottom(distanceFromBottom <= 40);
  }, []);

  const selectFilter = useCallback((nextFilter: LiveOutputFilter) => {
    const element = outputRef.current;
    if (element) {
      const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      setIsPinnedToBottom(distanceFromBottom <= 40);
    }
    setFilter(nextFilter);
  }, []);

  const jumpToLatest = useCallback(() => {
    setIsPinnedToBottom(true);
    window.requestAnimationFrame(scrollToBottom);
  }, [scrollToBottom]);

  return (
    <section className="live-output-viewer" aria-label="实时输出">
      <header className="live-output-header">
        <div>
          <span>实时输出</span>
          <strong>{statusLabel(status || 'not_run')}</strong>
        </div>
        <div className="selection-log-stream-tabs" role="tablist" aria-label="Live output filters">
          {(['all', 'logs', 'stdout', 'stderr', 'errors', 'raw'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={filter === item ? 'active' : ''}
              onClick={() => selectFilter(item)}
            >
              {liveOutputFilterLabel(item)}
            </button>
          ))}
        </div>
      </header>
      <div
        ref={outputRef}
        className="selection-log-output selection-live-output"
        role="log"
        aria-live="polite"
        onScroll={onOutputScroll}
      >
        {hasEvents ? (
          <div className="live-output-lines">
            {visibleEntries.map((entry) => (
              <article key={entry.id} className={`live-output-line stream-${entry.stream}`}>
                <span>{transcriptEntryLabel(entry)}</span>
                <pre>{entry.text}</pre>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">{emptyText}</p>
        )}
      </div>
      {shouldShowJump ? (
        <button type="button" className="live-output-jump" onClick={jumpToLatest}>
          跳到最新
        </button>
      ) : null}
    </section>
  );
}

function filterLiveEvents(
  events: WorkbenchLiveEvent[],
  filter: LiveOutputFilter,
): WorkbenchLiveEvent[] {
  if (filter === 'stdout' || filter === 'stderr') {
    return events.filter((event) => event.stream === filter);
  }
  if (filter === 'errors') {
    return events.filter((event) =>
      `${event.type} ${event.text || ''} ${stringValue(event.payload?.error)}`.toLowerCase().includes('error') ||
      String(event.type).includes('failed'),
    );
  }
  return buildAccTranscript(events, filter).map((entry) => entry.sourceEvent);
}

function liveOutputFilterLabel(filter: LiveOutputFilter): string {
  const labels: Record<LiveOutputFilter, string> = {
    all: '输出',
    logs: '日志',
    stdout: 'stdout',
    stderr: 'stderr',
    errors: '错误',
    raw: 'raw',
  };
  return labels[filter];
}

function transcriptEntryLabel(entry: AccTranscriptEntry): string {
  const time = entry.timestamp ? entry.timestamp.split('T').pop()?.replace('Z', '') || entry.timestamp : '';
  return [time, entry.stream, entry.label].filter(Boolean).join(' · ');
}

function limitText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function agentSessionArtifactPath(session: AgentSessionRecord | null | undefined, ref: unknown): string {
  if (!session || typeof ref !== 'string' || !ref) {
    return '';
  }
  if (/^[a-zA-Z]:[\\/]/u.test(ref) || ref.startsWith('/') || ref.startsWith('\\')) {
    return ref;
  }
  const sessionDir = typeof session.session_dir === 'string' ? session.session_dir : '';
  if (!sessionDir) {
    return ref;
  }
  return `${sessionDir.replace(/[\\/]+$/u, '')}/${ref}`;
}

function PropertyGroups({ groups }: { groups: SelectedDetailsPropertyGroup[] }) {
  return (
    <div className="selection-property-groups">
      {groups.map((group) => (
        <section key={group.title} className="node-settings-card">
          <div className="node-settings-section-header">
            <div>
              <span className="panel-kicker">属性</span>
              <h4>{group.title}</h4>
            </div>
          </div>
          <dl className="node-settings-facts">
            {group.rows.map((row) => (
              <Fragment key={`${group.title}-${row.label}`}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function NodePromptEditor({
  nodeKey,
  input,
  systemPrompt,
  onChange,
}: {
  nodeKey: string;
  input: Record<string, unknown>;
  systemPrompt: string;
  onChange: (input: Record<string, unknown>) => void;
}) {
  const initialInputRef = useRef(input);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(staticInputFromInvocationInput(input), null, 2));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    initialInputRef.current = input;
    setJsonText(JSON.stringify(staticInputFromInvocationInput(input), null, 2));
    setAdvancedOpen(false);
    setError('');
  }, [nodeKey]);

  function updatePrompt(value: string) {
    onChange(mergeInvocationInput(input, value, staticInputFromInvocationInput(input)));
  }

  function updateJson(value: string) {
    setJsonText(value);
    try {
      const parsed = JSON.parse(value);
      if (isPlainRecord(parsed)) {
        setError('');
        onChange(mergeInvocationInput(input, promptFromInvocationInput(input), parsed));
        return;
      }
      setError('高级输入参数必须是对象；当前修改不会提交。');
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
    }
  }

  function resetInput() {
    const initialInput = initialInputRef.current;
    setJsonText(JSON.stringify(staticInputFromInvocationInput(initialInput), null, 2));
    setError('');
    onChange(initialInput);
  }

  return (
    <section className="node-settings-card node-prompt-card">
      <section className="template-readonly-block prompt-system-block">
        <h5>系统提示词</h5>
        <p>{systemPrompt || '未填写系统提示词'}</p>
      </section>
      <label className="node-settings-field">
        <span>User Prompt</span>
        <textarea
          aria-label="用户提示词"
          rows={6}
          value={promptFromInvocationInput(input)}
          onChange={(event) => updatePrompt(event.target.value)}
          placeholder="告诉这个节点这次具体要做什么"
        />
      </label>
      <div className="inline-action-row">
        <button type="button" className="secondary-action compact-action" onClick={() => updatePrompt('')}>
          清空
        </button>
        <button type="button" className="secondary-action compact-action" onClick={resetInput}>
          恢复当前值
        </button>
        <button type="button" className="secondary-action compact-action" onClick={() => setAdvancedOpen((value) => !value)}>
          {advancedOpen ? '收起高级输入' : '高级输入参数'}
        </button>
      </div>
      {advancedOpen ? (
        <div className="advanced-input-editor">
          <label className="node-settings-field">
            <span>高级输入参数</span>
            <textarea
              aria-label="高级输入参数"
              rows={7}
              value={jsonText}
              onChange={(event) => updateJson(event.target.value)}
            />
          </label>
          {error ? <p className="notice compact-notice">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function SchemaFieldCards({ title, fields, emptyText }: { title: string; fields: SchemaFieldCard[]; emptyText: string }) {
  return (
    <section className="schema-card-section">
      <h5>{title}</h5>
      {fields.length > 0 ? (
        <div className="schema-field-list">
          {fields.map((field) => (
            <article key={`${title}-${field.name}`} className="schema-field-card">
              <div>
                <strong>{field.name}</strong>
                <span>{field.type}</span>
              </div>
              <p>{field.description || '未填写说明'}</p>
              <small>
                {field.required ? '必填' : '可选'}
                {field.example ? ` · 示例：${field.example}` : ''}
              </small>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-state">{emptyText}</p>
      )}
    </section>
  );
}

function isCodexAgentNode(node: AgentNodeSettingsModel, detail: CallableDetail | null): boolean {
  if (node.kind !== 'Agent') {
    return false;
  }
  if (detail?.runtime === 'codex_cli') {
    return true;
  }
  const callableId = node.callableId.toLowerCase();
  return callableId.includes('codex');
}

function CodexExecutionModeSelector({
  value,
  onChange,
}: {
  value: CodexExecutionMode;
  onChange: (value: CodexExecutionMode) => void;
}) {
  return (
    <div className="node-settings-field codex-mode-field">
      <span>Codex 执行模式</span>
      <select
        value={value}
        onChange={(event) => onChange(normalizedCodexExecutionMode(event.currentTarget.value))}
        aria-label="Codex 执行模式"
      >
        <option value="default">默认安全模式（read-only sandbox）</option>
        <option value="local_readonly_no_sandbox">本地只读无沙箱（高风险）</option>
        <option value="danger_full_access">危险全权限（高风险）</option>
      </select>
      {value === 'local_readonly_no_sandbox' ? (
        <p className="notice compact-notice">
          底层会使用 Codex dangerous bypass；只读约束来自提示词，不是 OS 级沙箱。
        </p>
      ) : null}
      {value === 'danger_full_access' ? (
        <p className="notice compact-notice">
          底层会使用 Codex dangerous bypass，并且不会注入禁止修改文件的提示词约束。
        </p>
      ) : null}
    </div>
  );
}

function TechnicalDetailsDisclosure({
  node,
  runtimeConfig,
  callableDetail,
}: {
  node: AgentNodeSettingsModel;
  runtimeConfig: RuntimeConfig | null;
  callableDetail: CallableDetail | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="node-settings-card technical-details-card">
      <button type="button" className="technical-details-toggle" onClick={() => setOpen((value) => !value)}>
        <span>更多技术详情</span>
        {open ? <ChevronUp aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}
      </button>
      {open ? (
        <div className="technical-details-content">
          <dl className="node-settings-facts">
            <dt>node id</dt>
            <dd>{node.nodeId}</dd>
            <dt>callable id</dt>
            <dd>{node.callableId || 'n/a'}</dd>
            <dt>scope</dt>
            <dd>{node.scopeLabel}</dd>
            <dt>run mode</dt>
            <dd>{runtimeConfig?.real_external_agents_enabled ? 'production / real CLI' : 'hermetic or external gate disabled'}</dd>
          </dl>
          <LiveLogBlocks liveLogs={node.logs} />
          <CodeBlock title="core-v2-invocation-preview.json" content={JSON.stringify(node.preview, null, 2)} variant="json" />
          <CodeBlock title="node-raw.json" content={JSON.stringify(node.raw, null, 2)} variant="json" />
          {callableDetail ? (
            <CodeBlock title="callable-template.json" content={JSON.stringify(callableDetail, null, 2)} variant="json" />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function RightInspector({
  canvas,
  selection,
  selectedWorkflow,
  selectedPort,
  selectedEdge,
  selectedInternalNode,
  connectionMode,
  dataConnectionDraft,
  runtimeConfig,
  liveLogs,
  workflowRun,
  workflowEvents,
  workflows,
  binding,
  onConnectionMode,
  onBeginDataConnection,
  onCancelDataConnection,
  onUpdateDataConnectionMaterialization,
  onCompleteDataConnection,
  onCompleteDataConnectionWithNewInputPort,
  onAddDataConnectPort,
  onRenameDataConnectPort,
  onDeleteDataConnectPort,
  onReadEvidence,
  onConfigureBinding,
  onUpdateWorkflowInput,
  onUpdateInternalInput,
  onUpdateWorkflowLabel,
  onUpdateInternalLabel,
  onUpdateWorkflowForwardMainOutput,
  onUpdateInternalForwardMainOutput,
  onUpdateWorkflowEmptyInputPolicy,
  onUpdateInternalEmptyInputPolicy,
  onUpdateWorkflowCodexExecutionMode,
  onUpdateInternalCodexExecutionMode,
  onOpenCallableResource,
}: {
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  selectedWorkflow?: WorkflowContainerModel;
  selectedPort?: WorkflowPortView;
  selectedEdge?: WorkflowCanvasEdge;
  selectedInternalNode?: InternalNodeView;
  connectionMode: ConnectionMode;
  dataConnectionDraft: DataConnectionDraft;
  runtimeConfig: RuntimeConfig | null;
  liveLogs: Record<string, NodeLiveLogs>;
  workflowRun: WorkflowRunResult | null;
  workflowEvents: RunEvent[];
  workflows: WorkflowSummary[];
  binding?: WorkflowBindingView;
  onConnectionMode: (mode: ConnectionMode) => void;
  onBeginDataConnection: (draft: Exclude<DataConnectionDraft, null>) => void;
  onCancelDataConnection: () => void;
  onUpdateDataConnectionMaterialization: (materialization: 'copy' | 'reference') => void;
  onCompleteDataConnection: (
    targetNodeId: string,
    targetPortId: string,
    options?: { replaceExisting?: boolean },
  ) => void;
  onCompleteDataConnectionWithNewInputPort: (targetNodeId: string, requestedPortId: string) => void;
  onAddDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    requestedPortId: string,
  ) => void;
  onRenameDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
    requestedPortId: string,
  ) => void;
  onDeleteDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
  ) => void;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onConfigureBinding: (workflowId: string) => void;
  onUpdateWorkflowInput: (workflowId: string, input: Record<string, unknown>) => void;
  onUpdateInternalInput: (
    workflowId: string,
    nodeId: string,
    input: Record<string, unknown>,
  ) => void;
  onUpdateWorkflowLabel: (workflowId: string, label: string) => void;
  onUpdateInternalLabel: (workflowId: string, nodeId: string, label: string) => void;
  onUpdateWorkflowForwardMainOutput: (workflowId: string, value: boolean) => void;
  onUpdateInternalForwardMainOutput: (
    workflowId: string,
    nodeId: string,
    value: boolean,
  ) => void;
  onUpdateWorkflowEmptyInputPolicy: (workflowId: string, value: EmptyInputPolicy) => void;
  onUpdateInternalEmptyInputPolicy: (
    workflowId: string,
    nodeId: string,
    value: EmptyInputPolicy,
  ) => void;
  onUpdateWorkflowCodexExecutionMode: (workflowId: string, value: CodexExecutionMode) => void;
  onUpdateInternalCodexExecutionMode: (
    workflowId: string,
    nodeId: string,
    value: CodexExecutionMode,
  ) => void;
  onOpenCallableResource: (callableId: string, name: string, kind: 'agent_class' | 'tool_class') => void;
}) {
  const [tab, setTab] = useState('overview');
  const selectedNodeCallableId =
    selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)
      ? selectedWorkflow.callableId || ''
      : selection.type === 'internal' && selectedInternalNode
        ? selectedInternalNode.callableId || selectedInternalNode.runtime || ''
        : '';
  const callableDetailState = useCallableDetail(selectedNodeCallableId);
  const nodeSettingsTitle = inspectorDrawerTitle(selection);
  useEffect(() => {
    setTab(selection.type === 'edge' ? 'mapping' : 'overview');
  }, [selection]);

  if (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)) {
    return (
      <aside className="right-inspector node-settings-panel" aria-label="节点设置面板">
        <header className="inspector-title-row node-settings-title-row">
          <div>
            <span className="panel-kicker">当前选中</span>
            <h3>{nodeSettingsTitle}</h3>
          </div>
        </header>
        <AgentNodeSettings
          node={{
            scopeLabel: '任务画布',
            nodeId: selectedWorkflow.id,
            label: workflowInvocationLabel(selectedWorkflow),
            task: workflowInvocationLabel(selectedWorkflow),
            kind: selectedWorkflow.sourceKind === 'tool' ? 'Tool' : 'Agent',
            status: selectedWorkflow.status,
            callableId: selectedWorkflow.callableId || '',
            codexExecutionMode: selectedWorkflow.codexExecutionMode,
            input: selectedWorkflow.sourceInput || {},
            inputPorts: selectedWorkflow.inputPorts,
            outputPorts: workflowOutputPorts(selectedWorkflow),
            outputSchema: selectedWorkflow.outputSchema,
            forwardMainOutputOnControl: selectedWorkflow.forwardMainOutputOnControl,
            emptyInputPolicy: selectedWorkflow.emptyInputPolicy,
            run: nodeRunForWorkflow(workflowRun, selectedWorkflow),
            logs: nodeLiveLogsFor(liveLogs, nodeRunForWorkflow(workflowRun, selectedWorkflow)),
            preview: workflowInvocationPreview(selectedWorkflow),
            raw: selectedWorkflow,
          }}
          connectionEditor={{
            canvas,
            canvasNodeKind: 'workflow',
            scopeWorkflowId: null,
            nodeId: selectedWorkflow.id,
            nodeLabel: workflowInvocationLabel(selectedWorkflow),
            callableId: selectedWorkflow.callableId || selectedWorkflow.workflowRef || '',
            inputPorts: selectedWorkflow.inputPorts,
            outputPorts: workflowOutputPorts(selectedWorkflow),
            outputPortsReadonly: workflowOutputPortsReadonly(selectedWorkflow),
            dataConnectionDraft,
            onBeginDataConnection,
            onCancelDataConnection,
            onUpdateDataConnectionMaterialization,
            onCompleteDataConnection,
            onCompleteDataConnectionWithNewInputPort,
            onAddPort: onAddDataConnectPort,
            onRenamePort: onRenameDataConnectPort,
            onDeletePort: onDeleteDataConnectPort,
          }}
          runtimeConfig={runtimeConfig}
          callableState={callableDetailState}
          onUpdateInput={(nextInput) => onUpdateWorkflowInput(selectedWorkflow.id, nextInput)}
          onUpdateLabel={(label) => onUpdateWorkflowLabel(selectedWorkflow.id, label)}
          onUpdateForwardMainOutput={(value) =>
            onUpdateWorkflowForwardMainOutput(selectedWorkflow.id, value)
          }
          onUpdateEmptyInputPolicy={(value) =>
            onUpdateWorkflowEmptyInputPolicy(selectedWorkflow.id, value)
          }
          onUpdateCodexExecutionMode={(value) =>
            onUpdateWorkflowCodexExecutionMode(selectedWorkflow.id, value)
          }
          onReadEvidence={onReadEvidence}
          onOpenCallableResource={onOpenCallableResource}
        />
      </aside>
    );
  }

  if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
    const nodeRun = nodeRunForInternalNode(workflowRun, selectedWorkflow.id, selectedInternalNode.id);
    return (
      <aside className="right-inspector node-settings-panel" aria-label="节点设置面板">
        <header className="inspector-title-row node-settings-title-row">
          <div>
            <span className="panel-kicker">当前选中</span>
            <h3>{nodeSettingsTitle}</h3>
          </div>
        </header>
        <AgentNodeSettings
          node={{
            scopeLabel: `任务流：${workflowInvocationLabel(selectedWorkflow)}`,
            nodeId: selectedInternalNode.id,
            label: internalInvocationLabel(selectedInternalNode),
            task: selectedInternalNode.task,
            kind: selectedInternalNode.kind,
            status: selectedInternalNode.status,
            callableId: selectedInternalNode.callableId || selectedInternalNode.runtime || '',
            codexExecutionMode: selectedInternalNode.codexExecutionMode,
            input: selectedInternalNode.input || {},
            inputPorts: selectedInternalNode.inputPorts || [port('main', 'input', 'input')],
            outputPorts: internalNodeOutputPorts(selectedInternalNode),
            outputSchema: selectedInternalNode.outputSchema,
            forwardMainOutputOnControl: selectedInternalNode.forwardMainOutputOnControl,
            emptyInputPolicy: selectedInternalNode.emptyInputPolicy,
            run: nodeRun,
            logs: nodeLiveLogsFor(liveLogs, nodeRun),
            workflowMainInputBinding: workflowMainInputBindingState(
              canvas,
              selectedWorkflow.id,
              selectedInternalNode.id,
            ),
            preview: internalNodeInvocationPreview(selectedInternalNode),
            raw: { workflow: selectedWorkflow.id, node: selectedInternalNode },
          }}
          connectionEditor={{
            canvas,
            canvasNodeKind: 'internal',
            scopeWorkflowId: selectedWorkflow.id,
            nodeId: selectedInternalNode.id,
            nodeLabel: internalInvocationLabel(selectedInternalNode),
            callableId: selectedInternalNode.callableId || selectedInternalNode.runtime || '',
            inputPorts: selectedInternalNode.inputPorts || [port('main', 'input', 'input')],
            outputPorts: internalNodeOutputPorts(selectedInternalNode),
            outputPortsReadonly: true,
            dataConnectionDraft,
            onBeginDataConnection,
            onCancelDataConnection,
            onUpdateDataConnectionMaterialization,
            onCompleteDataConnection,
            onCompleteDataConnectionWithNewInputPort,
            onAddPort: onAddDataConnectPort,
            onRenamePort: onRenameDataConnectPort,
            onDeletePort: onDeleteDataConnectPort,
          }}
          runtimeConfig={runtimeConfig}
          callableState={callableDetailState}
          onUpdateInput={(nextInput) => onUpdateInternalInput(selectedWorkflow.id, selectedInternalNode.id, nextInput)}
          onUpdateLabel={(label) => onUpdateInternalLabel(selectedWorkflow.id, selectedInternalNode.id, label)}
          onUpdateForwardMainOutput={(value) =>
            onUpdateInternalForwardMainOutput(selectedWorkflow.id, selectedInternalNode.id, value)
          }
          onUpdateEmptyInputPolicy={(value) =>
            onUpdateInternalEmptyInputPolicy(selectedWorkflow.id, selectedInternalNode.id, value)
          }
          onUpdateCodexExecutionMode={(value) =>
            onUpdateInternalCodexExecutionMode(selectedWorkflow.id, selectedInternalNode.id, value)
          }
          onReadEvidence={onReadEvidence}
          onOpenCallableResource={onOpenCallableResource}
        />
      </aside>
    );
  }

  return (
    <aside className="right-inspector" aria-label={`${nodeSettingsTitle}面板`}>
      <header className="inspector-title-row">
        <h3>{nodeSettingsTitle}</h3>
        <div className="segmented-control" aria-label="连接模式">
          <button
            type="button"
            className={connectionMode === 'data' ? 'active' : ''}
            onClick={() => onConnectionMode('data')}
          >
            数据
          </button>
          <button
            type="button"
            className={connectionMode === 'control' ? 'active' : ''}
            onClick={() => onConnectionMode('control')}
          >
            控制
          </button>
        </div>
      </header>
      <InspectorTabs
        selection={selection}
        activeTab={tab}
        onTab={setTab}
      />
      {selection.type === 'workflow' && selectedWorkflow ? (
        <WorkflowInspector
          canvas={canvas}
          workflow={selectedWorkflow}
          tab={tab}
          workflowRun={workflowRun}
          runtimeConfig={runtimeConfig}
          liveLogs={liveLogs}
          events={workflowEvents}
          savedWorkflow={workflowSummaryForRef(workflows, selectedWorkflow.workflowRef)}
          binding={binding}
          dataConnectionDraft={dataConnectionDraft}
          onReadEvidence={onReadEvidence}
          onConfigureBinding={onConfigureBinding}
          onBeginDataConnection={onBeginDataConnection}
          onCancelDataConnection={onCancelDataConnection}
          onUpdateDataConnectionMaterialization={onUpdateDataConnectionMaterialization}
          onCompleteDataConnection={onCompleteDataConnection}
          onCompleteDataConnectionWithNewInputPort={onCompleteDataConnectionWithNewInputPort}
          onAddDataConnectPort={onAddDataConnectPort}
          onRenameDataConnectPort={onRenameDataConnectPort}
          onDeleteDataConnectPort={onDeleteDataConnectPort}
          onUpdateInput={onUpdateWorkflowInput}
          onUpdateLabel={onUpdateWorkflowLabel}
        />
      ) : null}
      {selection.type === 'port' && selectedWorkflow && selectedPort ? (
        <PortInspector workflow={selectedWorkflow} port={selectedPort} tab={tab} canvas={canvas} />
      ) : null}
      {selection.type === 'edge' && selectedEdge ? (
        <EdgeInspector
          edge={selectedEdge}
          tab={tab}
          canvas={canvas}
          scopeWorkflowId={selection.scopeWorkflowId || null}
          onCreateTargetInputPort={(targetNodeId, targetPortId) =>
            onAddDataConnectPort(selection.scopeWorkflowId || null, targetNodeId, 'input', targetPortId)
          }
        />
      ) : null}
      {selection.type === 'internal' && selectedWorkflow && selectedInternalNode ? (
        <InternalNodeInspector
          canvas={canvas}
          workflow={selectedWorkflow}
          node={selectedInternalNode}
          tab={tab}
          workflowRun={workflowRun}
          runtimeConfig={runtimeConfig}
          liveLogs={liveLogs}
          dataConnectionDraft={dataConnectionDraft}
          onReadEvidence={onReadEvidence}
          onBeginDataConnection={onBeginDataConnection}
          onCancelDataConnection={onCancelDataConnection}
          onUpdateDataConnectionMaterialization={onUpdateDataConnectionMaterialization}
          onCompleteDataConnection={onCompleteDataConnection}
          onCompleteDataConnectionWithNewInputPort={onCompleteDataConnectionWithNewInputPort}
          onAddDataConnectPort={onAddDataConnectPort}
          onRenameDataConnectPort={onRenameDataConnectPort}
          onDeleteDataConnectPort={onDeleteDataConnectPort}
          onUpdateInput={onUpdateInternalInput}
          onUpdateLabel={onUpdateInternalLabel}
        />
      ) : null}
    </aside>
  );
}

function InspectorTabs({
  selection,
  activeTab,
  onTab,
}: {
  selection: CanvasSelection;
  activeTab: string;
  onTab: (tab: string) => void;
}) {
  const tabs =
    selection.type === 'edge'
      ? ['overview', 'upstream', 'downstream', 'mapping', 'raw']
      : selection.type === 'port'
        ? ['overview', 'contract', 'connections', 'evidence']
        : selection.type === 'internal'
          ? ['overview', 'invocation', 'connections', 'input', 'output', 'steps', 'artifacts', 'logs', 'raw']
          : ['overview', 'invocation', 'connections', 'input', 'output', 'config', 'history', 'raw'];
  const labels: Record<string, string> = {
    queued: '排队中',
    cancel_requested: '停止中',
    cancelled: '已取消',
    crashed: '已中断',
    overview: '概览',
    input: '输入',
    output: '输出',
    config: '配置',
    history: '运行历史',
    raw: '原始数据',
    contract: 'Contract',
    connections: '连接',
    evidence: '运行证据',
    upstream: '上游',
    downstream: '下游',
    mapping: '数据映射',
    artifacts: '产物',
    events: '事件',
    steps: '步骤',
    logs: '详细日志',
  };
  return (
    <div className="tab-strip compact-tabs" role="tablist" aria-label="Inspector tabs">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          className={activeTab === tab ? 'active' : ''}
          aria-label={tab === 'input' ? 'Inspector input tab' : undefined}
          onClick={() => onTab(tab)}
        >
          {labels[tab] || tab}
        </button>
      ))}
    </div>
  );
}

function WorkflowInspector({
  canvas,
  workflow,
  tab,
  workflowRun,
  runtimeConfig,
  liveLogs,
  events,
  savedWorkflow,
  binding,
  dataConnectionDraft,
  onReadEvidence,
  onConfigureBinding,
  onBeginDataConnection,
  onCancelDataConnection,
  onUpdateDataConnectionMaterialization,
  onCompleteDataConnection,
  onCompleteDataConnectionWithNewInputPort,
  onAddDataConnectPort,
  onRenameDataConnectPort,
  onDeleteDataConnectPort,
  onUpdateInput,
  onUpdateLabel,
}: {
  canvas: WorkspaceCanvasModel;
  workflow: WorkflowContainerModel;
  tab: string;
  workflowRun: WorkflowRunResult | null;
  runtimeConfig: RuntimeConfig | null;
  liveLogs: Record<string, NodeLiveLogs>;
  events: RunEvent[];
  savedWorkflow?: WorkflowSummary;
  binding?: WorkflowBindingView;
  dataConnectionDraft: DataConnectionDraft;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onConfigureBinding: (workflowId: string) => void;
  onBeginDataConnection: (draft: Exclude<DataConnectionDraft, null>) => void;
  onCancelDataConnection: () => void;
  onUpdateDataConnectionMaterialization: (materialization: 'copy' | 'reference') => void;
  onCompleteDataConnection: (
    targetNodeId: string,
    targetPortId: string,
    options?: { replaceExisting?: boolean },
  ) => void;
  onCompleteDataConnectionWithNewInputPort: (targetNodeId: string, requestedPortId: string) => void;
  onAddDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    requestedPortId: string,
  ) => void;
  onRenameDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
    requestedPortId: string,
  ) => void;
  onDeleteDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
  ) => void;
  onUpdateInput: (workflowId: string, input: Record<string, unknown>) => void;
  onUpdateLabel: (workflowId: string, label: string) => void;
}) {
  const nodeRun = nodeRunForWorkflow(workflowRun, workflow);
  const nodeLogs = nodeLiveLogsFor(liveLogs, nodeRun);
  const executable = isExecutableNodeWorkflow(workflow);
  if (tab === 'invocation') {
    return (
      <section className="inspector-stack">
        <div className="inspector-note">
          System/default prompt belongs to the reusable class resource. This panel edits only this invocation's user prompt and static input.
        </div>
        <InvocationInputEditor
          input={workflow.sourceInput || {}}
          onChange={(nextInput) => onUpdateInput(workflow.id, nextInput)}
        />
        <CodeBlock
          title="core-v2-invocation-preview.json"
          content={JSON.stringify(workflowInvocationPreview(workflow), null, 2)}
          variant="json"
        />
      </section>
    );
  }
  if (tab === 'connections') {
    if (!executable) {
      return <p className="muted">Workflow container 的边界端口连接会在后续单独建模；当前只支持可执行节点和内部节点。</p>;
    }
    return (
      <DataConnectionsPanel
        canvasNodeKind="workflow"
        canvas={canvas}
        scopeWorkflowId={null}
        nodeId={workflow.id}
        nodeLabel={workflowInvocationLabel(workflow)}
        callableId={workflow.callableId || workflow.workflowRef}
        inputPorts={workflow.inputPorts}
        outputPorts={workflow.outputPorts}
        dataConnectionDraft={dataConnectionDraft}
        onBeginDataConnection={onBeginDataConnection}
        onCancelDataConnection={onCancelDataConnection}
        onUpdateDataConnectionMaterialization={onUpdateDataConnectionMaterialization}
        onCompleteDataConnection={onCompleteDataConnection}
        onCompleteDataConnectionWithNewInputPort={onCompleteDataConnectionWithNewInputPort}
        onAddPort={onAddDataConnectPort}
        onRenamePort={onRenameDataConnectPort}
        onDeletePort={onDeleteDataConnectPort}
      />
    );
  }
  if (tab === 'input') {
    if (executable) {
      return (
        <section className="inspector-stack">
          <h4>有效输入</h4>
          <EvidencePreview
            path={nodeRun?.input_path}
            title="input.json"
            emptyText="尚未运行；当前节点没有真实 input.json。"
          />
          <CodeBlock
            title="静态输入"
            content={JSON.stringify(workflow.sourceInput || {}, null, 2)}
            variant="json"
          />
          <CodeBlock
            title="输入映射"
            content={JSON.stringify(workflow.sourceInputMapping || {}, null, 2)}
            variant="json"
          />
        </section>
      );
    }
    return <PortList title="输入端口" ports={workflow.inputPorts} />;
  }
  if (tab === 'output') {
    if (executable) {
      return (
        <section className="inspector-stack">
          <h4>真实输出</h4>
          <EvidencePreview
            path={nodeRun?.output_path}
            title="output.json"
            emptyText="尚未运行；当前节点没有真实 output.json。"
          />
        </section>
      );
    }
    return <PortList title="输出端口" ports={workflow.outputPorts} />;
  }
  if (tab === 'config') {
    return (
      <section className="inspector-stack">
        <dl className="definition-grid compact">
          <dt>workflow_ref</dt>
          <dd>{workflow.workflowRef || 'inline/demo'}</dd>
          {savedWorkflow ? (
            <>
              <dt>saved template</dt>
              <dd>{savedWorkflow.workflow_id}</dd>
              <dt>saved nodes</dt>
              <dd>{savedWorkflow.task_count}</dd>
            </>
          ) : null}
          <dt>cwd</dt>
          <dd>{bindingDirectory(workflow, binding)}</dd>
          <dt>binding</dt>
          <dd>{bindingPathOf(binding) || 'unbound'}</dd>
          <dt>size</dt>
          <dd>
            {workflow.size.width} x {workflow.size.height}
          </dd>
          <dt>binding status</dt>
          <dd>{binding?.status || 'unbound'}</dd>
        </dl>
        <button type="button" className="secondary-action" onClick={() => onConfigureBinding(workflow.id)}>
          <FolderCog aria-hidden="true" size={16} />
          配置工作目录
        </button>
      </section>
    );
  }
  if (tab === 'history') {
    return (
      <section className="inspector-stack">
        <button
          type="button"
          className="path-button"
          disabled={!nodeRun?.output_path}
          onClick={() => onReadEvidence(nodeRun?.output_path, '节点输出')}
        >
          <FileText aria-hidden="true" size={16} />
          <span>输出</span>
          <small>{shortPath(nodeRun?.output_path)}</small>
        </button>
        <EventTimeline events={events} title="工作流事件" />
      </section>
    );
  }
  if (tab === 'raw') {
    return (
      <CodeBlock
        title="workflow-container.json"
        content={JSON.stringify(workflow, null, 2)}
        variant="json"
      />
    );
  }
  if (executable) {
    return (
      <section className="inspector-stack">
        <dl className="definition-grid compact">
          <dt>Agent</dt>
          <dd>{workflow.title}</dd>
          <dt>callable</dt>
          <dd>{workflow.callableId || 'n/a'}</dd>
          <dt>runtime</dt>
          <dd>{workflow.sourceKind === 'tool' ? 'Tool' : 'Agent'}</dd>
          <dt>状态</dt>
          <dd>{statusLabel(workflow.status)}</dd>
          <dt>run</dt>
          <dd>{nodeRun?.run_dir ? shortPath(nodeRun.run_dir) : '尚未运行'}</dd>
        </dl>
        <div className="inspector-note">
          系统提示词属于资源库里的 Agent Class；这里是本次任务里的调用实例，只显示用户输入、映射和运行证据。
        </div>
        <div className="inspector-note">
          Run mode: {runtimeConfig?.real_external_agents_enabled ? 'production / real CLI' : 'hermetic or external gate disabled'}
        </div>
        <LiveLogBlocks liveLogs={nodeLogs} />
        <InvocationIdentityCard
          scope="Root canvas"
          nodeId={workflow.id}
          label={workflowInvocationLabel(workflow)}
          callableId={workflow.callableId}
          workflowRef={workflow.workflowRef}
          onLabelChange={(label) => onUpdateLabel(workflow.id, label)}
        />
        <InvocationInputEditor
          input={workflow.sourceInput || {}}
          onChange={(nextInput) => onUpdateInput(workflow.id, nextInput)}
        />
        <CodeBlock
          title="用户提示词 / 静态输入"
          content={JSON.stringify(workflow.sourceInput || {}, null, 2)}
          variant="json"
        />
        <CodeBlock
          title="上游输入映射"
          content={JSON.stringify(workflow.sourceInputMapping || {}, null, 2)}
          variant="json"
        />
        <div className="inspector-run-evidence-grid">
          <EvidencePreview
            path={nodeRun?.input_path}
            title="真实输入 input.json"
            emptyText="尚未运行；当前 Agent 实例没有真实 input.json。"
          />
          <EvidencePreview
            path={nodeRun?.output_path}
            title="真实输出 output.json"
            emptyText="尚未运行；当前 Agent 实例没有真实 output.json。"
          />
        </div>
      </section>
    );
  }
  return (
    <dl className="definition-grid compact">
      <dt>名称</dt>
      <dd>{workflow.title}</dd>
      <dt>状态</dt>
      <dd>{statusLabel(workflow.status)}</dd>
      <dt>目录</dt>
      <dd>{bindingDirectory(workflow, binding)}</dd>
      <dt>端口</dt>
      <dd>
        {workflow.inputPorts.length} in / {workflow.outputPorts.length} out
      </dd>
      <dt>内部节点</dt>
      <dd>{savedWorkflow ? `${savedWorkflow.task_count} saved` : workflow.internalNodes.length}</dd>
    </dl>
  );
}

function DataConnectionsPanel({
  canvas,
  scopeWorkflowId,
  nodeId,
  nodeLabel,
  callableId,
  inputPorts,
  outputPorts,
  outputPortsReadonly = false,
  dataConnectionDraft,
  onBeginDataConnection,
  onCancelDataConnection,
  onUpdateDataConnectionMaterialization,
  onCompleteDataConnection,
  onCompleteDataConnectionWithNewInputPort,
  onAddPort,
  onRenamePort,
  onDeletePort,
}: {
  canvasNodeKind: 'workflow' | 'internal';
  canvas: WorkspaceCanvasModel;
  scopeWorkflowId: string | null;
  nodeId: string;
  nodeLabel: string;
  callableId?: string;
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
}) {
  const [newInputPortId, setNewInputPortId] = useState('');
  const [newOutputPortId, setNewOutputPortId] = useState('');
  const sourceScopeMatches = dataConnectionDraft?.scopeWorkflowId === scopeWorkflowId;
  const targets = dataConnectNodes(canvas, scopeWorkflowId).filter(
    (candidate) => candidate.nodeId !== dataConnectionDraft?.sourceNodeId,
  );
  const incoming = dataEdgesForNode(canvas, scopeWorkflowId, nodeId, 'input');
  const outgoing = dataEdgesForNode(canvas, scopeWorkflowId, nodeId, 'output');

  function addPort(direction: PortDirection) {
    const requestedPortId = direction === 'input' ? newInputPortId : newOutputPortId;
    onAddPort(scopeWorkflowId, nodeId, direction, requestedPortId);
    if (direction === 'input') {
      setNewInputPortId('');
    } else {
      setNewOutputPortId('');
    }
  }

  function renamePort(direction: PortDirection, currentPortId: string) {
    const requestedPortId = window.prompt('新的 port id', currentPortId);
    if (requestedPortId === null) {
      return;
    }
    onRenamePort(scopeWorkflowId, nodeId, direction, currentPortId, requestedPortId);
  }

  function deletePort(direction: PortDirection, portId: string) {
    onDeletePort(scopeWorkflowId, nodeId, direction, portId);
  }

  return (
    <section className="inspector-stack data-connections-panel">
      <div className="connection-identity-card">
        <strong>{nodeLabel}</strong>
        <small>{nodeId}</small>
        {callableId ? <small>{callableId}</small> : null}
      </div>

      {dataConnectionDraft ? (
        <div className="data-connect-draft">
          <strong>
            正在连接: {dataConnectionDraft.sourceNodeLabel}.{dataConnectionDraft.sourcePortId}
          </strong>
          <label>
            materialization
            <select
              value={dataConnectionDraft.materialization}
              onChange={(event) =>
                onUpdateDataConnectionMaterialization(
                  event.target.value === 'reference' ? 'reference' : 'copy',
                )
              }
            >
              <option value="copy">copy</option>
              <option value="reference">reference</option>
            </select>
          </label>
          <button type="button" onClick={onCancelDataConnection}>
            取消连接
          </button>
        </div>
      ) : (
        <p className="muted">先从某个 output port 发起连接，再选择目标 input port。</p>
      )}

      <section className="inspector-stack">
        <h4>输出端口</h4>
        {outputPortsReadonly ? (
          <p className="muted">
            输出端口来自 output_schema.properties.outputs.properties，只读展示；需要修改命名输出时请编辑 output schema。
          </p>
        ) : null}
        {outputPorts.map((portValue) => {
          const related = outgoing.filter((edge) => edge.source.portId === portValue.id);
          const readonlyPort = outputPortsReadonly || isSchemaDerivedOutputPort(portValue);
          return (
            <article key={portValue.id} className="port-contract-row">
              <strong>{portValue.id}</strong>
              <span>{portValue.label}</span>
              {portValue.jsonPath ? <small>{portValue.jsonPath}</small> : null}
              {portValue.diagnostic ? <small>{portValue.diagnostic}</small> : null}
              {related.length > 0 ? (
                <small>
                  输出到 {related.map((edge) => `${edge.target.workflowId}.${edge.target.portId}`).join(', ')}
                </small>
              ) : (
                <small>暂无下游 data edge</small>
              )}
              <button
                type="button"
                className="secondary-action-button"
                onClick={() =>
                  onBeginDataConnection({
                    scopeWorkflowId,
                    sourceNodeId: nodeId,
                    sourceNodeLabel: nodeLabel,
                    sourcePortId: portValue.id,
                    materialization: 'copy',
                  })
                }
              >
                从此输出连接...
              </button>
              <button
                type="button"
                className="secondary-action-button"
                disabled={readonlyPort}
                title={readonlyPort ? 'schema-derived output port 只读，请修改 output schema' : undefined}
                onClick={() => renamePort('output', portValue.id)}
              >
                重命名
              </button>
              <button
                type="button"
                className="secondary-action-button"
                disabled={readonlyPort}
                title={readonlyPort ? 'schema-derived output port 只读，请修改 output schema' : undefined}
                onClick={() => deletePort('output', portValue.id)}
              >
                删除
              </button>
            </article>
          );
        })}
        {!outputPortsReadonly ? (
          <div className="inline-port-form">
            <input
              value={newOutputPortId}
              onChange={(event) => setNewOutputPortId(event.target.value)}
              placeholder="new_output_port"
              aria-label="new output port id"
            />
            <button type="button" onClick={() => addPort('output')}>
              添加输出端口
            </button>
          </div>
        ) : null}
      </section>

      <section className="inspector-stack">
        <h4>输入端口</h4>
        {inputPorts.map((portValue) => {
          const related = incoming.filter((edge) => edge.target.portId === portValue.id);
          return (
            <article key={portValue.id} className="port-contract-row">
              <strong>{portValue.id}</strong>
              <span>{portValue.label}</span>
              {related.length > 0 ? (
                <small>
                  来自 {related.map((edge) => `${edge.source.workflowId}.${edge.source.portId}`).join(', ')}
                </small>
              ) : (
                <small>暂无上游 data edge</small>
              )}
              <button
                type="button"
                className="secondary-action-button"
                onClick={() => renamePort('input', portValue.id)}
              >
                重命名
              </button>
              <button
                type="button"
                className="secondary-action-button"
                onClick={() => deletePort('input', portValue.id)}
              >
                删除
              </button>
            </article>
          );
        })}
        <div className="inline-port-form">
          <input
            value={newInputPortId}
            onChange={(event) => setNewInputPortId(event.target.value)}
            placeholder="new_input_port"
            aria-label="new input port id"
          />
          <button type="button" onClick={() => addPort('input')}>
            添加输入端口
          </button>
        </div>
      </section>

      {dataConnectionDraft && sourceScopeMatches ? (
        <section className="inspector-stack">
          <h4>可连接目标</h4>
          {targets.map((target) => (
            <article key={target.nodeId} className="connection-target-card">
              <strong>{target.label}</strong>
              <small>{target.nodeId}</small>
              {target.inputPorts.map((targetPort) => {
                const conflicts = dataEdgesForNode(
                  canvas,
                  scopeWorkflowId,
                  target.nodeId,
                  'input',
                ).filter((edge) => edge.target.portId === targetPort.id);
                const hasOneCardinalityConflict =
                  conflicts.length > 0 && (targetPort.cardinality || 'one') !== 'many';
                const requestedPortId = `${dataConnectionDraft.sourceNodeId}_input`;
                return (
                  <div key={targetPort.id} className="connection-target-port">
                    <span>
                      {targetPort.id}
                      {hasOneCardinalityConflict ? '（已有输入）' : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onCompleteDataConnection(target.nodeId, targetPort.id, {
                          replaceExisting: hasOneCardinalityConflict,
                        })
                      }
                    >
                      {hasOneCardinalityConflict ? '替换连接' : '连接到此输入'}
                    </button>
                    {hasOneCardinalityConflict ? (
                      <button
                        type="button"
                        onClick={() =>
                          onCompleteDataConnectionWithNewInputPort(
                            target.nodeId,
                            requestedPortId,
                          )
                        }
                      >
                        创建新输入端口并连接
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </article>
          ))}
          {targets.length === 0 ? <p className="muted">当前 scope 没有可连接目标。</p> : null}
        </section>
      ) : null}
      {dataConnectionDraft && !sourceScopeMatches ? (
        <p className="muted">当前连接来源不在这个 scope 内，请回到来源所在的画布层级。</p>
      ) : null}
    </section>
  );
}

function PortInspector({
  workflow,
  port,
  tab,
  canvas,
}: {
  workflow: WorkflowContainerModel;
  port: WorkflowPortView;
  tab: string;
  canvas: WorkspaceCanvasModel;
}) {
  const relatedEdges = canvas.edges.filter(
    (edge): edge is Extract<WorkflowCanvasEdge, { kind: 'data' }> => {
    if (edge.kind !== 'data') {
      return false;
    }
    return (
      (edge.source.workflowId === workflow.id && edge.source.portId === port.id) ||
      (edge.target.workflowId === workflow.id && edge.target.portId === port.id)
    );
    },
  );
  if (tab === 'connections') {
    return (
      <section className="inspector-stack">
      {relatedEdges.map((edge) => (
          <article
            key={`${edge.kind}:${edge.id}:${edge.source.workflowId}:${edge.source.portId}:${edge.target.workflowId}:${edge.target.portId}`}
            className="edge-summary-row"
          >
            {edge.source.workflowId}.{edge.source.portId} {'->'} {edge.target.workflowId}.
            {edge.target.portId}
          </article>
        ))}
        {relatedEdges.length === 0 ? <p className="muted">暂无连接</p> : null}
      </section>
    );
  }
  if (tab === 'contract' || tab === 'overview') {
    return (
      <dl className="definition-grid compact">
        <dt>workflow</dt>
        <dd>{workflow.title}</dd>
        <dt>port</dt>
        <dd>{port.id}</dd>
        <dt>方向</dt>
        <dd>{port.direction}</dd>
        <dt>说明</dt>
        <dd>{port.label}</dd>
        <dt>required</dt>
        <dd>{String(Boolean(port.required))}</dd>
        <dt>cardinality</dt>
        <dd>{port.cardinality || 'one'}</dd>
      </dl>
    );
  }
  return <p className="muted">运行证据会在 workflow run 后按 inbox/outbox manifest 展示。</p>;
}







function EdgeInspector({
  edge,
  tab,
  canvas,
  scopeWorkflowId,
  onCreateTargetInputPort,
}: {
  edge: WorkflowCanvasEdge;
  tab: string;
  canvas: WorkspaceCanvasModel;
  scopeWorkflowId: string | null;
  onCreateTargetInputPort: (targetNodeId: string, targetPortId: string) => void;
}) {
  const sourceWorkflow = canvas.workflows.find((workflow) => workflow.id === edge.source.workflowId);
  const targetWorkflow = canvas.workflows.find((workflow) => workflow.id === edge.target.workflowId);
  const boundaryWorkflowId = workflowIdForBoundaryMainBinding(edge);
  const isBoundaryControlEdge = edge.kind === 'control' && Boolean(boundaryWorkflowId);
  const boundaryPreviewSnapshot = useMemo(
    () => (isBoundaryControlEdge ? boundaryTransferPreviewSnapshot(canvas) : null),
    [canvas, isBoundaryControlEdge],
  );
  const boundaryPreview = useBoundaryTransferPreview({
    enabled: isBoundaryControlEdge,
    canvasSnapshot: boundaryPreviewSnapshot,
    edgeId: edge.id,
  });
  const diagnostics = edgeDiagnosticsForCanvasEdge(canvas, scopeWorkflowId, edge);
  const targetNodeExists =
    edge.kind === 'data' &&
    dataConnectNodes(canvas, scopeWorkflowId).some((node) => node.nodeId === edge.target.workflowId);
  const targetPortDiagnostic = targetNodeExists
    ? diagnostics.find((diagnostic) => diagnostic.code === 'dangling_data_edge_target')
    : undefined;
  const transferMode = controlEdgeMainTransferMode(canvas, scopeWorkflowId, edge);
  const boundaryLabel = boundaryMainBindingLabel(edge);
  const conflictMessage = boundaryInputMainConflictMessage(canvas, scopeWorkflowId, edge);
  if (tab === 'raw') {
    return <CodeBlock title="edge.json" content={JSON.stringify(edge, null, 2)} variant="json" />;
  }
  if (tab === 'mapping') {
    const preview = isBoundaryControlEdge
      ? boundaryPreview || unavailableBoundaryTransferPreview()
      : edgeCanonicalPreview(edge, canvas);
    return (
      <CodeBlock
        title="core-v2-edge-preview.json"
        content={JSON.stringify(preview, null, 2)}
        variant="json"
      />
    );
  }
  return (
    <dl className="definition-grid compact">
      <dt>绫诲瀷</dt>
      <dd>{boundaryLabel || (edge.kind === 'data' ? 'Data Edge' : 'Control Edge')}</dd>
      <dt>上游</dt>
      <dd>
        {sourceWorkflow?.title || edge.source.workflowId}
        {'portId' in edge.source ? `.${edge.source.portId}` : ''}
      </dd>
      <dt>下游</dt>
      <dd>
        {targetWorkflow?.title || edge.target.workflowId}
        {'portId' in edge.target ? `.${edge.target.portId}` : ''}
      </dd>
      <dt>样式</dt>
      <dd>{edge.kind === 'data' ? '浅灰虚线' : '控制线'}</dd>
      {edge.kind === 'control' ? (
        <>
          <dt>数据传递</dt>
          <dd>{transferMode.label}</dd>
          <dt>传递规则</dt>
          <dd>{transferMode.reason}</dd>
        </>
      ) : null}
      {conflictMessage ? (
        <>
          <dt>输入覆盖</dt>
          <dd>{conflictMessage}</dd>
        </>
      ) : null}
      {boundaryPreview?.diagnostics.length ? (
        <>
          <dt>边界传输</dt>
          <dd>
            {boundaryTransferPreviewHasErrors(boundaryPreview) ? '配置错误' : '可预览'}
          </dd>
          <dt>边界诊断</dt>
          <dd>{boundaryPreview.diagnostics.map((diagnostic) => diagnostic.message).join('；')}</dd>
        </>
      ) : null}
      {diagnostics.length > 0 ? (
        <>
          <dt>诊断</dt>
          <dd>{diagnostics.map((diagnostic) => diagnostic.message).join('；')}</dd>
          <dt>修复建议</dt>
          <dd>
            {diagnostics.some((diagnostic) => diagnostic.code === 'dangling_data_edge_source')
              ? '更新上游 output_schema，或把这条 data edge 迁移到仍存在的输出端口。'
              : '在下游节点创建对应 input port，或把这条 data edge 迁移到已有输入端口。'}
          </dd>
        </>
      ) : null}
      {targetPortDiagnostic && edge.kind === 'data' ? (
        <>
          <dt>快速修复</dt>
          <dd>
            <button
              type="button"
              className="secondary-action-button"
              onClick={() => onCreateTargetInputPort(edge.target.workflowId, edge.target.portId)}
            >
              创建 target input port
            </button>
          </dd>
        </>
      ) : null}
    </dl>
  );
}

function InternalNodeInspector({
  canvas,
  workflow,
  node,
  tab,
  workflowRun,
  runtimeConfig,
  liveLogs,
  dataConnectionDraft,
  onReadEvidence,
  onBeginDataConnection,
  onCancelDataConnection,
  onUpdateDataConnectionMaterialization,
  onCompleteDataConnection,
  onCompleteDataConnectionWithNewInputPort,
  onAddDataConnectPort,
  onRenameDataConnectPort,
  onDeleteDataConnectPort,
  onUpdateInput,
  onUpdateLabel,
}: {
  canvas: WorkspaceCanvasModel;
  workflow: WorkflowContainerModel;
  node: InternalNodeView;
  tab: string;
  workflowRun: WorkflowRunResult | null;
  runtimeConfig: RuntimeConfig | null;
  liveLogs: Record<string, NodeLiveLogs>;
  dataConnectionDraft: DataConnectionDraft;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onBeginDataConnection: (draft: Exclude<DataConnectionDraft, null>) => void;
  onCancelDataConnection: () => void;
  onUpdateDataConnectionMaterialization: (materialization: 'copy' | 'reference') => void;
  onCompleteDataConnection: (
    targetNodeId: string,
    targetPortId: string,
    options?: { replaceExisting?: boolean },
  ) => void;
  onCompleteDataConnectionWithNewInputPort: (targetNodeId: string, requestedPortId: string) => void;
  onAddDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    requestedPortId: string,
  ) => void;
  onRenameDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
    requestedPortId: string,
  ) => void;
  onDeleteDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
  ) => void;
  onUpdateInput: (
    workflowId: string,
    nodeId: string,
    input: Record<string, unknown>,
  ) => void;
  onUpdateLabel: (workflowId: string, nodeId: string, label: string) => void;
}) {
  const nodeRun = nodeRunForInternalNode(workflowRun, workflow.id, node.id);
  const nodeLogs = nodeLiveLogsFor(liveLogs, nodeRun);
  if (tab === 'invocation') {
    return (
      <section className="inspector-stack">
        <div className="inspector-note">
          This is the invocation config for this node instance; class-level methodology remains in the resource library.
        </div>
        <InvocationIdentityCard
          scope={`Workflow: ${workflowInvocationLabel(workflow)}`}
          nodeId={node.id}
          label={internalInvocationLabel(node)}
          callableId={node.callableId || node.runtime}
          onLabelChange={(label) => onUpdateLabel(workflow.id, node.id, label)}
        />
        <InvocationInputEditor
          input={node.input || {}}
          onChange={(nextInput) => onUpdateInput(workflow.id, node.id, nextInput)}
        />
        <CodeBlock
          title="core-v2-invocation-preview.json"
          content={JSON.stringify(internalNodeInvocationPreview(node), null, 2)}
          variant="json"
        />
      </section>
    );
  }
  if (tab === 'connections') {
    return (
      <DataConnectionsPanel
        canvasNodeKind="internal"
        canvas={canvas}
        scopeWorkflowId={workflow.id}
        nodeId={node.id}
        nodeLabel={internalInvocationLabel(node)}
        callableId={node.callableId || node.runtime}
        inputPorts={internalNodeInputPorts(node)}
        outputPorts={internalNodeOutputPorts(node)}
        outputPortsReadonly
        dataConnectionDraft={dataConnectionDraft}
        onBeginDataConnection={onBeginDataConnection}
        onCancelDataConnection={onCancelDataConnection}
        onUpdateDataConnectionMaterialization={onUpdateDataConnectionMaterialization}
        onCompleteDataConnection={onCompleteDataConnection}
        onCompleteDataConnectionWithNewInputPort={onCompleteDataConnectionWithNewInputPort}
        onAddPort={onAddDataConnectPort}
        onRenamePort={onRenameDataConnectPort}
        onDeletePort={onDeleteDataConnectPort}
      />
    );
  }
  if (tab === 'input') {
    return (
      <section className="inspector-stack">
        <h4>有效输入</h4>
        <EvidencePreview
          path={nodeRun?.input_path}
          title="input.json"
          emptyText="尚未运行；当前内部节点没有真实 input.json。"
        />
        <CodeBlock
          title="用户提示词 / 静态输入"
          content={JSON.stringify(node.input || {}, null, 2)}
          variant="json"
        />
      </section>
    );
  }
  if (tab === 'output') {
    return (
      <section className="inspector-stack">
        <h4>真实输出</h4>
        <EvidencePreview
          path={nodeRun?.output_path}
          title="output.json"
          emptyText="尚未运行；当前内部节点没有真实 output.json。"
        />
      </section>
    );
  }
  if (tab === 'steps') {
    return (
      <section className="inspector-stack">
        <h4>运行步骤</h4>
        {nodeRun?.steps?.length ? (
          <ul className="inspector-step-list">
            {nodeRun.steps.map((step, index) => (
              <li key={step.event_id || `${step.type}-${index}`}>
                <strong>{step.type || 'event'}</strong>
                <span>{step.summary || step.status || ''}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">暂无事件摘要。</p>
        )}
      </section>
    );
  }
  if (tab === 'artifacts') {
    return (
      <NodeEvidencePaths
        nodeRun={nodeRun}
        liveLogs={nodeLogs}
        onReadEvidence={onReadEvidence}
      />
    );
  }
  if (tab === 'logs') {
    return (
      <section className="inspector-stack">
        <h4>日志摘要</h4>
        {nodeRun?.log_excerpt ? (
          <CodeBlock title="log excerpt" content={nodeRun.log_excerpt} variant="log" />
        ) : (
          <p className="empty-state">暂无日志摘要。</p>
        )}
        <NodeEvidencePaths nodeRun={nodeRun} liveLogs={nodeLogs} onReadEvidence={onReadEvidence} />
      </section>
    );
  }
  if (tab === 'raw') {
    return (
      <CodeBlock
        title="internal-node.json"
        content={JSON.stringify({ workflow: workflow.id, node }, null, 2)}
        variant="json"
      />
    );
  }
  return (
    <section className="inspector-stack">
      <dl className="definition-grid compact">
        <dt>节点</dt>
        <dd>{node.name}</dd>
        <dt>任务</dt>
        <dd>{node.task}</dd>
        <dt>类型</dt>
        <dd>{node.kind}</dd>
        <dt>状态</dt>
        <dd>{statusLabel(node.status)}</dd>
        <dt>callable</dt>
        <dd>{node.callableId || 'n/a'}</dd>
        <dt>runtime</dt>
        <dd>{node.runtime || 'n/a'}</dd>
      </dl>
      {nodeRun?.summary ? (
        <div className="inspector-note">{nodeRun.summary}</div>
      ) : null}
      <div className="inspector-note">
        这是工作流容器内部的调用实例；系统提示词仍由资源库 Agent Class 管理。
      </div>
      <div className="inspector-note">
        Run mode: {runtimeConfig?.real_external_agents_enabled ? 'production / real CLI' : 'hermetic or external gate disabled'}
      </div>
      <LiveLogBlocks liveLogs={nodeLogs} />
      <InvocationIdentityCard
        scope={`Workflow: ${workflowInvocationLabel(workflow)}`}
        nodeId={node.id}
        label={internalInvocationLabel(node)}
        callableId={node.callableId || node.runtime}
        onLabelChange={(label) => onUpdateLabel(workflow.id, node.id, label)}
      />
      <InvocationInputEditor
        input={node.input || {}}
        onChange={(nextInput) => onUpdateInput(workflow.id, node.id, nextInput)}
      />
      {nodeRun?.output_preview ? (
        <CodeBlock
          title="输出摘要"
          content={JSON.stringify(nodeRun.output_preview, null, 2)}
          variant="json"
        />
      ) : (
        <EvidencePreview
          path={nodeRun?.output_path}
          title="output.json"
          emptyText="尚未运行；当前内部节点没有真实 output.json。"
        />
      )}
    </section>
  );
}

function InvocationIdentityCard({
  scope,
  nodeId,
  label,
  callableId,
  workflowRef,
  onLabelChange,
}: {
  scope: string;
  nodeId: string;
  label: string;
  callableId?: string;
  workflowRef?: string;
  onLabelChange?: (label: string) => void;
}) {
  return (
    <dl className="invocation-identity-card">
      <dt>scope</dt>
      <dd>{scope}</dd>
      <dt>node_id</dt>
      <dd>{nodeId}</dd>
      <dt>invocation</dt>
      <dd>
        {onLabelChange ? (
          <input
            type="text"
            value={label}
            onChange={(event) => onLabelChange(event.target.value)}
            aria-label="Invocation label"
          />
        ) : (
          label
        )}
      </dd>
      {callableId ? (
        <>
          <dt>callable_id</dt>
          <dd>{callableId}</dd>
        </>
      ) : null}
      {workflowRef ? (
        <>
          <dt>workflow_ref</dt>
          <dd>{workflowRef}</dd>
        </>
      ) : null}
    </dl>
  );
}

function mergeInvocationInput(
  input: Record<string, unknown>,
  userPrompt: string,
  staticInput: Record<string, unknown>,
): Record<string, unknown> {
  const nextInput: Record<string, unknown> = { ...staticInput };
  if (userPrompt.trim()) {
    nextInput.user_prompt = userPrompt;
  }
  for (const key of Object.keys(input)) {
    if (key !== 'user_prompt' && key !== 'prompt' && key !== 'topic') {
      continue;
    }
    if (!userPrompt.trim()) {
      delete nextInput[key];
    }
  }
  return nextInput;
}

function InvocationInputEditor({
  input,
  onChange,
}: {
  input: Record<string, unknown>;
  onChange: (input: Record<string, unknown>) => void;
}) {
  const [jsonText, setJsonText] = useState(() => JSON.stringify(staticInputFromInvocationInput(input), null, 2));
  const [error, setError] = useState('');
  const [lastSavedInput, setLastSavedInput] = useState(input);
  useEffect(() => {
    setJsonText(JSON.stringify(staticInputFromInvocationInput(input), null, 2));
    setLastSavedInput(input);
    setError('');
  }, [input]);

  function updatePrompt(value: string) {
    onChange(mergeInvocationInput(input, value, staticInputFromInvocationInput(input)));
  }

  function updateJson(value: string) {
    setJsonText(value);
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        setError('');
        onChange(mergeInvocationInput(input, promptFromInvocationInput(input), parsed as Record<string, unknown>));
        return;
      }
      setError('JSON 必须是对象；当前修改不会提交。');
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
    }
  }

  function clearPrompt() {
    updatePrompt('');
  }

  function resetInput() {
    setJsonText(JSON.stringify(staticInputFromInvocationInput(lastSavedInput), null, 2));
    setError('');
    onChange(lastSavedInput);
  }

  function formatJson() {
    try {
      const parsed = JSON.parse(jsonText);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        setJsonText(JSON.stringify(parsed, null, 2));
        setError('');
        return;
      }
      setError('JSON 必须是对象；当前修改不会提交。');
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
    }
  }

  return (
    <section className="invocation-input-editor" aria-label="Invocation 配置">
      <label>
        User Prompt
        <textarea
          aria-label="User Prompt"
          rows={5}
          value={promptFromInvocationInput(input)}
          onChange={(event) => updatePrompt(event.target.value)}
          placeholder="本节点实例的任务说明"
        />
      </label>
      <div className="inline-action-row">
        <button type="button" className="secondary-action compact-action" onClick={clearPrompt}>
          娓呯┖ User Prompt
        </button>
        <button type="button" className="secondary-action compact-action" onClick={resetInput}>
          重置为当前值
        </button>
      </div>
      <label>
        Static Input JSON
        <textarea aria-label="Static Input JSON" rows={7} value={jsonText} onChange={(event) => updateJson(event.target.value)} />
      </label>
      <div className="inline-action-row">
        <button type="button" className="secondary-action compact-action" onClick={formatJson}>
          格式化 JSON
        </button>
      </div>
      {error ? <p className="notice compact-notice">{error}</p> : null}
    </section>
  );
}

function EvidencePreview({
  path,
  title,
  emptyText,
}: {
  path?: string | null;
  title: string;
  emptyText: string;
}) {
  const [state, setState] = useState<{ status: 'empty' | 'loading' | 'loaded' | 'error'; content: string; type: ArtifactContent['type'] }>({
    status: path ? 'loading' : 'empty',
    content: '',
    type: 'text',
  });

  useEffect(() => {
    let ignore = false;
    if (!path) {
      setState({ status: 'empty', content: '', type: 'text' });
      return () => {
        ignore = true;
      };
    }
    setState({ status: 'loading', content: '', type: 'text' });
    api
      .artifact(path)
      .then((artifact) => {
        if (!ignore) {
          setState({ status: 'loaded', content: artifact.content, type: artifact.type });
        }
      })
      .catch((error) => {
        if (!ignore) {
          setState({
            status: 'error',
            content: error instanceof Error ? error.message : String(error),
            type: 'log',
          });
        }
      });
    return () => {
      ignore = true;
    };
  }, [path]);

  if (state.status === 'empty') {
    return <p className="empty-state">{emptyText}</p>;
  }
  if (state.status === 'loading') {
    return <p className="empty-state">正在读取 {shortPath(path)}...</p>;
  }
  return (
    <CodeBlock
      title={`${title}${path ? ` - ${shortPath(path)}` : ''}`}
      content={state.content}
      variant={state.type}
    />
  );
}

function RunEvidenceCard({
  nodeRun,
  liveLogs,
  runtimeConfig,
  onReadEvidence,
}: {
  nodeRun?: NodeRunSummary;
  liveLogs?: NodeLiveLogs;
  runtimeConfig: RuntimeConfig | null;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
}) {
  const inputPorts = inputPortsFromRun(nodeRun);
  const transferRows = transferRowsFromRun(nodeRun);
  const outputSummary = outputSummaryFromRun(nodeRun);
  const latestLog = latestLogExcerpt(liveLogs, nodeRun);
  const logPath = nodeRun?.stderr_log || nodeRun?.stdout_log;

  if (!nodeRun) {
    return (
      <div className="run-evidence-card empty">
        <p className="empty-state">尚未运行；运行后这里会显示真实输入、输出、绑定来源和日志入口。</p>
      </div>
    );
  }

  return (
    <div className="run-evidence-card" aria-label="运行证据">
      <div className="run-evidence-facts" aria-label="运行证据摘要">
        <EvidenceFact label="状态" value={statusLabel(nodeRun.status)} tone={nodeRun.status} />
        <EvidenceFact label="Run mode" value={runtimeLabel(runtimeConfig, nodeRun)} />
        <EvidenceFact label="收到输入端口" value={inputPorts.length ? inputPorts.join(', ') : '未记录'} />
      </div>

      <section className="evidence-flow-summary" aria-label="数据流证据">
        <h5>数据流</h5>
        {transferRows.length > 0 ? (
          <div className="evidence-flow-list">
            {transferRows.map((row) => (
              <article key={row.key} className="evidence-flow-row">
                <strong>{row.label}</strong>
                <span>{row.detail}</span>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">没有记录到输入绑定；该节点可能只按控制顺序运行。</p>
        )}
      </section>

      <div className="run-evidence-actions">
        <EvidenceAction
          label="真实输入"
          meta="input.json"
          path={nodeRun.input_path}
          onOpen={() => onReadEvidence(nodeRun.input_path, '真实输入')}
        />
        <EvidenceAction
          label="真实输出"
          meta="output.json"
          path={nodeRun.output_path}
          onOpen={() => onReadEvidence(nodeRun.output_path, '真实输出')}
        />
        <EvidenceAction
          label="运行日志"
          meta={nodeRun.stderr_log ? 'stderr.log' : 'stdout.log'}
          path={logPath}
          onOpen={() => onReadEvidence(logPath, '运行日志')}
        />
      </div>

      <section className="evidence-inline-summary" aria-label="运行证据预览">
        <h5>输出摘要</h5>
        <p>{outputSummary}</p>
        {latestLog ? (
          <>
            <h5>最近日志</h5>
            <pre>{latestLog}</pre>
          </>
        ) : null}
      </section>
    </div>
  );
}

function WorkflowMainInputBindingNotice({
  binding,
  nodeRun,
}: {
  binding?: WorkflowMainInputBindingState;
  nodeRun?: NodeRunSummary;
}) {
  if (!binding) {
    return null;
  }
  if (binding.status === 'unbound') {
    return <p className="muted workflow-binding-notice">当前节点没有 Workflow main 输入绑定。</p>;
  }
  const bindingLabel = `${binding.workflowId}.main -> ${binding.nodeId}.${binding.targetPort}`;
  const runHasWorkflowInput = nodeRunHasWorkflowInputBinding(nodeRun);
  if (!nodeRun) {
    return (
      <p className="muted workflow-binding-notice">
        当前画布绑定：{bindingLabel}。尚未运行，运行后会在 binding_manifest.json 中记录 workflow_input。
      </p>
    );
  }
  if (runHasWorkflowInput) {
    return (
      <p className="muted workflow-binding-notice">
        当前画布绑定：{bindingLabel}；本次运行证据已记录 workflow_input。
      </p>
    );
  }
  return (
    <p className="notice compact-notice workflow-binding-notice">
      当前画布已连接 Workflow main 输入，但本次运行没有对应 workflow_input 证据，可能发生在连接保存/发布前。请重新运行以生成新的运行证据。
    </p>
  );
}

function nodeRunHasWorkflowInputBinding(nodeRun?: NodeRunSummary): boolean {
  return bindingRecordsFromRun(nodeRun).some((binding) => {
    const bindingKind = stringValue(binding.binding_kind) || stringValue(binding.kind);
    return bindingKind === 'workflow_input';
  });
}

function EvidenceFact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={tone ? `evidence-fact tone-${tone}` : 'evidence-fact'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EvidenceAction({
  label,
  meta,
  path,
  onOpen,
}: {
  label: string;
  meta: string;
  path?: string | null;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="path-button evidence-path-button" disabled={!path} onClick={onOpen}>
      <FileText aria-hidden="true" size={16} />
      <span>{label}</span>
      <em>{meta}</em>
      <small>{shortPath(path)}</small>
    </button>
  );
}

type EvidenceFlowRow = {
  key: string;
  label: string;
  detail: string;
};

function inputPortsFromRun(nodeRun?: NodeRunSummary): string[] {
  const inputs = arrayOfStrings(nodeRun?.binding_manifest?.inputs);
  if (inputs.length > 0) {
    return inputs;
  }
  const bindings = bindingRecordsFromRun(nodeRun);
  const ports = bindings
    .map((binding) => stringValue(binding.target_port))
    .filter((port): port is string => Boolean(port));
  return [...new Set(ports)];
}

function transferRowsFromRun(nodeRun?: NodeRunSummary): EvidenceFlowRow[] {
  const bindings = bindingRecordsFromRun(nodeRun);
  return bindings.map((binding, index) => {
    const bindingKind = stringValue(binding.binding_kind) || stringValue(binding.kind) || 'binding';
    const sourceNode = stringValue(binding.source_node) || 'upstream';
    const sourcePort = stringValue(binding.source_port) || 'main';
    const targetPort = stringValue(binding.target_port) || 'main';
    if (bindingKind === 'control_main_default') {
      return {
        key: `${bindingKind}-${sourceNode}-${targetPort}-${index}`,
        label: '\u63a7\u5236\u7ebf main \u4f20\u8f93',
        detail: `${sourceNode}.${sourcePort} -> ${targetPort}`,
      };
    }
    if (bindingKind === 'control_main_aggregate') {
      const order = arrayOfStrings(binding.aggregate_order);
      return {
        key: `${bindingKind}-${targetPort}-${index}`,
        label: '\u63a7\u5236\u7ebf main \u805a\u5408',
        detail: order.length > 0 ? `${order.join(' + ')} -> ${targetPort}` : `multiple sources -> ${targetPort}`,
      };
    }
    return {
      key: `${bindingKind}-${sourceNode}-${targetPort}-${index}`,
      label: bindingKind,
      detail: `${sourceNode}.${sourcePort} -> ${targetPort}`,
    };
  });
}

function bindingRecordsFromRun(nodeRun?: NodeRunSummary): Array<Record<string, unknown>> {
  const manifestBindings = arrayOfRecords(nodeRun?.binding_manifest?.bindings);
  if (manifestBindings.length > 0) {
    return manifestBindings;
  }
  return arrayOfRecords(nodeRun?.binding_resolved);
}

function outputSummaryFromRun(nodeRun?: NodeRunSummary): string {
  if (!nodeRun) {
    return '尚未运行。';
  }
  const preview = nodeRun.output_preview;
  if (isRecordValue(preview)) {
    const status = stringValue(preview.status);
    const summary = stringValue(preview.summary);
    const outputKeys = isRecordValue(preview.outputs) ? Object.keys(preview.outputs) : [];
    const topLevelKeys = Object.keys(preview).filter(
      (key) => key !== 'status' && key !== 'summary' && key !== 'outputs',
    );
    const parts = [
      status ? `status=${status}` : '',
      summary ? `summary=${summary}` : '',
      outputKeys.length ? `outputs=${outputKeys.join(', ')}` : '',
      !outputKeys.length && topLevelKeys.length ? `fields=${topLevelKeys.join(', ')}` : '',
    ].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' / ');
    }
  }
  if (nodeRun.summary) {
    return nodeRun.summary;
  }
  return nodeRun.output_path ? '已产生 output.json，点击“真实输出”查看完整内容。' : '没有记录到 output.json。';
}


function runtimeLabel(runtimeConfig: RuntimeConfig | null, nodeRun?: NodeRunSummary): string {
  if (runtimeConfig) {
    return runtimeConfig.real_external_agents_enabled ? 'production / real CLI' : 'hermetic or gated';
  }
  if (nodeRun?.execution_mode || nodeRun?.adapter) {
    return [nodeRun.execution_mode, nodeRun.adapter].filter(Boolean).join(' / ');
  }
  return '未记录';
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecordValue) : [];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function NodeEvidencePaths({
  nodeRun,
  liveLogs,
  onReadEvidence,
}: {
  nodeRun?: NodeRunSummary;
  liveLogs?: NodeLiveLogs;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
}) {
  const runtimeEvidence =
    nodeRun?.runtime ||
    (nodeRun?.execution_mode || nodeRun?.adapter
      ? { execution_mode: nodeRun.execution_mode, adapter: nodeRun.adapter }
      : null);
  const bindingEvidence =
    nodeRun?.binding_resolved?.length || nodeRun?.binding_manifest
      ? {
          binding_resolved: nodeRun?.binding_resolved || [],
          binding_manifest: nodeRun?.binding_manifest || null,
        }
      : null;
  const paths = [
    ['输入', nodeRun?.input_path],
    ['提示词', nodeRun?.prompt_path],
    ['输出', nodeRun?.output_path],
    ['事件', nodeRun?.event_log],
    ['stdout', nodeRun?.stdout_log],
    ['stderr', nodeRun?.stderr_log],
  ] as const;
  return (
    <section className="inspector-stack">
      <LiveLogBlocks liveLogs={liveLogs} />
      {paths.map(([label, pathValue]) => (
        <button
          key={label}
          type="button"
          className="path-button"
          disabled={!pathValue}
          onClick={() => onReadEvidence(pathValue, label)}
        >
          <FileText aria-hidden="true" size={16} />
          <span>{label}</span>
          <small>{shortPath(pathValue)}</small>
        </button>
      ))}
      <dl className="definition-grid compact">
        <dt>artifacts</dt>
        <dd>{nodeRun?.artifact_dir ? shortPath(nodeRun.artifact_dir) : '尚未运行'}</dd>
      </dl>
      {runtimeEvidence ? (
        <CodeBlock
          title="runtime.json"
          content={JSON.stringify(runtimeEvidence, null, 2)}
          variant="json"
        />
      ) : null}
      {bindingEvidence ? (
        <CodeBlock
          title="data-binding-evidence.json"
          content={JSON.stringify(bindingEvidence, null, 2)}
          variant="json"
        />
      ) : null}
    </section>
  );
}

function LiveLogBlocks({ liveLogs }: { liveLogs?: NodeLiveLogs }) {
  if (!liveLogs || (!liveLogs.stdout && !liveLogs.stderr)) {
    return null;
  }
  return (
    <>
      {liveLogs.stdout ? (
        <CodeBlock title="Live stdout" content={liveLogs.stdout} variant="log" />
      ) : null}
      {liveLogs.stderr ? (
        <CodeBlock title="Live stderr" content={liveLogs.stderr} variant="log" />
      ) : null}
    </>
  );
}

function PortList({ title, ports }: { title: string; ports: WorkflowPortView[] }) {
  return (
    <section className="inspector-stack">
      <h4>{title}</h4>
      {ports.map((port) => (
        <article key={port.id} className="port-contract-row">
          <strong>{port.id}</strong>
          <span>{port.label}</span>
          <small>
            {port.required ? 'required' : 'optional'} / {port.cardinality || 'one'}
          </small>
        </article>
      ))}
    </section>
  );
}

function WorkflowBindingDialog({
  workflowId,
  binding,
  onClose,
  onValidate,
  onSave,
  onOpenFolder,
  onSelectDirectory,
}: {
  workflowId: string;
  binding?: WorkflowBindingView;
  onClose: () => void;
  onValidate: (workflowId: string, workspaceRoot: string) => Promise<WorkflowBindingView>;
  onSave: (workflowId: string, workspaceRoot: string) => Promise<WorkflowBindingView>;
  onOpenFolder: (workflowId: string) => Promise<void>;
  onSelectDirectory: (
    workflowId: string,
    initialDir: string,
  ) => Promise<WorkflowDirectorySelection>;
}) {
  const [workspaceRoot, setWorkspaceRoot] = useState(workspaceRootOf(binding) || '');
  const [message, setMessage] = useState(binding?.status || 'unbound');
  const [selectingDirectory, setSelectingDirectory] = useState(false);
  useEffect(() => {
    setWorkspaceRoot(workspaceRootOf(binding) || '');
    setMessage(binding?.status || 'unbound');
    setSelectingDirectory(false);
  }, [workflowId, binding]);

  async function validate() {
    const result = await onValidate(workflowId, workspaceRoot);
    setMessage(result.error || result.status);
  }

  async function save() {
    const result = await onSave(workflowId, workspaceRoot);
    setMessage(result.error || result.status);
  }

  async function selectDirectory() {
    setSelectingDirectory(true);
    try {
      const result = await onSelectDirectory(workflowId, workspaceRoot);
      if (result.status === 'selected' && result.valid) {
        const selectedPath = result.workspace_root || result.workspaceRoot || '';
        setWorkspaceRoot(selectedPath);
        setMessage('selected');
        return;
      }
      if (result.status === 'cancelled') {
        setMessage('cancelled');
        return;
      }
      setMessage(result.error || result.status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'directory picker failed');
    } finally {
      setSelectingDirectory(false);
    }
  }

  return (
    <div className="binding-dialog" role="dialog" aria-label="配置工作目录">
      <div className="binding-dialog-panel">
        <header>
          <div>
            <span className="topbar-kicker">Workspace Binding</span>
            <h3>{workflowId}</h3>
          </div>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </header>
        <label>
          workspace_root
          <input
            aria-label="workspace_root"
            value={workspaceRoot}
            onChange={(event) => setWorkspaceRoot(event.target.value)}
            placeholder="F:\\Agent-Callable-Conductor\\WorkFlowTest\\paper1"
          />
        </label>
        <dl className="definition-grid compact">
          <dt>状态</dt>
          <dd>{message}</dd>
          <dt>binding</dt>
          <dd>{bindingPathOf(binding) || `bindings/${workflowId}.binding.local.json`}</dd>
        </dl>
        <div className="toolbar-actions">
          <button type="button" onClick={selectDirectory} disabled={selectingDirectory}>
            {selectingDirectory ? '选择中...' : '选择文件夹'}
          </button>
          <button type="button" onClick={validate}>
            校验目录
          </button>
          <button type="button" className="primary-action" onClick={save}>
            保存绑定
          </button>
          <button type="button" onClick={() => void onOpenFolder(workflowId)}>
            打开 bindings 目录
          </button>
        </div>
      </div>
    </div>
  );
}

function EventTimeline({ events, title }: { events: RunEvent[]; title: string }) {
  const visibleEvents = events.slice(-12).reverse();
  return (
    <section className="event-timeline" aria-label={title}>
      <h3>{title}</h3>
      {visibleEvents.length === 0 ? <p className="muted">鏆傛棤浜嬩欢</p> : null}
      {visibleEvents.map((event, index) => (
        <article key={String(event.event_id || `${event.type}-${index}`)} className="event-row">
          <strong>{String(event.type || event.event || 'event')}</strong>
          <span>{event.node_id ? `node=${event.node_id}` : ''}</span>
          <small>{String(event.status || '')}</small>
          <small>{event.timestamp}</small>
        </article>
      ))}
    </section>
  );
}

function reconcileFlowNodes(
  current: CanvasFlowNode[],
  projected: CanvasFlowNode[],
  options: { preservePositions: boolean },
): CanvasFlowNode[] {
  if (!options.preservePositions) {
    return projected;
  }
  const currentById = new Map(current.map((node) => [node.id, node]));
  return projected.map((node) => {
    const existing = currentById.get(node.id);
    if (!existing) {
      return node;
    }
    return {
      ...node,
      position: existing.position,
      dragging: existing.dragging,
      measured: existing.measured ?? node.measured,
      width: existing.width ?? node.width,
      height: existing.height ?? node.height,
    };
  }) as CanvasFlowNode[];
}

function flowNodeIdentityKey(nodes: CanvasFlowNode[]): string {
  return nodes
    .map((node) => `${node.id}:${node.type || ''}:${node.parentId || ''}`)
    .sort()
    .join('|');
}

function flowNodeLayoutKey(nodes: CanvasFlowNode[]): string {
  return nodes
    .map((node) => {
      const size = flowNodeSize(node);
      return `${node.id}:${Math.round(node.position.x)}:${Math.round(node.position.y)}:${size.width}:${size.height}`;
    })
    .sort()
    .join('|');
}

function flowNodeSize(node: CanvasFlowNode): { width: number | string; height: number | string } {
  if (node.type === 'workflowContainer') {
    return {
      width: node.data.workflow.size.width,
      height: node.data.workflow.size.height,
    };
  }
  return {
    width: node.width ?? node.measured?.width ?? '',
    height: node.height ?? node.measured?.height ?? '',
  };
}

function dragCommitKey(node: CanvasFlowNode): string {
  return `${node.id}:${node.parentId || ''}:${Math.round(node.position.x)}:${Math.round(node.position.y)}`;
}

function toFlowNodes(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
  bindings: Record<string, WorkflowBindingView>,
  onSelectWorkflowFn: (workflowId: string) => void,
  onSelectPortFn: (workflowId: string, port: WorkflowPortView) => void,
  onSelectInternalFn: (workflowId: string, nodeId: string) => void,
  onOpenNodeDetails: (selection: CanvasSelection) => void,
  onOpenFocus: (workflowId: string) => void,
  onConfigureWorkflow: (workflowId: string) => void,
  showDataPorts: boolean,
  showAgentDataPorts: boolean,
  showDataPortLabels: boolean,
  onResize: (workflowId: string, size: { width: number; height: number }) => void,
  onMoveInternal: (
    workflowId: string,
    nodeId: string,
    position: { x: number; y: number },
  ) => void,
  onControlHandleMouseDown: (
    nodeId: string,
    handleId: string,
    side: EndpointSide,
    mode?: ConnectionMode,
  ) => void,
  connectionMode: ConnectionMode,
  edgeViewMode: EdgeViewMode,
  dataDropTargetPreview: DataDropTargetPreview | null,
  onSelectEdge: (address: EdgeAddress, altKey?: boolean) => void,
): CanvasFlowNode[] {
  return canvas.workflows.flatMap((workflow) => {
    if (isExecutableNodeWorkflow(workflow)) {
      return [
        topLevelAgentToolFlowNode(
          workflow,
          selection,
          showAgentDataPorts,
          showDataPortLabels,
          onSelectWorkflowFn,
          onSelectPortFn,
          onControlHandleMouseDown,
          dataDropTargetPreview,
        ),
      ];
    }
    const workflowNode: WorkflowFlowNode = {
      id: workflow.id,
      type: 'workflowContainer',
      position: workflow.position,
      selected: selection.type === 'workflow' && selection.id === workflow.id,
      zIndex: WORKFLOW_CONTAINER_Z_INDEX,
      data: {
        workflow,
        binding: bindings[workflow.id],
        selection,
        connectionMode,
        edgeViewMode,
        selected: selection.type === 'workflow' && selection.id === workflow.id,
        dataDropHint:
          dataDropTargetPreview?.flowNodeId === workflow.id
            ? `释放后创建输入端口：${dataDropTargetPreview.portId}`
            : undefined,
        showDataPorts,
        showDataPortLabels,
        onSelectEdge,
        onSelectPort: onSelectPortFn,
        onSelectInternal: onSelectInternalFn,
        onOpenNodeDetails,
        onOpenFocus,
        onConfigureWorkflow,
        onResize,
        onMoveInternal,
        onControlHandleMouseDown,
      },
    };
    const internalNodes = workflow.internalNodes.map((node, index): AgentToolFlowNode => {
      const inputPorts = internalNodeInputPorts(node);
      const outputPorts = internalNodeOutputPorts(node);
      const selected =
        selection.type === 'internal' &&
        selection.workflowId === workflow.id &&
        selection.nodeId === node.id;
      return {
        id: internalFlowNodeId(workflow.id, node.id),
        type: 'agentToolNode',
        parentId: workflow.id,
        extent: 'parent',
        position: node.position || defaultInternalNodePosition(index),
        selected,
        zIndex: selected ? WORKFLOW_INTERNAL_SELECTED_NODE_Z_INDEX : WORKFLOW_INTERNAL_NODE_Z_INDEX,
        data: {
          id: internalFlowNodeId(workflow.id, node.id),
          title: internalInvocationLabel(node),
          subtitle: node.callableId || node.runtime,
          scopeLabel: `Inside: ${workflowInvocationLabel(workflow)}`,
          kind: node.kind,
          status: node.status,
          callableId: node.callableId || node.runtime,
          temporaryResourceId: node.temporaryResourceId,
          workflowId: workflow.id,
          internalNodeId: node.id,
          inputPorts,
          outputPorts,
          size: agentToolNodeSize(inputPorts, outputPorts, showAgentDataPorts),
          selected,
          dataDropHint:
            dataDropTargetPreview?.flowNodeId === internalFlowNodeId(workflow.id, node.id)
              ? `释放后创建输入端口：${dataDropTargetPreview.portId}`
              : undefined,
          showDataPorts: showAgentDataPorts,
          showDataPortLabels,
          onSelect: () => onSelectInternalFn(workflow.id, node.id),
          onSelectPort: onSelectPortFn,
          onControlHandleMouseDown,
        },
      };
    });
    return [workflowNode, ...internalNodes];
  });
}

function topLevelAgentToolFlowNode(
  workflow: WorkflowContainerModel,
  selection: CanvasSelection,
  showDataPorts: boolean,
  showDataPortLabels: boolean,
  onSelectWorkflowFn: (workflowId: string) => void,
  onSelectPortFn: (workflowId: string, port: WorkflowPortView) => void,
  onControlHandleMouseDown: (
    nodeId: string,
    handleId: string,
    side: EndpointSide,
    mode?: ConnectionMode,
  ) => void,
  dataDropTargetPreview: DataDropTargetPreview | null,
): AgentToolFlowNode {
  const kind = workflow.sourceKind === 'tool' ? 'Tool' : 'Agent';
  const inputPorts = workflow.inputPorts;
  const outputPorts = workflowOutputPorts(workflow);
  return {
    id: workflow.id,
    type: 'agentToolNode',
    position: workflow.position,
    selected: selection.type === 'workflow' && selection.id === workflow.id,
    data: {
      id: workflow.id,
      title: workflowInvocationLabel(workflow),
      subtitle: workflow.callableId,
      kind,
      status: workflow.status,
      callableId: workflow.callableId,
      temporaryResourceId: workflow.temporaryResourceId,
      inputPorts,
      outputPorts,
      size: agentToolNodeSize(inputPorts, outputPorts, showDataPorts),
      selected: selection.type === 'workflow' && selection.id === workflow.id,
      dataDropHint:
        dataDropTargetPreview?.flowNodeId === workflow.id
          ? `释放后创建输入端口：${dataDropTargetPreview.portId}`
          : undefined,
      showDataPorts,
      showDataPortLabels,
      onSelect: () => onSelectWorkflowFn(workflow.id),
      onSelectPort: onSelectPortFn,
      onControlHandleMouseDown,
    },
  };
}

function agentToolNodeSize(
  inputPorts: WorkflowPortView[],
  outputPorts: WorkflowPortView[],
  showDataPorts: boolean,
): { width: number; height: number } {
  if (!showDataPorts) {
    return AGENT_TOOL_NODE_SIZE;
  }
  const visiblePortCount = Math.max(
    Math.min(inputPorts.length, AGENT_MAX_DATA_PORTS),
    Math.min(outputPorts.length, AGENT_MAX_DATA_PORTS),
  );
  const requiredHeight =
    visiblePortCount > 0
      ? (agentDataPortMaxOffset(visiblePortCount) + AGENT_PORT_VERTICAL_PADDING) * 2
      : AGENT_TOOL_NODE_SIZE.height;
  return {
    width: AGENT_TOOL_NODE_SIZE.width,
    height: Math.max(AGENT_TOOL_NODE_SIZE.height, requiredHeight),
  };
}

function recordConnectionTrace(event: string, detail: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') {
    return;
  }
  const entry = { event, detail, timestamp: Date.now() };
  try {
    const diagnosticsWindow = window as Window & {
      __ACC_CONNECTION_TRACE__?: ConnectionTraceEvent[];
    };
    const trace = diagnosticsWindow.__ACC_CONNECTION_TRACE__ || [];
    trace.push(entry);
    diagnosticsWindow.__ACC_CONNECTION_TRACE__ = trace.slice(-80);
  } catch {
    // Some browser automation sandboxes expose a non-extensible window proxy.
  }
  if (window.localStorage?.getItem('acc.connection.trace') === '1') {
    console.info('[acc-connection]', event, detail);
  }
}

function domConnectionEndpointAtPoint(
  point: { x: number; y: number },
  mode: ConnectionMode,
): DomConnectionEndpoint | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const stack =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(point.x, point.y)
      : [document.elementFromPoint(point.x, point.y)].filter(Boolean) as Element[];
  for (const element of stack) {
    const endpoint = domConnectionEndpointFromElement(element, mode);
    if (endpoint) {
      return endpoint;
    }
  }
  const direct = domConnectionEndpointFromElement(document.elementFromPoint(point.x, point.y), mode);
  if (direct) {
    return direct;
  }
  const handles = Array.from(document.querySelectorAll<HTMLElement>(connectionHandleSelector(mode)));
  let best: { endpoint: DomConnectionEndpoint; distance: number } | null = null;
  for (const handle of handles) {
    const endpoint = domConnectionEndpointFromElement(handle, mode);
    if (!endpoint) {
      continue;
    }
    const rect = handle.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.hypot(centerX - point.x, centerY - point.y);
    const insideExpandedRect =
      point.x >= rect.left - 12 &&
      point.x <= rect.right + 12 &&
      point.y >= rect.top - 12 &&
      point.y <= rect.bottom + 12;
    if (!insideExpandedRect && distance > 18) {
      continue;
    }
    if (!best || distance < best.distance) {
      best = { endpoint, distance };
    }
  }
  return best?.endpoint || null;
}

function domConnectionEndpointFromElement(
  element: Element | null,
  mode?: ConnectionMode,
): DomConnectionEndpoint | null {
  const handle = closestConnectionHandle(element);
  if (!(handle instanceof HTMLElement)) {
    return null;
  }
  if (mode && !isConnectionHandleForMode(handle, mode)) {
    return null;
  }
  const nodeId = handle.getAttribute('data-nodeid');
  if (!nodeId) {
    return null;
  }
  const side = connectionSideFromHandleElement(handle);
  if (!side) {
    return null;
  }
  return {
    nodeId,
    handleId: handle.getAttribute('data-handleid'),
    side,
  };
}

function domFlowNodeIdAtPoint(
  point: { x: number; y: number },
  elementOverride?: Element | null,
): string | null {
  const overrideId = flowNodeIdFromElement(elementOverride);
  if (overrideId) {
    return overrideId;
  }
  if (typeof document === 'undefined') {
    return null;
  }
  const stack =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(point.x, point.y)
      : ([document.elementFromPoint(point.x, point.y)].filter(Boolean) as Element[]);
  for (const element of stack) {
    const flowNodeId = flowNodeIdFromElement(element);
    if (flowNodeId) {
      return flowNodeId;
    }
  }
  return flowNodeIdFromElement(document.elementFromPoint(point.x, point.y));
}

function flowNodeIdFromElement(element: Element | null | undefined): string | null {
  const node = element?.closest?.('.react-flow__node');
  if (!(node instanceof HTMLElement)) {
    return null;
  }
  return (
    node.getAttribute('data-id') ||
    node.getAttribute('data-nodeid') ||
    node.id ||
    null
  );
}

function connectionHandleElementForEndpoint(endpoint: DomConnectionEndpoint): HTMLElement | null {
  return endpoint.handleId ? elementByDataHandleId(endpoint.handleId, endpoint.nodeId) : null;
}

function connectionHandleSelector(mode?: ConnectionMode): string {
  if (mode === 'control') {
    return '.acc-connect-hitbox, .workflow-control-handle, .agent-control-handle';
  }
  if (mode === 'data') {
    return '.workflow-port-handle';
  }
  return '.acc-connect-hitbox, .workflow-control-handle, .agent-control-handle, .workflow-port-handle, .react-flow__handle';
}

function closestConnectionHandle(element: Element | null): HTMLElement | null {
  const handle = element?.closest?.(connectionHandleSelector());
  return handle instanceof HTMLElement ? handle : null;
}

function isConnectionHandleForMode(handle: HTMLElement, mode: ConnectionMode): boolean {
  if (mode === 'control') {
    return (
      handle.classList.contains('acc-connect-hitbox') ||
      handle.classList.contains('workflow-control-handle') ||
      handle.classList.contains('agent-control-handle')
    );
  }
  return handle.classList.contains('workflow-port-handle');
}

function connectionModeForHandleElement(handle: HTMLElement): ConnectionMode | null {
  if (
    handle.classList.contains('acc-connect-hitbox') ||
    handle.classList.contains('workflow-control-handle') ||
    handle.classList.contains('agent-control-handle')
  ) {
    return 'control';
  }
  if (handle.classList.contains('workflow-port-handle')) {
    return 'data';
  }
  return null;
}

function connectionSideFromHandleElement(handle: HTMLElement): EndpointSide | null {
  const handleId = handle.getAttribute('data-handleid') || '';
  if (handleId.endsWith(':control:source') || handleId.includes('workflow-input-inner-source') || handleId.includes('workflow-output-outer-source')) {
    return 'source';
  }
  if (handleId.endsWith(':control:target') || handleId.includes('workflow-input-outer-target') || handleId.includes('workflow-output-inner-target')) {
    return 'target';
  }
  if (handle.classList.contains('source')) {
    return 'source';
  }
  if (handle.classList.contains('target')) {
    return 'target';
  }
  return null;
}

function queueControlHandleConnectionStart(
  target: EventTarget | null,
  onControlHandleMouseDown: (
    nodeId: string,
    handleId: string,
    side: EndpointSide,
    mode?: ConnectionMode,
  ) => void,
  mode: ConnectionMode = 'control',
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const handle = closestConnectionHandle(target);
  if (!(handle instanceof HTMLElement)) {
    return false;
  }
  if (!isConnectionHandleForMode(handle, mode)) {
    return false;
  }
  const nodeId = handle.getAttribute('data-nodeid');
  const handleId = handle.getAttribute('data-handleid');
  const side = connectionSideFromHandleElement(handle);
  if (!nodeId || !handleId || !side) {
    return false;
  }
  onControlHandleMouseDown(nodeId, handleId, side, mode);
  return true;
}

function reusableWorkflowClassGraph(graph: WorkflowGraph): WorkflowGraph {
  const metadata = omitEmptyRecord(
    omitKeys(
      {
        canonical_format: 'accflow',
        ...(graph.metadata || {}),
      },
      ['binding_ref'],
    ),
  );
  return {
    ...graph,
    nodes: graph.nodes.map(reusableWorkflowClassNode),
    workspace_policy: {
      ...(graph.workspace_policy || {}),
      save_mode: 'stateless_template',
      default_state_mode: 'stateless',
    },
    metadata,
  };
}

function reusableWorkflowClassNode(node: WorkflowGraphNode): WorkflowGraphNode {
  const ui = node.ui
    ? omitEmptyRecord(sanitizeWorkflowClassNodeUi(omitKeys(node.ui, ['binding_ref'])))
    : undefined;
  const nextNode: WorkflowGraphNode = {
    ...node,
    cwd_policy: 'inherit_environment',
    relative_cwd: undefined,
    ui,
  };
  if (!nextNode.ui) {
    delete nextNode.ui;
  }
  delete nextNode.relative_cwd;
  return nextNode;
}

function sanitizeWorkflowClassNodeUi(ui: Record<string, unknown>): Record<string, unknown> {
  const nextUi = { ...ui };
  if (Array.isArray(nextUi.internal_nodes)) {
    nextUi.internal_nodes = nextUi.internal_nodes.map((node) =>
      isRecord(node) ? omitKeys(node, ['status', 'runId', 'sessionId', 'event_log', 'output_path']) : node,
    );
  }
  return nextUi;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function omitKeys<T extends Record<string, unknown>>(record: T, keys: string[]): Record<string, unknown> {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !blocked.has(key)));
}

function omitEmptyRecord<T extends Record<string, unknown>>(record: T): T | undefined {
  return Object.keys(record).length ? record : undefined;
}

async function loadWorkbenchTaskFromBackend(taskRecord: Record<string, unknown>): Promise<WorkbenchTask | null> {
  const taskId = typeof taskRecord.task_id === 'string' ? taskRecord.task_id : '';
  if (!taskId) {
    return null;
  }
  let canvasRecord: Record<string, unknown> | null = null;
  try {
    canvasRecord = await api.getWorkbenchTaskCanvas(taskId);
  } catch {
    canvasRecord = null;
  }
  const canvas = canvasFromBackendSnapshot(taskId, taskRecord, canvasRecord);
  if (!canvas) {
    return null;
  }
  return {
    taskId,
    title: typeof taskRecord.title === 'string' ? taskRecord.title : canvas.name,
    canvas,
    authoring: normalizeWorkbenchAuthoringState({
      temporaryResources:
        canvasRecord && isRecord(canvasRecord.temporary_resources)
          ? canvasRecord.temporary_resources
          : {},
    }),
    savedWorkflowRef:
      typeof taskRecord.saved_workflow_ref === 'string' ? taskRecord.saved_workflow_ref : undefined,
    activeRunId: typeof taskRecord.active_run_id === 'string' ? taskRecord.active_run_id : undefined,
    latestRunId: typeof taskRecord.latest_run_id === 'string' ? taskRecord.latest_run_id : undefined,
    status: 'not_run',
  };
}

function canvasFromBackendSnapshot(
  taskId: string,
  taskRecord: Record<string, unknown>,
  canvasRecord: Record<string, unknown> | null,
): WorkspaceCanvasModel | null {
  const snapshot = canvasRecord?.canvas_snapshot;
  if (!isRecord(snapshot)) {
    return emptyWorkspaceCanvas(
      taskId,
      typeof taskRecord.title === 'string' ? taskRecord.title : 'Untitled task',
    );
  }
  const id = typeof snapshot.id === 'string' ? snapshot.id : taskId;
  const name =
    typeof snapshot.name === 'string'
      ? snapshot.name
      : typeof taskRecord.title === 'string'
        ? taskRecord.title
        : 'Untitled task';
  if (!Array.isArray(snapshot.workflows) || !Array.isArray(snapshot.edges)) {
    return null;
  }
  return normalizeCanvasEdges({
    id,
    name,
    layout: 'workspace-canvas',
    rootWorkflowId: typeof snapshot.rootWorkflowId === 'string' ? snapshot.rootWorkflowId : id,
    workflows: snapshot.workflows as WorkflowContainerModel[],
    edges: snapshot.edges as WorkflowCanvasEdge[],
  });
}

async function persistWorkbenchTaskToBackend(
  task: WorkbenchTask,
  callables: CallableSummary[],
  workflows: WorkflowSummary[],
): Promise<void> {
  const canvas = stripRuntimeStateFromCanvas(task.canvas);
  const snapshot = captureAuthoringSnapshot({
    taskId: task.taskId,
    canvas,
    selection: { type: 'task_canvas', taskId: task.taskId },
    callables,
    workflows,
  });
  await api.putWorkbenchTaskCanvas(task.taskId, {
    canvas_hash: snapshot.snapshot_id,
    canvas_snapshot: authoringBackendCanvasSnapshot(snapshot),
    selection: authoringSelectionPayload(snapshot.selection),
    temporary_resources: task.authoring?.temporaryResources || {},
  });
}

function loadTaskStore(): WorkbenchTaskStorePayload {
  if (typeof window === 'undefined') {
    return defaultTaskStorePayload();
  }
  const stored = window.localStorage.getItem(TASK_STORE_KEY);
  return taskStorePayloadFromSerialized(stored);
}

function saveTaskStore(payload: WorkbenchTaskStorePayload): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(TASK_STORE_KEY, JSON.stringify(payload));
}

function workflowRunFromRunSummary(summary: RunSummary, graph: WorkflowGraph): WorkflowRunResult {
  return {
    workflow_id: summary.workflow_id || graph.id,
    status: summary.status,
    run_dir: summary.run_dir,
    started_at: summary.started_at || undefined,
    ended_at: summary.ended_at || undefined,
    nodes: summary.nodes,
    edges: graph.edges,
    errors: [],
  };
}

function workflowRunFromRunStateSnapshot(snapshot: WorkflowRunResult, graph: WorkflowGraph): WorkflowRunResult {
  return {
    ...snapshot,
    workflow_id: snapshot.workflow_id || graph.id,
    run_dir: snapshot.run_dir,
    nodes: snapshot.nodes || [],
    edges: graph.edges,
    errors: snapshot.errors || [],
  };
}

function nodeRunProjectionKey(node: NodeRunSummary): string {
  if (node.ui_node_id) {
    return node.ui_node_id;
  }
  if (node.parent_node_id) {
    return internalFlowNodeId(node.parent_node_id, node.node_id);
  }
  return node.node_id;
}

function workspaceDemoCanvas(): WorkspaceCanvasModel {
  const nvidiaResearchPrompt =
    '请对 NVIDIA Corporation（ticker: NVDA，NASDAQ）进行单股深度调研分析。研究目标是形成可验证、可追踪的投资研究报告，覆盖业务模式、财务质量、行业位置、估值情景、主要风险、潜在催化剂和最终一致性评审。';
  const nvidiaResearchInput = {
    user_prompt: nvidiaResearchPrompt,
    target: {
      ticker: 'NVDA',
      company_name: 'NVIDIA Corporation',
      exchange: 'NASDAQ',
      asset_type: 'common_stock',
      research_scope: 'single_stock_deep_research',
    },
    research_preferences: {
      focus: ['AI accelerators', 'data center revenue', 'gross margin quality', 'valuation sensitivity', 'supply chain and regulatory risks'],
      output_language: 'zh-CN',
    },
  };
  const agentNode = (
    id: string,
    title: string,
    task: string,
    inputPorts: WorkflowPortView[],
    outputPorts: WorkflowPortView[],
    outputSchema: Record<string, unknown>,
    position: { x: number; y: number },
    callableId = DEMO_ANALYST_AGENT_ID,
    sourceInput?: Record<string, unknown>,
  ): WorkflowContainerModel => ({
    id,
    title,
    sourceKind: 'agent_session',
    callableId,
    codexExecutionMode: 'default',
    directory: `workflows/demo/${id}`,
    status: 'not_run',
    sourceInput: sourceInput || { user_prompt: task },
    outputSchema,
    inputPorts,
    outputPorts,
    internalNodes: [],
    internalEdges: [],
    position,
    size: { width: 310, height: 150 },
    warnings: [],
  });

  const inlineWorkflow = (
    id: string,
    title: string,
    directory: string,
    inputPorts: WorkflowPortView[],
    outputPorts: WorkflowPortView[],
    internalNodes: InternalNodeView[],
    internalEdges: WorkflowCanvasEdge[],
    position: { x: number; y: number },
  ): WorkflowContainerModel => ({
    id,
    title,
    workflowBodyKind: 'inline_container',
    directory,
    status: 'not_run',
    inputPorts,
    outputPorts,
    internalNodes,
    internalEdges,
    position,
    size: DEFAULT_CONTAINER_SIZE,
    warnings: [],
  });

  const analysisSchema = (name: string) =>
    objectOutputSchema(['status', 'summary', 'findings', 'evidence'], {
      findings: stringArrayField(`${name} 的关键发现`),
      evidence: stringArrayField('证据、假设和需要后续验证的信息'),
    });
  const synthesisSchema = (name: string) =>
    objectOutputSchema(['status', 'summary', 'decision_factors', 'open_questions'], {
      decision_factors: stringArrayField(`${name} 输出给下游 workflow 的判断因子`),
      open_questions: stringArrayField('下游仍需处理的不确定性'),
    });
  const reportSchema = objectOutputSchema(['status', 'summary', 'report_sections', 'evidence_map'], {
    report_sections: stringArrayField('最终报告章节'),
    evidence_map: stringArrayField('章节到上游产物的追踪关系'),
    action_items: stringArrayField('发布前行动项'),
  });

  const sourceDataWorkflowId = 'Source_Data_Workflow';
  const fundamentalsWorkflowId = 'Fundamentals_Workflow';
  const valuationWorkflowId = 'Valuation_Workflow';
  const riskWorkflowId = 'Risk_Catalyst_Workflow';
  const reportWorkflowId = 'Report_Workflow';

  return {
    id: 'core_v2_stock_research_canvas',
    name: 'Core v2 股市调研分析示例',
    layout: 'workspace-canvas',
    rootWorkflowId: 'Final_Review_Agent',
    exposedOutputs: [
      port('main', '投资调研报告', 'output', true),
      port('review', '发布评审结论', 'output', true),
      port('action_items', '后续行动项', 'output', true),
      port('source_register', '来源登记表', 'output', true),
      port('valuation', '估值结论', 'output', true),
    ],
    workflowOutputBindings: [
      {
        source: { node: reportWorkflowId, port: 'report' },
        target_port: 'main',
        materialization: 'copy',
        required: true,
      },
      {
        source: { node: 'Final_Review_Agent', port: 'main' },
        target_port: 'review',
        materialization: 'copy',
        required: true,
      },
      {
        source: { node: 'Final_Review_Agent', port: 'action_items' },
        target_port: 'action_items',
        materialization: 'copy',
        required: true,
      },
      {
        source: { node: sourceDataWorkflowId, port: 'source_register' },
        target_port: 'source_register',
        materialization: 'copy',
        required: true,
      },
      {
        source: { node: valuationWorkflowId, port: 'main' },
        target_port: 'valuation',
        materialization: 'copy',
        required: true,
      },
    ],
    workflows: [
      agentNode(
        'Research_Brief_Agent',
        '研究简报确认',
        '确认 NVIDIA / NVDA 的研究对象、范围、约束和后续关注点；不要提前写投资结论、估值观点或未经核验的数据。',
        [port('main', '股票或公司输入', 'input')],
        [
          port('target_profile', '标的画像', 'output', true),
          port('research_scope', '研究范围', 'output', true),
          port('constraints', '研究约束', 'output', true),
          port('watchlist_seed', '候选关注点', 'output', true),
        ],
        objectOutputSchema(
          ['status', 'summary', 'target_profile', 'research_scope', 'constraints', 'watchlist_seed'],
          {
            target_profile: {
              type: 'object',
              description: 'ticker、公司名称、业务边界和研究对象定义',
              additionalProperties: true,
            },
            research_scope: stringField('本次单股深研的范围边界'),
            constraints: stringArrayField('研究范围、数据边界和下游限制条件'),
            watchlist_seed: stringArrayField('后续风险与催化剂 workflow 需要持续关注的事项'),
          },
        ),
        { x: 80, y: 260 },
        DEMO_ANALYST_AGENT_ID,
        nvidiaResearchInput,
      ),
      inlineWorkflow(
        sourceDataWorkflowId,
        '公开数据核验工作流',
        'workflows/demo/core_v2/source_data',
        [port('target', '标的画像', 'input', true)],
        [
          port('verified_data_pack', '核验数据包', 'output', true),
          port('source_register', '来源登记表', 'output', true),
          port('data_gaps', '数据缺口', 'output', true),
        ],
        [
          internalNode(
            'company_disclosure_agent',
            '公司披露采集',
            '联网读取 NVIDIA 10-K、10-Q、earnings release、investor presentation 和 transcript，提取可引用事实。',
            'Agent',
            DEMO_DATA_AGENT_ID,
            sourceDataComponentOutputSchema('公司披露采集'),
            [port('target', '标的画像', 'input', true)],
          ),
          internalNode(
            'market_data_agent',
            '市场数据采集',
            '联网读取股价、市值、forward multiples、consensus estimates 和 peer multiples；无法取得时必须列入 data_gaps。',
            'Agent',
            DEMO_DATA_AGENT_ID,
            sourceDataComponentOutputSchema('市场数据采集'),
            [port('target', '标的画像', 'input', true)],
          ),
          internalNode(
            'news_policy_agent',
            '新闻政策采集',
            '联网整理近 3-6 个月 export control、Blackwell/Rubin、hyperscaler capex 和 AI demand 相关新闻。',
            'Agent',
            DEMO_DATA_AGENT_ID,
            sourceDataComponentOutputSchema('新闻政策采集'),
            [port('target', '标的画像', 'input', true)],
          ),
          internalNode(
            'peer_competition_agent',
            '同业竞争采集',
            '联网整理 AMD、Broadcom/custom ASIC、Google TPU、hyperscaler internal silicon 和推理替代方案。',
            'Agent',
            DEMO_DATA_AGENT_ID,
            sourceDataComponentOutputSchema('同业竞争采集'),
            [port('target', '标的画像', 'input', true)],
          ),
          internalNode(
            'data_quality_synthesis_agent',
            '数据质量汇总',
            '从 main 控制聚合输入中读取四路公开数据采集结果，压缩为可供下游消费的核验数据包、来源登记表、数据缺口和 as_of_date；不要复制上游原文。',
            'Agent',
            DEMO_SYNTHESIS_AGENT_ID,
            verifiedDataPackOutputSchema(),
            [port('main', '四路采集结果聚合', 'input', true)],
            [
              port('verified_data_pack', '核验数据包', 'output', true),
              port('source_register', '来源登记表', 'output', true),
              port('data_gaps', '数据缺口', 'output', true),
            ],
          ),
        ],
        [
          dataEdge(workflowInputBoundaryId(sourceDataWorkflowId), 'target', 'company_disclosure_agent', 'target'),
          dataEdge(workflowInputBoundaryId(sourceDataWorkflowId), 'target', 'market_data_agent', 'target'),
          dataEdge(workflowInputBoundaryId(sourceDataWorkflowId), 'target', 'news_policy_agent', 'target'),
          dataEdge(workflowInputBoundaryId(sourceDataWorkflowId), 'target', 'peer_competition_agent', 'target'),
          controlEdge('company_disclosure_agent', 'data_quality_synthesis_agent'),
          controlEdge('market_data_agent', 'data_quality_synthesis_agent'),
          controlEdge('news_policy_agent', 'data_quality_synthesis_agent'),
          controlEdge('peer_competition_agent', 'data_quality_synthesis_agent'),
          dataEdge('data_quality_synthesis_agent', 'verified_data_pack', workflowOutputBoundaryId(sourceDataWorkflowId), 'verified_data_pack'),
          dataEdge('data_quality_synthesis_agent', 'source_register', workflowOutputBoundaryId(sourceDataWorkflowId), 'source_register'),
          dataEdge('data_quality_synthesis_agent', 'data_gaps', workflowOutputBoundaryId(sourceDataWorkflowId), 'data_gaps'),
        ],
        { x: 470, y: 240 },
      ),
      inlineWorkflow(
        fundamentalsWorkflowId,
        '基本面工作流',
        'workflows/demo/core_v2/fundamentals',
        [port('target', '标的画像', 'input', true), port('verified_data', '核验数据包', 'input', true)],
        [
          port('main', '基本面结论', 'output', true),
          port('evidence_pack', '基本面证据包', 'output', true),
        ],
        [
          internalNode(
            'business_model_agent',
            '业务模式分析',
            '分析收入来源、客户、产品线和商业模式韧性。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            analysisSchema('业务模式分析'),
            [port('target', '标的画像', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
          internalNode(
            'financial_quality_agent',
            '财务质量分析',
            '分析收入质量、利润率、现金流、资产负债表和需验证的财报数据。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            analysisSchema('财务质量分析'),
            [port('target', '标的画像', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
          internalNode(
            'industry_position_agent',
            '行业位置分析',
            '分析行业结构、竞争对手、增长驱动和公司相对位置。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            analysisSchema('行业位置分析'),
            [port('target', '标的画像', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
          internalNode(
            'fundamentals_synthesis_agent',
            '基本面汇总',
            '从 main 控制聚合输入中读取业务、财务、行业三路结果，形成下游估值和风险可消费的结论。',
            'Agent',
            DEMO_SYNTHESIS_AGENT_ID,
            synthesisSchema('基本面汇总'),
            [port('main', '三路基本面分析聚合', 'input', true)],
          ),
          internalNode(
            'fundamentals_evidence_agent',
            '证据包整理',
            '从基本面汇总中整理证据、假设和验证缺口，供最终报告追踪。',
            'Agent',
            DEMO_SYNTHESIS_AGENT_ID,
            synthesisSchema('证据包整理'),
            [port('main', '基本面汇总', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
        ],
        [
          dataEdge(workflowInputBoundaryId(fundamentalsWorkflowId), 'target', 'business_model_agent', 'target'),
          dataEdge(workflowInputBoundaryId(fundamentalsWorkflowId), 'verified_data', 'business_model_agent', 'verified_data'),
          dataEdge(workflowInputBoundaryId(fundamentalsWorkflowId), 'target', 'financial_quality_agent', 'target'),
          dataEdge(workflowInputBoundaryId(fundamentalsWorkflowId), 'verified_data', 'financial_quality_agent', 'verified_data'),
          dataEdge(workflowInputBoundaryId(fundamentalsWorkflowId), 'target', 'industry_position_agent', 'target'),
          dataEdge(workflowInputBoundaryId(fundamentalsWorkflowId), 'verified_data', 'industry_position_agent', 'verified_data'),
          controlEdge('business_model_agent', 'fundamentals_synthesis_agent'),
          controlEdge('financial_quality_agent', 'fundamentals_synthesis_agent'),
          controlEdge('industry_position_agent', 'fundamentals_synthesis_agent'),
          controlEdge('fundamentals_synthesis_agent', 'fundamentals_evidence_agent'),
          dataEdge(workflowInputBoundaryId(fundamentalsWorkflowId), 'verified_data', 'fundamentals_evidence_agent', 'verified_data'),
          dataEdge('fundamentals_synthesis_agent', 'main', workflowOutputBoundaryId(fundamentalsWorkflowId), 'main'),
          dataEdge('fundamentals_evidence_agent', 'main', workflowOutputBoundaryId(fundamentalsWorkflowId), 'evidence_pack'),
        ],
        { x: 860, y: 80 },
      ),
      inlineWorkflow(
        valuationWorkflowId,
        '估值与情景工作流',
        'workflows/demo/core_v2/valuation',
        [
          port('fundamentals', '基本面结论', 'input', true),
          port('constraints', '研究约束', 'input', true),
          port('verified_data', '核验数据包', 'input', true),
        ],
        [port('main', '估值结论', 'output', true)],
        [
          internalNode(
            'operating_model_agent',
            '经营模型假设',
            '基于核验数据和基本面结论建立 revenue、gross margin、operating margin、FCF、share count、net cash 的建模假设。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            operatingModelOutputSchema(),
            [port('fundamentals', '基本面结论', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
          internalNode(
            'scenario_valuation_agent',
            '情景估值',
            '构造 bull/base/bear 情景，输出关键变量、成立条件、估值结果或无法估值的具体缺失原因。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            scenarioValuationOutputSchema(),
            [
              port('fundamentals', '基本面结论', 'input', true),
              port('constraints', '研究约束', 'input', true),
              port('verified_data', '核验数据包', 'input', true),
            ],
          ),
          internalNode(
            'comparables_agent',
            '可比公司估值',
            '基于核验市场数据整理 peers、multiples、premium/discount rationale；缺少共识或行情数据时必须显式说明。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            comparablesOutputSchema(),
            [port('fundamentals', '基本面结论', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
          internalNode(
            'valuation_synthesis_agent',
            '估值汇总',
            '从 main 控制聚合输入中整合经营模型、情景估值和可比公司估值，输出结论型估值判断；禁止只输出估值方法论。',
            'Agent',
            DEMO_SYNTHESIS_AGENT_ID,
            valuationSynthesisOutputSchema(),
            [port('main', '三路估值分析聚合', 'input', true)],
          ),
        ],
        [
          dataEdge(workflowInputBoundaryId(valuationWorkflowId), 'fundamentals', 'operating_model_agent', 'fundamentals'),
          dataEdge(workflowInputBoundaryId(valuationWorkflowId), 'verified_data', 'operating_model_agent', 'verified_data'),
          dataEdge(workflowInputBoundaryId(valuationWorkflowId), 'fundamentals', 'scenario_valuation_agent', 'fundamentals'),
          dataEdge(workflowInputBoundaryId(valuationWorkflowId), 'constraints', 'scenario_valuation_agent', 'constraints'),
          dataEdge(workflowInputBoundaryId(valuationWorkflowId), 'verified_data', 'scenario_valuation_agent', 'verified_data'),
          dataEdge(workflowInputBoundaryId(valuationWorkflowId), 'fundamentals', 'comparables_agent', 'fundamentals'),
          dataEdge(workflowInputBoundaryId(valuationWorkflowId), 'verified_data', 'comparables_agent', 'verified_data'),
          controlEdge('operating_model_agent', 'valuation_synthesis_agent'),
          controlEdge('scenario_valuation_agent', 'valuation_synthesis_agent'),
          controlEdge('comparables_agent', 'valuation_synthesis_agent'),
          dataEdge('valuation_synthesis_agent', 'main', workflowOutputBoundaryId(valuationWorkflowId), 'main'),
        ],
        { x: 1360, y: 40 },
      ),
      inlineWorkflow(
        riskWorkflowId,
        '风险与催化剂工作流',
        'workflows/demo/core_v2/risk_catalyst',
        [
          port('fundamentals', '基本面结论', 'input', true),
          port('watchlist', '候选关注点', 'input', true),
          port('verified_data', '核验数据包', 'input', true),
        ],
        [
          port('main', '风险结论', 'output', true),
          port('watchlist', '催化剂跟踪清单', 'output', true),
        ],
        [
          internalNode(
            'macro_risk_agent',
            '宏观与监管风险',
            '并行识别利率、监管、汇率、政策和周期风险。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            riskComponentOutputSchema(),
            [port('fundamentals', '基本面结论', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
          internalNode(
            'company_risk_agent',
            '公司特有风险',
            '并行识别竞争、执行、客户集中度、管理层和资本配置风险。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            riskComponentOutputSchema(),
            [port('fundamentals', '基本面结论', 'input', true), port('verified_data', '核验数据包', 'input', true)],
          ),
          internalNode(
            'catalyst_agent',
            '催化剂扫描',
            '并行识别未来 6-12 个月可能改变预期的正负催化剂。',
            'Agent',
            DEMO_ANALYST_AGENT_ID,
            catalystOutputSchema(),
            [
              port('fundamentals', '基本面结论', 'input', true),
              port('watchlist', '候选关注点', 'input', true),
              port('verified_data', '核验数据包', 'input', true),
            ],
          ),
          internalNode(
            'risk_synthesis_agent',
            '风险催化剂汇总',
            '从 main 控制聚合输入中汇总风险与催化剂，形成最终报告需要的风险矩阵。',
            'Agent',
            DEMO_SYNTHESIS_AGENT_ID,
            riskSynthesisOutputSchema(),
            [port('main', '三路风险与催化剂分析聚合', 'input', true)],
          ),
        ],
        [
          dataEdge(workflowInputBoundaryId(riskWorkflowId), 'fundamentals', 'macro_risk_agent', 'fundamentals'),
          dataEdge(workflowInputBoundaryId(riskWorkflowId), 'verified_data', 'macro_risk_agent', 'verified_data'),
          dataEdge(workflowInputBoundaryId(riskWorkflowId), 'fundamentals', 'company_risk_agent', 'fundamentals'),
          dataEdge(workflowInputBoundaryId(riskWorkflowId), 'verified_data', 'company_risk_agent', 'verified_data'),
          dataEdge(workflowInputBoundaryId(riskWorkflowId), 'fundamentals', 'catalyst_agent', 'fundamentals'),
          dataEdge(workflowInputBoundaryId(riskWorkflowId), 'watchlist', 'catalyst_agent', 'watchlist'),
          dataEdge(workflowInputBoundaryId(riskWorkflowId), 'verified_data', 'catalyst_agent', 'verified_data'),
          controlEdge('macro_risk_agent', 'risk_synthesis_agent'),
          controlEdge('company_risk_agent', 'risk_synthesis_agent'),
          controlEdge('catalyst_agent', 'risk_synthesis_agent'),
          dataEdge('risk_synthesis_agent', 'main', workflowOutputBoundaryId(riskWorkflowId), 'main'),
          dataEdge('catalyst_agent', 'main', workflowOutputBoundaryId(riskWorkflowId), 'watchlist'),
        ],
        { x: 1360, y: 480 },
      ),
      inlineWorkflow(
        reportWorkflowId,
        '报告生成工作流',
        'workflows/demo/core_v2/report',
        [
          port('fundamentals', '基本面结论', 'input', true),
          port('valuation', '估值结论', 'input', true),
          port('risk', '风险结论', 'input', true),
          port('evidence_pack', '证据包', 'input', true),
          port('verified_data', '核验数据包', 'input', true),
          port('source_register', '来源登记表', 'input', true),
        ],
        [
          port('report', '投资调研报告', 'output', true),
          port('appendix', '证据附录', 'output', true),
        ],
        [
          internalNode(
            'investment_thesis_agent',
            '投资论点撰写',
            '整合基本面、估值和风险，输出投资观点、置信度和关键论点；不得只输出报告写作框架。',
            'Agent',
            DEMO_REPORT_AGENT_ID,
            investmentThesisOutputSchema(),
            [
              port('fundamentals', '基本面结论', 'input', true),
              port('valuation', '估值结论', 'input', true),
              port('risk', '风险结论', 'input', true),
            ],
          ),
          internalNode(
            'evidence_mapper_agent',
            '证据追踪整理',
            '从 main 控制输入读取投资论点，并结合证据包、估值结论和来源登记表整理证据映射；不要生成报告章节正文。',
            'Agent',
            DEMO_REPORT_AGENT_ID,
            evidenceMapOnlyOutputSchema(),
            [
              port('main', '投资论点', 'input', true),
              port('evidence_pack', '证据包', 'input', true),
              port('valuation', '估值结论', 'input', true),
              port('source_register', '来源登记表', 'input', true),
            ],
          ),
          internalNode(
            'report_compiler_agent',
            '报告合成',
            '合成完整 NVIDIA 单股深研报告，必须输出 executive summary、investment stance、估值结论、风险收益和监控计划；不得只输出方法论或待办清单。',
            'Agent',
            DEMO_REPORT_AGENT_ID,
            finalInvestmentReportOutputSchema(),
            [
              port('main', '证据追踪', 'input', true),
              port('thesis', '投资论点', 'input', true),
              port('verified_data', '核验数据包', 'input', true),
              port('source_register', '来源登记表', 'input', true),
            ],
          ),
        ],
        [
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'fundamentals', 'investment_thesis_agent', 'fundamentals'),
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'valuation', 'investment_thesis_agent', 'valuation'),
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'risk', 'investment_thesis_agent', 'risk'),
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'evidence_pack', 'evidence_mapper_agent', 'evidence_pack'),
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'valuation', 'evidence_mapper_agent', 'valuation'),
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'source_register', 'evidence_mapper_agent', 'source_register'),
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'verified_data', 'report_compiler_agent', 'verified_data'),
          dataEdge(workflowInputBoundaryId(reportWorkflowId), 'source_register', 'report_compiler_agent', 'source_register'),
          controlEdge('investment_thesis_agent', 'evidence_mapper_agent'),
          controlEdge('evidence_mapper_agent', 'report_compiler_agent'),
          dataEdge('investment_thesis_agent', 'main', 'report_compiler_agent', 'thesis'),
          dataEdge('report_compiler_agent', 'main', workflowOutputBoundaryId(reportWorkflowId), 'report'),
          dataEdge('evidence_mapper_agent', 'main', workflowOutputBoundaryId(reportWorkflowId), 'appendix'),
        ],
        { x: 1860, y: 260 },
      ),
      agentNode(
        'Final_Review_Agent',
        '最终发布评审',
        '接收多个 workflow 输出，检查报告、估值、风险和证据链是否一致。',
        [
          port('report', '投资调研报告', 'input', true),
          port('valuation', '估值结论', 'input', true),
          port('risk_watchlist', '风险催化剂清单', 'input', true),
          port('evidence_appendix', '证据附录', 'input', true),
        ],
        [
          port('main', '发布评审结论', 'output', true),
          port('action_items', '后续行动项', 'output', true),
        ],
        reportPublishOutputSchema(),
        { x: 2360, y: 300 },
        DEMO_REVIEW_AGENT_ID,
      ),
    ],
    edges: [
      controlEdge('Research_Brief_Agent', sourceDataWorkflowId),
      dataEdge('Research_Brief_Agent', 'target_profile', sourceDataWorkflowId, 'target'),
      controlEdge(sourceDataWorkflowId, fundamentalsWorkflowId),
      dataEdge('Research_Brief_Agent', 'target_profile', fundamentalsWorkflowId, 'target'),
      dataEdge(sourceDataWorkflowId, 'verified_data_pack', fundamentalsWorkflowId, 'verified_data'),
      controlEdge(fundamentalsWorkflowId, valuationWorkflowId),
      controlEdge(fundamentalsWorkflowId, riskWorkflowId),
      dataEdge(fundamentalsWorkflowId, 'main', valuationWorkflowId, 'fundamentals'),
      dataEdge('Research_Brief_Agent', 'constraints', valuationWorkflowId, 'constraints'),
      dataEdge(sourceDataWorkflowId, 'verified_data_pack', valuationWorkflowId, 'verified_data'),
      dataEdge(fundamentalsWorkflowId, 'main', riskWorkflowId, 'fundamentals'),
      dataEdge('Research_Brief_Agent', 'watchlist_seed', riskWorkflowId, 'watchlist'),
      dataEdge(sourceDataWorkflowId, 'verified_data_pack', riskWorkflowId, 'verified_data'),
      controlEdge(valuationWorkflowId, reportWorkflowId),
      controlEdge(riskWorkflowId, reportWorkflowId),
      dataEdge(fundamentalsWorkflowId, 'main', reportWorkflowId, 'fundamentals'),
      dataEdge(fundamentalsWorkflowId, 'evidence_pack', reportWorkflowId, 'evidence_pack'),
      dataEdge(valuationWorkflowId, 'main', reportWorkflowId, 'valuation'),
      dataEdge(riskWorkflowId, 'main', reportWorkflowId, 'risk'),
      dataEdge(sourceDataWorkflowId, 'verified_data_pack', reportWorkflowId, 'verified_data'),
      dataEdge(sourceDataWorkflowId, 'source_register', reportWorkflowId, 'source_register'),
      controlEdge(reportWorkflowId, 'Final_Review_Agent'),
      dataEdge(reportWorkflowId, 'report', 'Final_Review_Agent', 'report'),
      dataEdge(valuationWorkflowId, 'main', 'Final_Review_Agent', 'valuation'),
      dataEdge(riskWorkflowId, 'watchlist', 'Final_Review_Agent', 'risk_watchlist'),
      dataEdge(reportWorkflowId, 'appendix', 'Final_Review_Agent', 'evidence_appendix'),
    ],
  };
}

function stringField(description: string): Record<string, unknown> {
  return { type: 'string', description };
}

function stringArrayField(description: string): Record<string, unknown> {
  return {
    type: 'array',
    description,
    items: { type: 'string' },
  };
}

function objectOutputSchema(
  required: string[],
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties: {
      status: stringField('success 或 failed'),
      summary: stringField('面向下游节点的简明结论'),
      ...properties,
    },
  };
}

function fundamentalsComponentOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'findings', 'evidence'], {
    findings: stringArrayField('关键发现'),
    evidence: stringArrayField('引用的文件、数据或需外部验证的信息'),
    assumptions: stringArrayField('需要在后续节点显式保留的不确定性'),
  });
}

function fundamentalsSynthesisOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'business_quality', 'financial_quality', 'industry_position'], {
    business_quality: stringField('业务模式质量判断'),
    financial_quality: stringField('财务质量判断'),
    industry_position: stringField('行业位置判断'),
    open_questions: stringArrayField('后续估值和风险分析需要验证的问题'),
  });
}

function sourceDataComponentOutputSchema(name: string): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'facts', 'sources', 'data_gaps'], {
    facts: stringArrayField(`${name} 提取出的可引用事实`),
    sources: stringArrayField('来源标题、URL、发布日期或访问日期'),
    data_gaps: stringArrayField('未取得或仍需复核的数据'),
    as_of_date: stringField('数据采集日期'),
  });
}

function verifiedDataPackOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'verified_data_pack', 'source_register', 'data_gaps', 'as_of_date'], {
    verified_data_pack: {
      type: 'object',
      description: '下游节点可直接消费的核验事实、市场数据、新闻政策和同业竞争数据',
      additionalProperties: true,
    },
    source_register: stringArrayField('可追踪来源清单'),
    data_gaps: stringArrayField('影响报告或估值发布质量的数据缺口'),
    as_of_date: stringField('数据包截至日期'),
  });
}

function operatingModelOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'revenue_model', 'margin_model', 'cash_flow_model'], {
    revenue_model: stringField('收入驱动、分部增长和关键假设'),
    margin_model: stringField('gross margin、operating margin 和正常化假设'),
    cash_flow_model: stringField('FCF、capex、working capital、share count、net cash 等假设'),
    missing_inputs: stringArrayField('无法建模或需要补充的数据'),
  });
}

function scenarioValuationOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'base_case', 'bull_case', 'bear_case'], {
    base_case: stringField('base case 关键变量、成立条件和估值结果或缺失原因'),
    bull_case: stringField('bull case 关键变量、成立条件和估值结果或缺失原因'),
    bear_case: stringField('bear case 关键变量、成立条件和估值结果或缺失原因'),
    valuation_status: stringField('complete 或 insufficient_data'),
    missing_inputs: stringArrayField('阻止输出数值估值区间的数据缺口'),
  });
}

function comparablesOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'peers', 'multiples_view', 'premium_discount_rationale'], {
    peers: stringArrayField('可比公司或替代资产'),
    multiples_view: stringField('EV/Revenue、EV/EBIT、P/E 等可比估值判断'),
    premium_discount_rationale: stringField('相对 peers 应享有溢价或折价的理由'),
    missing_inputs: stringArrayField('缺失的市场数据、共识或 peer multiple'),
  });
}

function valuationSynthesisOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(
    ['status', 'summary', 'valuation_conclusion', 'base_case', 'bull_case', 'bear_case', 'risk_reward_view', 'missing_inputs'],
    {
      valuation_conclusion: stringField('结论型估值判断；不能只描述估值方法'),
      base_case: stringField('base case 结论'),
      bull_case: stringField('bull case 结论'),
      bear_case: stringField('bear case 结论'),
      risk_reward_view: stringField('风险收益判断'),
      valuation_status: stringField('complete 或 insufficient_data'),
      missing_inputs: stringArrayField('缺失数据和对结论的影响'),
    },
  );
}

function investmentThesisOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'investment_stance', 'confidence', 'key_thesis'], {
    investment_stance: stringField('研究建议口径的投资观点，例如偏正面/中性/偏谨慎及原因'),
    confidence: stringField('高/中/低置信度及原因'),
    key_thesis: stringArrayField('支撑投资观点的核心论点'),
    thesis_risks: stringArrayField('可能推翻投资观点的关键风险'),
  });
}

function evidenceMapOnlyOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'evidence_map', 'source_coverage', 'evidence_gaps'], {
    evidence_map: stringArrayField('报告结论到上游证据和来源的映射'),
    source_coverage: stringArrayField('披露、市场、新闻政策和同业数据的覆盖情况'),
    evidence_gaps: stringArrayField('发布前必须补齐或在报告中披露的证据缺口'),
    action_items: stringArrayField('补充证据的行动项'),
  });
}

function finalInvestmentReportOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'report'], {
    report: {
      type: 'object',
      additionalProperties: false,
      required: [
        'executive_summary',
        'investment_stance',
        'business_quality',
        'financial_quality',
        'industry_position',
        'valuation_conclusion',
        'risk_reward',
        'key_risks',
        'catalysts',
        'monitoring_plan',
        'source_notes',
        'limitations',
      ],
      properties: {
        executive_summary: stringField('一页式核心摘要'),
        investment_stance: stringField('研究建议口径投资观点，不输出绝对化买卖指令'),
        business_quality: stringField('业务质量结论'),
        financial_quality: stringField('财务质量结论'),
        industry_position: stringField('行业位置结论'),
        valuation_conclusion: stringField('估值结论'),
        risk_reward: stringField('风险收益判断'),
        key_risks: stringArrayField('关键风险'),
        catalysts: stringArrayField('正负催化剂'),
        monitoring_plan: stringArrayField('后续跟踪指标'),
        source_notes: stringArrayField('关键来源说明'),
        limitations: stringArrayField('限制、免责声明和不可发布条件'),
      },
    },
    action_items: stringArrayField('后续行动项'),
  });
}

function riskComponentOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'risks'], {
    risks: stringArrayField('风险项'),
    severity_notes: stringArrayField('风险严重程度或触发条件'),
  });
}

function catalystOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'positive_catalysts', 'negative_catalysts'], {
    positive_catalysts: stringArrayField('正向催化剂'),
    negative_catalysts: stringArrayField('负向催化剂'),
    watchlist: stringArrayField('需要持续跟踪的事件'),
  });
}

function riskSynthesisOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'risk_matrix', 'catalyst_watchlist'], {
    risk_matrix: stringArrayField('整合后的风险矩阵'),
    catalyst_watchlist: stringArrayField('催化剂跟踪清单'),
    mitigation_notes: stringArrayField('风险缓释或验证方式'),
  });
}

function reportPublishOutputSchema(): Record<string, unknown> {
  return objectOutputSchema(['status', 'summary', 'readiness', 'required_followups'], {
    readiness: stringField('报告是否可发布，以及原因'),
    required_followups: stringArrayField('发布前仍需补充的检查项'),
    action_items: stringArrayField('发布前后需要执行的行动项'),
  });
}

function normalizeWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
  const controlEdges = graph.control_edges || graph.edges || [];
  const dataEdges = graph.data_edges || [];
  return {
    ...graph,
    edges: controlEdges,
    control_edges: controlEdges,
    data_edges: dataEdges,
  };
}

function graphFromLegacyWorkflow(workflow: WorkflowDetail): WorkflowGraph {
  if (workflow.graph) {
    return workflow.graph;
  }
  const tasks = workflow.workflow.tasks || [];
  return {
    id: workflow.workflow_id,
    version: workflow.workflow.version || '0.2.0',
    name: workflow.workflow.name || workflow.workflow_id,
    description: workflow.workflow.description,
    nodes: tasks.map((task, index) => ({
      id: task.name,
      callable_ref: {
        kind: 'agent_class',
        id: findCallableId(task.command) || 'fake-agent.generic',
      },
      kind: 'agent_session',
      label: task.name,
      input: { topic: task.name },
      input_mapping: {},
      position: { x: index * 500, y: 220 },
    })),
    edges: tasks.flatMap((task) =>
      (task.depends_on || []).map((dependency) => ({
        id: `edge_${dependency}_${task.name}`,
        from: dependency,
        to: task.name,
        label: '依赖',
        mapping: {},
        condition: null,
      })),
    ),
    metadata: { source: 'legacy-yaml' },
  };
}

function focusCanvas(
  canvas: WorkspaceCanvasModel,
  focusedWorkflowId: string | null,
): WorkspaceCanvasModel {
  if (!focusedWorkflowId) {
    return canvas;
  }
  const workflow = canvas.workflows.find((item) => item.id === focusedWorkflowId);
  if (!workflow) {
    return canvas;
  }
  const inputBoundaryId = workflowInputBoundaryId(workflow.id);
  const outputBoundaryId = workflowOutputBoundaryId(workflow.id);
  const inputBoundary: WorkflowContainerModel = {
    id: inputBoundaryId,
    title: 'Workflow Inputs',
    boundaryKind: 'workflow_input',
    directory: workflow.directory,
    bindingPath: workflow.bindingPath,
    status: workflow.status,
    inputPorts: [],
    outputPorts: workflow.inputPorts.map((item) => boundaryPort(item, 'output')),
    internalNodes: [],
    internalEdges: [],
    position: { x: 40, y: 250 },
    size: BOUNDARY_NODE_SIZE,
    warnings: [],
  };
  const outputBoundary: WorkflowContainerModel = {
    id: outputBoundaryId,
    title: 'Workflow Outputs',
    boundaryKind: 'workflow_output',
    directory: workflow.directory,
    bindingPath: workflow.bindingPath,
    status: workflow.status,
    inputPorts: workflow.outputPorts.map((item) => boundaryPort(item, 'input')),
    outputPorts: [],
    internalNodes: [],
    internalEdges: [],
    position: { x: 1240, y: 250 },
    size: BOUNDARY_NODE_SIZE,
    warnings: [],
  };
  const editableNodes = workflow.internalNodes.map((node, index) => ({
    id: node.id,
    title: node.name,
    sourceKind: node.kind === 'Tool' ? 'tool' : 'agent_session',
    callableId: node.callableId || node.runtime,
    directory: workflow.directory,
    bindingPath: workflow.bindingPath,
    status: node.status,
    inputPorts: node.inputPorts || [port('main', 'input', 'input')],
    outputPorts: internalNodeOutputPorts(node),
    internalNodes: [node],
    internalEdges: [],
    position: node.position || { x: 360 + index * 420, y: 260 },
    size: { width: 360, height: 220 },
    warnings: [],
  }));
  return {
    id: `${canvas.id}_${focusedWorkflowId}`,
    name: `${workflow.title} Focus Mode`,
    layout: 'workflow-focus',
    focusedWorkflowId,
    rootWorkflowId: editableNodes[0]?.id || workflow.id,
    workflows: [inputBoundary, ...editableNodes, outputBoundary],
    edges: workflow.internalEdges,
  };
}

function singleNodeWorkflowGraph(node: InternalNodeView, ownerId: string): WorkflowGraph {
  return {
    id: `${ownerId}_${node.id}_single_node`,
    version: '0.4.0',
    name: `${node.name} single node run`,
    description: 'Single-node graph generated by ACC Workbench.',
    nodes: [internalNodeToGraphNode(stripRuntimeStateFromNode(node))],
    edges: [],
    control_edges: [],
    data_edges: [],
    workspace_policy: {
      save_mode: 'local_binding',
      default_state_mode: 'stateful',
    },
    policy: { failure_mode: 'fail_fast', max_concurrency: 1 },
    metadata: {
      layout: 'single-node-run',
      parent_workflow_id: ownerId,
    },
  };
}

function stripRuntimeStateFromNode(node: InternalNodeView): InternalNodeView {
  return { ...node, status: 'not_run' };
}

function internalNode(
  id: string,
  name: string,
  task: string,
  kind: 'Agent' | 'Tool',
  callableId?: string,
  outputSchema?: Record<string, unknown>,
  inputPorts?: WorkflowPortView[],
  outputPorts?: WorkflowPortView[],
): InternalNodeView {
  return {
    id,
    name,
    task,
    kind,
    status: 'not_run',
    callableId: callableId || (kind === 'Tool' ? 'merge' : 'fake-agent.generic'),
    input: { user_prompt: task || name },
    outputSchema,
    inputPorts: inputPorts || [port('main', '输入材料', 'input')],
    outputPorts: outputPorts || [port('main', '输出产物', 'output', true)],
  };
}

function dataEdge(
  sourceWorkflowId: string,
  sourcePortId: string,
  targetWorkflowId: string,
  targetPortId: string,
): WorkflowCanvasEdge {
  return dataEdgeWithId(
    `data_${sourceWorkflowId}_${sourcePortId}_${targetWorkflowId}_${targetPortId}`,
    sourceWorkflowId,
    sourcePortId,
    targetWorkflowId,
    targetPortId,
  );
}

function controlEdge(sourceWorkflowId: string, targetWorkflowId: string): WorkflowCanvasEdge {
  return controlEdgeWithId(`control_${sourceWorkflowId}_${targetWorkflowId}`, sourceWorkflowId, targetWorkflowId);
}

function dataEdgeWithId(
  id: string,
  sourceWorkflowId: string,
  sourcePortId: string,
  targetWorkflowId: string,
  targetPortId: string,
): WorkflowCanvasEdge {
  return {
    id,
    kind: 'data',
    source: { workflowId: sourceWorkflowId, portId: sourcePortId },
    target: { workflowId: targetWorkflowId, portId: targetPortId },
    materialization: 'copy',
  };
}

function controlEdgeWithId(
  id: string,
  sourceWorkflowId: string,
  targetWorkflowId: string,
): WorkflowCanvasEdge {
  return {
    id,
    kind: 'control',
    source: { workflowId: sourceWorkflowId },
    target: { workflowId: targetWorkflowId },
    condition: null,
    context: 'none',
  };
}

function portViewToGraphPort(portView: WorkflowPortView): WorkflowPort {
  return {
    id: portView.id,
    direction: portView.direction,
    required: portView.required,
    cardinality: portView.cardinality || 'one',
    artifact_types: portView.artifactTypes || ['artifact'],
  };
}

function uniqueEdgeId(
  canvas: WorkspaceCanvasModel,
  kind: 'data' | 'control',
  sourceWorkflowId: string,
  targetWorkflowId: string,
): string {
  const existing = new Set(canvas.edges.map((edge) => edge.id));
  let index = 1;
  let edgeId = `${kind}_${sourceWorkflowId}_${targetWorkflowId}`;
  while (existing.has(edgeId)) {
    index += 1;
    edgeId = `${kind}_${sourceWorkflowId}_${targetWorkflowId}_${index}`;
  }
  return edgeId;
}

function uniqueEdgeIdForScope(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  kind: 'data' | 'control',
  sourceWorkflowId: string,
  targetWorkflowId: string,
): string {
  const scopedEdges =
    scopeWorkflowId === null
      ? canvas.edges
      : canvas.workflows.find((workflow) => workflow.id === scopeWorkflowId)?.internalEdges || [];
  const existing = new Set(scopedEdges.map((edge) => edge.id));
  let index = 1;
  let edgeId = `${kind}_${sourceWorkflowId}_${targetWorkflowId}`;
  while (existing.has(edgeId)) {
    index += 1;
    edgeId = `${kind}_${sourceWorkflowId}_${targetWorkflowId}_${index}`;
  }
  return edgeId;
}

function addEdgeWithControlDependency(
  canvas: WorkspaceCanvasModel,
  edge: WorkflowCanvasEdge,
  scopeWorkflowId: string | null,
): WorkspaceCanvasModel {
  const existing = canvas.edges.find((item) => canvasEdgesAreEquivalent(item, edge));
  const edgeToStore = existing || edge;
  const edges = [
    ...canvas.edges.filter((item) => item.id !== edgeToStore.id && !canvasEdgesAreEquivalent(item, edgeToStore)),
    edgeToStore,
  ];
  if (edgeToStore.kind !== 'data') {
    return { ...canvas, edges };
  }
  if (isWorkflowBoundaryEdge(edgeToStore)) {
    return { ...canvas, edges };
  }
  const hasControlEdge = edges.some(
    (item) =>
      item.kind === 'control' &&
      item.source.workflowId === edgeToStore.source.workflowId &&
      item.target.workflowId === edgeToStore.target.workflowId,
  );
  if (hasControlEdge) {
    return { ...canvas, edges };
  }
  const control = controlEdgeWithId(
    uniqueEdgeIdForScope(
      { ...canvas, edges },
      scopeWorkflowId,
      'control',
      edgeToStore.source.workflowId,
      edgeToStore.target.workflowId,
    ),
    edgeToStore.source.workflowId,
    edgeToStore.target.workflowId,
  );
  return { ...canvas, edges: [...edges, control] };
}

function normalizeCanvasEdges(canvas: WorkspaceCanvasModel): WorkspaceCanvasModel {
  return {
    ...canvas,
    edges: uniqueCanvasEdges(canvas.edges),
    workflows: canvas.workflows.map((workflow) => ({
      ...workflow,
      internalEdges: uniqueCanvasEdges(workflow.internalEdges),
    })),
  };
}

function flowEdgeData(address: EdgeAddress): Record<string, unknown> {
  return { edgeAddress: address };
}

function edgeAddressFromFlowEdge(edge: Edge): EdgeAddress | null {
  const value = edge.data?.edgeAddress;
  if (value && typeof value === 'object') {
    const record = value as { edgeId?: unknown; scopeWorkflowId?: unknown };
    if (
      typeof record.edgeId !== 'string' ||
      (record.scopeWorkflowId !== undefined &&
        record.scopeWorkflowId !== null &&
        typeof record.scopeWorkflowId !== 'string')
    ) {
      return edgeAddressFromFlowEdgeId(edge.id);
    }
    return {
      edgeId: record.edgeId,
      scopeWorkflowId: typeof record.scopeWorkflowId === 'string' ? record.scopeWorkflowId : null,
    };
  }
  return edgeAddressFromFlowEdgeId(edge.id);
}

function applyDataEdgeCommandOrKeep(
  canvas: WorkspaceCanvasModel,
  request: DataEdgeCommandRequest,
  onError?: (message: string) => void,
): WorkspaceCanvasModel {
  try {
    return createDataEdgeCommand(canvas, request).canvas;
  } catch (error) {
    onError?.(error instanceof Error ? error.message : '创建 Data Edge 失败');
    return canvas;
  }
}

function createDataEdgeToNodeBodyCommand(
  canvas: WorkspaceCanvasModel,
  visibleCanvas: WorkspaceCanvasModel,
  pending: PendingCanvasConnection,
  targetFlowNodeId: string,
): DataEdgeCommandResult & { targetPortId: string } {
  const plan = prepareDataEdgeToNodeBodyCommand(canvas, visibleCanvas, pending, targetFlowNodeId);
  const result = createDataEdgeCommand(plan.canvasWithTargetPort, plan.request);
  return { ...result, targetPortId: plan.targetPortId };
}

function prepareDataEdgeToNodeBodyCommand(
  canvas: WorkspaceCanvasModel,
  visibleCanvas: WorkspaceCanvasModel,
  pending: PendingCanvasConnection,
  targetFlowNodeId: string,
): BodyDropDataEdgePlan {
  if (pending.mode !== 'data' || !pending.endpoint || !endpointCanSource(pending.endpoint)) {
    throw new Error('Data Edge 必须从 output port 拖到目标节点。');
  }
  const target = flowEndpointForCanvas(visibleCanvas, targetFlowNodeId);
  if (!target.nodeId || workflowBoundaryKind(target.nodeId)) {
    throw new Error('请释放到可执行节点，而不是 workflow 边界。');
  }
  const sourceScope = pending.endpoint.workflowId;
  const targetScope = target.internal ? target.workflowId : null;
  if (sourceScope !== targetScope) {
    throw new Error('Data Edge 必须连接同一层级内的节点。');
  }
  const scopeWorkflowId = sourceScope || null;
  const sourceNodeId = dataNodeIdForEndpoint(pending.endpoint);
  const targetNodeId = target.nodeId;
  if (sourceNodeId === targetNodeId) {
    throw new Error('Data Edge 不能连接到同一个节点。');
  }
  const targetPortId = inputPortIdForBodyDrop(
    canvas,
    scopeWorkflowId,
    targetNodeId,
    pending.endpoint.portId,
    sourceNodeId,
  );
  const targetNode = findDataConnectNode(canvas, scopeWorkflowId, targetNodeId);
  const createdTargetPort = !targetNode?.inputPorts.some((portValue) => portValue.id === targetPortId);
  const canvasWithTargetPort = createdTargetPort
    ? addInputPortToDataConnectNode(canvas, scopeWorkflowId, targetNodeId, targetPortId)
    : canvas;
  return {
    canvasWithTargetPort,
    targetPortId,
    createdTargetPort,
    request: {
      scopeWorkflowId,
      sourceNodeId,
      sourcePortId: pending.endpoint.portId,
      targetNodeId,
      targetPortId,
      materialization: 'copy',
    },
  };
}

function dataNodeIdForEndpoint(endpoint: EndpointDescriptor): string {
  if (endpoint.role === 'workflow_inner_input' || endpoint.role === 'focus_boundary_input_output') {
    const workflowId = endpoint.workflowId || endpoint.nodeId;
    return workflowInputBoundaryId(workflowId);
  }
  if (endpoint.role === 'workflow_inner_output' || endpoint.role === 'focus_boundary_output_input') {
    const workflowId = endpoint.workflowId || endpoint.nodeId;
    return workflowOutputBoundaryId(workflowId);
  }
  return endpoint.nodeId;
}

function inputPortIdForDataBodyPreview(
  canvas: WorkspaceCanvasModel,
  visibleCanvas: WorkspaceCanvasModel,
  pending: PendingCanvasConnection,
  targetFlowNodeId: string,
): string {
  if (pending.mode !== 'data' || !pending.endpoint || !endpointCanSource(pending.endpoint)) {
    throw new Error('Data Edge 必须从 output port 拖到目标节点。');
  }
  const target = flowEndpointForCanvas(visibleCanvas, targetFlowNodeId);
  const sourceScope = pending.endpoint.workflowId;
  const targetScope = target.internal ? target.workflowId : null;
  if (sourceScope !== targetScope || !target.nodeId || workflowBoundaryKind(target.nodeId)) {
    throw new Error('Data Edge 必须连接同一层级内的节点。');
  }
  return inputPortIdForBodyDrop(
    canvas,
    sourceScope || null,
    target.nodeId,
    pending.endpoint.portId,
    dataNodeIdForEndpoint(pending.endpoint),
  );
}

function inputPortIdForBodyDrop(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  targetNodeId: string,
  sourcePortId: string,
  sourceNodeId: string,
): string {
  const requestedPortId = sourcePortId === 'main' ? `${sourceNodeId}_main` : sourcePortId;
  const basePortId = slugId(requestedPortId);
  const targetNode = findDataConnectNode(canvas, scopeWorkflowId, targetNodeId);
  const existing = targetNode?.inputPorts.find((portValue) => portValue.id === basePortId);
  if (!existing) {
    return basePortId;
  }
  const conflicts = dataEdgesForNode(canvas, scopeWorkflowId, targetNodeId, 'input').filter(
    (edge) => edge.target.portId === basePortId,
  );
  if (conflicts.length === 0 || (existing.cardinality || 'one') === 'many') {
    return basePortId;
  }
  return uniqueInputPortIdForNode(canvas, scopeWorkflowId, targetNodeId, basePortId);
}

function addInputPortToDataConnectNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
  portId: string,
): WorkspaceCanvasModel {
  return addPortToDataConnectNode(canvas, scopeWorkflowId, nodeId, 'input', portId);
}

function internalEdgeEndpointToFlowId(workflowId: string, nodeId: string): string {
  if (nodeId === workflowInputBoundaryId(workflowId) || nodeId === workflowOutputBoundaryId(workflowId)) {
    return nodeId;
  }
  return internalFlowNodeId(workflowId, nodeId);
}

function mergeWorkflowRunNodeDetails(
  workflowRun: WorkflowRunResult | null,
  runId: string | null,
  detailsByKey: Record<string, NodeRunSummary>,
): WorkflowRunResult | null {
  if (!workflowRun || !runId) {
    return workflowRun;
  }
  return {
    ...workflowRun,
    nodes: workflowRun.nodes.map((node) => {
      const detail = detailsByKey[nodeRunDetailCacheKey(runId, node)];
      return detail ? mergeNodeRunDetail(node, detail) : node;
    }),
  };
}

function mergeNodeRunDetail(base: NodeRunSummary, detail: NodeRunSummary): NodeRunSummary {
  return {
    ...base,
    ...detail,
    ui_node_id: base.ui_node_id || detail.ui_node_id,
    parent_node_id: base.parent_node_id || detail.parent_node_id,
    status: detail.status || base.status,
    run_dir: detail.run_dir || base.run_dir,
  };
}

function nodeRunDetailCacheKey(runId: string, nodeRun: NodeRunSummary): string {
  return [
    runId,
    nodeRunProjectionKey(nodeRun),
    normalizeRunDirKey(effectiveNodeRunDir(nodeRun)),
  ]
    .filter(Boolean)
    .join('|');
}

function normalizeBinding(
  binding: WorkflowBindingView | null | undefined,
  workflowId: string,
): WorkflowBindingView {
  return {
    workflow_id: binding?.workflow_id || binding?.workflowId || workflowId,
    workflowId: binding?.workflowId || binding?.workflow_id || workflowId,
    binding_path:
      binding?.binding_path || binding?.bindingPath || `bindings/${workflowId}.binding.local.json`,
    bindingPath:
      binding?.bindingPath || binding?.binding_path || `bindings/${workflowId}.binding.local.json`,
    workspace_root: binding?.workspace_root ?? binding?.workspaceRoot ?? null,
    workspaceRoot: binding?.workspaceRoot ?? binding?.workspace_root ?? null,
    exists: Boolean(binding?.exists),
    status: binding?.status || 'unbound',
    valid: binding?.valid,
    error: binding?.error ?? null,
  };
}


function bindingPathOf(binding: WorkflowBindingView | null | undefined): string {
  return binding?.bindingPath || binding?.binding_path || '';
}

function bindingRefOfPath(bindingPath: string): string {
  const normalized = bindingPath.replace(/\\/g, '/');
  if (normalized.startsWith('binding:')) {
    return normalized;
  }
  if (normalized.startsWith('bindings/')) {
    return `binding:${normalized.slice('bindings/'.length)}`;
  }
  return `binding:${normalized}`;
}


function edgeConnectsRemainingNodes(edge: WorkflowCanvasEdge, remainingIds: Set<string>): boolean {
  return (
    (remainingIds.has(edge.source.workflowId) || isWorkflowBoundaryId(edge.source.workflowId)) &&
    (remainingIds.has(edge.target.workflowId) || isWorkflowBoundaryId(edge.target.workflowId))
  );
}

function isWorkflowShellNode(workflow: WorkflowContainerModel): boolean {
  return !workflow.boundaryKind && (workflow.sourceKind || 'workflow') === 'workflow';
}

function workflowAtPosition(
  canvas: WorkspaceCanvasModel,
  position: { x: number; y: number },
): WorkflowContainerModel | null {
  const candidates = canvas.workflows
    .filter(isWorkflowShellNode)
    .filter(
      (workflow) =>
        position.x >= workflow.position.x &&
        position.y >= workflow.position.y &&
        position.x <= workflow.position.x + workflow.size.width &&
        position.y <= workflow.position.y + workflow.size.height,
    );
  return candidates[candidates.length - 1] || null;
}

function workflowAtNodeRect(
  canvas: WorkspaceCanvasModel,
  rect: { x: number; y: number; width: number; height: number },
  excludeWorkflowId?: string,
): WorkflowContainerModel | null {
  const candidates = canvas.workflows
    .map((workflow, index) => ({ workflow, index }))
    .filter(
      ({ workflow }) =>
        workflow.id !== excludeWorkflowId &&
        isWorkflowShellNode(workflow),
    )
    .map(({ workflow, index }) => ({
      workflow,
      index,
      area: rectIntersectionArea(rect, {
        x: workflow.position.x,
        y: workflow.position.y,
        width: workflow.size.width,
        height: workflow.size.height,
      }),
    }))
    .filter((candidate) => candidate.area > 0)
    .sort((left, right) => left.area - right.area || left.index - right.index);
  return candidates.at(-1)?.workflow || null;
}

function resolvePaletteDropTarget(
  canvas: WorkspaceCanvasModel,
  item: PaletteItem,
  target: EventTarget | null,
  position: { x: number; y: number },
): PaletteDropTarget {
  const targetWorkflow = workflowFromDropTarget(canvas, target);
  if (!targetWorkflow) {
    return { kind: 'root_canvas', position };
  }
  if (item.kind === 'workflow') {
    return { kind: 'rejected', reason: 'Workflow 只能拖到主画布，不能拖入另一个 Workflow 内部' };
  }
  return {
    kind: 'workflow_internal',
    workflowId: targetWorkflow.id,
    position: finitePosition(
      {
        x: position.x - targetWorkflow.position.x,
        y: position.y - targetWorkflow.position.y,
      },
      defaultInternalNodePosition(targetWorkflow.internalNodes.length),
    ),
  };
}

function rectIntersectionArea(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): number {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function workflowFromDropTarget(
  canvas: WorkspaceCanvasModel,
  target: EventTarget | null,
): WorkflowContainerModel | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const container = target.closest<HTMLElement>('[data-drop-scope="workflow-internal"][data-workflow-id]');
  const workflowId = container?.dataset.workflowId;
  if (!workflowId) {
    return null;
  }
  return (
    canvas.workflows.find(
      (workflow) =>
        workflow.id === workflowId &&
        isWorkflowShellNode(workflow),
    ) || null
  );
}

function resizeWorkflowContainer(
  canvas: WorkspaceCanvasModel,
  workflowId: string,
  size: { width: number; height: number },
): WorkspaceCanvasModel {
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) =>
      workflow.id === workflowId
        ? {
            ...workflow,
            size: {
              width: Math.max(260, size.width),
              height: Math.max(190, size.height),
            },
          }
        : workflow,
    ),
  };
}

function moveInternalNode(
  canvas: WorkspaceCanvasModel,
  workflowId: string,
  nodeId: string,
  position: { x: number; y: number },
): WorkspaceCanvasModel {
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) =>
      workflow.id === workflowId
        ? {
            ...workflow,
            internalNodes: workflow.internalNodes.map((node) =>
              node.id === nodeId ? { ...node, position } : node,
            ),
          }
        : workflow,
    ),
  };
}

function commitFlowNodeLayout(
  canvas: WorkspaceCanvasModel,
  flowNodes: CanvasFlowNode[],
): WorkspaceCanvasModel {
  const positions = new Map(flowNodes.map((node) => [node.id, node.position]));
  const workflowSizes = new Map(
    flowNodes
      .filter((node): node is WorkflowFlowNode => node.type === 'workflowContainer')
      .map((node) => [
        node.id,
        {
          width: finiteNumber(node.width ?? node.measured?.width, node.data.workflow.size.width),
          height: finiteNumber(node.height ?? node.measured?.height, node.data.workflow.size.height),
        },
      ]),
  );
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
      const workflowPosition = positions.get(workflow.id);
      const workflowSize = workflowSizes.get(workflow.id);
      return {
        ...workflow,
        position: workflowPosition || workflow.position,
        size: workflowSize || workflow.size,
        internalNodes: workflow.internalNodes.map((node) => {
          const position = positions.get(internalFlowNodeId(workflow.id, node.id));
          return position ? { ...node, position } : node;
        }),
      };
    }),
  };
}

function commitDraggedNodeToCanvas(
  canvas: WorkspaceCanvasModel,
  committedFlowNodes: CanvasFlowNode[],
  node: CanvasFlowNode,
  focusedWorkflowId: string | null = null,
): WorkspaceCanvasModel {
  const internal = parseInternalFlowNodeId(node.id);
  if (internal) {
    return reparentInternalNodeAtAbsolutePosition(
      canvas,
      internal.workflowId,
      internal.nodeId,
      absoluteDraggedInternalPosition(canvas, committedFlowNodes, node, internal.workflowId),
    );
  }
  if (focusedWorkflowId) {
    const focusedWorkflow = canvas.workflows.find((workflow) => workflow.id === focusedWorkflowId);
    if (focusedWorkflow?.internalNodes.some((item) => item.id === node.id)) {
      return moveInternalNode(canvas, focusedWorkflowId, node.id, node.position);
    }
  }
  const workflow = canvas.workflows.find((item) => item.id === node.id);
  if (!workflow) {
    return canvas;
  }
  if (!isExecutableNodeWorkflow(workflow)) {
    return moveRootWorkflow(canvas, workflow.id, node.position);
  }
  const targetWorkflow = workflowAtNodeRect(canvas, {
    x: node.position.x,
    y: node.position.y,
    width: AGENT_TOOL_NODE_SIZE.width,
    height: AGENT_TOOL_NODE_SIZE.height,
  });
  if (!targetWorkflow) {
    return moveRootWorkflow(canvas, workflow.id, node.position);
  }
  const targetNodeId = uniqueId(workflow.id, new Set(targetWorkflow.internalNodes.map((item) => item.id)));
  const internalNode = internalNodeFromExecutableWorkflow(workflow, {
    x: node.position.x - targetWorkflow.position.x,
    y: node.position.y - targetWorkflow.position.y,
  });
  return {
    ...canvas,
    workflows: canvas.workflows
      .filter((item) => item.id !== workflow.id)
      .map((item) =>
        item.id === targetWorkflow.id
          ? expandWorkflowToFitChildrenCenterLocked({
              ...item,
              internalNodes: [...item.internalNodes, { ...internalNode, id: targetNodeId }],
            })
          : item,
      ),
    edges: canvas.edges.filter((edge) => !edgeTouchesNode(edge, workflow.id)),
  };
}

function selectionForDraggedNodeCommit(
  canvas: WorkspaceCanvasModel,
  committedFlowNodes: CanvasFlowNode[],
  node: CanvasFlowNode,
  selection: CanvasSelection,
): CanvasSelection | null {
  if (
    canvas.focusedWorkflowId &&
    selection.type === 'internal' &&
    selection.workflowId === canvas.focusedWorkflowId &&
    selection.nodeId === node.id
  ) {
    return selection;
  }
  const internal = parseInternalFlowNodeId(node.id);
  if (internal) {
    if (
      selection.type !== 'internal' ||
      selection.workflowId !== internal.workflowId ||
      selection.nodeId !== internal.nodeId
    ) {
      return null;
    }
    const absolutePosition = absoluteDraggedInternalPosition(
      canvas,
      committedFlowNodes,
      node,
      internal.workflowId,
    );
    const targetWorkflow = workflowAtNodeRect(
      canvas,
      {
        x: absolutePosition.x,
        y: absolutePosition.y,
        width: AGENT_TOOL_NODE_SIZE.width,
        height: AGENT_TOOL_NODE_SIZE.height,
      },
      internal.workflowId,
    );
    if (targetWorkflow) {
      return {
        type: 'internal',
        workflowId: targetWorkflow.id,
        nodeId: uniqueId(internal.nodeId, new Set(targetWorkflow.internalNodes.map((item) => item.id))),
      };
    }
    const sourceWorkflow = canvas.workflows.find((workflow) => workflow.id === internal.workflowId);
    if (!sourceWorkflow) {
      return null;
    }
    const sourceRect = {
      x: sourceWorkflow.position.x,
      y: sourceWorkflow.position.y,
      width: sourceWorkflow.size.width,
      height: sourceWorkflow.size.height,
    };
    const draggedRect = {
      x: absolutePosition.x,
      y: absolutePosition.y,
      width: AGENT_TOOL_NODE_SIZE.width,
      height: AGENT_TOOL_NODE_SIZE.height,
    };
    return rectIntersectionArea(sourceRect, draggedRect) === 0
      ? {
          type: 'workflow',
          id: uniqueId(internal.nodeId, new Set(canvas.workflows.map((workflow) => workflow.id))),
        }
      : null;
  }
  if (selection.type !== 'workflow' || selection.id !== node.id) {
    return null;
  }
  const workflow = canvas.workflows.find((item) => item.id === node.id);
  if (!workflow || !isExecutableNodeWorkflow(workflow)) {
    return null;
  }
  const targetWorkflow = workflowAtNodeRect(canvas, {
    x: node.position.x,
    y: node.position.y,
    width: AGENT_TOOL_NODE_SIZE.width,
    height: AGENT_TOOL_NODE_SIZE.height,
  });
  return targetWorkflow
    ? {
        type: 'internal',
        workflowId: targetWorkflow.id,
        nodeId: uniqueId(workflow.id, new Set(targetWorkflow.internalNodes.map((item) => item.id))),
      }
    : null;
}

function absoluteDraggedInternalPosition(
  canvas: WorkspaceCanvasModel,
  committedFlowNodes: CanvasFlowNode[],
  node: CanvasFlowNode,
  sourceWorkflowId: string,
): { x: number; y: number } {
  const sourceFlowNode = committedFlowNodes.find((candidate) => candidate.id === sourceWorkflowId);
  if (sourceFlowNode) {
    return {
      x: sourceFlowNode.position.x + node.position.x,
      y: sourceFlowNode.position.y + node.position.y,
    };
  }
  const sourceWorkflow = canvas.workflows.find((workflow) => workflow.id === sourceWorkflowId);
  return {
    x: (sourceWorkflow?.position.x || 0) + node.position.x,
    y: (sourceWorkflow?.position.y || 0) + node.position.y,
  };
}

function moveRootWorkflow(
  canvas: WorkspaceCanvasModel,
  workflowId: string,
  position: { x: number; y: number },
): WorkspaceCanvasModel {
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) =>
      workflow.id === workflowId ? { ...workflow, position } : workflow,
    ),
  };
}

function reparentInternalNodeAtAbsolutePosition(
  canvas: WorkspaceCanvasModel,
  sourceWorkflowId: string,
  nodeId: string,
  absolutePosition: { x: number; y: number },
): WorkspaceCanvasModel {
  const sourceWorkflow = canvas.workflows.find((workflow) => workflow.id === sourceWorkflowId);
  const node = sourceWorkflow?.internalNodes.find((item) => item.id === nodeId);
  if (!sourceWorkflow || !node) {
    return canvas;
  }
  const targetWorkflow = workflowAtNodeRect(
    canvas,
    {
      x: absolutePosition.x,
      y: absolutePosition.y,
      width: AGENT_TOOL_NODE_SIZE.width,
      height: AGENT_TOOL_NODE_SIZE.height,
    },
    sourceWorkflowId,
  );
  if (targetWorkflow) {
    const targetNodeId = uniqueId(nodeId, new Set(targetWorkflow.internalNodes.map((item) => item.id)));
    return {
      ...canvas,
      workflows: canvas.workflows.map((workflow) => {
        if (workflow.id === sourceWorkflowId) {
          return {
            ...workflow,
            internalNodes: workflow.internalNodes.filter((item) => item.id !== nodeId),
            internalEdges: workflow.internalEdges.filter((edge) => !edgeTouchesNode(edge, nodeId)),
          };
        }
        if (workflow.id === targetWorkflow.id) {
          return expandWorkflowToFitChildrenCenterLocked({
            ...workflow,
            internalNodes: [
              ...workflow.internalNodes,
              {
                ...node,
                id: targetNodeId,
                position: {
                  x: absolutePosition.x - workflow.position.x,
                  y: absolutePosition.y - workflow.position.y,
                },
              },
            ],
          });
        }
        return workflow;
      }),
    };
  }
  const sourceRect = {
    x: sourceWorkflow.position.x,
    y: sourceWorkflow.position.y,
    width: sourceWorkflow.size.width,
    height: sourceWorkflow.size.height,
  };
  const draggedRect = {
    x: absolutePosition.x,
    y: absolutePosition.y,
    width: AGENT_TOOL_NODE_SIZE.width,
    height: AGENT_TOOL_NODE_SIZE.height,
  };
  if (rectIntersectionArea(sourceRect, draggedRect) === 0) {
    const rootNode = executableWorkflowFromInternalNode(node, absolutePosition, canvas);
    return {
      ...canvas,
      workflows: [
        ...canvas.workflows
          .map((workflow) =>
            workflow.id === sourceWorkflowId
              ? {
                  ...workflow,
                  internalNodes: workflow.internalNodes.filter((item) => item.id !== nodeId),
                  internalEdges: workflow.internalEdges.filter((edge) => !edgeTouchesNode(edge, nodeId)),
                }
      : workflow,
          ),
        rootNode,
      ],
    };
  }
  const relativePosition = {
    x: absolutePosition.x - sourceWorkflow.position.x,
    y: absolutePosition.y - sourceWorkflow.position.y,
  };
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) =>
      workflow.id === sourceWorkflowId
        ? expandWorkflowToFitChildrenCenterLocked({
            ...workflow,
            internalNodes: workflow.internalNodes.map((item) =>
              item.id === nodeId ? { ...item, position: relativePosition } : item,
            ),
          })
        : workflow,
    ),
  };
}

function internalNodeFromExecutableWorkflow(
  workflow: WorkflowContainerModel,
  position: { x: number; y: number },
): InternalNodeView {
  const wrapped = workflow.internalNodes[0];
  return {
    id: workflow.id,
    name: workflow.title,
    task: wrapped?.task || workflow.callableId || workflow.title,
    kind: workflow.sourceKind === 'tool' ? 'Tool' : 'Agent',
    status: workflow.status,
    callableId: workflow.callableId || wrapped?.callableId,
    runtime: workflow.callableId || wrapped?.runtime,
    input: workflow.sourceInput || wrapped?.input,
    inputPorts: workflow.inputPorts,
    outputPorts: workflowOutputPorts(workflow),
    control: workflow.control || wrapped?.control,
    outputSchema: workflow.outputSchema || wrapped?.outputSchema,
    forwardMainOutputOnControl:
      workflow.forwardMainOutputOnControl ?? wrapped?.forwardMainOutputOnControl ?? null,
    emptyInputPolicy: workflow.emptyInputPolicy ?? wrapped?.emptyInputPolicy ?? 'allow',
    position,
  };
}

function executableWorkflowFromInternalNode(
  node: InternalNodeView,
  position: { x: number; y: number },
  canvas: WorkspaceCanvasModel,
): WorkflowContainerModel {
  const id = uniqueId(node.id, new Set(canvas.workflows.map((workflow) => workflow.id)));
  return {
    id,
    title: node.name,
    sourceKind: node.kind === 'Tool' ? 'tool' : 'agent_session',
    callableId: node.callableId || node.runtime,
    sourceInput: node.input,
    control: node.control,
    outputSchema: node.outputSchema,
    forwardMainOutputOnControl: node.forwardMainOutputOnControl ?? null,
    emptyInputPolicy: node.emptyInputPolicy,
    directory: 'Root canvas environment',
    status: node.status,
    inputPorts: node.inputPorts || [port('main', 'input', 'input')],
    outputPorts: internalNodeOutputPorts(node),
    internalNodes: [],
    internalEdges: [],
    position,
    size: AGENT_TOOL_NODE_SIZE,
    warnings: [],
  };
}

function workflowSummaryForRef(
  workflows: WorkflowSummary[],
  workflowRef: string | undefined,
): WorkflowSummary | undefined {
  if (!workflowRef) {
    return undefined;
  }
  const normalized = workflowRef.replace(/\\/gu, '/');
  return workflows.find((workflow) => {
    const path = workflow.path.replace(/\\/gu, '/');
    return path === normalized || workflow.workflow_id === workflowRef || workflow.file_id === workflowRef;
  });
}

function isChildWorkflowSummary(workflow: WorkflowSummary): boolean {
  const id = workflow.workflow_id || workflow.file_id || '';
  const path = workflow.path || '';
  return /__[^/\\]+\.accflow\.json$/u.test(path) || id.includes('__');
}

function uniqueInvocationLabel(baseLabel: string, existingLabels: Set<string>): string {
  const normalizedBase = baseLabel.trim() || 'Invocation';
  if (!existingLabels.has(normalizedBase)) {
    return normalizedBase;
  }
  let index = 2;
  let nextLabel = `${normalizedBase} #${index}`;
  while (existingLabels.has(nextLabel)) {
    index += 1;
    nextLabel = `${normalizedBase} #${index}`;
  }
  return nextLabel;
}

function isTextEditingKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], .cm-editor, .monaco-editor'));
}

function isNodeDetailDoubleClickIgnored(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest(
      'button, input, textarea, select, [contenteditable="true"], .workflow-port-click-target, .workflow-port-node, .workflow-control-handle, .react-flow__handle',
    ),
  );
}

function isInspectableNodeSelection(selection: CanvasSelection): boolean {
  return selection.type === 'workflow' || selection.type === 'internal';
}

function isNodeDetailModel(model: SelectedEntityDetailsModel): boolean {
  return model.kind === 'node' || model.kind === 'internal-node' || model.kind === 'workflow';
}

function selectionKey(selection: CanvasSelection): string {
  if (selection.type === 'task_canvas') {
    return `task:${selection.taskId}`;
  }
  if (selection.type === 'workflow') {
    return `${selection.type}:${selection.id}`;
  }
  if (selection.type === 'edge') {
    return `edge:${selection.scopeWorkflowId || 'root'}:${selection.id}`;
  }
  if (selection.type === 'port') {
    return `port:${selection.workflowId}:${selection.direction}:${selection.portId}`;
  }
  return `internal:${selection.workflowId}:${selection.nodeId}`;
}

function addWorkflowFromPalette(
  canvas: WorkspaceCanvasModel,
  item: Extract<PaletteItem, { kind: 'workflow' }>,
  position: { x: number; y: number },
): WorkspaceCanvasModel {
  const baseId = slugId(item.workflowRef || item.label || 'workflow');
  const id = uniqueId(baseId || 'workflow', new Set(canvas.workflows.map((workflow) => workflow.id)));
  const invocationLabel = uniqueInvocationLabel(
    item.label || id,
    new Set(canvas.workflows.map(workflowInvocationLabel)),
  );
  const workflow: WorkflowContainerModel = {
    id,
    title: invocationLabel,
    invocationLabel,
    sourceKind: 'workflow',
    workflowBodyKind: 'inline_container',
    workflowRef: item.workflowRef,
    directory: '未绑定工作目录',
    bindingPath: `bindings/${id}.binding.local.json`,
    status: 'not_run',
    inputPorts: [port('main', '输入', 'input')],
    outputPorts: [port('main', '输出', 'output')],
    internalNodes: [],
    internalEdges: [],
    position,
    size: DEFAULT_CONTAINER_SIZE,
    warnings: [],
  };
  return { ...canvas, workflows: [...canvas.workflows, workflow] };
}

function nextPaletteSelection(
  canvas: WorkspaceCanvasModel,
  item: Exclude<PaletteItem, { kind: 'workflow' }>,
  targetWorkflowId: string | null,
): CanvasSelection {
  if (targetWorkflowId) {
    const workflow = canvas.workflows.find((candidate) => candidate.id === targetWorkflowId);
    const existingIds = new Set(workflow?.internalNodes.map((node) => node.id) || []);
    return {
      type: 'internal',
      workflowId: targetWorkflowId,
      nodeId: uniqueId(paletteItemBaseId(item), existingIds),
    };
  }
  return {
    type: 'workflow',
    id: uniqueId(paletteItemBaseId(item), new Set(canvas.workflows.map((workflow) => workflow.id))),
  };
}

function addCallableNodeFromPalette(
  canvas: WorkspaceCanvasModel,
  item: Exclude<PaletteItem, { kind: 'workflow' }>,
  position: { x: number; y: number },
): WorkspaceCanvasModel {
  const existingIds = new Set(canvas.workflows.map((workflow) => workflow.id));
  const existingLabels = new Set(canvas.workflows.map(workflowInvocationLabel));
  const node = internalNodeFromPaletteItem(item, position, existingIds, existingLabels);
  const id = node.id;
  const workflow: WorkflowContainerModel = {
    id,
    title: node.name,
    invocationLabel: node.invocationLabel || node.name,
    sourceKind: node.kind === 'Tool' ? 'tool' : 'agent_session',
    callableId: node.callableId,
    sourceInput: node.input,
    control: node.control,
    outputSchema: node.outputSchema,
    forwardMainOutputOnControl: node.forwardMainOutputOnControl ?? null,
    directory: 'Root canvas environment',
    status: 'not_run',
    inputPorts: node.inputPorts || [port('main', 'input', 'input')],
    outputPorts: internalNodeOutputPorts(node),
    internalNodes: [],
    internalEdges: [],
    position,
    size: AGENT_TOOL_NODE_SIZE,
    warnings: [],
  };
  return { ...canvas, workflows: [...canvas.workflows, workflow] };
}

function addInternalNodeFromPalette(
  canvas: WorkspaceCanvasModel,
  workflowId: string,
  item: Exclude<PaletteItem, { kind: 'workflow' }>,
  position: { x: number; y: number },
): WorkspaceCanvasModel {
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
      if (workflow.id !== workflowId) {
        return workflow;
      }
      const existingIds = new Set(workflow.internalNodes.map((node) => node.id));
      const existingLabels = new Set(workflow.internalNodes.map(internalInvocationLabel));
      const node = internalNodeFromPaletteItem(item, position, existingIds, existingLabels);
      return expandWorkflowToFitChildren({ ...workflow, internalNodes: [...workflow.internalNodes, node] });
    }),
  };
}

function addInternalNodeFromPaletteWithConnection(
  canvas: WorkspaceCanvasModel,
  workflowId: string,
  item: Exclude<PaletteItem, { kind: 'workflow' }>,
  position: { x: number; y: number },
  pendingConnection?: PendingCanvasConnection,
): WorkspaceCanvasModel {
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
      if (workflow.id !== workflowId) {
        return workflow;
      }
      const existingIds = new Set(workflow.internalNodes.map((node) => node.id));
      const existingLabels = new Set(workflow.internalNodes.map(internalInvocationLabel));
      const node = internalNodeFromPaletteItem(item, position, existingIds, existingLabels);
      const pendingEdge = pendingConnection
        ? edgeFromPendingConnection(
            { ...focusCanvas(canvas, workflowId), workflows: [] },
            pendingConnection,
            node.id,
          )
        : null;
      return expandWorkflowToFitChildren({
        ...workflow,
        internalNodes: [...workflow.internalNodes, node],
        internalEdges: pendingEdge
          ? [...workflow.internalEdges.filter((edge) => edge.id !== pendingEdge.id), pendingEdge]
          : workflow.internalEdges,
      });
    }),
  };
}

function internalNodeFromPaletteItem(
  item: Exclude<PaletteItem, { kind: 'workflow' }>,
  position: { x: number; y: number },
  existingIds: Set<string>,
  existingLabels: Set<string> = new Set(),
): InternalNodeView {
  const callableId = item.kind === 'file_source' ? 'file-source.local' : item.callableId;
  const id = uniqueId(paletteItemBaseId(item), existingIds);
  const isTool = item.kind === 'tool' || item.kind === 'file_source';
  const invocationLabel = uniqueInvocationLabel(item.label || callableId || id, existingLabels);
  const task = isTool ? '本地工具节点' : invocationLabel;
  return {
    id,
    name: invocationLabel,
    invocationLabel,
    task,
    kind: isTool ? 'Tool' : 'Agent',
    status: 'not_run',
    callableId,
    runtime: callableId,
    input:
      item.kind === 'file_source'
        ? { path: '' }
        : { user_prompt: invocationLabel },
    inputPorts:
      item.kind === 'file_source'
        ? [port('main', 'input', 'input')]
        : item.inputPorts || [port('main', 'input', 'input')],
    outputPorts:
      item.kind === 'file_source'
        ? [port('main', 'output', 'output')]
        : outputPortsFromSchema(item.outputSchema, item.outputPorts || [port('main', 'output', 'output')]),
    outputSchema: item.kind === 'file_source' ? undefined : item.outputSchema,
    forwardMainOutputOnControl: null,
    position,
  };
}

function paletteItemBaseId(item: Exclude<PaletteItem, { kind: 'workflow' }>): string {
  const stableRef = item.kind === 'file_source' ? item.callableId : item.callableId;
  return slugId(stableRef || item.label || 'node');
}

function edgeFromPendingConnection(
  canvas: WorkspaceCanvasModel,
  pending: PendingCanvasConnection,
  newNodeId: string,
): WorkflowCanvasEdge | null {
  const sourceHandle = parsePortToken(pending.handleId);
  if (pending.mode === 'control') {
    const sourceNodeId = sourceHandle?.workflowId || pending.nodeId;
    if (!sourceNodeId || isWorkflowBoundaryId(sourceNodeId) || isWorkflowBoundaryId(newNodeId)) {
      return null;
    }
    return controlEdge(sourceNodeId, newNodeId);
  }
  if (!sourceHandle) {
    return null;
  }
  if (sourceHandle.direction === 'output') {
    return dataEdge(sourceHandle.workflowId, sourceHandle.portId, newNodeId, 'main');
  }
  return dataEdge(newNodeId, 'main', sourceHandle.workflowId, sourceHandle.portId);
}

function flowPositionFromEvent(
  flowInstance: { screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number } } | null,
  event: { clientX: number; clientY: number; currentTarget: HTMLElement },
): { x: number; y: number } {
  return flowPositionFromPoint(flowInstance, { x: event.clientX, y: event.clientY }, event.currentTarget);
}

function flowPositionFromPoint(
  flowInstance: { screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number } } | null,
  point: { x: number; y: number },
  fallbackElement?: HTMLElement,
): { x: number; y: number } {
  if (flowInstance) {
    return flowInstance.screenToFlowPosition(point);
  }
  if (fallbackElement) {
    const bounds = fallbackElement.getBoundingClientRect();
    return { x: point.x - bounds.left, y: point.y - bounds.top };
  }
  return point;
}

function pointerPoint(event: CanvasPointerEvent): { x: number; y: number } {
  if ('changedTouches' in event && event.changedTouches.length > 0) {
    return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
  }
  return { x: (event as MouseEvent | ReactMouseEvent<Element>).clientX, y: (event as MouseEvent | ReactMouseEvent<Element>).clientY };
}

function viewportViewBox(): string {
  if (typeof window === 'undefined') {
    return '0 0 1 1';
  }
  return `0 0 ${Math.max(1, window.innerWidth)} ${Math.max(1, window.innerHeight)}`;
}

function connectionPreviewFromHandle(handle: HTMLElement, fallback: { x: number; y: number }): ConnectPreviewState {
  const rect = handle.getBoundingClientRect();
  const start = rect.width > 0 || rect.height > 0
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : fallback;
  return { start, end: fallback };
}

function slugId(value: string): string {
  const slug = value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 48);
  return slug || 'node';
}

function isJsdomRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.navigator?.userAgent?.toLowerCase().includes('jsdom')
  );
}




function evidenceActionByLabel(
  actions: SelectedDetailsEvidenceAction[],
  label: string,
): SelectedDetailsEvidenceAction | undefined {
  return actions.find((action) => action.label === label);
}

async function readEvidenceContent(path: string, runId?: string | null): Promise<ArtifactContent> {
  if (runId) {
    try {
      return await api.runEvidence(runId, path);
    } catch {
      // Non-run artifacts still use the registered artifact boundary.
    }
  }
  return api.artifact(path);
}


function agentEventsLiveText(events: RunEvent[]): string {
  const lines = events
    .filter((event) => String(event.type || event.event || '').startsWith('agent_'))
    .slice(-80)
    .map(agentEventLiveLine)
    .filter(Boolean);
  return lines.length ? ['[agent events]', ...lines].join('\n') : '';
}

function agentEventLiveLine(event: RunEvent): string {
  const type = String(event.type || event.event || 'agent_event');
  const timestamp = event.timestamp ? `${event.timestamp} ` : '';
  const payload = isPlainRecord(event.payload) ? event.payload : {};
  if (type === 'agent_message') {
    const content = stringValue(payload.content);
    return `${timestamp}assistant: ${compactText(assistantMessageDisplayContent(content))}`;
  }
  if (type === 'agent_output_draft') {
    return `${timestamp}草稿已生成 ${shortPath(stringValue(payload.output_path))}`;
  }
  if (type === 'agent_output_published') {
    return `${timestamp}输出已发布 ${shortPath(stringValue(payload.output_path))}`;
  }
  if (type === 'agent_turn_started') {
    return `${timestamp}agent turn started`;
  }
  if (type === 'agent_turn_completed') {
    return `${timestamp}agent turn completed`;
  }
  if (type === 'agent_turn_failed') {
    return `${timestamp}agent turn failed: ${compactText(stringValue(payload.error) || stringValue(payload.message))}`;
  }
  if (type === 'agent_status') {
    return `${timestamp}${readableAgentStatus(payload)}`;
  }
  return `${timestamp}${type}: ${agentEventSummary(event)}`;
}

function readableAgentStatus(payload: Record<string, unknown>): string {
  const status = stringValue(payload.status);
  const item = isPlainRecord(payload.item) ? payload.item : {};
  const method = stringValue(payload.method);
  const itemType = stringValue(item.type);
  const query = stringValue(item.query);
  const action = isPlainRecord(item.action) ? item.action : {};
  const actionQuery = stringValue(action.query);
  const queries = Array.isArray(action.queries)
    ? action.queries.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  if (query || actionQuery || queries.length) {
    return `搜索 ${compactText(query || actionQuery || queries.join('; '))}`;
  }
  if (itemType === 'reasoning') {
    return method.endsWith('/completed') ? 'reasoning completed' : 'reasoning started';
  }
  if (itemType) {
    return `${itemType} ${method || status || 'updated'}`;
  }
  if (status) {
    return `status ${status}`;
  }
  return 'agent status updated';
}







function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inspectorDrawerTitle(selection: CanvasSelection): string {
  if (selection.type === 'port') {
    return '端口设置';
  }
  if (selection.type === 'edge') {
    return '连接设置';
  }
  if (selection.type === 'workflow' || selection.type === 'internal') {
    return '节点设置';
  }
  return '任务设置';
}

function callableDisplayTitle(detail: Pick<CallableDetail, 'id' | 'name' | 'metadata'>): string {
  const metadataName = detail.metadata?.name;
  return detail.name || (typeof metadataName === 'string' ? metadataName : '') || detail.id;
}

function callableDescription(detail: Pick<CallableDetail, 'description' | 'metadata'>): string {
  const metadataDescription = detail.metadata?.description;
  return detail.description || (typeof metadataDescription === 'string' ? metadataDescription : '');
}

function providerLabelFromCallable(detail: Pick<CallableDetail, 'runtime' | 'runner' | 'metadata'>): string {
  const provider = detail.metadata?.agent_provider;
  if (typeof provider === 'string' && provider.trim()) {
    return providerLabel(provider);
  }
  const runtime = detail.runtime || detail.runner || '';
  if (runtime.includes('codex')) {
    return 'Codex';
  }
  if (runtime.includes('claude')) {
    return 'Claude';
  }
  if (runtime.includes('generic')) {
    return '自定义 CLI';
  }
   return runtime || '默认 Agent';
}

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    codex: 'Codex',
    claude: 'Claude',
    hermes: 'Hermes',
    cursor: 'Cursor',
    gemini: 'Gemini',
    generic_cli: '自定义 CLI',
  };
  return labels[provider] || provider;
}

function skillsFromMetadata(metadata?: Record<string, unknown>): string[] {
  const skills = metadata?.skills;
  if (!Array.isArray(skills)) {
    return [];
  }
  return skills.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function thinkingLabel(value: string): string {
  const labels: Record<string, string> = {
    low: '轻量',
    medium: '标准',
    high: '深入',
    max: '极限',
  };
  return labels[value] || value || '标准';
}

function schemaFieldsFromPorts(
  ports: Record<string, unknown> | undefined,
  fallbackPorts: WorkflowPortView[],
): SchemaFieldCard[] {
  if (ports && Object.keys(ports).length > 0) {
    return Object.entries(ports).map(([name, value]) => schemaFieldFromValue(name, value));
  }
  return fallbackPorts.map((portValue) => ({
    name: portValue.label || portValue.id,
    type: portValue.artifactTypes?.join(', ') || '数据',
    required: Boolean(portValue.required),
    description: `${portValue.direction === 'input' ? '输入端口' : '输出端口'}: ${portValue.id}`,
  }));
}

function schemaFieldsFromArtifactContract(contract: Record<string, unknown> | unknown[] | undefined): SchemaFieldCard[] {
  if (!isPlainRecord(contract)) {
    return [];
  }
  const outputSchema = contract.output_schema;
  return schemaFieldsFromJsonSchema(outputSchema);
}

function schemaFieldsFromJsonSchema(schema: unknown): SchemaFieldCard[] {
  if (!isPlainRecord(schema)) {
    return [];
  }
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : [];
  const properties = schema.properties;
  if (isPlainRecord(properties)) {
    return Object.entries(properties).map(([name, value]) => ({
      ...schemaFieldFromValue(name, value),
      required: required.includes(name),
    }));
  }
  return [];
}

function schemaFieldFromValue(name: string, value: unknown): SchemaFieldCard {
  if (!isPlainRecord(value)) {
    return {
      name,
      type: typeof value === 'string' ? value : '数据',
      required: false,
      description: '',
    };
  }
  const nestedSchema = isPlainRecord(value.schema) ? value.schema : undefined;
  const typeValue = value.type || nestedSchema?.type || value.kind || value.format || '数据';
  const description = value.description || value.label || nestedSchema?.description || '';
  const example = value.example ?? value.default ?? nestedSchema?.example ?? nestedSchema?.default;
  return {
    name,
    type: Array.isArray(typeValue) ? typeValue.join(' / ') : String(typeValue),
    required: Boolean(value.required),
    description: typeof description === 'string' ? description : '',
    example: example === undefined ? undefined : String(example),
  };
}

function dedupeSchemaFields(fields: SchemaFieldCard[]): SchemaFieldCard[] {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = `${field.name}:${field.type}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueId(baseId: string, existingIds: Set<string>): string {
  let id = baseId;
  let index = 1;
  while (existingIds.has(id)) {
    index += 1;
    id = `${baseId}_${index}`;
  }
  return id;
}


function textArtifact(name: string, content: string, type: ArtifactContent['type']): ArtifactContent {
  return { name, path: name, content, type, size_bytes: content.length };
}

function artifactNameFromPath(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).pop() || path;
}

function truncateLargeLog(content: ArtifactContent): ArtifactContent {
  if (content.type !== 'log') {
    return content;
  }
  const lines = content.content.split(/\r?\n/u);
  if (lines.length <= MAX_LOG_PREVIEW_LINES) {
    return content;
  }
  return {
    ...content,
    content: [
      `日志较大，仅显示最后 ${MAX_LOG_PREVIEW_LINES} 行。`,
      '',
      ...lines.slice(-MAX_LOG_PREVIEW_LINES),
    ].join('\n'),
  };
}

function findCallableId(command: unknown): string {
  if (!Array.isArray(command)) {
    return '';
  }
  const runIndex = command.lastIndexOf('run');
  const candidate = command[runIndex + 1];
  return typeof candidate === 'string' && candidate.includes('.') ? candidate : '';
}

export {
  AgentToolNode,
  WorkspaceCanvas,
  addCallableNodeFromPalette,
  addInternalNodeFromPalette,
  addWorkflowFromPalette,
  applyCanvasAuthoringProposal,
  buildDeterministicCanvasAuthoringProposal,
  captureAuthoringSnapshot,
  canvasToWorkflowGraph,
  canvasEdgeToFlowEdge,
  connectionCandidatesFromPendingEndpoint,
  connectionFromPendingEndpoint,
  controlEdgeMainTransferMode,
  reverseConnection,
  resolveScopedConnection,
  isConnectionHandleForMode,
  outputPortsFromSchema,
  effectiveOutputPortsForNode,
  createDataEdgeCommand,
  addPortToDataConnectNode,
  renamePortOnDataConnectNode,
  deletePortFromDataConnectNode,
  temporaryResourceIssueForCanvas,
  temporaryResourceIssueForGraph,
  validateCanvasAuthoringProposal,
  expandWorkflowToFitChildren,
  expandWorkflowToFitChildrenCenterLocked,
  graphToWorkspaceCanvas,
  edgeCanonicalPreview,
  internalInvocationLabel,
  isExecutableNodeWorkflow,
  layoutCanvasForSelection,
  reusableWorkflowClassGraph,
  layoutWorkspaceCanvas,
  workspaceDemoCanvas,
  nextRootPalettePosition,
  nodeRunForInternalNode,
  nodeRunHasWorkflowInputBinding,
  nodeLiveLogsFor,
  workflowMainInputBindingState,
  nodeLogDeltaKeys,
  normalizeSelectionIntent,
  normalizeWorkbenchSelection,
  deleteSelectionFromCanvas,
  selectionCanBeDeleted,
  shouldDisconnectEdgeOnClick,
  promptFromInvocationInput,
  staticInputFromInvocationInput,
  workflowInvocationLabel,
  boundedLiveEvents,
  filterLiveEvents,
  liveStateForNodeRun,
  liveEventFromAgentRunEvent,
  assistantDisplayStatus,
  buildAssistantTranscriptItems,
  // Re-export extracted modules for migration period.
  AssistantDrawerExtracted,
  AssistantDockContentExtracted,
  AssistantControlRailExtracted,
  AssistantProposalSummaryExtracted,
  SelectedNodeRuntimePaneExtracted,
  ExecutionDockExtracted,
  LiveOutputViewerExtracted,
  NodeDetailOverlayExtracted,
  SelectionDetailsDockExtracted,
};
