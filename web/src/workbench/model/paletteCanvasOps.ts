import {
  AGENT_TOOL_NODE_SIZE,
  DEFAULT_CONTAINER_SIZE,
} from '../constants';
import type {
  CanvasSelection,
  InternalNodeView,
  WorkflowContainerModel,
  WorkflowPortView,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { expandWorkflowToFitChildren } from './canvasLayout';
import { internalInvocationLabel, workflowInvocationLabel } from './selectionModel';
import { outputPortsFromSchema } from './schemaPorts';
import { internalNodeOutputPorts, port } from './workflowGraphProjection';

export type PaletteWorkflowItem = { kind: 'workflow'; workflowRef?: string; label: string };

export type PaletteCallableItem =
  | {
      kind: 'agent';
      callableId: string;
      label: string;
      inputPorts?: WorkflowPortView[];
      outputPorts?: WorkflowPortView[];
      outputSchema?: Record<string, unknown>;
    }
  | {
      kind: 'tool';
      callableId: string;
      label: string;
      inputPorts?: WorkflowPortView[];
      outputPorts?: WorkflowPortView[];
      outputSchema?: Record<string, unknown>;
    }
  | { kind: 'file_source'; callableId: 'file-source.local'; label: string };

export type PaletteCanvasItem = PaletteWorkflowItem | PaletteCallableItem;

export function addWorkflowFromPalette(
  canvas: WorkspaceCanvasModel,
  item: PaletteWorkflowItem,
  position: { x: number; y: number },
): WorkspaceCanvasModel {
  const baseId = slugId(item.workflowRef || item.label || 'workflow');
  const id = uniqueId(baseId || 'workflow', new Set(canvas.workflows.map((workflow) => workflow.id)));
  const invocationLabel = uniqueInvocationLabel(
    item.label || id,
    new Set(canvas.workflows.map(workflowInvocationLabel)),
  );
  const workflow: WorkflowContainerModel = {
    id,
    title: invocationLabel,
    invocationLabel,
    sourceKind: 'workflow',
    workflowBodyKind: 'inline_container',
    workflowRef: item.workflowRef,
    directory: '未绑定工作目录',
    bindingPath: `bindings/${id}.binding.local.json`,
    status: 'not_run',
    inputPorts: [port('main', '输入', 'input')],
    outputPorts: [port('main', '输出', 'output')],
    internalNodes: [],
    internalEdges: [],
    position,
    size: DEFAULT_CONTAINER_SIZE,
    warnings: [],
  };
  return { ...canvas, workflows: [...canvas.workflows, workflow] };
}

export function nextPaletteSelection(
  canvas: WorkspaceCanvasModel,
  item: PaletteCallableItem,
  targetWorkflowId: string | null,
): CanvasSelection {
  if (targetWorkflowId) {
    const workflow = canvas.workflows.find((candidate) => candidate.id === targetWorkflowId);
    const existingIds = new Set(workflow?.internalNodes.map((node) => node.id) || []);
    return {
      type: 'internal',
      workflowId: targetWorkflowId,
      nodeId: uniqueId(paletteItemBaseId(item), existingIds),
    };
  }
  return {
    type: 'workflow',
    id: uniqueId(paletteItemBaseId(item), new Set(canvas.workflows.map((workflow) => workflow.id))),
  };
}

export function addCallableNodeFromPalette(
  canvas: WorkspaceCanvasModel,
  item: PaletteCallableItem,
  position: { x: number; y: number },
): WorkspaceCanvasModel {
  const existingIds = new Set(canvas.workflows.map((workflow) => workflow.id));
  const existingLabels = new Set(canvas.workflows.map(workflowInvocationLabel));
  const node = internalNodeFromPaletteItem(item, position, existingIds, existingLabels);
  const id = node.id;
  const workflow: WorkflowContainerModel = {
    id,
    title: node.name,
    invocationLabel: node.invocationLabel || node.name,
    sourceKind: node.kind === 'Tool' ? 'tool' : 'agent_session',
    callableId: node.callableId,
    sourceInput: node.input,
    control: node.control,
    outputSchema: node.outputSchema,
    forwardMainOutputOnControl: node.forwardMainOutputOnControl ?? null,
    directory: 'Root canvas environment',
    status: 'not_run',
    inputPorts: node.inputPorts || [port('main', 'input', 'input')],
    outputPorts: internalNodeOutputPorts(node),
    internalNodes: [],
    internalEdges: [],
    position,
    size: AGENT_TOOL_NODE_SIZE,
    warnings: [],
  };
  return { ...canvas, workflows: [...canvas.workflows, workflow] };
}

export function addInternalNodeFromPalette(
  canvas: WorkspaceCanvasModel,
  workflowId: string,
  item: PaletteCallableItem,
  position: { x: number; y: number },
): WorkspaceCanvasModel {
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
      if (workflow.id !== workflowId) {
        return workflow;
      }
      const existingIds = new Set(workflow.internalNodes.map((node) => node.id));
      const existingLabels = new Set(workflow.internalNodes.map(internalInvocationLabel));
      const node = internalNodeFromPaletteItem(item, position, existingIds, existingLabels);
      return expandWorkflowToFitChildren({ ...workflow, internalNodes: [...workflow.internalNodes, node] });
    }),
  };
}

