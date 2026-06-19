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
  FileText,
  FolderCog,
  GitBranch,
  LayoutDashboard,
  Link2,
  Bot,
  RefreshCw,
  TestTube,
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

import { api } from '../api';
import { shortPath, statusTone } from '../format';
import type {
  AgentMessage,
  AgentSessionRecord,
  AgentTurnRecord,
  ArtifactContent,
  AuthoringAgentSummary,
  AuthoringRequiredAction,
  CallableDetail,
  CallableSummary,
  GraphOpsDryRunPayload,
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
  graphOpsTransactionForTemporaryAgent,
  isTemporaryCallableId,
  persistentCallableIdForDraft,
} from '../workbench/model/graphOpsProposal';
import {
  authoringBackendCanvasSnapshot,
  authoringOperationSummary,
  authoringSelectionPayload,
  authoringTargetFromSelection,
  authoringValidationFromBackend,
  canvasAuthoringHash,
  effectiveAssistantTurnReason,
  isInspectableNodeSelection,
  mergeAuthoringValidation,
  replaceTemporaryResourceWithCallable,
  temporaryResourceIssueForCanvas,
  temporaryResourceIssueForGraph,
} from '../workbench/model/authoringProposal';
import {
  applyCanvasAuthoringProposal,
  authoringId,
  buildDeterministicCanvasAuthoringProposal,
  captureAuthoringSnapshot,
  validateCanvasAuthoringProposal,
} from './authoring/authoringRuntime';
import {
  addCallableNodeFromPalette,
  addInternalNodeFromPalette,
  addWorkflowFromPalette,
  internalNodeFromPaletteItem,
  nextPaletteSelection,
  paletteItemBaseId,
  slugId,
  uniqueId,
} from '../workbench/model/paletteCanvasOps';
import {
  addPortToDataConnectNode,
  canvasEdgesAreEquivalent,
  connectionCandidatesFromPendingEndpoint,
  connectionFromPendingEndpoint,
  controlSlotLimitIssue,
  controlSourceTokenId,
  controlTargetTokenId,
  controlEdgeWithId,
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
  normalizeCanvasEdges,
  parsePortToken,
  portTokenId,
  renamePortOnDataConnectNode,
  resolveScopedConnection,
  reverseConnection,
  tryCommitResolvedConnection,
  uniqueCanvasEdges,
  uniqueEdgeIdForScope,
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
  AgentNodeConnectionEditor,
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
  CanvasAuthoringValidationResult,
  CanvasSelection,
  CodexExecutionMode,
  ConnectionMode,
  DataConnectionDraft,
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
import {
  useBoundaryTransferPreview,
  useBoundaryTransferValidation,
} from '../hooks/useBoundaryTransferPreview';
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
  AgentToolNode,
  FlowNodeLayoutContext,
  WorkflowContainer,
  nodeTypes,
  type AgentToolFlowNode,
  type CanvasFlowNode,
  type WorkflowFlowNode,
} from './canvas/NodeRenderer';
import {
  closestConnectionHandle,
  connectionHandleSelector,
  connectionModeForHandleElement,
  connectionSideFromHandleElement,
  isConnectionHandleForMode,
  queueControlHandleConnectionStart,
} from './canvas/connectionDom';
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

