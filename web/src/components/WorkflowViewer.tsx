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
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from 'react';

import { api } from '../api';
import { emptyAssistantTaskState, useAssistantStore } from '../stores/assistantStore';
import { useRunStore } from '../stores/runStore';
import { useWorkbenchStore } from '../stores/workbenchStore';
import type {
  AgentSessionRecord,
  AgentTurnRecord,
  AuthoringAgentSummary,
  AuthoringRequiredAction,
  CallableSummary,
  GraphOpsDryRunPayload,
  InteractionRequest,
  NodeRunSummary,
  RunEvent,
  RuntimeConfig,
  BoundaryTransferPreview,
  WorkflowDataEdge,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowSummary,
} from '../types';
import {
  AGENT_CONTROL_HANDLE_FALLBACK_TOP,
  AGENT_CONTROL_HANDLE_TOP,
  AGENT_DATA_PORT_GAP,
  DEFAULT_WORKFLOW_MAX_CONCURRENCY,
  INSPECTOR_DEFAULT_WIDTH,
  INTERNAL_AGENT_TOOL_NODE_SIZE,
  TEMPORARY_CALLABLE_ID_PREFIX,
  WORKFLOW_INNER_HANDLE_X,
  agentDataPortTop,
} from '../workbench/constants';
import {
  emptyInputPolicyFromMetadata,
  emptyWorkbenchAuthoringState,
  isActiveTaskStatus,
} from '../workbench/model/taskModel';
import {
  isTemporaryCallableId,
} from '../workbench/model/graphOpsProposal';
import {
  authoringBackendCanvasSnapshot,
  authoringOperationSummary,
  authoringSelectionPayload,
  authoringTargetFromSelection,
  authoringValidationFromBackend,
  canvasAuthoringHash,
  mergeAuthoringValidation,
} from '../workbench/model/authoringProposal';
import {
  buildDeterministicCanvasAuthoringProposal,
  validateCanvasAuthoringProposal,
} from './authoring/authoringRuntime';
import {
  addCallableNodeFromPalette,
  addInternalNodeFromPalette,
  addWorkflowFromPalette,
  nextPaletteSelection,
  paletteItemBaseId,
  uniqueId,
} from '../workbench/model/paletteCanvasOps';
import {
  connectionCandidatesFromPendingEndpoint,
  connectionFromPendingEndpoint,
  controlSlotLimitIssue,
  controlSourceTokenId,
  controlTargetTokenId,
  dataConnectEdges,
  dataConnectNodes,
  describeEndpoint,
  edgeDiagnosticsForCanvasEdge,
  edgeDiagnosticsForWorkflowEdge,
  findDataConnectNode,
  isWorkflowBoundaryEdge,
  isWorkflowInputBoundaryControlBinding,
  isWorkflowOutputBoundaryControlBinding,
  normalizeCanvasEdges,
  portTokenId,
  resolveScopedConnection,
  reverseConnection,
  tryCommitResolvedConnection,
  uniqueCanvasEdges,
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
  expandWorkflowToFitChildren,
  expandWorkflowToFitChildrenCenterLocked,
  layoutCanvasForSelection,
  layoutWorkflowInternalNodes,
  nextRootPalettePosition,
} from '../workbench/model/canvasLayout';
import {
  edgeTouchesNode,
  findCanvasEdgeByAddress,
  isActiveCanvasObjectStatus,
  isExecutableNodeWorkflow,
  normalizeSelectionIntent,
  normalizeWorkbenchSelection,
  selectionEdgeAddress,
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
  inspectorDrawerTitle,
  isNodeDetailModel,
  selectionKey,
  truncateLargeLog,
} from '../workbench/model/workflowViewerShell';
import {
  agentEventsLiveText,
  failedAgentEventsText,
} from '../workbench/model/agentEventText';
import {
  bindingDirectory,
  boundaryInputMainConflictMessage,
  boundaryMainBindingLabel,
  controlEdgeMainTransferMode,
  effectiveNodeRunDir,
  nodeLiveLogsFor,
  nodeRunForInternalNode,
  nodeRunForWorkflow,
  selectedNodeRunForSelection,
  sameRunDir,
  selectedEntityDetailsModel,
  selectedNodeSettingsModel,
  statusLabel,
  workflowMainInputBindingState,
  type NodeRunLookupContext,
} from '../workbench/model/selectedNodeModel';
import type {
  AssistantApplyUndoToken,
  AssistantChatMessage,
  AssistantGraphOpsReview,
  AssistantTurnReason,
  BoundaryTransfer,
  BoundaryTransferMapping,
  BottomDockMode,
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
  PortDirection,
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
} from '../lib/runTranscript';
import {
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
  internalNodeInputPorts,
  internalNodeInvocationPreview,
  internalNodeOutputPorts,
  isInlineWorkflowContainer,
  port,
  workflowInvocationPreview,
  workflowOutputPorts,
  workflowOutputPortsReadonly,
} from '../workbench/model/workflowGraphProjection';
import {
  mergeNodeRunDetail,
  mergeWorkflowRunNodeDetails,
  nodeRunDetailCacheKey,
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
  isWorkflowBoundaryId,
  parseInternalFlowNodeId,
  workflowBoundaryKind,
  workflowIdFromBoundaryId,
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
import { WorkspaceCanvas } from './canvas/WorkspaceCanvas';
import {
  applyRunOverlayToCanvas,
  stripRuntimeStateFromCanvas,
  workflowRunFailureText,
} from './workflow-viewer/runState';

import { ExecutionDock as ExecutionDockComponent } from './execution';
import { LiveOutputViewer } from './execution/RunOverlay';
import {
  AgentNodeSettingsPanel,
  SelectionPropertiesPane,
} from './inspector/AgentNodeSettingsPanel';
import { EvidencePreview } from './inspector/EvidencePreview';
import { EventTimeline } from './inspector/EventTimeline';
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
import { useRunStream } from '../hooks/useRunStream';
import { useSelectedAgentSession, type AgentSessionUiState } from '../hooks/useSelectedAgentSession';
import { useOpenedWorkflowCanvas } from '../hooks/useOpenedWorkflowCanvas';
import { useNodeRunDetails } from '../hooks/useNodeRunDetails';
import { useCallableDetail, type CallableDetailLoadState } from '../hooks/useCallableDetail';
import { useGraphOpsPersistence } from '../hooks/useGraphOpsPersistence';
import { useRunnerSubmit } from '../hooks/useRunnerSubmit';
import { useSelectedAgentActions } from '../hooks/useSelectedAgentActions';
import { useSelectedAgentTurnActions } from '../hooks/useSelectedAgentTurnActions';
import { useAssistantProposalGenerateActions } from '../hooks/useAssistantProposalGenerateActions';
import { useAssistantProposalApplyActions } from '../hooks/useAssistantProposalApplyActions';
import { useSubmittedRunPolling } from '../hooks/useSubmittedRunPolling';
import {
  loadTaskStore,
  persistWorkbenchTaskToBackend,
  saveTaskStore,
  useTaskPersistence,
} from '../hooks/useTaskPersistence';
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
  useWorkbenchDurableTaskBootstrapActions,
} from '../hooks/useWorkbenchDurableTaskBootstrapActions';
import {
  useWorkflowBindings,
} from '../hooks/useWorkflowBindings';
import { useWorkflowPersistence } from '../hooks/useWorkflowPersistence';
import { useWorkbenchTaskActions } from '../hooks/useWorkbenchTaskActions';
import { useDataConnectionActions } from '../hooks/useDataConnectionActions';
import { useInvocationSettingsActions } from '../hooks/useInvocationSettingsActions';
import {
  useEvidenceDockActions,
  type EvidenceDockState,
} from '../hooks/useEvidenceDockActions';
import { useWorkflowRunSubmitActions } from '../hooks/useWorkflowRunSubmitActions';
import { useWorkflowRunSelectionActions } from '../hooks/useWorkflowRunSelectionActions';
import {
  boundaryTransferPreviewSnapshotForCanvas,
  useWorkflowSaveValidationActions,
} from '../hooks/useWorkflowSaveValidationActions';
import { useAssistantGraphOpsPersistenceActions } from '../hooks/useAssistantGraphOpsPersistenceActions';
import { useCanvasSelectionUiActions } from '../hooks/useCanvasSelectionUiActions';
import { useAssistantAuthoringSessionActions } from '../hooks/useAssistantAuthoringSessionActions';
import { useRunProjectionActions } from '../hooks/useRunProjectionActions';
import { useCanvasGraphStateActions } from '../hooks/useCanvasGraphStateActions';
import { useRunRestorationActions } from '../hooks/useRunRestorationActions';

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

