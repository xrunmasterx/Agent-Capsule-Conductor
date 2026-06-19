import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  AuthoringRequiredAction,
  CallableSummary,
  RunEvent,
  WorkflowGraph,
  WorkflowSummary,
} from '../types';
import {
  emptyWorkbenchAuthoringState,
  isActiveTaskStatus,
} from '../workbench/model/taskModel';
import {
  authoringBackendCanvasSnapshot,
  authoringSelectionPayload,
  canvasAuthoringHash,
  mergeAuthoringValidation,
} from '../workbench/model/authoringProposal';
import {
  validateCanvasAuthoringProposal,
} from './authoring/authoringRuntime';
import {
  findDataConnectNode,
} from '../workbench/model/canvasEdgeOps';
import {
  isExecutableNodeWorkflow,
  normalizeWorkbenchSelection,
} from '../workbench/model/selectionModel';
import {
  workbenchViewProjection,
} from '../workbench/model/workbenchViewProjection';
import { selectionKey, truncateLargeLog } from '../workbench/model/workflowViewerShell';
import type {
  CanvasAuthoringProposal,
  DataConnectionDraft,
  WorkbenchTask,
} from '../types/workbench';
import {
  buildAccTranscript,
} from '../lib/runTranscript';
import {
  useWorkbenchLiveStream,
  type WorkbenchLiveStreamScope,
} from '../hooks/useWorkbenchLiveStream';
import {
  useBoundaryTransferValidation,
} from '../hooks/useBoundaryTransferPreview';
import {
  canvasToWorkflowGraph,
} from '../workbench/model/workflowGraphProjection';
import {
  applyRunOverlayToCanvas,
  stripRuntimeStateFromCanvas,
  workflowRunFailureText,
} from './workflow-viewer/runState';

import type { ResourceTemplate } from './inspector/ResourceInspector';
import {
  TopBar as TopBarComponent,
  WorkbenchShell,
  type SaveWorkflowDialogState,
} from './workbench';
import { useAssistantTurnStream } from '../hooks/useAssistantStream';
import { useArtifactContentCache } from '../hooks/useArtifactContentCache';
import { useRunStream } from '../hooks/useRunStream';
import { useOpenedWorkflowCanvas } from '../hooks/useOpenedWorkflowCanvas';
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
import { useWorkflowSaveValidationActions } from '../hooks/useWorkflowSaveValidationActions';
import { useAssistantGraphOpsPersistenceActions } from '../hooks/useAssistantGraphOpsPersistenceActions';
import { useCanvasSelectionUiActions } from '../hooks/useCanvasSelectionUiActions';
import { useAssistantAuthoringSessionActions } from '../hooks/useAssistantAuthoringSessionActions';
import { useRunProjectionActions } from '../hooks/useRunProjectionActions';
import { useCanvasGraphStateActions } from '../hooks/useCanvasGraphStateActions';
import { useRunRestorationActions } from '../hooks/useRunRestorationActions';
import { useAssistantTaskStoreBindings } from '../hooks/useAssistantTaskStoreBindings';
import { useWorkbenchTaskStoreBindings } from '../hooks/useWorkbenchTaskStoreBindings';
import { useRunStoreBindings } from '../hooks/useRunStoreBindings';
import { useWorkbenchStoreInitialization } from '../hooks/useWorkbenchStoreInitialization';
import { WorkflowViewerDock } from './workflow-viewer/WorkflowViewerDock';
import { WorkflowViewerMainStage } from './workflow-viewer/WorkflowViewerMainStage';
import { WorkflowViewerNodeDetailOverlay } from './workflow-viewer/WorkflowViewerNodeDetailOverlay';
import { WorkflowViewerRightPanel } from './workflow-viewer/WorkflowViewerRightPanel';
import { useWorkflowViewerSelectionState } from './workflow-viewer/useWorkflowViewerSelectionState';

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