import { ExecutionDock as ExecutionDockComponent } from './execution';
import { LiveOutputViewer } from './execution/RunOverlay';
import { DataConnectionsPanel } from './inspector/DataConnectionsPanel';
import { NodeDetailOverlay } from './inspector/NodeDetailOverlay';
import { RightInspector } from './inspector/RightInspector';
import {
  SelectionDetailsDock,
  evidenceContentForCurrentSelection,
} from './inspector/SelectionDetailsDock';
import {
  SaveWorkflowDialog as SaveWorkflowDialogComponent,
  TaskOverviewPage as TaskOverviewPageComponent,
  TaskWorkspaceSwitcher as TaskWorkspaceSwitcherComponent,
  TopBar as TopBarComponent,
  WorkbenchShell,
  type SaveWorkflowDialogState,
} from './workbench';
import { useAssistantTurnStream } from '../hooks/useAssistantStream';
import { useArtifactContentCache } from '../hooks/useArtifactContentCache';
import { useAssistantSession } from '../hooks/useAssistantSession';
import { useRunStream } from '../hooks/useRunStream';
import { useSelectedAgentSession, type AgentSessionUiState } from '../hooks/useSelectedAgentSession';
import { useOpenedWorkflowLoader } from '../hooks/useOpenedWorkflowLoader';
import { useNodeRunDetails } from '../hooks/useNodeRunDetails';
import { useCallableDetail, type CallableDetailLoadState } from '../hooks/useCallableDetail';
import { useGraphOpsPersistence } from '../hooks/useGraphOpsPersistence';
import { useRunRestorationLoader } from '../hooks/useRunRestorationLoader';
import { useRunRefreshLoader } from '../hooks/useRunRefreshLoader';
import { useRunnerSubmit } from '../hooks/useRunnerSubmit';
import { useSelectedAgentActions } from '../hooks/useSelectedAgentActions';
import { useSubmittedRunPolling } from '../hooks/useSubmittedRunPolling';
import { useTaskPersistence } from '../hooks/useTaskPersistence';
import { useWorkbenchAssistantActions } from '../hooks/useWorkbenchAssistantActions';
import {
  assistantDisplayStatus,
  buildAssistantTranscriptItems,
  graphOpsStringList,
  type AssistantDisplayStatus,
  type AssistantTranscriptItem,
} from './assistant/assistantTranscript';
import { AssistantDockContent } from './assistant/AssistantConsole';
import { useWorkbenchTaskDurability } from '../hooks/useWorkbenchTaskDurability';
import {
  useWorkbenchTaskCanvasPersistence,
  type LoadWorkbenchTaskCanvas,
  type SaveWorkbenchTaskCanvas,
} from '../hooks/useWorkbenchTaskCanvasPersistence';
import {
  useWorkbenchBootstrap,
  useWorkbenchBootstrapLoaders,
} from '../hooks/useWorkbenchBootstrap';
import {
  bindingPathOf,
  bindingRefOfPath,
  useWorkflowBindings,
} from '../hooks/useWorkflowBindings';
import { useWorkflowPersistence } from '../hooks/useWorkflowPersistence';

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

