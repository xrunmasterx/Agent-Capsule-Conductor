import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap as ReactFlowMiniMap,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from 'react';

import type { CallableSummary, WorkflowBindingView, WorkflowRunResult, WorkflowSummary } from '../../types';
import type { CanvasSelection, ConnectionMode, EdgeViewMode, PortDirection, WorkflowPortView, WorkspaceCanvasModel } from '../../types/workbench';
import { connectionCandidatesFromPendingEndpoint, connectionFromPendingEndpoint, createDataEdgeCommand, describeEndpoint, portTokenId, resolveScopedConnection, reverseConnection, tryCommitResolvedConnection, type ConnectionResolution, type EndpointSide, type PendingCanvasConnection } from '../../workbench/model/canvasEdgeOps';
import { edgeAddressForScope, normalizeSelectionIntent, selectionForEdgeAddress, shouldDisconnectEdgeOnClick, type SelectionIntent } from '../../workbench/model/selectionModel';
import { isInspectableNodeSelection } from '../../workbench/model/authoringProposal';
import { workflowOutputPorts } from '../../workbench/model/workflowGraphProjection';
import { addCallableNodeFromPalette, addInternalNodeFromPalette, addWorkflowFromPalette, nextPaletteSelection, slugId, uniqueId } from '../../workbench/model/paletteCanvasOps';
import { parsePaletteItem, type PaletteItem } from '../workflow-viewer/palette';
import type { EdgeAddress } from '../workflow-viewer/workflowConnectionState';
import { edgeAddressFromFlowEdge, dragCommitKey, flowNodeIdentityKey, flowNodeLayoutKey, reconcileFlowNodes, toFlowEdges, toFlowNodes, type DataDropTargetPreview } from './flowProjection';
import { CanvasToolbar, ConnectPreviewLine, NodeCreateMenu, type ConnectPreviewState } from './CanvasToolbar';
import { FlowNodeLayoutContext, nodeTypes, type CanvasFlowNode } from './NodeRenderer';
import { closestConnectionHandle, connectionHandleElementForEndpoint, connectionModeForHandleElement, connectionSideFromHandleElement, domConnectionEndpointAtPoint, domConnectionEndpointFromElement, domFlowNodeIdAtPoint, recordConnectionTrace, rectCenter, type DomConnectionEndpoint } from './connectionDom';
import { connectionPreviewFromHandle, flowPositionFromEvent, flowPositionFromPoint, pointerPoint, type CanvasPointerEvent } from './canvasPointer';
import { focusCanvas } from './canvasFocus';
import { addInternalNodeFromPaletteWithConnection, commitDraggedNodeToCanvas, moveInternalNode, resizeWorkflowContainer, resolvePaletteDropTarget, selectionForDraggedNodeCommit } from './canvasMutation';
import { isNodeDetailDoubleClickIgnored, isTextEditingKeyboardTarget } from './canvasDomGuards';
import { createDataEdgeToNodeBodyCommand, inputPortIdForDataBodyPreview, prepareDataEdgeToNodeBodyCommand } from './canvasDataDrop';
import type { RunOverlayState } from '../workflow-viewer/runState';

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

function MiniMap() {
  return <ReactFlowMiniMap pannable zoomable nodeClassName="workflow-minimap-node" />;
}

export function WorkspaceCanvas({
  canvas,
  layoutSyncVersion = 0,
  selection,
  connectionMode,
  edgeViewMode,
  runOverlay = null,
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
  runOverlay?: RunOverlayState | null;
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
        runOverlay,
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
      runOverlay,
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
