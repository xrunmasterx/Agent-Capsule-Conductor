import { MarkerType, type Edge } from '@xyflow/react';

import {
  AGENT_MAX_DATA_PORTS,
  AGENT_PORT_VERTICAL_PADDING,
  AGENT_TOOL_NODE_SIZE,
  WORKFLOW_INTERNAL_EDGE_Z_INDEX,
  WORKFLOW_CONTAINER_Z_INDEX,
  WORKFLOW_INTERNAL_NODE_Z_INDEX,
  WORKFLOW_INTERNAL_SELECTED_EDGE_Z_INDEX,
  WORKFLOW_INTERNAL_SELECTED_NODE_Z_INDEX,
  agentDataPortMaxOffset,
} from '../../workbench/constants';
import {
  controlSourceTokenId,
  controlTargetTokenId,
  edgeDiagnosticsForCanvasEdge,
  isWorkflowBoundaryMainBinding,
  portTokenId,
  uniqueCanvasEdges,
  workflowInputInnerSourceTokenId,
  workflowInputOuterTargetTokenId,
  workflowIdForBoundaryMainBinding,
  workflowOutputInnerTargetTokenId,
  workflowOutputOuterSourceTokenId,
  type EdgeDiagnostic,
  type EndpointSide,
} from '../../workbench/model/canvasEdgeOps';
import { defaultInternalNodePosition } from '../../workbench/model/canvasLayout';
import { edgeAddressFromFlowEdgeId, flowEdgeId, type EdgeAddress } from '../../workbench/model/edgeAddress';
import {
  edgeAddressForScope,
  internalInvocationLabel,
  selectionMatchesEdgeAddress,
  workflowInvocationLabel,
} from '../../workbench/model/selectionModel';
import {
  internalNodeInputPorts,
  internalNodeOutputPorts,
  workflowOutputPorts,
} from '../../workbench/model/workflowGraphProjection';
import {
  internalEdgeEndpointToFlowId,
  internalFlowNodeId,
  isExecutableNodeWorkflow,
  parseInternalFlowNodeId,
  workflowInputBoundaryId,
  workflowOutputBoundaryId,
} from '../../workbench/model/workflowNodeModel';
import type { WorkflowBindingView } from '../../types';
import type {
  CanvasSelection,
  ConnectionMode,
  EdgeViewMode,
  WorkflowPortView,
  WorkflowCanvasEdge,
  WorkflowContainerModel,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import {
  overlayStatusForNode,
  overlayStatusForWorkflow,
  type RunOverlayState,
} from '../workflow-viewer/runState';
import type { AgentToolFlowNode, CanvasFlowNode, WorkflowFlowNode } from './NodeRenderer';

export function toFlowEdges(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
  connectionMode: ConnectionMode,
  edgeViewMode: EdgeViewMode,
  showDataPorts: boolean,
): Edge[] {
  const workflowContainerIds = new Set(
    canvas.workflows
      .filter(isWorkflowShellNode)
      .map((workflow) => workflow.id),
  );
  const edgeScopeWorkflowId =
    canvas.layout === 'workflow-focus' && canvas.focusedWorkflowId ? canvas.focusedWorkflowId : null;
  const rootEdges = uniqueCanvasEdges(canvas.edges).flatMap((edge) =>
    canvasEdgeToFlowEdge(
      edge,
      edgeScopeWorkflowId,
      selection,
      connectionMode,
      undefined,
      edgeViewMode,
      showDataPorts,
      workflowContainerIds,
      edgeDiagnosticsForCanvasEdge(canvas, null, edge),
    ),
  );
  const internalEdges =
    canvas.layout === 'workflow-focus'
      ? []
      : canvas.workflows.flatMap((workflow) =>
          uniqueCanvasEdges(workflow.internalEdges).flatMap((edge) =>
            canvasEdgeToFlowEdge(
              edge,
              workflow.id,
              selection,
              connectionMode,
              workflow.id,
              edgeViewMode,
              showDataPorts,
              workflowContainerIds,
              edgeDiagnosticsForCanvasEdge(canvas, workflow.id, edge),
            ),
          ),
        );
  return uniqueFlowEdgesById([...rootEdges, ...internalEdges]);
}

export function uniqueFlowEdgesById(edges: Edge[]): Edge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (seen.has(edge.id)) {
      return false;
    }
    seen.add(edge.id);
    return true;
  });
}