function boundaryTransferPreviewSnapshot(canvas: WorkspaceCanvasModel): Record<string, unknown> {
  const strippedCanvas = stripRuntimeStateFromCanvas(canvas);
  return {
    ...strippedCanvas,
    canonical_graph: canvasToWorkflowGraph(strippedCanvas),
  };
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
  const [bindingEditorWorkflowId, setBindingEditorWorkflowId] = useState<string | null>(null);
  const [evidenceDock, setEvidenceDock] = useState<EvidenceDockState>({
    open: false,
    title: '运行证据',
    content: null,
  });
  const [bottomDockMode, setBottomDockMode] = useState<BottomDockMode>('evidence');
  const [nodeDetailOpen, setNodeDetailOpen] = useState(false);
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
  const graphRef = useRef(sourceGraph);
  const selectedRunId = currentTask?.activeRunId || currentTask?.latestRunId || null;
  const selectedRunProjection = selectedRunId ? runsById[selectedRunId] : undefined;
  const { artifactCacheByPath, ensureArtifactContent, readArtifactContent } =
    useArtifactContentCache({
      runId: selectedRunId,
      normalizeContent: truncateLargeLog,
    });
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

  const addAssistantSystemMessage = useCallback((content: string) => {
    setAssistantMessages((current) => [
      ...current,
      { id: authoringId('assistant_msg'), role: 'system', content },
    ]);
  }, []);
  const ensureAssistantSessionFromPayload = useAssistantSession({
    sessionId: assistantSessionId,
    selectedAuthoringAgentId,
    setAuthoringAgents,
    setSelectedAuthoringAgentId,
    setSessionId: setAssistantSessionId,
    setAgentSession: setAssistantAgentSession,
    setSessionStatus: setAssistantSessionStatus,
    setMessages: setAssistantMessages,
    setBusy: setAssistantBusy,
    addSystemMessage: addAssistantSystemMessage,
  });
  const ensureAssistantSession = useCallback(
    (snapshot = currentAuthoringSnapshot()): Promise<string> =>
      ensureAssistantSessionFromPayload({
        taskId: snapshot.task_id,
        canvasHash: snapshot.snapshot_id,
        canvasSnapshot: authoringBackendCanvasSnapshot(snapshot),
        selection: authoringSelectionPayload(snapshot.selection),
      }),
    [activeTaskId, callables, canvas, ensureAssistantSessionFromPayload, selection, workflows],
  );

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

  const appendRunAgentEventToProjection = useCallback((runId: string, event: RunEvent) => {
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
  }, []);

  const appendRunLiveEvent = useCallback((runId: string, event: WorkbenchLiveEvent) => {
    setRunLiveEventsById((current) => ({
      ...current,
      [runId]: boundedLiveEvents(current[runId] || [], [event]),
    }));
  }, []);

  const { loadRuntimeConfig, loadWorkbenchTaskRecords } = useWorkbenchBootstrapLoaders();
  const { loadWorkbenchTaskCanvas, saveWorkbenchTaskCanvas } = useWorkbenchTaskCanvasPersistence();
  const { validateBoundaryTransfers } = useBoundaryTransferValidation();
  const { pollSubmittedRunUntilTerminal } = useSubmittedRunPolling();
  const { submitRunnerJob } = useRunnerSubmit();
  const {
    loadWorkbenchAssistantSession,
    submitWorkbenchAssistantTurnRequest,
  } = useWorkbenchAssistantActions();
  const {
    createGraphOpsProposalRequest,
    validateGraphOpsProposalRequest,
    dryRunGraphOpsProposalRequest,
    approveGraphOpsProposalRequest,
    applyGraphOpsProposalRequest,
  } = useGraphOpsPersistence();
  const {
    submitSelectedAgentTurnRequest,
    publishSelectedAgentOutputRequest,
    answerSelectedAgentInteractionRequest,
  } = useSelectedAgentActions();
  const { saveWorkflowGraph, validateWorkflowGraph } = useWorkflowPersistence();
  const loadDurableWorkbenchTask = useCallback(
    (taskRecord: Record<string, unknown>) => loadWorkbenchTaskFromBackend(taskRecord, loadWorkbenchTaskCanvas),
    [loadWorkbenchTaskCanvas],
  );
  const persistInitialWorkbenchTask = useCallback(
    (task: WorkbenchTask) =>
      persistWorkbenchTaskToBackend(
        task,
        callablesRef.current,
        workflowsRef.current,
        saveWorkbenchTaskCanvas,
      ),
    [saveWorkbenchTaskCanvas],
  );
  const handleLoadedDurableTasks = useCallback(
    (loadedTasks: WorkbenchTask[], nextActiveTask: WorkbenchTask) => {
      const nextCanvas = normalizeCanvasEdges(nextActiveTask.canvas);
      setTasks(loadedTasks);
      setActiveTaskId(nextActiveTask.taskId);
      setCanvas(nextCanvas);
      const nextGraph = canvasToWorkflowGraph(nextCanvas);
      graphRef.current = nextGraph;
      setSourceGraph(nextGraph);
      setSelection({ type: 'task_canvas', taskId: nextCanvas.id });
      setMessage('已从本地 runner 加载持久化任务');
    },
    [],
  );
  const handleMigratedInitialTasks = useCallback(() => {
    setMessage('已迁移浏览器任务缓存到本地 runner');
  }, []);
  const handleWorkbenchBootstrapError = useCallback((error: unknown) => {
    setMessage(error instanceof Error ? error.message : String(error));
  }, []);

  useWorkbenchBootstrap({
    initialTaskStore,
    loadRuntimeConfig,
    loadWorkbenchTaskRecords,
    loadWorkbenchTask: loadDurableWorkbenchTask,
    persistInitialTask: persistInitialWorkbenchTask,
    onRuntimeConfig: setRuntimeConfig,
    onLoadedTasks: handleLoadedDurableTasks,
    onMigratedInitialTasks: handleMigratedInitialTasks,
    onBootstrapError: handleWorkbenchBootstrapError,
    setDurableTasksReady,
  });

  useEffect(() => {
    if (!assistantOpen || assistantSessionId || assistantBusy) {
      return;
    }
    void ensureAssistantSession().catch(() => {
      // The drawer shows the backend error as a system message.
    });
  }, [assistantBusy, assistantOpen, assistantSessionId, ensureAssistantSession]);

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

  const workflowBindingIds = useMemo(
    () => [canvas.id, ...canvas.workflows.map((item) => item.id)],
    [canvas.id, canvas.workflows],
  );
  const handleWorkflowBindingSaved = useCallback(
    (workflowId: string, normalized: WorkflowBindingView) => {
      updateCanvas((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === workflowId
            ? {
                ...workflow,
                bindingPath: bindingPathOf(normalized),
                directory: workspaceRootOf(normalized),
              }
            : workflow,
        ),
      }));
      setMessage(`已保存 ${workflowId} workspace binding`);
    },
    [updateCanvas],
  );
  const handleWorkflowBindingFolderOpened = useCallback((workflowId: string) => {
    setMessage(`已打开 ${workflowId} 的 bindings 目录`);
  }, []);
  const {
    workflowBindings,
    saveBinding,
    validateBinding,
    openBindingsFolder,
    selectBindingDirectory,
  } = useWorkflowBindings({
    workflowIds: workflowBindingIds,
    onSaved: handleWorkflowBindingSaved,
    onOpenedFolder: handleWorkflowBindingFolderOpened,
  });

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

  const restorationRunId = currentTask?.activeRunId || currentTask?.latestRunId || null;
  const shouldRestoreRun = Boolean(restorationRunId && !runsById[restorationRunId]?.run);
  const handleRunRestorationLoaded = useCallback(
    ({ runId, summary, stateSnapshot, events }: {
      runId: string;
      summary: RunSummary;
      stateSnapshot: WorkflowRunResult | null;
      events: RunEvent[] | null;
    }) => {
      if (!currentTask) {
        return;
      }
      const taskGraph = canvasToWorkflowGraph(currentTask.canvas);
      const restoredRun = stateSnapshot
        ? workflowRunFromRunStateSnapshot(stateSnapshot, taskGraph)
        : workflowRunFromRunSummary(summary, taskGraph);
      const liveRun = events
        ? mergeWorkflowRunWithEvents(
            restoredRun,
            liveWorkflowRunFromEvents(taskGraph, summary.run_dir || `runs/${runId}`, events),
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
          events: events || [],
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
    },
    [currentTask],
  );
  const handleRunRestorationFailed = useCallback((runId: string) => {
    setRunsById((current) => {
      const next = { ...current };
      delete next[runId];
      return next;
    });
  }, []);
  useRunRestorationLoader({
    enabled: shouldRestoreRun,
    runId: restorationRunId,
    onLoaded: handleRunRestorationLoaded,
    onLoadFailed: handleRunRestorationFailed,
  });

  const handleOpenedExternalWorkflow = useCallback((workflow: WorkflowDetail) => {
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
    setMessage(`\u5df2\u6253\u5f00 ${workflow.workflow_id}`);
    setEvidenceDock({ open: false, title: '\u8fd0\u884c\u8bc1\u636e', content: null });
  }, [workflowRun]);
  useOpenedWorkflowLoader({
    enabled: openedExternalWorkflow,
    workflowId: selectedWorkflowId,
    onWorkflowLoaded: handleOpenedExternalWorkflow,
  });

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
  const { nodeRunDetailsByKey } = useNodeRunDetails({
    runId: selectedRunId,
    nodeRun: rawSelectedNodeRun,
    detailKey: rawSelectedNodeRunDetailKey,
    mergeDetail: mergeNodeRunDetail,
  });

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
  const {
    state: agentSessionState,
    refresh: refreshAgentSession,
    setPendingTurn: setAgentSessionPendingTurn,
    appendEvent: appendSelectedAgentSessionEvent,
  } = useSelectedAgentSession(selectedAgentSessionContext);
  const appendRunAgentEvent = useCallback(
    (runId: string, event: RunEvent) => {
      appendRunAgentEventToProjection(runId, event);
      appendSelectedAgentSessionEvent(runId, event);
    },
    [appendRunAgentEventToProjection, appendSelectedAgentSessionEvent],
  );

  useRunStream(selectedRunId, {
    appendNodeLogDelta,
    appendRunAgentEvent,
    appendRunLiveEvent,
    updateRunProjection,
  });
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

  const loadRunRefresh = useRunRefreshLoader();
  const refreshRunProjection = useCallback(
    async (runId: string) => {
      const current = runsById[runId];
      if (!current) {
        return;
      }
      const { summary, stateSnapshot, events } = await loadRunRefresh(runId);
      const snapshotRun = stateSnapshot
        ? workflowRunFromRunStateSnapshot(stateSnapshot, current.graph)
        : workflowRunFromRunSummary(summary, current.graph);
      const liveRun = mergeWorkflowRunWithEvents(
        snapshotRun,
        liveWorkflowRunFromEvents(current.graph, summary.run_dir || current.runDir, events),
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
          events,
          overlay,
        },
      }));
    },
    [loadRunRefresh, runsById],
  );

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
  const publishCurrentTaskSnapshot = useCallback(async () => {
    const snapshot = currentAuthoringSnapshot();
    await saveWorkbenchTaskCanvas(snapshot.task_id, {
      canvas_hash: snapshot.snapshot_id,
      canvas_snapshot: authoringBackendCanvasSnapshot(snapshot),
      selection: authoringSelectionPayload(snapshot.selection),
      temporary_resources: currentAuthoringState.temporaryResources,
    });
  }, [
    activeTaskId,
    canvas,
    selection,
    callables,
    workflows,
    currentAuthoringState.temporaryResources,
    saveWorkbenchTaskCanvas,
  ]);
  const buildBackendTaskSnapshot = useCallback((): WorkbenchTask | null => {
    if (!currentTask) {
      return null;
    }
    return {
      ...currentTask,
      canvas: stripRuntimeStateFromCanvas(canvas),
    };
  }, [canvas, currentTask]);
  const persistBackendTaskSnapshot = useCallback(
    (taskSnapshot: WorkbenchTask) =>
      persistWorkbenchTaskToBackend(taskSnapshot, callables, workflows, saveWorkbenchTaskCanvas),
    [callables, workflows, saveWorkbenchTaskCanvas],
  );
  const handleBackendAutosaveError = useCallback((error: unknown) => {
    console.warn('Workbench task autosave failed', error);
  }, []);
  const handleDurableTaskDeleteError = useCallback((error: unknown) => {
    setMessage(error instanceof Error ? error.message : String(error));
  }, []);
  const { createDurableTask, deleteDurableTask } = useWorkbenchTaskDurability({
    durableTasksReady,
    onDeleteError: handleDurableTaskDeleteError,
  });
  const canUndoAssistantApply =
    Boolean(assistantApplyUndo) &&
    assistantApplyUndo?.taskId === activeTaskId &&
    assistantApplyUndo.afterCanvasHash === currentAuthoringCanvasHash &&
    !isRunning &&
    !assistantPendingTurn;

  useTaskPersistence({
    durableTasksReady,
    activeTaskId,
    tasks,
    saveLocalTaskStore: saveTaskStore,
    snapshotPublishKey: `${activeTaskId}:${currentAuthoringCanvasHash}:${selectionKey(selection)}`,
    publishCurrentSnapshot: publishCurrentTaskSnapshot,
    backendPersistKey: currentTask ? `${activeTaskId}:${currentAuthoringCanvasHash}` : '',
    buildBackendTaskSnapshot,
    persistTaskToBackend: persistBackendTaskSnapshot,
    onBackendAutosaveError: handleBackendAutosaveError,
  });

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
    createDurableTask(task.taskId, task.title);
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
    deleteDurableTask(taskId);
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
    await validateBoundaryTransfers(boundaryTransferPreviewSnapshot(canvas));
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
    const result = await saveWorkflowGraph(graph, true);
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
      const result = await validateWorkflowGraph(graphRef.current.id);
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
      const submitted = await submitRunnerJob(runnableGraph, {
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
      pollSubmittedRunUntilTerminal({
        runId,
        foreground: selectedRunId === runId,
        onSnapshot: ({ summary, stateSnapshot, events }) => {
          const snapshotRun = stateSnapshot
            ? workflowRunFromRunStateSnapshot(stateSnapshot, runnableGraph)
            : workflowRunFromRunSummary(summary, runnableGraph);
          const liveRun = mergeWorkflowRunWithEvents(
            snapshotRun,
            liveWorkflowRunFromEvents(runnableGraph, summary.run_dir || runDir, events),
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
              events,
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
            return true;
          }
          setMessage(`运行 ${liveRun.workflow_id}: ${statusLabel(runStatus)}`);
          onChanged?.();
          return false;
        },
        onError: () => {
          updateRunProjection(runId, (current) => ({ ...current, pollState: 'error' }));
        },
      });
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
    const content = await readArtifactContent(path);
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
          : await loadWorkbenchAssistantSession(sessionId);
      setAssistantAgentSession(currentSession);
      const turn = await submitWorkbenchAssistantTurnRequest(sessionId, {
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
      await createGraphOpsProposalRequest(transaction);
      const validation = await validateGraphOpsProposalRequest(transaction.proposal_id);
      if (validation.status !== 'valid') {
        throw new Error(`GraphOps validate failed: ${JSON.stringify(validation)}`);
      }
      const dryRun = await dryRunGraphOpsProposalRequest(transaction.proposal_id);
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
      await approveGraphOpsProposalRequest(review.proposal.proposal_id, {
        target_paths: review.dryRun.target_paths,
        base_hashes: review.proposal.base.content_hashes,
        dry_run_digest: review.dryRun.dry_run_digest,
      });
      const manifest = await applyGraphOpsProposalRequest(review.proposal.proposal_id);
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
    const turn = await submitSelectedAgentTurnRequest(session.session_id, {
      message: messageText,
      reason,
      expected_provider_session_id:
        typeof session.provider_session_id === 'string' ? session.provider_session_id : undefined,
    });
    setAgentSessionPendingTurn(turn);
    setMessage(`Agent turn ${turn.turn_id}: ${turn.status || 'queued'}`);
    await refreshAgentSession();
  }

  async function publishSelectedAgentOutput(expectedTurnId: string) {
    const session = agentSessionState.session;
    if (!session) {
      throw new Error('当前节点还没有可用的 Agent Session');
    }
    await publishSelectedAgentOutputRequest(session.session_id, expectedTurnId);
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
    await answerSelectedAgentInteractionRequest(runId, interactionId, answer);
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
      <TopBarComponent
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
        <TaskWorkspaceSwitcherComponent value={taskWorkspaceView} onChange={setTaskWorkspaceView} />
        {taskWorkspaceView === 'overview' ? (
          <TaskOverviewPageComponent
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
            <ExecutionDockComponent
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
              renderers={{
                codeBlock: (props) => <CodeBlock {...props} />,
                evidencePreview: (props) => <EvidencePreview {...props} />,
                invocationInputEditor: (props) => <InvocationInputEditor {...props} />,
                invocationIdentityCard: (props) => <InvocationIdentityCard {...props} />,
                liveLogBlocks: (logs) => <LiveLogBlocks liveLogs={logs} />,
                nodeEvidencePaths: (props) => <NodeEvidencePaths {...props} />,
                portList: (props) => <PortList {...props} />,
                eventTimeline: (props) => <EventTimeline {...props} />,
              }}
              renderAgentNodeSettings={(props) => <AgentNodeSettings {...props} />}
              boundaryPreviewSnapshotForCanvas={boundaryTransferPreviewSnapshot}
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
            onClose={() => setNodeDetailOpen(false)}
          >
            <SelectionInputPane
              model={selectedDetailsModelWithAgentEvents}
              artifactCacheByPath={artifactCacheByPath}
              onEnsureArtifactContent={ensureArtifactContent}
            />
            <SelectionPropertiesPane
              model={selectedDetailsModelWithAgentEvents}
              callableState={selectedCallableDetailState}
              runtimeConfig={runtimeConfig}
              agentSessionState={agentSessionState}
              agentLiveState={
                selectedAgentTurnLiveState.events.length ? selectedAgentTurnLiveState : selectedAgentLiveState
              }
              onReadEvidence={readEvidence}
              onRefreshAgentSession={refreshAgentSession}
              onPublishAgentOutput={publishSelectedAgentOutput}
              onAnswerAgentInteraction={answerSelectedAgentInteraction}
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
            <SelectionOutputPane
              model={selectedDetailsModelWithAgentEvents}
              liveState={
                selectedAgentTurnLiveState.events.length ? selectedAgentTurnLiveState : selectedAgentLiveState
              }
              artifactCacheByPath={artifactCacheByPath}
              onEnsureArtifactContent={ensureArtifactContent}
            />
          </NodeDetailOverlay>
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
        <SaveWorkflowDialogComponent
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
            canShowNodeContext={selectedDetailsModelWithAgentEvents.kind !== 'canvas' && selectedDetailsModelWithAgentEvents.kind !== 'empty'}
            runtimePane={<SelectedNodeRuntimePane model={selectedDetailsModelWithAgentEvents} />}
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

type SchemaFieldCard = {
  name: string;
  type: string;
  required: boolean;
  description: string;
  example?: string;
};

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

async function loadWorkbenchTaskFromBackend(
  taskRecord: Record<string, unknown>,
  loadTaskCanvas: LoadWorkbenchTaskCanvas,
): Promise<WorkbenchTask | null> {
  const taskId = typeof taskRecord.task_id === 'string' ? taskRecord.task_id : '';
  if (!taskId) {
    return null;
  }
  let canvasRecord: Record<string, unknown> | null = null;
  try {
    canvasRecord = await loadTaskCanvas(taskId);
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
  saveTaskCanvas: SaveWorkbenchTaskCanvas,
): Promise<void> {
  const canvas = stripRuntimeStateFromCanvas(task.canvas);
  const snapshot = captureAuthoringSnapshot({
    taskId: task.taskId,
    canvas,
    selection: { type: 'task_canvas', taskId: task.taskId },
    callables,
    workflows,
  });
  await saveTaskCanvas(task.taskId, {
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
};
