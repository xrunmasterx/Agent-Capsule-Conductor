import { useCallback, useMemo } from 'react';

import type {
  RuntimeConfig,
  WorkflowBindingView,
  WorkflowRunResult,
  RunEvent,
  WorkbenchLiveEvent,
} from '../../types';
import type {
  CanvasSelection,
  NodeLiveLogs,
  RunProjection,
  WorkbenchTask,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { useCallableDetail } from '../../hooks/useCallableDetail';
import { useNodeRunDetails } from '../../hooks/useNodeRunDetails';
import {
  useSelectedAgentSession,
  type SelectedAgentSessionContext,
} from '../../hooks/useSelectedAgentSession';
import {
  liveStateForNodeRun,
  useWorkbenchLiveStream,
  type WorkbenchLiveStreamScope,
} from '../../hooks/useWorkbenchLiveStream';
import {
  findCanvasEdgeByAddress,
  selectionEdgeAddress,
} from '../../workbench/model/selectionModel';
import {
  effectiveNodeRunDir,
  selectedEntityDetailsModel,
  selectedNodeRunForSelection,
  selectedNodeSettingsModel,
  type NodeRunLookupContext,
} from '../../workbench/model/selectedNodeModel';
import {
  mergeNodeRunDetail,
  mergeWorkflowRunNodeDetails,
  nodeRunDetailCacheKey,
} from '../../workbench/model/workflowRuntimeProjection';
import { isTemporaryCallableId } from '../../workbench/model/graphOpsProposal';

export type UseWorkflowViewerSelectionStateOptions = {
  displayCanvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  selectedRunId: string | null;
  selectedRunProjection?: RunProjection;
  workflowRun: WorkflowRunResult | null;
  workflowEvents: RunEvent[];
  selectedLiveLogs: Record<string, NodeLiveLogs>;
  selectedRunLiveEvents: WorkbenchLiveEvent[];
  runtimeConfig: RuntimeConfig | null;
  workflowBindings: Record<string, WorkflowBindingView>;
  currentTask?: WorkbenchTask;
};

export function useWorkflowViewerSelectionState({
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
}: UseWorkflowViewerSelectionStateOptions) {
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
    () => selectedNodeRunForSelection(
      workflowRun,
      selection,
      selectedWorkflow,
      selectedInternalNode,
      selectedNodeRunLookup,
    ),
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
  const selectedAgentSessionContext = useMemo<SelectedAgentSessionContext | null>(
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
  const appendRunAgentEventToSession = useCallback(
    (runId: string, event: RunEvent) => {
      appendSelectedAgentSessionEvent(runId, event);
    },
    [appendSelectedAgentSessionEvent],
  );

  return {
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
  };
}