function resolveSetState<T>(current: T, next: SetStateAction<T>): T {
  return typeof next === 'function' ? (next as (value: T) => T)(current) : next;
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
  const { closeEvidenceDock, readEvidence } = useEvidenceDockActions({
    activeTaskId,
    selectedRunId,
    readArtifactContent,
    setEvidenceDock,
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

  const {
    resetAssistantConversationState,
    currentAuthoringSnapshot,
    addAssistantSystemMessage,
    ensureAssistantSession,
    loadWorkbenchAssistantSession,
    submitWorkbenchAssistantTurnRequest,
  } = useAssistantAuthoringSessionActions({
    activeTaskId,
    canvas,
    selection,
    callables,
    workflows,
    assistantSessionId,
    selectedAuthoringAgentId,
    setAuthoringAgents,
    setSelectedAuthoringAgentId,
    setAssistantInput,
    setAssistantMessages,
    setAssistantProposal,
    setAssistantApplyUndo,
    setAssistantTurnReason,
    setAssistantBackendValidation,
    setAssistantRequiredActions,
    setAssistantGraphOpsReview,
    setAssistantSessionId,
    setAssistantAgentSession,
    setAssistantPendingTurn,
    setAssistantEvents,
    setAssistantSessionStatus,
    setAssistantBusy,
  });
  const { generateAssistantProposal } = useAssistantProposalGenerateActions({
    assistantInput,
    assistantTurnReason,
    selection,
    assistantAgentSession,
    currentAuthoringSnapshot,
    ensureAssistantSession,
    loadWorkbenchAssistantSession,
    submitWorkbenchAssistantTurnRequest,
    setAssistantMessages,
    setAssistantBusy,
    setAssistantAgentSession,
    setAssistantPendingTurn,
    setAssistantSessionStatus,
    setAssistantInput,
    setAssistantProposal,
    setAssistantBackendValidation,
    setBottomDockMode,
    setEvidenceDock,
    setMessage,
  });

  const {
    updateRunProjection,
    appendNodeLogDelta,
    appendRunAgentEventToProjection,
    appendRunLiveEvent,
    refreshRunProjection,
  } = useRunProjectionActions({
    runsById,
    setRunsById,
    setRunLogsById,
    setRunLiveEventsById,
  });

  const { loadWorkbenchTaskCanvas, saveWorkbenchTaskCanvas } = useWorkbenchTaskCanvasPersistence();
  const { validateBoundaryTransfers } = useBoundaryTransferValidation();
  const { pollSubmittedRunUntilTerminal } = useSubmittedRunPolling();
  const { submitRunnerJob } = useRunnerSubmit();
  const graphOpsPersistence = useGraphOpsPersistence();
  const {
    submitSelectedAgentTurnRequest,
    publishSelectedAgentOutputRequest,
    answerSelectedAgentInteractionRequest,
  } = useSelectedAgentActions();
  const { saveWorkflowGraph, validateWorkflowGraph } = useWorkflowPersistence();
  useWorkbenchDurableTaskBootstrapActions({
    initialTaskStore,
    callablesRef,
    workflowsRef,
    graphRef,
    loadWorkbenchTaskCanvas,
    saveWorkbenchTaskCanvas,
    setRuntimeConfig,
    setTasks,
    setActiveTaskId,
    setCanvas,
    setSourceGraph,
    setSelection,
    setMessage,
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
    addSystemMessage: addAssistantSystemMessage,
  });

  const {
    updateCanvas,
    updateCanvasAndGraph,
    handleWorkflowBindingSaved,
    handleWorkflowBindingFolderOpened,
  } = useCanvasGraphStateActions({
    activeTaskId,
    sourceGraph,
    graphRef,
    setCanvas,
    setTasks,
    setSourceGraph,
    setMessage,
  });

  const workflowBindingIds = useMemo(
    () => [canvas.id, ...canvas.workflows.map((item) => item.id)],
    [canvas.id, canvas.workflows],
  );
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

  useRunRestorationActions({
    currentTask,
    runsById,
    setRunsById,
    setTasks,
  });

  useOpenedWorkflowCanvas({
    enabled: openedExternalWorkflow,
    workflowId: selectedWorkflowId,
    workflowRun,
    graphRef,
    setSourceGraph,
    setCanvas,
    setSelection,
    setMessage,
    closeEvidenceDock,
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

  const {
    submitSelectedAgentTurn,
    publishSelectedAgentOutput,
    answerSelectedAgentInteraction,
  } = useSelectedAgentTurnActions({
    agentSessionState,
    selectedAgentSessionContext,
    selectedRunId,
    submitSelectedAgentTurnRequest,
    publishSelectedAgentOutputRequest,
    answerSelectedAgentInteractionRequest,
    setAgentSessionPendingTurn,
    setMessage,
    refreshAgentSession,
    refreshRunProjection,
    onChanged,
  });

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
  const clearAssistantProposal = useCallback(() => {
    setAssistantProposal(null);
  }, [setAssistantProposal]);
  const {
    createDemo,
    openWorkflow,
    switchTask,
    newTask,
    deleteTask,
    autoLayout,
  } = useWorkbenchTaskActions({
    tasks,
    activeTaskId,
    graphRef,
    setTasks,
    setActiveTaskId,
    setSourceGraph,
    setCanvas,
    setSelection,
    setFocusedWorkflowId,
    setOpenedExternalWorkflow,
    setMessage,
    setLayoutSyncVersion,
    clearAssistantProposal,
    resetAssistantConversationState,
    closeEvidenceDock,
    createDurableTask,
    deleteDurableTask,
    onSelect,
  });
  const canUndoAssistantApply =
    Boolean(assistantApplyUndo) &&
    assistantApplyUndo?.taskId === activeTaskId &&
    assistantApplyUndo.afterCanvasHash === currentAuthoringCanvasHash &&
    !isRunning &&
    !assistantPendingTurn;
  const {
    applyAssistantProposal,
    undoLastAssistantApply,
    discardAssistantProposal,
  } = useAssistantProposalApplyActions({
    activeTaskId,
    canvas,
    selection,
    assistantProposal,
    assistantApplyUndo,
    canUndoAssistantApply,
    temporaryResources: currentAuthoringState.temporaryResources,
    callables,
    workflows,
    graphRef,
    setSourceGraph,
    setCanvas,
    setTasks,
    setSelection,
    setAssistantApplyUndo,
    setAssistantProposal,
    setAssistantBackendValidation,
    setAssistantRequiredActions,
    setAssistantMessages,
    setMessage,
  });
  const {
    persistTemporaryResourceDraft,
    applyGraphOpsPersistenceReview,
  } = useAssistantGraphOpsPersistenceActions({
    activeTaskId,
    canvas,
    temporaryResources: currentAuthoringState.temporaryResources,
    graphRef,
    graphOps: graphOpsPersistence,
    setSourceGraph,
    setCanvas,
    setTasks,
    setAssistantRequiredActions,
    setAssistantGraphOpsReview,
    setAssistantMessages,
    setAssistantBusy,
    setMessage,
    onChanged,
  });

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

  const {
    beginDataConnection,
    cancelDataConnection,
    updateDataConnectionMaterialization,
    completeDataConnection,
    completeDataConnectionWithNewInputPort,
    addDataConnectPort,
    renameDataConnectPort,
    deleteDataConnectPort,
  } = useDataConnectionActions({
    canvas,
    dataConnectionDraft,
    setConnectionMode,
    setDataConnectionDraft,
    setChrome,
    setMessage,
    setSelection,
    updateCanvasAndGraph,
  });
  const {
    updateWorkflowInvocationInput,
    updateInternalInvocationInput,
    updateWorkflowInvocationLabel,
    updateInternalInvocationLabel,
    updateWorkflowForwardMainOutput,
    updateInternalForwardMainOutput,
    updateWorkflowEmptyInputPolicy,
    updateInternalEmptyInputPolicy,
    updateWorkflowCodexExecutionMode,
    updateInternalCodexExecutionMode,
  } = useInvocationSettingsActions({
    updateCanvas,
    updateCanvasAndGraph,
  });


  const {
    startInspectorResize,
    handleCanvasLayoutPointerDown,
    handleCanvasLayoutClick,
    selectCanvasObject,
    openNodeDetails,
    deleteSelectedCanvasObject,
    openCallableResourceFromNode,
  } = useCanvasSelectionUiActions({
    canvas,
    selection,
    inspectorWidth,
    isRunning,
    setChrome,
    setNodeDetailOpen,
    setSelection,
    updateCanvas,
    setMessage,
    setSelectedResource,
  });

  const {
    currentTemporaryResourceIssue,
    ensureBoundaryTransfersValid,
    reportTemporaryResourceIssue,
    requestSaveWorkflow,
    confirmSaveWorkflow,
    saveGraph,
    validateGraph,
  } = useWorkflowSaveValidationActions({
    activeTaskId,
    canvas,
    currentTaskAuthoring: currentTask?.authoring,
    focusedWorkflowId,
    saveWorkflowDialog,
    setSaveWorkflowDialog,
    graphRef,
    setSourceGraph,
    setMessage,
    setEvidenceDock,
    saveWorkflowGraph,
    validateWorkflowGraph,
    validateBoundaryTransfers,
    closeEvidenceDock,
    onSelect,
    onChanged,
  });

  const { runWorkflowGraph } = useWorkflowRunSubmitActions({
    activeTaskId,
    selectedRunId,
    workflowBindings,
    submitRunnerJob,
    pollSubmittedRunUntilTerminal,
    setMessage,
    setEvidenceDock,
    setTasks,
    setRunsById,
    updateRunProjection,
    graphRef,
    setSourceGraph,
    ensureBoundaryTransfersValid,
    reportTemporaryResourceIssue,
    onChanged,
  });
  const {
    canRunSelectedWorkflow,
    canRunSelectedNode,
    runGraph,
    runSelectedWorkflow,
    runSelectedNode,
  } = useWorkflowRunSelectionActions({
    canvas,
    selection,
    selectedWorkflow,
    selectedInternalNode,
    currentTemporaryResourceIssue,
    ensureBoundaryTransfersValid,
    reportTemporaryResourceIssue,
    runWorkflowGraph,
    setMessage,
  });

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
              boundaryPreviewSnapshotForCanvas={boundaryTransferPreviewSnapshotForCanvas}
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