export function edgeAddressFromFlowEdge(edge: Edge): EdgeAddress | null {
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

export function canvasEdgeToFlowEdge(
  edge: WorkflowCanvasEdge,
  scopeWorkflowId: string | null,
  selection: CanvasSelection,
  connectionMode: ConnectionMode,
  parentWorkflowId?: string,
  edgeViewMode: EdgeViewMode = 'all',
  showDataPorts = false,
  workflowContainerIds: Set<string> = new Set(),
  diagnostics: EdgeDiagnostic[] = [],
): Edge[] {
  if (edgeViewMode !== 'all' && edge.kind !== edgeViewMode) {
    return [];
  }
  if (isImplicitMainDataEdge(edge)) {
    return [];
  }
  const address = edgeAddressForScope(scopeWorkflowId, edge.id);
  const isSelected = selectionMatchesEdgeAddress(selection, address);
  const shellBoundaryEdge = parentWorkflowId
    ? shellBoundaryFlowEdge(edge, parentWorkflowId, address, isSelected)
    : null;
  if (shellBoundaryEdge) {
    return [shellBoundaryEdge];
  }
  const focusedBoundaryEdge = !parentWorkflowId
    ? focusedBoundaryControlFlowEdge(edge, address, isSelected, connectionMode)
    : null;
  if (focusedBoundaryEdge) {
    return [focusedBoundaryEdge];
  }
  const sourceId = parentWorkflowId
    ? internalEdgeEndpointToFlowId(parentWorkflowId, edge.source.workflowId)
    : edge.source.workflowId;
  const targetId = parentWorkflowId
    ? internalEdgeEndpointToFlowId(parentWorkflowId, edge.target.workflowId)
    : edge.target.workflowId;
  if (edge.kind === 'data') {
    const broken = diagnostics.length > 0;
    const sourcePortMissing = diagnostics.some(
      (diagnostic) => diagnostic.code === 'dangling_data_edge_source',
    );
    const targetPortMissing = diagnostics.some(
      (diagnostic) => diagnostic.code === 'dangling_data_edge_target',
    );
    return [{
      id: flowEdgeId(address),
      type: 'step',
      data: { ...flowEdgeData(address), diagnostics },
      source: sourceId,
      target: targetId,
      zIndex: parentWorkflowId
        ? isSelected
          ? WORKFLOW_INTERNAL_SELECTED_EDGE_Z_INDEX
          : WORKFLOW_INTERNAL_EDGE_Z_INDEX
        : undefined,
      sourceHandle: sourcePortMissing
        ? controlSourceTokenForFlowNode(
            sourceId,
            canvasWorkflowId(sourceId, parentWorkflowId),
            workflowContainerIds,
            parentWorkflowId,
          )
        : portTokenId(sourceId, 'output', edge.source.portId),
      targetHandle: targetPortMissing
        ? controlTargetTokenForFlowNode(
            targetId,
            canvasWorkflowId(targetId, parentWorkflowId),
            workflowContainerIds,
            parentWorkflowId,
          )
        : portTokenId(targetId, 'input', edge.target.portId),
      selected: isSelected,
      markerEnd: { type: MarkerType.ArrowClosed, color: broken ? '#ef4444' : isSelected ? '#16b89e' : '#256f91' },
      className: ['workflow-edge-data', broken ? 'workflow-edge-broken' : ''].filter(Boolean).join(' '),
      style: {
        stroke: broken ? '#ef4444' : isSelected ? '#16b89e' : '#256f91',
        strokeWidth: isSelected ? 4 : 1.8,
        strokeDasharray: broken ? '3 5' : isSelected ? '14 8' : '8 6',
        opacity: isSelected || broken ? 1 : 0.42,
      },
    }];
  }
  return [{
    id: flowEdgeId(address),
    data: flowEdgeData(address),
    source: sourceId,
    target: targetId,
    zIndex: parentWorkflowId
      ? isSelected
        ? WORKFLOW_INTERNAL_SELECTED_EDGE_Z_INDEX
        : WORKFLOW_INTERNAL_EDGE_Z_INDEX
      : undefined,
    sourceHandle: controlSourceTokenForFlowNode(sourceId, canvasWorkflowId(sourceId, parentWorkflowId), workflowContainerIds, parentWorkflowId),
    targetHandle: controlTargetTokenForFlowNode(targetId, canvasWorkflowId(targetId, parentWorkflowId), workflowContainerIds, parentWorkflowId),
    selected: isSelected,
    markerEnd: controlEdgeMarkerEnd(isSelected, connectionMode === 'control' ? '#f8fafc' : '#94a3b8'),
    className: 'workflow-edge-control',
    style: {
      stroke: isSelected ? '#16b89e' : connectionMode === 'control' ? '#f8fafc' : '#94a3b8',
      strokeWidth: isSelected ? 4 : 2.6,
    },
  }];
}

function controlEdgeMarkerEnd(isSelected: boolean, color: string): Edge['markerEnd'] {
  return { type: MarkerType.ArrowClosed, color: isSelected ? '#16b89e' : color };
}

function canvasWorkflowId(flowId: string, parentWorkflowId?: string): string {
  if (!parentWorkflowId) {
    return flowId;
  }
  const internal = parseInternalFlowNodeId(flowId);
  return internal?.nodeId || flowId;
}

function controlSourceTokenForFlowNode(
  flowNodeId: string,
  workflowId: string,
  workflowContainerIds: Set<string>,
  parentWorkflowId?: string,
): string | undefined {
  if (!parentWorkflowId && workflowContainerIds.has(workflowId)) {
    return workflowOutputOuterSourceTokenId(workflowId);
  }
  return controlSourceTokenId(flowNodeId);
}

function controlTargetTokenForFlowNode(
  flowNodeId: string,
  workflowId: string,
  workflowContainerIds: Set<string>,
  parentWorkflowId?: string,
): string | undefined {
  if (!parentWorkflowId && workflowContainerIds.has(workflowId)) {
    return workflowInputOuterTargetTokenId(workflowId);
  }
  return controlTargetTokenId(flowNodeId);
}

function shellBoundaryFlowEdge(
  edge: WorkflowCanvasEdge,
  workflowId: string,
  address: EdgeAddress,
  isSelected: boolean,
): Edge | null {
  const inputBoundaryId = workflowInputBoundaryId(workflowId);
  const outputBoundaryId = workflowOutputBoundaryId(workflowId);
  const sourceIsWorkflowInput = edge.source.workflowId === inputBoundaryId;
  const targetIsWorkflowOutput = edge.target.workflowId === outputBoundaryId;
  if (!sourceIsWorkflowInput && !targetIsWorkflowOutput) {
    return null;
  }
  if (edge.kind !== 'data' && edge.kind !== 'control') {
    return null;
  }
  const sourceId = sourceIsWorkflowInput
    ? workflowId
    : internalEdgeEndpointToFlowId(workflowId, edge.source.workflowId);
  const targetId = targetIsWorkflowOutput
    ? workflowId
    : internalEdgeEndpointToFlowId(workflowId, edge.target.workflowId);
  if (edge.kind === 'control') {
    return {
      id: flowEdgeId(address),
      data: flowEdgeData(address),
      source: sourceId,
      target: targetId,
      sourceHandle: sourceIsWorkflowInput ? workflowInputInnerSourceTokenId(workflowId) : controlSourceTokenId(sourceId),
      targetHandle: targetIsWorkflowOutput ? workflowOutputInnerTargetTokenId(workflowId) : controlTargetTokenId(targetId),
      selected: isSelected,
      markerEnd: controlEdgeMarkerEnd(isSelected, '#f8fafc'),
      className: 'workflow-edge-control workflow-edge-boundary-main',
      style: {
        stroke: isSelected ? '#16b89e' : '#f8fafc',
        strokeWidth: isSelected ? 4 : 3,
      },
    };
  }
  return {
    id: flowEdgeId(address),
    type: 'step',
    data: flowEdgeData(address),
    source: sourceId,
    target: targetId,
    sourceHandle: sourceIsWorkflowInput ? workflowInputInnerSourceTokenId(workflowId) : controlSourceTokenId(sourceId),
    targetHandle: targetIsWorkflowOutput ? workflowOutputInnerTargetTokenId(workflowId) : controlTargetTokenId(targetId),
    selected: isSelected,
    markerEnd: { type: MarkerType.ArrowClosed, color: isSelected ? '#16b89e' : '#38bdf8' },
    className: 'workflow-edge-data workflow-edge-boundary-main',
    style: {
      stroke: isSelected ? '#16b89e' : '#38bdf8',
      strokeWidth: isSelected ? 4 : 3,
      strokeDasharray: isSelected ? '14 8' : '8 6',
    },
  };
}

function focusedBoundaryControlFlowEdge(
  edge: WorkflowCanvasEdge,
  address: EdgeAddress,
  isSelected: boolean,
  connectionMode: ConnectionMode,
): Edge | null {
  if (edge.kind !== 'control') {
    return null;
  }
  const workflowId = workflowIdForBoundaryMainBinding(edge);
  if (!workflowId || !isWorkflowBoundaryMainBinding(workflowId, edge)) {
    return null;
  }
  const sourceIsWorkflowInput = edge.source.workflowId === workflowInputBoundaryId(workflowId);
  const targetIsWorkflowOutput = edge.target.workflowId === workflowOutputBoundaryId(workflowId);
  return {
    id: flowEdgeId(address),
    data: flowEdgeData(address),
    source: edge.source.workflowId,
    target: edge.target.workflowId,
    sourceHandle: sourceIsWorkflowInput
      ? workflowInputInnerSourceTokenId(edge.source.workflowId)
      : controlSourceTokenId(edge.source.workflowId),
    targetHandle: targetIsWorkflowOutput
      ? workflowOutputInnerTargetTokenId(edge.target.workflowId)
      : controlTargetTokenId(edge.target.workflowId),
    selected: isSelected,
    markerEnd: controlEdgeMarkerEnd(isSelected, connectionMode === 'control' ? '#f8fafc' : '#94a3b8'),
    className: 'workflow-edge-control workflow-edge-boundary-main',
    style: {
      stroke: isSelected ? '#16b89e' : connectionMode === 'control' ? '#f8fafc' : '#94a3b8',
      strokeWidth: isSelected ? 4 : 2.8,
    },
  };
}

function isImplicitMainDataEdge(edge: WorkflowCanvasEdge): boolean {
  const projectionOnlyEdge = edge as WorkflowCanvasEdge & { implicitMainDataEdge?: boolean };
  return edge.kind === 'data' && projectionOnlyEdge.implicitMainDataEdge === true;
}

function flowEdgeData(address: EdgeAddress): Record<string, unknown> {
  return { edgeAddress: address };
}

function isWorkflowShellNode(workflow: WorkflowContainerModel): boolean {
  return !workflow.boundaryKind && (workflow.sourceKind || 'workflow') === 'workflow';
}

export type DataDropTargetPreview = {
  flowNodeId: string;
  portId: string;
};

export function reconcileFlowNodes(
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

export function flowNodeIdentityKey(nodes: CanvasFlowNode[]): string {
  return nodes
    .map((node) => `${node.id}:${node.type || ''}:${node.parentId || ''}`)
    .sort()
    .join('|');
}

export function flowNodeLayoutKey(nodes: CanvasFlowNode[]): string {
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

export function dragCommitKey(node: CanvasFlowNode): string {
  return `${node.id}:${node.parentId || ''}:${Math.round(node.position.x)}:${Math.round(node.position.y)}`;
}

export function toFlowNodes(
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
  runOverlay: RunOverlayState | null = null,
): CanvasFlowNode[] {
  return canvas.workflows.flatMap((workflow) => {
    const workflowStatus = workflowOverlayStatus(runOverlay, canvas, workflow);
    if (isExecutableNodeWorkflow(workflow)) {
      return [
        topLevelAgentToolFlowNode(
          workflow,
          workflowStatus,
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
    const projectedWorkflow = workflowStatus === workflow.status ? workflow : { ...workflow, status: workflowStatus };
    const workflowNode: WorkflowFlowNode = {
      id: workflow.id,
      type: 'workflowContainer',
      position: workflow.position,
      selected: selection.type === 'workflow' && selection.id === workflow.id,
      zIndex: WORKFLOW_CONTAINER_Z_INDEX,
      data: {
        workflow: projectedWorkflow,
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
      const flowNodeId = internalFlowNodeId(workflow.id, node.id);
      const inputPorts = internalNodeInputPorts(node);
      const outputPorts = internalNodeOutputPorts(node);
      const selected =
        selection.type === 'internal' &&
        selection.workflowId === workflow.id &&
        selection.nodeId === node.id;
      return {
        id: flowNodeId,
        type: 'agentToolNode',
        parentId: workflow.id,
        extent: 'parent',
        position: node.position || defaultInternalNodePosition(index),
        selected,
        zIndex: selected ? WORKFLOW_INTERNAL_SELECTED_NODE_Z_INDEX : WORKFLOW_INTERNAL_NODE_Z_INDEX,
        data: {
          id: flowNodeId,
          title: internalInvocationLabel(node),
          subtitle: node.callableId || node.runtime,
          scopeLabel: `Inside: ${workflowInvocationLabel(workflow)}`,
          kind: node.kind,
          status: overlayStatusForNode(runOverlay, flowNodeId, node.status),
          callableId: node.callableId || node.runtime,
          temporaryResourceId: node.temporaryResourceId,
          workflowId: workflow.id,
          internalNodeId: node.id,
          inputPorts,
          outputPorts,
          size: agentToolNodeSize(inputPorts, outputPorts, showAgentDataPorts),
          selected,
          dataDropHint:
            dataDropTargetPreview?.flowNodeId === flowNodeId
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
  status: WorkflowContainerModel['status'],
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
      status,
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

function workflowOverlayStatus(
  runOverlay: RunOverlayState | null,
  canvas: WorkspaceCanvasModel,
  workflow: WorkflowContainerModel,
): WorkflowContainerModel['status'] {
  const status = overlayStatusForWorkflow(runOverlay, workflow);
  if (canvas.layout !== 'workflow-focus' || !canvas.focusedWorkflowId || workflow.boundaryKind) {
    return status;
  }
  return overlayStatusForNode(
    runOverlay,
    internalFlowNodeId(canvas.focusedWorkflowId, workflow.id),
    status,
  );
}

export function agentToolNodeSize(
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
