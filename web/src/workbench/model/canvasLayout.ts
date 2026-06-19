import dagre from 'dagre';

import {
  AGENT_TOOL_NODE_SIZE,
  DEFAULT_CONTAINER_SIZE,
  INTERNAL_AGENT_TOOL_NODE_SIZE,
  ROOT_LAYOUT_GAP,
  WORKFLOW_CHILD_PADDING,
  WORKFLOW_CHILD_START_PADDING,
  WORKFLOW_INTERNAL_LAYOUT_GAP,
  WORKFLOW_LAYOUT_SAFE_AREA,
} from '../constants';
import type {
  CanvasSelection,
  InternalNodeView,
  WorkflowContainerModel,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import {
  isExecutableNodeWorkflow,
  isWorkflowBoundaryId,
  workflowInputBoundaryId,
  workflowOutputBoundaryId,
} from './workflowNodeModel';

export function layoutWorkspaceCanvas(canvas: WorkspaceCanvasModel): WorkspaceCanvasModel {
  const workflowsWithInternalLayout = canvas.workflows.map(layoutWorkflowInternalNodes);
  const layout = new dagre.graphlib.Graph();
  layout.setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: 'LR', nodesep: ROOT_LAYOUT_GAP.node, ranksep: ROOT_LAYOUT_GAP.rank });
  workflowsWithInternalLayout.forEach((workflow) =>
    layout.setNode(workflow.id, {
      width: workflow.size.width,
      height: workflow.size.height,
    }),
  );
  canvas.edges.forEach((edge) => layout.setEdge(edge.source.workflowId, edge.target.workflowId));
  dagre.layout(layout);
  return {
    ...canvas,
    workflows: workflowsWithInternalLayout.map((workflow) => {
      const position = layout.node(workflow.id);
      return position
        ? {
            ...workflow,
            position: {
              x: position.x - workflow.size.width / 2,
              y: position.y - workflow.size.height / 2,
            },
          }
        : workflow;
    }),
  };
}

export function layoutCanvasForSelection(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
): WorkspaceCanvasModel {
  const workflowId =
    selection.type === 'workflow'
      ? selection.id
      : selection.type === 'internal' || selection.type === 'port'
        ? selection.workflowId
        : selection.type === 'edge' && selection.scopeWorkflowId
          ? selection.scopeWorkflowId
          : null;
  if (!workflowId) {
    return layoutWorkspaceCanvas(canvas);
  }
  const selectedWorkflow = canvas.workflows.find((workflow) => workflow.id === workflowId);
  if (!selectedWorkflow || isExecutableNodeWorkflow(selectedWorkflow)) {
    return layoutWorkspaceCanvas(canvas);
  }
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) =>
      workflow.id === workflowId ? layoutWorkflowInternalNodes(workflow) : workflow,
    ),
  };
}

