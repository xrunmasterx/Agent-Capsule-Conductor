import { MarkerType, type Edge } from '@xyflow/react';

import {
  WORKFLOW_INTERNAL_EDGE_Z_INDEX,
  WORKFLOW_INTERNAL_SELECTED_EDGE_Z_INDEX,
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
} from '../../workbench/model/canvasEdgeOps';
import { flowEdgeId, type EdgeAddress } from '../../workbench/model/edgeAddress';
import {
  edgeAddressForScope,
  selectionMatchesEdgeAddress,
} from '../../workbench/model/selectionModel';
import {
  internalEdgeEndpointToFlowId,
  parseInternalFlowNodeId,
  workflowInputBoundaryId,
  workflowOutputBoundaryId,
} from '../../workbench/model/workflowNodeModel';
import type {
  CanvasSelection,
  ConnectionMode,
  EdgeViewMode,
  WorkflowCanvasEdge,
  WorkflowContainerModel,
  WorkspaceCanvasModel,
} from '../../types/workbench';

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
