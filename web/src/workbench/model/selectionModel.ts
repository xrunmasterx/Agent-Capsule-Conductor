import type {
  CanvasSelection,
  InternalNodeView,
  WorkflowCanvasEdge,
  WorkflowContainerModel,
  WorkflowPortView,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import type { EdgeAddress } from './edgeAddress';
import {
  edgeAddressEquals,
  rootEdgeAddress,
  workflowEdgeAddress,
} from './edgeAddress';
import { expandWorkflowToFitChildren } from './canvasLayout';
import { outputPortsFromSchema } from './schemaPorts';
import {
  flowEndpointForCanvas,
  isExecutableNodeWorkflow,
  isWorkflowBoundaryId,
} from './workflowNodeModel';

export type SelectionIntent =
  | { kind: 'react-flow-node'; flowNodeId: string }
  | { kind: 'workflow-shell'; workflowId: string }
  | { kind: 'internal-node'; workflowId: string; nodeId: string }
  | { kind: 'edge'; address: EdgeAddress };

export type SelectionDeleteEligibility = { ok: boolean; reason?: string };

export function promptFromInvocationInput(input: Record<string, unknown>): string {
  const prompt = input.user_prompt ?? input.prompt ?? input.topic;
  return typeof prompt === 'string' ? prompt : '';
}

export function staticInputFromInvocationInput(input: Record<string, unknown>): Record<string, unknown> {
  const { user_prompt: _userPrompt, prompt: _prompt, topic: _topic, ...staticInput } = input;
  return staticInput;
}

export function workflowInvocationLabel(workflow: WorkflowContainerModel): string {
  return workflow.invocationLabel || workflow.title || workflow.id;
}

export function internalInvocationLabel(node: InternalNodeView): string {
  return node.invocationLabel || node.name || node.id;
}

export function shouldDisconnectEdgeOnClick(event: { altKey: boolean; button: number }): boolean {
  return event.altKey && event.button === 0;
}

export {
  isExecutableNodeWorkflow,
};

export function isActiveCanvasObjectStatus(status: string): boolean {
  return status === 'queued' || status === 'running' || status === 'scheduled' || status === 'cancel_requested';
}

export function selectionForEdgeAddress(address: EdgeAddress): CanvasSelection {
  return {
    type: 'edge',
    id: address.edgeId,
    scopeWorkflowId: address.scopeWorkflowId,
  };
}

export function edgeAddressForScope(scopeWorkflowId: string | null | undefined, edgeId: string): EdgeAddress {
  return scopeWorkflowId ? workflowEdgeAddress(scopeWorkflowId, edgeId) : rootEdgeAddress(edgeId);
}

export function selectionEdgeAddress(canvas: WorkspaceCanvasModel, selection: CanvasSelection): EdgeAddress | null {
  if (selection.type !== 'edge') {
    return null;
  }
  if ('scopeWorkflowId' in selection && selection.scopeWorkflowId !== undefined) {
    return edgeAddressForScope(selection.scopeWorkflowId, selection.id);
  }
  return resolveLegacyEdgeSelection(canvas, selection.id);
}

export function findCanvasEdgeByAddress(
  canvas: WorkspaceCanvasModel,
  address: EdgeAddress | null | undefined,
): WorkflowCanvasEdge | undefined {
  if (!address) {
    return undefined;
  }
  if (!address.scopeWorkflowId) {
    return canvas.edges.find((edge) => edge.id === address.edgeId);
  }
  return canvas.workflows
    .find((workflow) => workflow.id === address.scopeWorkflowId)
    ?.internalEdges.find((edge) => edge.id === address.edgeId);
}

export function selectionMatchesEdge(
  selection: CanvasSelection,
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  edge: WorkflowCanvasEdge,
): boolean {
  return edgeAddressEquals(selectionEdgeAddress(canvas, selection), edgeAddressForScope(scopeWorkflowId, edge.id));
}

export function selectionMatchesEdgeAddress(selection: CanvasSelection, address: EdgeAddress): boolean {
  if (selection.type !== 'edge' || selection.id !== address.edgeId) {
    return false;
  }
  return selection.scopeWorkflowId === undefined || selection.scopeWorkflowId === address.scopeWorkflowId;
}

export function normalizeWorkbenchSelection(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
  focusedWorkflowId: string | null,
): CanvasSelection {
  if (selection.type === 'task_canvas') {
    return selection.taskId === canvas.id ? selection : { type: 'task_canvas', taskId: canvas.id };
  }
  if (selection.type === 'workflow') {
    if (canvas.workflows.some((workflow) => workflow.id === selection.id)) {
      return selection;
    }
    return { type: 'task_canvas', taskId: canvas.id };
  }
  if (selection.type === 'edge') {
    const address = selectionEdgeAddress(canvas, selection);
    if (!address || !findCanvasEdgeByAddress(canvas, address)) {
      return { type: 'task_canvas', taskId: canvas.id };
    }
    return selectionForEdgeAddress(address);
  }
  const workflow = canvas.workflows.find((item) => item.id === selection.workflowId);
  if (!workflow) {
    return { type: 'task_canvas', taskId: canvas.id };
  }
  if (focusedWorkflowId && workflow.id !== focusedWorkflowId) {
    return { type: 'task_canvas', taskId: canvas.id };
  }
  if (selection.type === 'port') {
    const ports = selection.direction === 'input' ? workflow.inputPorts : workflowOutputPorts(workflow);
    return ports.some((portValue) => portValue.id === selection.portId)
      ? selection
      : { type: 'task_canvas', taskId: canvas.id };
  }
  return workflow.internalNodes.some((node) => node.id === selection.nodeId)
    ? selection
    : { type: 'task_canvas', taskId: canvas.id };
}

export function normalizeSelectionIntent(
  visibleCanvas: WorkspaceCanvasModel,
  baseCanvas: WorkspaceCanvasModel,
  intent: SelectionIntent,
  focusedWorkflowId: string | null,
): CanvasSelection | null {
  if (intent.kind === 'edge') {
    return findCanvasEdgeByAddress(baseCanvas, intent.address) ? selectionForEdgeAddress(intent.address) : null;
  }
  if (intent.kind === 'workflow-shell') {
    return baseCanvas.workflows.some((workflow) => workflow.id === intent.workflowId)
      ? { type: 'workflow', id: intent.workflowId }
      : null;
  }
  if (intent.kind === 'internal-node') {
    if (isWorkflowBoundaryId(intent.workflowId)) {
      return baseCanvas.workflows.some((workflow) => workflow.id === intent.workflowId)
        ? { type: 'workflow', id: intent.workflowId }
        : null;
    }
    const workflow = baseCanvas.workflows.find((item) => item.id === intent.workflowId);
    if (!workflow || !workflow.internalNodes.some((node) => node.id === intent.nodeId)) {
      return null;
    }
    return { type: 'internal', workflowId: intent.workflowId, nodeId: intent.nodeId };
  }
  const endpoint = flowEndpointForCanvas(visibleCanvas, intent.flowNodeId);
  if (endpoint.internal && endpoint.workflowId) {
    return normalizeSelectionIntent(
      visibleCanvas,
      baseCanvas,
      { kind: 'internal-node', workflowId: endpoint.workflowId, nodeId: endpoint.nodeId },
      focusedWorkflowId,
    );
  }
  if (focusedWorkflowId && intent.flowNodeId !== focusedWorkflowId) {
    const focusedWorkflow = baseCanvas.workflows.find((workflow) => workflow.id === focusedWorkflowId);
    if (focusedWorkflow?.internalNodes.some((node) => node.id === intent.flowNodeId)) {
      return { type: 'internal', workflowId: focusedWorkflowId, nodeId: intent.flowNodeId };
    }
  }
  return baseCanvas.workflows.some((workflow) => workflow.id === intent.flowNodeId)
    ? { type: 'workflow', id: intent.flowNodeId }
    : null;
}

export function selectionCanBeDeleted(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
  isRunning: boolean,
): SelectionDeleteEligibility {
  if (selection.type === 'edge') {
    if (isRunning) {
      return { ok: false, reason: '任务运行中，不能删除画布节点或连接。' };
    }
    return findCanvasEdgeByAddress(canvas, selectionEdgeAddress(canvas, selection))
      ? { ok: true }
      : { ok: false, reason: '选中的连接已不存在。' };
  }
  if (isRunning) {
    return { ok: false, reason: '任务运行中，不能删除画布节点或连接。' };
  }
  if (selection.type === 'task_canvas') {
    return { ok: false, reason: '请先选中要删除的节点或连接。' };
  }
  if (selection.type === 'port') {
    return { ok: false, reason: '端口不能通过快捷键删除，请在节点设置中调整输入输出。' };
  }
  if ((selection as CanvasSelection).type === 'edge') {
    return canvasHasEdge(canvas, (selection as { id: string }).id)
      ? { ok: true }
      : { ok: false, reason: '选中的连接已不存在。' };
  }
  if (selection.type === 'workflow') {
    const workflow = canvas.workflows.find((item) => item.id === selection.id);
    if (!workflow) {
      return { ok: false, reason: '选中的节点已不存在。' };
    }
    if (isActiveCanvasObjectStatus(workflow.status)) {
      return { ok: false, reason: '该节点正在运行，不能删除。' };
    }
    return { ok: true };
  }
  const workflow = canvas.workflows.find((item) => item.id === selection.workflowId);
  const node = workflow?.internalNodes.find((item) => item.id === selection.nodeId);
  if (!workflow || !node) {
    return { ok: false, reason: '选中的节点已不存在。' };
  }
  if (isActiveCanvasObjectStatus(node.status)) {
    return { ok: false, reason: '该节点正在运行，不能删除。' };
  }
  return { ok: true };
}

export function deleteSelectionFromCanvas(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
): WorkspaceCanvasModel {
  if (selection.type === 'edge') {
    const address = selectionEdgeAddress(canvas, selection);
    if (!address) {
      return canvas;
    }
    if (!address.scopeWorkflowId) {
      return {
        ...canvas,
        edges: canvas.edges.filter((edge) => edge.id !== address.edgeId),
      };
    }
    return {
      ...canvas,
      workflows: canvas.workflows.map((workflow) => ({
        ...workflow,
        internalEdges:
          workflow.id === address.scopeWorkflowId
            ? workflow.internalEdges.filter((edge) => edge.id !== address.edgeId)
            : workflow.internalEdges,
      })),
    };
  }
  if (selection.type === 'workflow') {
    return {
      ...canvas,
      workflows: canvas.workflows.filter((workflow) => workflow.id !== selection.id),
      edges: canvas.edges.filter((edge) => !edgeTouchesNode(edge, selection.id)),
    };
  }
  if (selection.type === 'internal') {
    return {
      ...canvas,
      workflows: canvas.workflows.map((workflow) => {
        if (workflow.id !== selection.workflowId) {
          return workflow;
        }
        const nextWorkflow = {
          ...workflow,
          internalNodes: workflow.internalNodes.filter((node) => node.id !== selection.nodeId),
          internalEdges: workflow.internalEdges.filter((edge) => !edgeTouchesNode(edge, selection.nodeId)),
        };
        return isExecutableNodeWorkflow(nextWorkflow) ? nextWorkflow : expandWorkflowToFitChildren(nextWorkflow);
      }),
    };
  }
  if ((selection as CanvasSelection).type === 'edge') {
    const legacyEdgeId = (selection as unknown as { id: string }).id;
    return {
      ...canvas,
      edges: canvas.edges.filter((edge) => edge.id !== legacyEdgeId),
      workflows: canvas.workflows.map((workflow) => ({
        ...workflow,
        internalEdges: workflow.internalEdges.filter((edge) => edge.id !== legacyEdgeId),
      })),
    };
  }
  return canvas;
}

export function canvasHasEdge(canvas: WorkspaceCanvasModel, edgeId: string): boolean {
  return (
    canvas.edges.some((edge) => edge.id === edgeId) ||
    canvas.workflows.some((workflow) => workflow.internalEdges.some((edge) => edge.id === edgeId))
  );
}

export function edgeTouchesNode(edge: WorkflowCanvasEdge, nodeId: string): boolean {
  return edge.source.workflowId === nodeId || edge.target.workflowId === nodeId;
}

function resolveLegacyEdgeSelection(canvas: WorkspaceCanvasModel, edgeId: string): EdgeAddress | null {
  const matches: EdgeAddress[] = [];
  if (canvas.edges.some((edge) => edge.id === edgeId)) {
    matches.push(rootEdgeAddress(edgeId));
  }
  for (const workflow of canvas.workflows) {
    if (workflow.internalEdges.some((edge) => edge.id === edgeId)) {
      matches.push(workflowEdgeAddress(workflow.id, edgeId));
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function workflowOutputPorts(workflow: WorkflowContainerModel): WorkflowPortView[] {
  if (workflow.sourceKind && workflow.sourceKind !== 'workflow') {
    return outputPortsFromSchema(workflow.outputSchema, workflow.outputPorts);
  }
  return workflow.outputPorts;
}
