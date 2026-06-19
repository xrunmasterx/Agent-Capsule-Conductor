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
  WorkflowSummary,
} from '../../types';
import {
  emptyWorkbenchAuthoringState,
  isActiveTaskStatus,
} from '../../workbench/model/taskModel';
import {
  isExecutableNodeWorkflow,
} from '../../workbench/model/selectionModel';
import { truncateLargeLog } from '../../workbench/model/workflowViewerShell';
import type {
  CanvasAuthoringProposal,
  DataConnectionDraft,
} from '../../types/workbench';
import {
  buildAccTranscript,
} from '../../lib/runTranscript';
import {
  useWorkbenchLiveStream,
  type WorkbenchLiveStreamScope,
} from '../../hooks/useWorkbenchLiveStream';
import {
  useBoundaryTransferValidation,
} from '../../hooks/useBoundaryTransferPreview';
import {
  applyRunOverlayToCanvas,
  workflowRunFailureText,
} from './runState';

import type { ResourceTemplate } from '../inspector/ResourceInspector';
import {
  type SaveWorkflowDialogState,
} from '../workbench';
import { useAssistantTurnStream } from '../../hooks/useAssistantStream';
import { useArtifactContentCache } from '../../hooks/useArtifactContentCache';
import { useRunStream } from '../../hooks/useRunStream';
import { useOpenedWorkflowCanvas } from '../../hooks/useOpenedWorkflowCanvas';
import { useGraphOpsPersistence } from '../../hooks/useGraphOpsPersistence';
import { useRunnerSubmit } from '../../hooks/useRunnerSubmit';
import { useSelectedAgentActions } from '../../hooks/useSelectedAgentActions';
import { useSelectedAgentTurnActions } from '../../hooks/useSelectedAgentTurnActions';
import { useAssistantProposalGenerateActions } from '../../hooks/useAssistantProposalGenerateActions';
import { useAssistantProposalApplyActions } from '../../hooks/useAssistantProposalApplyActions';
import { useSubmittedRunPolling } from '../../hooks/useSubmittedRunPolling';
import {
  loadTaskStore,
  saveTaskStore,
} from '../../hooks/useTaskPersistence';
import { useWorkbenchTaskDurability } from '../../hooks/useWorkbenchTaskDurability';
import {
  useWorkbenchTaskCanvasPersistence,
} from '../../hooks/useWorkbenchTaskCanvasPersistence';
import {
  useWorkbenchDurableTaskBootstrapActions,
} from '../../hooks/useWorkbenchDurableTaskBootstrapActions';
import {
  useWorkflowBindings,
} from '../../hooks/useWorkflowBindings';
import { useWorkflowPersistence } from '../../hooks/useWorkflowPersistence';
import { useWorkbenchTaskActions } from '../../hooks/useWorkbenchTaskActions';
import { useDataConnectionActions } from '../../hooks/useDataConnectionActions';
import { useInvocationSettingsActions } from '../../hooks/useInvocationSettingsActions';
import {
  useEvidenceDockActions,
  type EvidenceDockState,
} from '../../hooks/useEvidenceDockActions';
import { useWorkflowRunSubmitActions } from '../../hooks/useWorkflowRunSubmitActions';
import { useWorkflowRunSelectionActions } from '../../hooks/useWorkflowRunSelectionActions';
import { useWorkflowSaveValidationActions } from '../../hooks/useWorkflowSaveValidationActions';
import { useAssistantGraphOpsPersistenceActions } from '../../hooks/useAssistantGraphOpsPersistenceActions';
import { useCanvasSelectionUiActions } from '../../hooks/useCanvasSelectionUiActions';
import { useAssistantAuthoringSessionActions } from '../../hooks/useAssistantAuthoringSessionActions';
import { useRunProjectionActions } from '../../hooks/useRunProjectionActions';
import { useCanvasGraphStateActions } from '../../hooks/useCanvasGraphStateActions';
import { useRunRestorationActions } from '../../hooks/useRunRestorationActions';
import { useAssistantTaskStoreBindings } from '../../hooks/useAssistantTaskStoreBindings';
import { useWorkbenchTaskStoreBindings } from '../../hooks/useWorkbenchTaskStoreBindings';
import { useRunStoreBindings } from '../../hooks/useRunStoreBindings';
import { useWorkbenchStoreInitialization } from '../../hooks/useWorkbenchStoreInitialization';
import { useWorkflowViewerAssistantDerivedState } from './useWorkflowViewerAssistantDerivedState';
import { useWorkflowViewerCanvasGuards } from './useWorkflowViewerCanvasGuards';
import { useWorkflowViewerChromeState } from './useWorkflowViewerChromeState';
import { useWorkflowViewerGraphState } from './useWorkflowViewerGraphState';
import { WorkflowViewerLayout } from './WorkflowViewerLayout';
import { useWorkflowViewerSelectionState } from './useWorkflowViewerSelectionState';
import { useWorkflowViewerTaskPersistence } from './useWorkflowViewerTaskPersistence';