export function layoutWorkflowInternalNodes(workflow: WorkflowContainerModel): WorkflowContainerModel {
  if (!workflow.internalNodes.length || isExecutableNodeWorkflow(workflow)) {
    return workflow;
  }
  const layout = new dagre.graphlib.Graph();
  layout.setDefaultEdgeLabel(() => ({}));
  layout.setGraph({
    rankdir: 'LR',
    nodesep: WORKFLOW_INTERNAL_LAYOUT_GAP.node,
    ranksep: WORKFLOW_INTERNAL_LAYOUT_GAP.rank,
    marginx: 0,
    marginy: 0,
  });
  const realNodeIds = new Set(workflow.internalNodes.map((node) => node.id));
  const inputBoundaryId = workflowInputBoundaryId(workflow.id);
  const outputBoundaryId = workflowOutputBoundaryId(workflow.id);
  const layoutNodeIds = new Set<string>([inputBoundaryId, outputBoundaryId, ...realNodeIds]);
  layout.setNode(inputBoundaryId, { width: 1, height: 1 });
  workflow.internalNodes.forEach((node) =>
    layout.setNode(node.id, {
      width: INTERNAL_AGENT_TOOL_NODE_SIZE.width,
      height: INTERNAL_AGENT_TOOL_NODE_SIZE.height,
    }),
  );
  layout.setNode(outputBoundaryId, { width: 1, height: 1 });
  const layoutEdgeKeys = new Set<string>();
  const addLayoutEdge = (
    sourceId: string,
    targetId: string,
    options: { weight: number; minlen?: number },
  ) => {
    if (sourceId === targetId || !layoutNodeIds.has(sourceId) || !layoutNodeIds.has(targetId)) {
      return;
    }
    const key = `${sourceId}->${targetId}`;
    if (layoutEdgeKeys.has(key)) {
      return;
    }
    layoutEdgeKeys.add(key);
    layout.setEdge(sourceId, targetId, { weight: options.weight, minlen: options.minlen || 1 });
  };
  const hasExplicitControlEdge = new Set(
    workflow.internalEdges
      .filter((edge) => edge.kind === 'control')
      .map((edge) => `${edge.source.workflowId}->${edge.target.workflowId}`),
  );
  workflow.internalEdges.forEach((edge) => {
    const sourceId = edge.source.workflowId;
    const targetId = edge.target.workflowId;
    if (edge.kind === 'control') {
      addLayoutEdge(sourceId, targetId, { weight: 8, minlen: 1 });
      return;
    }
    if (hasExplicitControlEdge.has(`${sourceId}->${targetId}`)) {
      return;
    }
    const boundaryWeight = isWorkflowBoundaryId(sourceId) || isWorkflowBoundaryId(targetId) ? 3 : 2;
    addLayoutEdge(sourceId, targetId, { weight: boundaryWeight, minlen: 1 });
  });
  if (layoutEdgeKeys.size === 0 && workflow.internalNodes.length > 1) {
    workflow.internalNodes.forEach((node, index, nodes) => {
      const nextNode = nodes[index + 1];
      if (nextNode) {
        addLayoutEdge(node.id, nextNode.id, { weight: 1, minlen: 1 });
      }
    });
  }
  dagre.layout(layout);
  const nextNodes = workflow.internalNodes.map((node) => {
    const position = layout.node(node.id);
    return position
      ? {
          ...node,
          position: {
            x: Math.round(position.x - INTERNAL_AGENT_TOOL_NODE_SIZE.width / 2 + WORKFLOW_LAYOUT_SAFE_AREA.left),
            y: Math.round(position.y - INTERNAL_AGENT_TOOL_NODE_SIZE.height / 2 + WORKFLOW_LAYOUT_SAFE_AREA.top),
          },
        }
      : node;
  });
  return expandWorkflowToFitLayout({ ...workflow, internalNodes: nextNodes });
}

export function expandWorkflowToFitChildren(workflow: WorkflowContainerModel): WorkflowContainerModel {
  if (!workflow.internalNodes.length || isExecutableNodeWorkflow(workflow)) {
    return workflow;
  }
  const bounds = normalizeWorkflowChildBounds(workflow.internalNodes);
  const offsetX = Math.max(0, WORKFLOW_CHILD_START_PADDING - bounds.minX);
  const offsetY = Math.max(0, WORKFLOW_CHILD_START_PADDING - bounds.minY);
  const nextInternalNodes =
    offsetX || offsetY
      ? workflow.internalNodes.map((node) => ({
          ...node,
          position: {
            x: finiteNumber(node.position?.x, 0) + offsetX,
            y: finiteNumber(node.position?.y, 0) + offsetY,
          },
        }))
      : workflow.internalNodes;
  const nextMaxX = bounds.maxX + offsetX;
  const nextMaxY = bounds.maxY + offsetY;
  return {
    ...workflow,
    position: {
      x: workflow.position.x - offsetX,
      y: workflow.position.y - offsetY,
    },
    internalNodes: nextInternalNodes,
    size: {
      width: Math.max(workflow.size.width + offsetX, nextMaxX + WORKFLOW_CHILD_PADDING),
      height: Math.max(workflow.size.height + offsetY, nextMaxY + WORKFLOW_CHILD_PADDING),
    },
  };
}