export function WorkflowViewer({
  workflows,
  callables,
  resourceErrors,
  selectedWorkflowId,
  onSelect,
  onChanged,
}: Props) {
  const initialTaskStore = useMemo(() => loadTaskStore(), []);
  useWorkbenchStoreInitialization(initialTaskStore);
  const initialTask = useMemo(
    () =>
      initialTaskStore.tasks.find((task) => task.taskId === initialTaskStore.activeTaskId) ||
      initialTaskStore.tasks[0],
    [initialTaskStore],
  );
  const {
    tasks,
    activeTaskId,
    setActiveTaskId,
    connectionMode,
    setConnectionMode,
    chrome,
    setChrome,
    edgeViewMode,
    setEdgeViewMode,
    taskWorkspaceView,
    setTaskWorkspaceView,
    bottomDockMode,
    setBottomDockMode,
    nodeDetailOpen,
    setNodeDetailOpen,
    selection,
    focusedWorkflowId,
    setTasks,
    setCanvas,
    setSelection,
    setFocusedWorkflowId,
  } = useWorkbenchTaskStoreBindings();
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
  const {
    runsById,
    setRunsById,
    runLogsById,
    setRunLogsById,
    runLiveEventsById,
    setRunLiveEventsById,
    runtimeConfig,
    setRuntimeConfig,
  } = useRunStoreBindings();
  const [openedExternalWorkflow, setOpenedExternalWorkflow] = useState(false);
  const [dataConnectionDraft, setDataConnectionDraft] = useState<DataConnectionDraft>(null);

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
  const {
    assistantTaskState,
    authoringAgents,
    setAuthoringAgents,
    setAssistantInput,
    setAssistantMessages,
    setAssistantProposal,
    setSelectedAuthoringAgentId,
    setAssistantSessionId,
    setAssistantAgentSession,
    setAssistantPendingTurn,
    setAssistantEvents,
    setAssistantTurnReason,
    setAssistantSessionStatus,
    setAssistantBackendValidation,
    setAssistantRequiredActions,
    setAssistantGraphOpsReview,
    setAssistantBusy,
    setAssistantApplyUndo,
  } = useAssistantTaskStoreBindings(activeTaskId);
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
  const selectedLiveLogs = selectedRunId ? runLogsById[selectedRunId] || {} : {};
  const selectedRunLiveEvents = selectedRunId ? runLiveEventsById[selectedRunId] || [] : [];
  const {
    selectedWorkflow,
    selectedPort,
    selectedEdge,
    selectedInternalNode,
    enrichedWorkflowRun,
    selectedCallableDetailState,
    selectedAgentSessionContext,
    agentSessionState,
    refreshAgentSession,
    setAgentSessionPendingTurn,
    appendRunAgentEventToSession,
    selectedAgentLiveState,
    selectedAgentTurnLiveState,
    selectedDetailsModelWithAgentEvents,
  } = useWorkflowViewerSelectionState({
    displayCanvas,
    selection,
    selectedRunId,
    selectedRunProjection,
    workflowRun,
    workflowEvents,
    selectedLiveLogs,
    selectedRunLiveEvents,
    runtimeConfig,
    workflowBindings,
    currentTask,
  });
  const appendRunAgentEvent = useCallback(
    (runId: string, event: RunEvent) => {
      appendRunAgentEventToProjection(runId, event);
      appendRunAgentEventToSession(runId, event);
    },
    [appendRunAgentEventToProjection, appendRunAgentEventToSession],
  );

  useRunStream(selectedRunId, {
    appendNodeLogDelta,
    appendRunAgentEvent,
    appendRunLiveEvent,
    updateRunProjection,
  });
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
  const configureWorkflow = useCallback((workflowId: string) => {
    setSelection({ type: 'workflow', id: workflowId });
    setBindingEditorWorkflowId(workflowId);
  }, []);

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
        <WorkflowViewerMainStage
          taskWorkspaceView={taskWorkspaceView}
          onTaskWorkspaceViewChange={setTaskWorkspaceView}
          tasks={tasks}
          activeTaskId={activeTaskId}
          onSelectTask={switchTask}
          onNewTask={newTask}
          onDeleteTask={deleteTask}
          canvas={displayCanvas}
          layoutSyncVersion={layoutSyncVersion}
          selection={selection}
          connectionMode={connectionMode}
          edgeViewMode={edgeViewMode}
          workflowRun={workflowRun}
          focusedWorkflowId={focusedWorkflowId}
          callables={callables}
          workflows={workflows}
          workflowBindings={workflowBindings}
          onFocusedWorkflow={setFocusedWorkflowId}
          onCanvasChange={updateCanvas}
          onSelectCanvasObject={selectCanvasObject}
          onOpenNodeDetails={openNodeDetails}
          onDeleteSelection={deleteSelectedCanvasObject}
          onConnectionMode={setConnectionMode}
          onEdgeViewMode={setEdgeViewMode}
          onNotice={setMessage}
          onConfigureWorkflow={configureWorkflow}
          isRunning={isRunning}
          runtimeConfig={runtimeConfig}
          canRunWorkflow={canRunSelectedWorkflow}
          canRunNode={canRunSelectedNode}
          onRunTask={runGraph}
          onRunWorkflow={runSelectedWorkflow}
          onRunNode={runSelectedNode}
        />
        <WorkflowViewerRightPanel
          resourceDetailOpen={resourceDetailOpen}
          inspectorOpen={inspectorOpen}
          inspectorWidth={inspectorWidth}
          selection={selection}
          selectedResource={selectedResource}
          canvas={displayCanvas}
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
          workflowBindings={workflowBindings}
          onResizeStart={startInspectorResize}
          onCollapseRightPanel={() => setChrome((current) => ({ ...current, rightPanel: 'none' }))}
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
        <WorkflowViewerNodeDetailOverlay
          open={blueprintViewActive && nodeDetailOpen}
          model={selectedDetailsModelWithAgentEvents}
          selection={selection}
          selectedWorkflow={selectedWorkflow}
          selectedInternalNode={selectedInternalNode}
          artifactCacheByPath={artifactCacheByPath}
          selectedAgentTurnLiveState={selectedAgentTurnLiveState}
          selectedAgentLiveState={selectedAgentLiveState}
          callableState={selectedCallableDetailState}
          runtimeConfig={runtimeConfig}
          agentSessionState={agentSessionState}
          onClose={() => setNodeDetailOpen(false)}
          onEnsureArtifactContent={ensureArtifactContent}
          onReadEvidence={readEvidence}
          onRefreshAgentSession={refreshAgentSession}
          onPublishAgentOutput={publishSelectedAgentOutput}
          onAnswerAgentInteraction={answerSelectedAgentInteraction}
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
      <WorkflowViewerDock
        bindingEditorWorkflowId={bindingEditorWorkflowId}
        setBindingEditorWorkflowId={setBindingEditorWorkflowId}
        workflowBindings={workflowBindings}
        validateBinding={validateBinding}
        saveBinding={saveBinding}
        openBindingsFolder={openBindingsFolder}
        selectBindingDirectory={selectBindingDirectory}
        saveWorkflowDialog={saveWorkflowDialog}
        setSaveWorkflowDialog={setSaveWorkflowDialog}
        confirmSaveWorkflow={confirmSaveWorkflow}
        blueprintViewActive={blueprintViewActive}
        evidenceDock={evidenceDock}
        setEvidenceDock={setEvidenceDock}
        bottomDockMode={bottomDockMode}
        message={message}
        selectedDetailsModel={selectedDetailsModelWithAgentEvents}
        currentTaskId={currentTask?.taskId}
        selectedRunId={selectedRunId}
        readEvidence={readEvidence}
        assistantInput={assistantInput}
        assistantMessages={assistantMessages}
        assistantProposal={assistantProposal}
        assistantValidation={assistantValidation}
        temporaryResources={currentAuthoringState.temporaryResources}
        authoringAgents={authoringAgents}
        selectedAuthoringAgentId={selectedAuthoringAgentId}
        assistantSessionId={assistantSessionId}
        assistantAgentSession={assistantAgentSession}
        assistantSessionStatus={assistantSessionStatus}
        assistantPendingTurn={assistantPendingTurn}
        assistantEvents={assistantEvents}
        assistantLiveState={assistantLiveState}
        assistantTurnReason={assistantTurnReason}
        assistantRequiredActions={assistantRequiredActions}
        assistantGraphOpsReview={assistantGraphOpsReview}
        assistantBusy={assistantBusy}
        selection={selection}
        selectedWorkflow={selectedWorkflow}
        selectedInternalNode={selectedInternalNode}
        hasSelectedRunNode={Boolean(selectedAgentSessionContext)}
        canUndoAssistantApply={canUndoAssistantApply}
        setSelectedAuthoringAgentId={setSelectedAuthoringAgentId}
        setAssistantSessionId={setAssistantSessionId}
        setAssistantAgentSession={setAssistantAgentSession}
        setAssistantPendingTurn={setAssistantPendingTurn}
        setAssistantEvents={setAssistantEvents}
        setAssistantSessionStatus={setAssistantSessionStatus}
        setAssistantTurnReason={setAssistantTurnReason}
        setAssistantInput={setAssistantInput}
        generateAssistantProposal={generateAssistantProposal}
        applyAssistantProposal={applyAssistantProposal}
        discardAssistantProposal={discardAssistantProposal}
        undoLastAssistantApply={undoLastAssistantApply}
        persistTemporaryResourceDraft={persistTemporaryResourceDraft}
        applyGraphOpsPersistenceReview={applyGraphOpsPersistenceReview}
        setAssistantGraphOpsReview={setAssistantGraphOpsReview}
      />
    </WorkbenchShell>
  );
}