export type WorkflowViewerControllerProps = {
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

export function WorkflowViewerController({
  workflows,
  callables,
  resourceErrors,
  selectedWorkflowId,
  onSelect,
  onChanged,
}: WorkflowViewerControllerProps) {
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
  const {
    sourceGraph,
    setSourceGraph,
    graphRef,
    layoutSyncVersion,
    setLayoutSyncVersion,
  } = useWorkflowViewerGraphState(initialTask.canvas);
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
  const {
    viewProjection,
    blueprintViewActive,
    resourceDetailOpen,
    inspectorOpen,
    assistantOpen,
    inspectorWidth,
    toggleAssistantDock,
    toggleDetailsDock,
  } = useWorkflowViewerChromeState({
    taskWorkspaceView,
    setTaskWorkspaceView,
    chrome,
    bottomDockMode,
    setBottomDockMode,
    evidenceDock,
    setEvidenceDock,
  });

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

  const paletteTargetWorkflow =
    focusedWorkflowId
      ? canvas.workflows.find((workflow) => workflow.id === focusedWorkflowId)
      : selectedWorkflow &&
          !isExecutableNodeWorkflow(selectedWorkflow)
        ? selectedWorkflow
        : null;
  const {
    assistantValidation,
    currentAuthoringCanvasHash,
    canUndoAssistantApply,
    clearAssistantProposal,
  } = useWorkflowViewerAssistantDerivedState({
    activeTaskId,
    canvas,
    temporaryResources: currentAuthoringState.temporaryResources,
    callables,
    workflows,
    assistantProposal,
    assistantBackendValidation,
    assistantApplyUndo,
    isRunning,
    hasAssistantPendingTurn: Boolean(assistantPendingTurn),
    setAssistantProposal,
  });
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

  useWorkflowViewerTaskPersistence({
    durableTasksReady,
    activeTaskId,
    tasks,
    currentTask,
    canvas,
    selection,
    callables,
    workflows,
    temporaryResources: currentAuthoringState.temporaryResources,
    currentAuthoringSnapshot,
    currentAuthoringCanvasHash,
    saveLocalTaskStore: saveTaskStore,
    saveWorkbenchTaskCanvas,
    onBackendAutosaveError: handleBackendAutosaveError,
  });

  useWorkflowViewerCanvasGuards({
    displayCanvas,
    selection,
    focusedWorkflowId,
    connectionMode,
    dataConnectionDraft,
    setSelection,
    setChrome,
    setNodeDetailOpen,
    setDataConnectionDraft,
  });

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
    <WorkflowViewerLayout
      durableTasksReady={durableTasksReady}
      rightPanelVisible={viewProjection.rightPanelVisible}
      onCanvasPointerDownCapture={handleCanvasLayoutPointerDown}
      onCanvasClickCapture={handleCanvasLayoutClick}
      topBarProps={{
        title: canvas.name,
        subtitle: 'WorkflowFunctionTemplate / ScopeFrame / SessionInstance / ArtifactBundle 统一视图',
        isRunning,
        onNew: newTask,
        onLoadDemo: createDemo,
        onSave: requestSaveWorkflow,
        onValidate: validateGraph,
        onRun: runGraph,
        onAutoLayout: autoLayout,
        assistantOpen,
        onToggleAssistant: toggleAssistantDock,
        detailsOpen: viewProjection.detailsOpen,
        onToggleDetails: toggleDetailsDock,
      }}
      mainStageProps={{
        taskWorkspaceView,
        onTaskWorkspaceViewChange: setTaskWorkspaceView,
        tasks,
        activeTaskId,
        onSelectTask: switchTask,
        onNewTask: newTask,
        onDeleteTask: deleteTask,
        canvas: displayCanvas,
        layoutSyncVersion,
        selection,
        connectionMode,
        edgeViewMode,
        workflowRun,
        focusedWorkflowId,
        callables,
        workflows,
        workflowBindings,
        onFocusedWorkflow: setFocusedWorkflowId,
        onCanvasChange: updateCanvas,
        onSelectCanvasObject: selectCanvasObject,
        onOpenNodeDetails: openNodeDetails,
        onDeleteSelection: deleteSelectedCanvasObject,
        onConnectionMode: setConnectionMode,
        onEdgeViewMode: setEdgeViewMode,
        onNotice: setMessage,
        onConfigureWorkflow: configureWorkflow,
        isRunning,
        runtimeConfig,
        canRunWorkflow: canRunSelectedWorkflow,
        canRunNode: canRunSelectedNode,
        onRunTask: runGraph,
        onRunWorkflow: runSelectedWorkflow,
        onRunNode: runSelectedNode,
      }}
      rightPanelProps={{
        resourceDetailOpen,
        inspectorOpen,
        inspectorWidth,
        selection,
        selectedResource,
        canvas: displayCanvas,
        selectedWorkflow,
        selectedPort,
        selectedEdge,
        selectedInternalNode,
        connectionMode,
        dataConnectionDraft,
        runtimeConfig,
        liveLogs: selectedLiveLogs,
        workflowRun: enrichedWorkflowRun,
        workflowEvents: selectedRunLiveEvents,
        workflows,
        workflowBindings,
        onResizeStart: startInspectorResize,
        onCollapseRightPanel: () => setChrome((current) => ({ ...current, rightPanel: 'none' })),
        onConnectionMode: setConnectionMode,
        onBeginDataConnection: beginDataConnection,
        onCancelDataConnection: cancelDataConnection,
        onUpdateDataConnectionMaterialization: updateDataConnectionMaterialization,
        onCompleteDataConnection: completeDataConnection,
        onCompleteDataConnectionWithNewInputPort: completeDataConnectionWithNewInputPort,
        onAddDataConnectPort: addDataConnectPort,
        onRenameDataConnectPort: renameDataConnectPort,
        onDeleteDataConnectPort: deleteDataConnectPort,
        onReadEvidence: readEvidence,
        onConfigureBinding: setBindingEditorWorkflowId,
        onUpdateWorkflowInput: updateWorkflowInvocationInput,
        onUpdateInternalInput: updateInternalInvocationInput,
        onUpdateWorkflowLabel: updateWorkflowInvocationLabel,
        onUpdateInternalLabel: updateInternalInvocationLabel,
        onUpdateWorkflowForwardMainOutput: updateWorkflowForwardMainOutput,
        onUpdateInternalForwardMainOutput: updateInternalForwardMainOutput,
        onUpdateWorkflowEmptyInputPolicy: updateWorkflowEmptyInputPolicy,
        onUpdateInternalEmptyInputPolicy: updateInternalEmptyInputPolicy,
        onUpdateWorkflowCodexExecutionMode: updateWorkflowCodexExecutionMode,
        onUpdateInternalCodexExecutionMode: updateInternalCodexExecutionMode,
        onOpenCallableResource: openCallableResourceFromNode,
      }}
      nodeDetailOverlayProps={{
        open: blueprintViewActive && nodeDetailOpen,
        model: selectedDetailsModelWithAgentEvents,
        selection,
        selectedWorkflow,
        selectedInternalNode,
        artifactCacheByPath,
        selectedAgentTurnLiveState,
        selectedAgentLiveState,
        callableState: selectedCallableDetailState,
        runtimeConfig,
        agentSessionState,
        onClose: () => setNodeDetailOpen(false),
        onEnsureArtifactContent: ensureArtifactContent,
        onReadEvidence: readEvidence,
        onRefreshAgentSession: refreshAgentSession,
        onPublishAgentOutput: publishSelectedAgentOutput,
        onAnswerAgentInteraction: answerSelectedAgentInteraction,
        onUpdateWorkflowInput: updateWorkflowInvocationInput,
        onUpdateInternalInput: updateInternalInvocationInput,
        onUpdateWorkflowLabel: updateWorkflowInvocationLabel,
        onUpdateInternalLabel: updateInternalInvocationLabel,
        onUpdateWorkflowForwardMainOutput: updateWorkflowForwardMainOutput,
        onUpdateInternalForwardMainOutput: updateInternalForwardMainOutput,
        onUpdateWorkflowEmptyInputPolicy: updateWorkflowEmptyInputPolicy,
        onUpdateInternalEmptyInputPolicy: updateInternalEmptyInputPolicy,
        onUpdateWorkflowCodexExecutionMode: updateWorkflowCodexExecutionMode,
        onUpdateInternalCodexExecutionMode: updateInternalCodexExecutionMode,
        onOpenCallableResource: openCallableResourceFromNode,
      }}
      dockProps={{
        bindingEditorWorkflowId,
        setBindingEditorWorkflowId,
        workflowBindings,
        validateBinding,
        saveBinding,
        openBindingsFolder,
        selectBindingDirectory,
        saveWorkflowDialog,
        setSaveWorkflowDialog,
        confirmSaveWorkflow,
        blueprintViewActive,
        evidenceDock,
        setEvidenceDock,
        bottomDockMode,
        message,
        selectedDetailsModel: selectedDetailsModelWithAgentEvents,
        currentTaskId: currentTask?.taskId,
        selectedRunId,
        readEvidence,
        assistantInput,
        assistantMessages,
        assistantProposal,
        assistantValidation,
        temporaryResources: currentAuthoringState.temporaryResources,
        authoringAgents,
        selectedAuthoringAgentId,
        assistantSessionId,
        assistantAgentSession,
        assistantSessionStatus,
        assistantPendingTurn,
        assistantEvents,
        assistantLiveState,
        assistantTurnReason,
        assistantRequiredActions,
        assistantGraphOpsReview,
        assistantBusy,
        selection,
        selectedWorkflow,
        selectedInternalNode,
        hasSelectedRunNode: Boolean(selectedAgentSessionContext),
        canUndoAssistantApply,
        setSelectedAuthoringAgentId,
        setAssistantSessionId,
        setAssistantAgentSession,
        setAssistantPendingTurn,
        setAssistantEvents,
        setAssistantSessionStatus,
        setAssistantTurnReason,
        setAssistantInput,
        generateAssistantProposal,
        applyAssistantProposal,
        discardAssistantProposal,
        undoLastAssistantApply,
        persistTemporaryResourceDraft,
        applyGraphOpsPersistenceReview,
        setAssistantGraphOpsReview,
      }}
    />
  );
}