export function expandWorkflowToFitChildrenCenterLocked(workflow: WorkflowContainerModel): WorkflowContainerModel {
  if (!workflow.internalNodes.length || isExecutableNodeWorkflow(workflow)) {
    return workflow;
  }
  const center = {
    x: workflow.position.x + workflow.size.width / 2,
    y: workflow.position.y + workflow.size.height / 2,
  };
  const childBounds = normalizeWorkflowAbsoluteChildBounds(workflow);
  const nextSize = {
    width: Math.max(
      workflow.size.width,
      2 * Math.max(center.x - childBounds.minX, childBounds.maxX - center.x),
    ),
    height: Math.max(
      workflow.size.height,
      2 * Math.max(center.y - childBounds.minY, childBounds.maxY - center.y),
    ),
  };
  const nextPosition = {
    x: center.x - nextSize.width / 2,
    y: center.y - nextSize.height / 2,
  };
  const shift = {
    x: workflow.position.x - nextPosition.x,
    y: workflow.position.y - nextPosition.y,
  };
  return {
    ...workflow,
    position: nextPosition,
    size: nextSize,
    internalNodes: workflow.internalNodes.map((node) => ({
      ...node,
      position: {
        x: finiteNumber(node.position?.x, 0) + shift.x,
        y: finiteNumber(node.position?.y, 0) + shift.y,
      },
    })),
  };
}

export function nextRootPalettePosition(canvas: WorkspaceCanvasModel): { x: number; y: number } {
  const safeStartX = 620;
  const rootNodes = canvas.workflows.filter((workflow) => !workflow.boundaryKind);
  if (!rootNodes.length) {
    return { x: safeStartX, y: 180 };
  }
  const rootAgentCount = rootNodes.filter(isExecutableNodeWorkflow).length;
  const columns = 1;
  const columnIndex = rootAgentCount % columns;
  const rowIndex = Math.floor(rootAgentCount / columns);
  return {
    x: safeStartX + columnIndex * (AGENT_TOOL_NODE_SIZE.width + 80),
    y: 180 + rowIndex * 160,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function finitePosition(
  position: { x: number; y: number },
  fallback: { x: number; y: number },
): { x: number; y: number } {
  return Number.isFinite(position.x) && Number.isFinite(position.y) ? position : fallback;
}

export function defaultInternalNodePosition(index: number): { x: number; y: number } {
  return {
    x: 12,
    y: 12 + index * 78,
  };
}

function expandWorkflowToFitLayout(workflow: WorkflowContainerModel): WorkflowContainerModel {
  if (!workflow.internalNodes.length || isExecutableNodeWorkflow(workflow)) {
    return workflow;
  }
  const bounds = normalizeWorkflowChildBounds(workflow.internalNodes);
  return {
    ...workflow,
    size: {
      width: Math.max(
        bounds.maxX + WORKFLOW_LAYOUT_SAFE_AREA.right,
        DEFAULT_CONTAINER_SIZE.width,
      ),
      height: Math.max(
        bounds.maxY + WORKFLOW_LAYOUT_SAFE_AREA.bottom,
        DEFAULT_CONTAINER_SIZE.height,
      ),
    },
  };
}

function normalizeWorkflowAbsoluteChildBounds(workflow: WorkflowContainerModel): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return workflow.internalNodes.reduce(
    (bounds, node) => {
      const x = workflow.position.x + finiteNumber(node.position?.x, 0);
      const y = workflow.position.y + finiteNumber(node.position?.y, 0);
      return {
        minX: Math.min(bounds.minX, x),
        minY: Math.min(bounds.minY, y),
        maxX: Math.max(bounds.maxX, x + INTERNAL_AGENT_TOOL_NODE_SIZE.width),
        maxY: Math.max(bounds.maxY, y + INTERNAL_AGENT_TOOL_NODE_SIZE.height),
      };
    },
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

function normalizeWorkflowChildBounds(nodes: InternalNodeView[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return nodes.reduce(
    (bounds, node) => {
      const x = finiteNumber(node.position?.x, 0);
      const y = finiteNumber(node.position?.y, 0);
      return {
        minX: Math.min(bounds.minX, x),
        minY: Math.min(bounds.minY, y),
        maxX: Math.max(bounds.maxX, x + INTERNAL_AGENT_TOOL_NODE_SIZE.width),
        maxY: Math.max(bounds.maxY, y + INTERNAL_AGENT_TOOL_NODE_SIZE.height),
      };
    },
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}
