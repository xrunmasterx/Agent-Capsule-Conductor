import type { AuthoringValidation, WorkflowGraph } from '../../types';
import type {
  AssistantTurnReason,
  AuthoringContextSnapshot,
  CanvasAuthoringOperation,
  CanvasAuthoringTarget,
  CanvasAuthoringValidationResult,
  CanvasSelection,
  WorkbenchAuthoringState,
  WorkflowContainerModel,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { isTemporaryCallableId } from './graphOpsProposal';
import { internalInvocationLabel, workflowInvocationLabel } from './selectionModel';

export function canvasAuthoringHash(taskId: string, canvas: WorkspaceCanvasModel): string {
  return `canvas_hash_v1:${hashString(stableJsonStringify({ taskId, canvas }))}`;
}

export function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function authoringTargetFromSelection(
  selection: CanvasSelection,
  taskId: string,
): CanvasAuthoringTarget {
  if (selection.type === 'workflow') {
    return { kind: 'workflow', workflow_id: selection.id };
  }
  if (selection.type === 'internal') {
    return {
      kind: 'internal_node',
      workflow_id: selection.workflowId,
      node_id: selection.nodeId,
    };
  }
  if (selection.type === 'edge') {
    return {
      kind: 'edge',
      edge_id: selection.id,
      scope_workflow_id: selection.scopeWorkflowId || null,
    };
  }
  if (selection.type === 'port') {
    return {
      kind: 'port',
      workflow_id: selection.workflowId,
      port_id: selection.portId,
      direction: selection.direction,
    };
  }
  return { kind: 'task_canvas', task_id: selection.taskId || taskId };
}

export function effectiveAssistantTurnReason(
  requestedReason: AssistantTurnReason,
  selection: CanvasSelection,
): AssistantTurnReason {
  if (requestedReason === 'workbench_chat') {
    return 'workbench_chat';
  }
  return isInspectableNodeSelection(selection) ? 'selected_node_revision' : 'canvas_revision';
}

export function isInspectableNodeSelection(selection: CanvasSelection): boolean {
  return selection.type === 'workflow' || selection.type === 'internal';
}

export function mergeAuthoringValidation(
  localValidation: CanvasAuthoringValidationResult | null,
  backendValidation: CanvasAuthoringValidationResult | null,
): CanvasAuthoringValidationResult | null {
  if (!localValidation && !backendValidation) {
    return null;
  }
  const errors = [
    ...(backendValidation?.errors || []),
    ...(localValidation?.errors || []).filter(
      (error) => !(backendValidation?.errors || []).includes(error),
    ),
  ];
  const warnings = [
    ...(backendValidation?.warnings || []),
    ...(localValidation?.warnings || []).filter(
      (warning) => !(backendValidation?.warnings || []).includes(warning),
    ),
  ];
  return {
    status:
      backendValidation?.status === 'invalid' || localValidation?.status === 'invalid'
        ? 'invalid'
        : 'valid',
    errors,
    warnings,
  };
}

export function authoringValidationFromBackend(
  validation: AuthoringValidation | null | undefined,
): CanvasAuthoringValidationResult | null {
  if (!validation) {
    return null;
  }
  return {
    status: validation.status === 'valid' ? 'valid' : 'invalid',
    errors: (validation.errors || []).map((error) => error.message || String(error.code || error)),
    warnings: (validation.warnings || []).map(
      (warning) => warning.message || String(warning.code || warning),
    ),
  };
}

export function authoringBackendCanvasSnapshot(snapshot: AuthoringContextSnapshot): Record<string, unknown> {
  return {
    task_id: snapshot.task_id,
    id: snapshot.canvas.id,
    name: snapshot.canvas.name,
    workflows: snapshot.canvas.workflows,
    edges: snapshot.canvas.edges,
    canonical_graph: snapshot.canonical_graph,
    callable_catalog: snapshot.callable_catalog,
    workflow_catalog: snapshot.workflow_catalog,
  };
}

export function authoringSelectionPayload(selection: CanvasSelection): Record<string, unknown> {
  return selection as unknown as Record<string, unknown>;
}

export function replaceTemporaryResourceWithCallable(
  canvas: WorkspaceCanvasModel,
  temporaryResourceId: string,
  callableId: string,
): WorkspaceCanvasModel {
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
      const workflowMatches =
        workflow.temporaryResourceId === temporaryResourceId ||
        workflow.callableId === temporaryResourceId;
      return {
        ...workflow,
        ...(workflowMatches
          ? {
              sourceKind: 'agent_session' as const,
              callableId,
              temporaryResourceId: undefined,
              warnings: [],
            }
          : {}),
        internalNodes: workflow.internalNodes.map((node) => {
          const nodeMatches =
            node.temporaryResourceId === temporaryResourceId ||
            node.callableId === temporaryResourceId;
          return nodeMatches
            ? {
                ...node,
                kind: 'Agent' as const,
                callableId,
                runtime: callableId,
                temporaryResourceId: undefined,
              }
            : node;
        }),
      };
    }),
  };
}

export function temporaryResourceIssueForCanvas(
  canvas: WorkspaceCanvasModel,
  authoring: WorkbenchAuthoringState | undefined,
): string | null {
  for (const workflow of canvas.workflows) {
    const resourceId = workflow.temporaryResourceId || (isTemporaryCallableId(workflow.callableId) ? workflow.callableId : '');
    if (resourceId) {
      const draft = authoring?.temporaryResources[resourceId];
      return `节点 ${workflowInvocationLabel(workflow)} 使用临时 agent template ${draft?.agent_draft.name || resourceId}，不能 run/save。请替换为真实 callable。`;
    }
    for (const node of workflow.internalNodes) {
      const internalResourceId = node.temporaryResourceId || (isTemporaryCallableId(node.callableId) ? node.callableId : '');
      if (internalResourceId) {
        const draft = authoring?.temporaryResources[internalResourceId];
        return `节点 ${internalInvocationLabel(node)} 使用临时 agent template ${draft?.agent_draft.name || internalResourceId}，不能 run/save。请替换为真实 callable。`;
      }
    }
  }
  return null;
}

export function temporaryResourceIssueForGraph(graph: WorkflowGraph): string | null {
  const node = graph.nodes.find((item) => isTemporaryCallableId(item.callable_ref?.id));
  return node
    ? `Graph 节点 ${node.label || node.id} 绑定临时 callable ${node.callable_ref.id}，不能提交运行。`
    : null;
}

export function authoringOperationSummary(operation: CanvasAuthoringOperation): string {
  if (operation.op === 'add_existing_callable_node') {
    return `添加节点 ${operation.node_id} -> ${operation.callable_id}`;
  }
  if (operation.op === 'create_temporary_agent_template') {
    return `创建临时 agent ${operation.draft_id}`;
  }
  if (operation.op === 'add_control_edge') {
    return `控制线 ${operation.from} -> ${operation.to}`;
  }
  if (operation.op === 'add_data_edge') {
    return `Data Edge ${operation.from.node}.${operation.from.port} -> ${operation.to.node}.${operation.to.port}`;
  }
  if ('node_id' in operation) {
    return `${operation.op}: ${operation.node_id}`;
  }
  return operation.op;
}

export function workflowById(canvas: WorkspaceCanvasModel, workflowId: string): WorkflowContainerModel | undefined {
  return canvas.workflows.find((workflow) => workflow.id === workflowId);
}
