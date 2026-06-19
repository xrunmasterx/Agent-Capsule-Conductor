import {
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
  type SetStateAction,
} from 'react';

import { api } from '../api';
import { shortPath } from '../format';
import { emptyAssistantTaskState, useAssistantStore } from '../stores/assistantStore';
import { useRunStore } from '../stores/runStore';
import { useWorkbenchStore } from '../stores/workbenchStore';
import type {
  AgentMessage,
  AgentSessionRecord,
  AgentTurnRecord,
  ArtifactContent,
  AuthoringAgentSummary,
  AuthoringRequiredAction,
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
  WorkflowDetail,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowRunResult,
  WorkflowSummary,
} from '../types';
import {
  AGENT_CONTROL_HANDLE_FALLBACK_TOP,
  AGENT_CONTROL_HANDLE_TOP,
  AGENT_DATA_PORT_GAP,
  DEFAULT_WORKFLOW_MAX_CONCURRENCY,
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  INTERNAL_AGENT_TOOL_NODE_SIZE,
  MAX_LOG_PREVIEW_LINES,
  DEFAULT_TASK_ID,
  TEMPORARY_CALLABLE_ID_PREFIX,
  WORKFLOW_INNER_HANDLE_X,
  agentDataPortTop,
} from '../workbench/constants';
import {
  createEmptyTask,
  emptyInputPolicyFromMetadata,
  emptyWorkbenchAuthoringState,
  isActiveRunStatus,
  isActiveTaskStatus,
  nextTaskTitle,
  normalizeTaskRunStatus,
  normalizedCodexExecutionMode,
  taskStatusFromRunStatus,
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
  describeEndpoint,
  deletePortFromDataConnectNode,
  edgeDiagnosticsForCanvasEdge,
  edgeDiagnosticsForWorkflowEdge,
  findDataConnectNode,
  isWorkflowBoundaryEdge,
  isWorkflowInputBoundaryControlBinding,
  isWorkflowOutputBoundaryControlBinding,
  normalizeCanvasEdges,
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
  type ConnectionResolution,
  type DataConnectNodeOption,
  type EdgeDiagnostic,
  type EndpointSide,
  type PendingCanvasConnection,
} from '../workbench/model/canvasEdgeOps';
import {
  clamp,
  expandWorkflowToFitChildren,
  expandWorkflowToFitChildrenCenterLocked,
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
  isActiveCanvasObjectStatus,
  isExecutableNodeWorkflow,
  normalizeSelectionIntent,
  normalizeWorkbenchSelection,
  selectionCanBeDeleted,
  selectionEdgeAddress,
  selectionForEdgeAddress,
  selectionMatchesEdge,
  shouldDisconnectEdgeOnClick,
  type SelectionIntent,
  workflowInvocationLabel,
} from '../workbench/model/selectionModel';
import {
  authoringSelectionLabel,
  workbenchViewProjection,
} from '../workbench/model/workbenchViewProjection';
import {
  bindingDirectory,
  boundaryInputMainConflictMessage,
  boundaryMainBindingLabel,
  controlEdgeMainTransferMode,
  effectiveNodeRunDir,
  nodeLiveLogsFor,
  nodeLogDeltaKeys,
  nodeRunForInternalNode,
  nodeRunForWorkflow,
  normalizeRunDirKey,
  selectedNodeRunForSelection,
  sameRunDir,
  selectedEntityDetailsModel,
  selectedNodeSettingsModel,
  statusLabel,
  workflowMainInputBindingState,
  workspaceRootOf,
  type NodeRunLookupContext,
} from '../workbench/model/selectedNodeModel';
import { workspaceDemoCanvas } from '../workbench/model/workspaceDemoCanvas';
import {
  graphToWorkspaceCanvas,
} from '../workbench/model/canvasProjection';
import type {
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
  SelectedEntityDetailsModel,
  TaskWorkspaceView,
  TemporaryResourceDraft,
  TemporaryResourceDraftStatus,
  WorkbenchChromeState,
  WorkbenchTask,
  WorkflowCanvasEdge,
  WorkflowContainerModel,
  WorkflowMainInputBindingState,
  WorkflowPortView,
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
  filterLiveEvents,
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
  isSchemaDerivedOutputPort,
  outputPortTooltip,
  outputPortsFromSchema,
} from '../workbench/model/schemaPorts';
import {
  canvasToWorkflowGraph,
  edgeCanonicalPreview,
  graphForCurrentView,
  internalNodeInputPorts,
  internalNodeInvocationPreview,
  internalNodeOutputPorts,
  internalWorkflowToGraph,
  isInlineWorkflowContainer,
  port,
  workflowInvocationPreview,
  workflowOutputPorts,
  workflowOutputPortsReadonly,
} from '../workbench/model/workflowGraphProjection';
import {
  graphFromLegacyWorkflow,
  nodeRunProjectionKey,
  normalizeWorkflowGraph,
  reusableWorkflowClassGraph,
  singleNodeWorkflowGraph,
  workflowRunFromRunStateSnapshot,
  workflowRunFromRunSummary,
} from '../workbench/model/workflowRuntimeProjection';
import {
  type EdgeAddress,
} from './workflow-viewer/workflowConnectionState';
import {
  canvasEdgeToFlowEdge,
  dragCommitKey,
  edgeAddressFromFlowEdge,
  flowNodeIdentityKey,
  flowNodeLayoutKey,
  reconcileFlowNodes,
  toFlowEdges,
  toFlowNodes,
  type DataDropTargetPreview,
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
  connectionHandleElementForEndpoint,
  connectionHandleSelector,
  connectionModeForHandleElement,
  connectionSideFromHandleElement,
  domConnectionEndpointAtPoint,
  domConnectionEndpointFromElement,
  domFlowNodeIdAtPoint,
  isConnectionHandleForMode,
  queueControlHandleConnectionStart,
  recordConnectionTrace,
  rectCenter,
  type DomConnectionEndpoint,
} from './canvas/connectionDom';
import {
  internalNodeFromExecutableWorkflow,
} from './canvas/canvasMutation';
import {
  addInputPortToDataConnectNode,
} from './canvas/canvasDataDrop';
import { WorkspaceCanvas } from './canvas/WorkspaceCanvas';
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
import {
  AgentNodeSettingsPanel,
  SelectionPropertiesPane,
} from './inspector/AgentNodeSettingsPanel';
import { EvidencePreview } from './inspector/EvidencePreview';
import { InvocationIdentityCard } from './inspector/InvocationIdentityCard';
import { InvocationInputEditor } from './inspector/InvocationInputEditor';
import { LiveLogBlocks } from './inspector/LiveLogBlocks';
import { NodeDetailOverlay } from './inspector/NodeDetailOverlay';
import { NodeEvidencePaths } from './inspector/NodeEvidencePaths';
import { PortList } from './inspector/PortList';
import { RightInspector } from './inspector/RightInspector';
import { ResourceInspector, type ResourceTemplate } from './inspector/ResourceInspector';
import { SelectedNodeRuntimePane } from './inspector/SelectedNodeRuntimePane';
import {
  SelectionDetailsDock,
  evidenceContentForCurrentSelection,
} from './inspector/SelectionDetailsDock';
import { SelectionInputPane } from './inspector/SelectionInputPane';
import { SelectionOutputPane } from './inspector/SelectionOutputPane';
import {
  SaveWorkflowDialog as SaveWorkflowDialogComponent,
  TaskOverviewPage as TaskOverviewPageComponent,
  TaskWorkspaceSwitcher as TaskWorkspaceSwitcherComponent,
  TopBar as TopBarComponent,
  WorkflowBindingDialog as WorkflowBindingDialogComponent,
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
import {
  loadTaskStore,
  loadWorkbenchTaskFromBackend,
  persistWorkbenchTaskToBackend,
  saveTaskStore,
  useTaskPersistence,
} from '../hooks/useTaskPersistence';
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

function trimLiveLog(value: string): string {
  const lines = value.split(/\r?\n/);
  if (lines.length <= MAX_LOG_PREVIEW_LINES) {
    return value;
  }
  return lines.slice(-MAX_LOG_PREVIEW_LINES).join('\n');
}

function resolveSetState<T>(current: T, next: SetStateAction<T>): T {
  return typeof next === 'function' ? (next as (value: T) => T)(current) : next;
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
  const storeInitializedRef = useRef(false);
  if (!storeInitializedRef.current) {
    useAssistantStore.setState(useAssistantStore.getInitialState(), true);
    useRunStore.setState(useRunStore.getInitialState(), true);
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    useWorkbenchStore.getState().hydrateTasks(initialTaskStore.tasks, initialTaskStore.activeTaskId);
    storeInitializedRef.current = true;
  }
  const initialTask = useMemo(
    () =>
      initialTaskStore.tasks.find((task) => task.taskId === initialTaskStore.activeTaskId) ||
      initialTaskStore.tasks[0],
    [initialTaskStore],
  );
  const taskOrder = useWorkbenchStore((state) => state.taskOrder);
  const tasksById = useWorkbenchStore((state) => state.tasksById);
  const tasks = useMemo(
    () => taskOrder.map((taskId) => tasksById[taskId]).filter((task): task is WorkbenchTask => Boolean(task)),
    [taskOrder, tasksById],
  );
  const activeTaskId = useWorkbenchStore((state) => state.activeTaskId);
  const setStoreTasks = useWorkbenchStore((state) => state.setTasks);
  const setActiveTaskId = useWorkbenchStore((state) => state.setActiveTaskId);
  const setStoreCanvas = useWorkbenchStore((state) => state.updateCanvas);
  const storeSetSelection = useWorkbenchStore((state) => state.setSelection);
  const storeSetFocusedWorkflowId = useWorkbenchStore((state) => state.setFocusedWorkflowId);
  const connectionMode = useWorkbenchStore((state) => state.connectionMode);
  const setConnectionMode = useWorkbenchStore((state) => state.setConnectionMode);
  const chrome = useWorkbenchStore((state) => state.chrome);
  const setChrome = useWorkbenchStore((state) => state.setChrome);
  const edgeViewMode = useWorkbenchStore((state) => state.edgeViewMode);
  const setEdgeViewMode = useWorkbenchStore((state) => state.setEdgeViewMode);
  const taskWorkspaceView = useWorkbenchStore((state) => state.taskWorkspaceView);
  const setTaskWorkspaceView = useWorkbenchStore((state) => state.setTaskWorkspaceView);
  const bottomDockMode = useWorkbenchStore((state) => state.bottomDockMode);
  const setBottomDockMode = useWorkbenchStore((state) => state.setBottomDockMode);
  const nodeDetailOpen = useWorkbenchStore((state) => state.nodeDetailOpen);
  const setNodeDetailOpen = useWorkbenchStore((state) => state.setNodeDetailOpen);
  const selection = useWorkbenchStore((state) =>
    state.selectionsByTaskId[state.activeTaskId] || { type: 'task_canvas', taskId: state.activeTaskId },
  );
  const focusedWorkflowId = useWorkbenchStore((state) => state.focusedWorkflowIdByTaskId[state.activeTaskId] || null);
  const callablesRef = useRef(callables);
  const workflowsRef = useRef(workflows);
  const currentTask = useMemo(
    () => tasks.find((task) => task.taskId === activeTaskId) || tasks[0],
    [activeTaskId, tasks],
  );
  const canvas = currentTask?.canvas || initialTask.canvas;
  const [layoutSyncVersion, setLayoutSyncVersion] = useState(0);
  const [sourceGraph, setSourceGraph] = useState<WorkflowGraph>(() =>
    canvasToWorkflowGraph(initialTask.canvas),
  );
  const [message, setMessage] = useState('已加载工作台');
  const [durableTasksReady, setDurableTasksReady] = useState(false);
  const runsById = useRunStore((state) => state.runsById);
  const setRunsById = useRunStore((state) => state.setRunsById);
  const runLogsById = useRunStore((state) => state.runLogsById);
  const setRunLogsById = useRunStore((state) => state.setRunLogsById);
  const runLiveEventsById = useRunStore((state) => state.liveEventsByRunId);
  const setRunLiveEventsById = useRunStore((state) => state.setLiveEventsByRunId);
  const runtimeConfig = useRunStore((state) => state.runtimeConfig);
  const setRuntimeConfig = useRunStore((state) => state.setRuntimeConfig);
  const [openedExternalWorkflow, setOpenedExternalWorkflow] = useState(false);
  const [dataConnectionDraft, setDataConnectionDraft] = useState<DataConnectionDraft>(null);

  const setTasks = useCallback((next: SetStateAction<WorkbenchTask[]>) => {
    const state = useWorkbenchStore.getState();
    const currentTasks = state.taskOrder
      .map((taskId) => state.tasksById[taskId])
      .filter((task): task is WorkbenchTask => Boolean(task));
    setStoreTasks(typeof next === 'function' ? next(currentTasks) : next, state.activeTaskId);
  }, [setStoreTasks]);
  const setCanvas = useCallback((next: SetStateAction<WorkspaceCanvasModel>) => {
    const state = useWorkbenchStore.getState();
    const task = state.tasksById[state.activeTaskId];
    if (!task) {
      return;
    }
    const nextCanvas = typeof next === 'function' ? next(task.canvas) : next;
    setStoreCanvas(state.activeTaskId, normalizeCanvasEdges(nextCanvas));
  }, [setStoreCanvas]);
  const setSelection = useCallback((next: SetStateAction<CanvasSelection>) => {
    const state = useWorkbenchStore.getState();
    const currentSelection =
      state.selectionsByTaskId[state.activeTaskId] || { type: 'task_canvas', taskId: state.activeTaskId };
    storeSetSelection(
      state.activeTaskId,
      typeof next === 'function' ? next(currentSelection) : next,
    );
  }, [storeSetSelection]);
  const setFocusedWorkflowId = useCallback((next: SetStateAction<string | null>) => {
    const state = useWorkbenchStore.getState();
    const currentFocusedWorkflowId = state.focusedWorkflowIdByTaskId[state.activeTaskId] || null;
    storeSetFocusedWorkflowId(
      state.activeTaskId,
      typeof next === 'function' ? next(currentFocusedWorkflowId) : next,
    );
  }, [storeSetFocusedWorkflowId]);

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
  const [saveWorkflowDialog, setSaveWorkflowDialog] = useState<SaveWorkflowDialogState | null>(
    null,
  );
  const assistantTaskState =
    useAssistantStore((state) => state.assistantByTaskId[activeTaskId]) || emptyAssistantTaskState();
  const authoringAgents = useAssistantStore((state) => state.authoringAgents);
  const {
    assistantInput,
    assistantMessages,
    assistantProposal,
    selectedAuthoringAgentId,
    assistantSessionId,
    assistantAgentSession,
    assistantPendingTurn,
    assistantEvents,
    assistantTurnReason,
    assistantSessionStatus,
    assistantBackendValidation,
    assistantRequiredActions,
    assistantGraphOpsReview,
    assistantBusy,
    assistantApplyUndo,
  } = assistantTaskState;
  const setAuthoringAgents = useCallback((next: SetStateAction<AuthoringAgentSummary[]>) => {
    const store = useAssistantStore.getState();
    store.setAuthoringAgents(resolveSetState(store.authoringAgents, next));
  }, []);
  const setAssistantInput = useCallback((next: SetStateAction<string>) => {
    const current = useAssistantStore.getState().assistantByTaskId[activeTaskId] || emptyAssistantTaskState();
    useAssistantStore.getState().setAssistantInput(activeTaskId, resolveSetState(current.assistantInput, next));
  }, [activeTaskId]);
  const setAssistantMessages = useCallback((next: SetStateAction<AssistantChatMessage[]>) => {
    const current = useAssistantStore.getState().assistantByTaskId[activeTaskId] || emptyAssistantTaskState();
    useAssistantStore.getState().setAssistantMessages(
      activeTaskId,
      resolveSetState(current.assistantMessages, next),
    );
  }, [activeTaskId]);
  const setAssistantProposal = useCallback((next: SetStateAction<CanvasAuthoringProposal | null>) => {
    const current = useAssistantStore.getState().assistantByTaskId[activeTaskId] || emptyAssistantTaskState();
    useAssistantStore.getState().setAssistantProposal(
      activeTaskId,
      resolveSetState(current.assistantProposal, next),
    );
  }, [activeTaskId]);
  const setSelectedAuthoringAgentId = useCallback((next: SetStateAction<string>) => {
    const current = useAssistantStore.getState().assistantByTaskId[activeTaskId] || emptyAssistantTaskState();
    useAssistantStore.getState().setSelectedAuthoringAgentId(
      activeTaskId,
      resolveSetState(current.selectedAuthoringAgentId, next),
    );
  }, [activeTaskId]);
  const setAssistantSessionId = useCallback((next: SetStateAction<string | null>) => {
    const current = useAssistantStore.getState().assistantByTaskId[activeTaskId] || emptyAssistantTaskState();
    useAssistantStore.getState().setAssistantSessionId(
      activeTaskId,
      resolveSetState(current.assistantSessionId, next),
    );
  }, [activeTaskId]);
  const setAssistantAgentSession = useCallback((next: SetStateAction<AgentSessionRecord | null>) => {
    const current = useAssistantStore.getState().assistantByTaskId[activeTaskId] || emptyAssistantTaskState();
    useAssistantStore.getState().setAssistantAgentSession(
      activeTaskId,
      resolveSetState(current.assistantAgentSession, next),
    );
  }, [activeTaskId]);
  const setAssistantPendingTurn = useCallback((next: SetStateAction<AgentTurnRecord | null>) => {
    const current = useAssistantStore.getState().assistantByTaskId[activeTaskId] || emptyAssistantTaskState();
    useAssistantStore.getState().setAssistantPendingTurn(
      activeTaskId,
      resolveSetState(current.assistantPendingTurn, next),
    );
  }, [activeTaskId]);
  const setAssistantEvents = useCallback((next: SetStateAction<RunEvent[]>) => {
    const current = useAssistantStore.getState().assistantByTaskId[activeTaskId] || emptyAssistantTaskState();
    useAssistantStore.getState().setAssistantEvents(activeTaskId, resolveSetState(current.assistantEvents, next));
  }, [activeTaskId]);
  const setAssistantTurnReason = useCallback((next: SetStateAction<AssistantTurnReason>) => {
    const current = useAssistantStore.getState().assistantByTaskId[activeTaskId] || emptyAssistantTaskState();
    useAssistantStore.getState().setAssistantTurnReason(
      activeTaskId,
      resolveSetState(current.assistantTurnReason, next),
    );
  }, [activeTaskId]);
  const setAssistantSessionStatus = useCallback((next: SetStateAction<string>) => {
    const current = useAssistantStore.getState().assistantByTaskId[activeTaskId] || emptyAssistantTaskState();
    useAssistantStore.getState().setAssistantSessionStatus(
      activeTaskId,
      resolveSetState(current.assistantSessionStatus, next),
    );
  }, [activeTaskId]);
  const setAssistantBackendValidation = useCallback((next: SetStateAction<CanvasAuthoringValidationResult | null>) => {
    const current = useAssistantStore.getState().assistantByTaskId[activeTaskId] || emptyAssistantTaskState();
    useAssistantStore.getState().setAssistantBackendValidation(
      activeTaskId,
      resolveSetState(current.assistantBackendValidation, next),
    );
  }, [activeTaskId]);
  const setAssistantRequiredActions = useCallback((next: SetStateAction<AuthoringRequiredAction[]>) => {
    const current = useAssistantStore.getState().assistantByTaskId[activeTaskId] || emptyAssistantTaskState();
    useAssistantStore.getState().setAssistantRequiredActions(
      activeTaskId,
      resolveSetState(current.assistantRequiredActions, next),
    );
  }, [activeTaskId]);
  const setAssistantGraphOpsReview = useCallback((next: SetStateAction<AssistantGraphOpsReview | null>) => {
    const current = useAssistantStore.getState().assistantByTaskId[activeTaskId] || emptyAssistantTaskState();
    useAssistantStore.getState().setAssistantGraphOpsReview(
      activeTaskId,
      resolveSetState(current.assistantGraphOpsReview, next),
    );
  }, [activeTaskId]);
  const setAssistantBusy = useCallback((next: SetStateAction<boolean>) => {
    const current = useAssistantStore.getState().assistantByTaskId[activeTaskId] || emptyAssistantTaskState();
    useAssistantStore.getState().setAssistantBusy(activeTaskId, resolveSetState(current.assistantBusy, next));
  }, [activeTaskId]);
  const setAssistantApplyUndo = useCallback((next: SetStateAction<AssistantApplyUndoToken | null>) => {
    const current = useAssistantStore.getState().assistantByTaskId[activeTaskId] || emptyAssistantTaskState();
    useAssistantStore.getState().setAssistantApplyUndo(
      activeTaskId,
      resolveSetState(current.assistantApplyUndo, next),
    );
  }, [activeTaskId]);
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
              renderAgentNodeSettings={(props) => <AgentNodeSettingsPanel {...props} />}
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
              agentEventText={agentEventsLiveText(selectedDetailsModelWithAgentEvents.events)}
              artifactCacheByPath={artifactCacheByPath}
              onEnsureArtifactContent={ensureArtifactContent}
            />
          </NodeDetailOverlay>
        ) : null}
      </div>
      {bindingEditorWorkflowId ? (
        <WorkflowBindingDialogComponent
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
            runtimePane={
              <SelectedNodeRuntimePane
                model={selectedDetailsModelWithAgentEvents}
                agentEventText={agentEventsLiveText(selectedDetailsModelWithAgentEvents.events)}
                failedEventText={failedAgentEventsText(selectedDetailsModelWithAgentEvents.events)}
              />
            }
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



function compactText(value: string): string {
  const text = value.replace(/\s+/gu, ' ').trim();
  return text.length > 420 ? `${text.slice(0, 420)}...` : text || 'empty';
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







function parentPath(path: string | null | undefined): string {
  if (!path) {
    return '';
  }
  const normalized = path.replaceAll('\\', '/');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '';
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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function isJsdomRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.navigator?.userAgent?.toLowerCase().includes('jsdom')
  );
}




function agentEventsLiveText(events: RunEvent[]): string {
  const lines = events
    .filter((event) => String(event.type || event.event || '').startsWith('agent_'))
    .slice(-80)
    .map(agentEventLiveLine)
    .filter(Boolean);
  return lines.length ? ['[agent events]', ...lines].join('\n') : '';
}

function failedAgentEventsText(events: RunEvent[]): string {
  return events
    .filter((event) => String(event.event || event.type || '').includes('failed') || String(event.status || '').includes('failed'))
    .map(agentEventLiveLine)
    .filter((line) => line.trim())
    .join('\n');
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