export function internalNodeFromPaletteItem(
  item: PaletteCallableItem,
  position: { x: number; y: number },
  existingIds: Set<string>,
  existingLabels: Set<string> = new Set(),
): InternalNodeView {
  const callableId = item.kind === 'file_source' ? 'file-source.local' : item.callableId;
  const id = uniqueId(paletteItemBaseId(item), existingIds);
  const isTool = item.kind === 'tool' || item.kind === 'file_source';
  const invocationLabel = uniqueInvocationLabel(item.label || callableId || id, existingLabels);
  const task = isTool ? '本地工具节点' : invocationLabel;
  return {
    id,
    name: invocationLabel,
    invocationLabel,
    task,
    kind: isTool ? 'Tool' : 'Agent',
    status: 'not_run',
    callableId,
    runtime: callableId,
    input:
      item.kind === 'file_source'
        ? { path: '' }
        : { user_prompt: invocationLabel },
    inputPorts:
      item.kind === 'file_source'
        ? [port('main', 'input', 'input')]
        : item.inputPorts || [port('main', 'input', 'input')],
    outputPorts:
      item.kind === 'file_source'
        ? [port('main', 'output', 'output')]
        : outputPortsFromSchema(item.outputSchema, item.outputPorts || [port('main', 'output', 'output')]),
    outputSchema: item.kind === 'file_source' ? undefined : item.outputSchema,
    forwardMainOutputOnControl: null,
    position,
  };
}

export function paletteItemBaseId(item: PaletteCallableItem): string {
  const stableRef = item.kind === 'file_source' ? item.callableId : item.callableId;
  return slugId(stableRef || item.label || 'node');
}

export function slugId(value: string): string {
  const slug = value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 48);
  return slug || 'node';
}

export function uniqueId(baseId: string, existingIds: Set<string>): string {
  let id = baseId;
  let index = 1;
  while (existingIds.has(id)) {
    index += 1;
    id = `${baseId}_${index}`;
  }
  return id;
}

function uniqueInvocationLabel(baseLabel: string, existingLabels: Set<string>): string {
  const normalizedBase = baseLabel.trim() || 'Invocation';
  if (!existingLabels.has(normalizedBase)) {
    return normalizedBase;
  }
  let index = 2;
  let nextLabel = `${normalizedBase} #${index}`;
  while (existingLabels.has(nextLabel)) {
    index += 1;
    nextLabel = `${normalizedBase} #${index}`;
  }
  return nextLabel;
}
