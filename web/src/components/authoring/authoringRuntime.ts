import type { CallableSummary, WorkflowSummary } from '../../types';
import type {
  AuthoringContextSnapshot,
  CanvasAuthoringApplyResult,
  CanvasAuthoringOperation,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
  CanvasSelection,
  TemporaryResourceDraft,
  WorkflowCanvasEdge,
  WorkflowPortView,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { TEMPORARY_CALLABLE_ID_PREFIX } from '../../workbench/constants';
import { authoringTargetFromSelection, canvasAuthoringHash } from '../../workbench/model/authoringProposal';
import {
  canvasEdgesAreEquivalent,
  controlEdgeWithId,
  controlSlotLimitIssue,
  createDataEdgeCommand,
  findDataConnectNode,
  normalizeCanvasEdges,
  uniqueEdgeIdForScope,
  wouldCreateControlCycle,
} from '../../workbench/model/canvasEdgeOps';
import { layoutWorkflowInternalNodes, layoutWorkspaceCanvas } from '../../workbench/model/canvasLayout';
import { isTemporaryCallableId } from '../../workbench/model/graphOpsProposal';
import { addCallableNodeFromPalette, addInternalNodeFromPalette, addWorkflowFromPalette, paletteItemBaseId, uniqueId } from '../../workbench/model/paletteCanvasOps';
import { isExecutableNodeWorkflow } from '../../workbench/model/selectionModel';
import { canvasToWorkflowGraph } from '../../workbench/model/workflowGraphProjection';
import { workflowBoundaryKind, workflowInputBoundaryId, workflowOutputBoundaryId } from '../../workbench/model/workflowNodeModel';
import { stripRuntimeStateFromCanvas } from '../workflow-viewer/runState';
import { outputSchemaFromArtifactContract, paletteItemFromCallable, workflowPortsFromPortContracts, type PaletteItem } from '../workflow-viewer/palette';

export function authoringId(prefix: string): string {
  const randomId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '_')
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomId}`;
}

export function captureAuthoringSnapshot({
  taskId,
  canvas,
  selection,
  callables,
  workflows,
}: {
  taskId: string;
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  callables: CallableSummary[];
  workflows: WorkflowSummary[];
}): AuthoringContextSnapshot {
  const strippedCanvas = stripRuntimeStateFromCanvas(canvas);
  return {
    snapshot_id: canvasAuthoringHash(taskId, strippedCanvas),
    task_id: taskId,
    target: authoringTargetFromSelection(selection, taskId),
    canvas: strippedCanvas,
    canonical_graph: canvasToWorkflowGraph(strippedCanvas),
    selection,
    callable_catalog: callables,
    workflow_catalog: workflows,
  };
}

function boundaryTransferPreviewSnapshot(canvas: WorkspaceCanvasModel): Record<string, unknown> {
  const strippedCanvas = stripRuntimeStateFromCanvas(canvas);
  return {
    ...strippedCanvas,
    canonical_graph: canvasToWorkflowGraph(strippedCanvas),
  };
}

export function buildDeterministicCanvasAuthoringProposal({
  message,
  snapshot,
}: {
  message: string;
  snapshot: AuthoringContextSnapshot;
}): { proposal: CanvasAuthoringProposal | null; errors: string[]; warnings: string[] } {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return { proposal: null, errors: ['请输入需求描述。'], warnings: [] };
  }
  const proposalId = authoringId('canvas_proposal');
  if (wantsTemporaryAgentTemplate(trimmedMessage)) {
    return {
      proposal: {
        proposal_id: proposalId,
        base_task_id: snapshot.task_id,
        base_canvas_hash: snapshot.snapshot_id,
        target: snapshot.target,
        rationale: 'Draft a temporary agent template on the current canvas only.',
        operations: [temporaryAgentTemplateOperation(trimmedMessage, snapshot.canvas)],
      },
      errors: [],
      warnings: ['临时 agent template 只能应用到当前 task canvas，不能 run/save。'],
    };
  }

  const selectedNode = selectedAuthoringNode(snapshot.canvas, snapshot.selection);
  if (selectedNode) {
    return {
      proposal: {
        proposal_id: proposalId,
        base_task_id: snapshot.task_id,
        base_canvas_hash: snapshot.snapshot_id,
        target: snapshot.target,
        rationale: 'Adjust the selected invocation input and output schema.',
        operations: [
          {
            op: 'update_invocation_input',
            scope_workflow_id: selectedNode.scopeWorkflowId,
            node_id: selectedNode.nodeId,
            input: { ...selectedNode.input, user_prompt: trimmedMessage },
          },
          {
            op: 'update_output_schema',
            scope_workflow_id: selectedNode.scopeWorkflowId,
            node_id: selectedNode.nodeId,
            output_schema: genericOutputSchema(trimmedMessage),
          },
        ],
      },
      errors: [],
      warnings: [],
    };
  }

  return taskCanvasSkeletonProposal(trimmedMessage, snapshot, proposalId);
}

function wantsTemporaryAgentTemplate(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes('new agent') ||
    lowered.includes('agent template') ||
    lowered.includes('create agent') ||
    lowered.includes('temporary agent') ||
    /(?:新建|创建|临时).*(?:agent|智能体)/u.test(message) ||
    /(?:agent|智能体).*模板/u.test(message)
  );
}

function selectedAuthoringNode(
  canvas: WorkspaceCanvasModel,
  selection: CanvasSelection,
): { scopeWorkflowId: string | null; nodeId: string; input: Record<string, unknown> } | null {
  if (selection.type === 'workflow') {
    const workflow = canvas.workflows.find((item) => item.id === selection.id);
    if (workflow && isExecutableNodeWorkflow(workflow)) {
      return {
        scopeWorkflowId: null,
        nodeId: workflow.id,
        input: workflow.sourceInput || {},
      };
    }
  }
  if (selection.type === 'internal') {
    const workflow = canvas.workflows.find((item) => item.id === selection.workflowId);
    const node = workflow?.internalNodes.find((item) => item.id === selection.nodeId);
    if (node) {
      return {
        scopeWorkflowId: workflow?.id || null,
        nodeId: node.id,
        input: node.input || {},
      };
    }
  }
  return null;
}

function taskCanvasSkeletonProposal(
  message: string,
  snapshot: AuthoringContextSnapshot,
  proposalId: string,
): { proposal: CanvasAuthoringProposal | null; errors: string[]; warnings: string[] } {
  const callableItems = snapshot.callable_catalog
    .filter((callable) => callable.kind === 'agent_class' || callable.kind === 'tool_class')
    .slice(0, 2);
  if (!callableItems.length) {
    return { proposal: null, errors: ['当前资源库没有可用 agent/tool callable。'], warnings: [] };
  }

  const existingIds = new Set(snapshot.canvas.workflows.map((workflow) => workflow.id));
  const operations: CanvasAuthoringOperation[] = [];
  callableItems.forEach((callable, index) => {
    const item = paletteItemFromCallable(callable);
    const nodeId = uniqueId(paletteItemBaseId(item), existingIds);
    existingIds.add(nodeId);
    operations.push({
      op: 'add_existing_callable_node',
      scope_workflow_id: null,
      node_id: nodeId,
      callable_id: callable.id,
      callable_kind: callable.kind === 'tool_class' ? 'tool_class' : 'agent_class',
      label: callable.name || callable.id,
      position: nextAuthoringRootPosition(snapshot.canvas, index),
      input: {
        user_prompt:
          index === 0
            ? message
            : `Review and synthesize the upstream result for this request: ${message}`,
      },
      input_ports: workflowPortsFromPortContracts(callable.input_ports, 'input'),
      output_ports: workflowPortsFromPortContracts(callable.output_ports, 'output'),
      output_schema: outputSchemaFromArtifactContract(callable.artifact_contract) || genericOutputSchema(message),
    });
  });
  if (callableItems.length >= 2) {
    operations.push({
      op: 'add_control_edge',
      scope_workflow_id: null,
      from: (operations[0] as Extract<CanvasAuthoringOperation, { op: 'add_existing_callable_node' }>).node_id,
      to: (operations[1] as Extract<CanvasAuthoringOperation, { op: 'add_existing_callable_node' }>).node_id,
    });
  }

  return {
    proposal: {
      proposal_id: proposalId,
      base_task_id: snapshot.task_id,
      base_canvas_hash: snapshot.snapshot_id,
      target: snapshot.target,
      rationale: 'Create a canvas-local workflow draft from existing callable templates.',
      operations,
    },
    errors: [],
    warnings: callableItems.length < 2 ? ['只有一个可用 callable，已生成单节点草稿。'] : [],
  };
}

function temporaryAgentTemplateOperation(
  message: string,
  canvas: WorkspaceCanvasModel,
): Extract<CanvasAuthoringOperation, { op: 'create_temporary_agent_template' }> {
  const draftId = authoringId(TEMPORARY_CALLABLE_ID_PREFIX.slice(0, -1));
  const nodeId = uniqueId(draftId, new Set(canvas.workflows.map((workflow) => workflow.id)));
  const outputSchema = genericOutputSchema(message);
  return {
    op: 'create_temporary_agent_template',
    scope_workflow_id: null,
    draft_id: draftId,
    node_id: nodeId,
    label: 'Temporary Agent',
    position: nextAuthoringRootPosition(canvas, 0),
    input: { user_prompt: message },
    output_schema: outputSchema,
    agent_draft: {
      id: draftId,
      version: '0.1.0',
      runtime: 'codex_cli',
      name: 'Temporary Agent',
      description: 'Canvas-local draft generated by the Phase 1 assistant.',
      default_prompt: message,
      input_ports: { main: { type: 'artifact', required: false } },
      output_ports: { main: { type: 'artifact', required: true } },
      artifact_contract: { output_schema: outputSchema },
      metadata: {
        temporary: true,
        generated_by: 'workbench_authoring_phase_1',
      },
    },
  };
}

function genericOutputSchema(message: string): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      summary: { type: 'string', description: `Result for: ${message.slice(0, 120)}` },
      artifacts: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['summary'],
  };
}

function nextAuthoringRootPosition(
  canvas: WorkspaceCanvasModel,
  index: number,
): { x: number; y: number } {
  if (!canvas.workflows.length) {
    return { x: 120 + index * 420, y: 180 };
  }
  const maxX = Math.max(...canvas.workflows.map((workflow) => workflow.position.x));
  return { x: maxX + 420 + index * 420, y: 180 };
}

export function validateCanvasAuthoringProposal(
  proposal: CanvasAuthoringProposal,
  context: {
    canvas: WorkspaceCanvasModel;
    taskId: string;
    temporaryResources: Record<string, TemporaryResourceDraft>;
    callables: CallableSummary[];
    workflows: WorkflowSummary[];
  },
): CanvasAuthoringValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (proposal.base_task_id !== context.taskId) {
    errors.push('Proposal 属于另一个 task，不能应用到当前画布。');
  }
  const currentHash = canvasAuthoringHash(context.taskId, stripRuntimeStateFromCanvas(context.canvas));
  if (proposal.base_canvas_hash !== currentHash) {
    errors.push('画布已变化，proposal 已过期。');
  }
  const allowedOps = new Set<CanvasAuthoringOperation['op']>([
    'add_existing_callable_node',
    'add_workflow_container',
    'update_invocation_input',
    'update_invocation_label',
    'update_output_schema',
    'set_ports',
    'add_control_edge',
    'add_data_edge',
    'remove_edge',
    'create_temporary_agent_template',
    'replace_temporary_template_with_existing_callable',
  ]);
  for (const operation of proposal.operations) {
    if (!allowedOps.has(operation.op)) {
      errors.push(`Unsupported authoring operation: ${(operation as { op?: string }).op || '<unknown>'}`);
    }
  }
  errors.push(...authoringOperationContractIssues(proposal, context));
  if (!errors.length) {
    try {
      applyCanvasAuthoringOperations({
        canvas: context.canvas,
        proposal,
        temporaryResources: context.temporaryResources,
        callables: context.callables,
        workflows: context.workflows,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { status: errors.length ? 'invalid' : 'valid', errors, warnings };
}

function authoringOperationContractIssues(
  proposal: CanvasAuthoringProposal,
  context: {
    canvas: WorkspaceCanvasModel;
    temporaryResources: Record<string, TemporaryResourceDraft>;
    callables: CallableSummary[];
    workflows: WorkflowSummary[];
  },
): string[] {
  const errors: string[] = [];
  const callableMap = new Map(context.callables.map((callable) => [callable.id, callable]));
  const workflowMap = new Map(context.workflows.map((workflow) => [workflow.path, workflow]));
  const rootNodeIds = new Set(context.canvas.workflows.map((workflow) => workflow.id));
  const workflowContainerScopeIds = new Set(
    context.canvas.workflows
      .filter((workflow) => !isExecutableNodeWorkflow(workflow))
      .map((workflow) => workflow.id),
  );
  const internalNodeIdsByWorkflow = new Map(
    context.canvas.workflows.map((workflow) => [
      workflow.id,
      new Set([
        ...workflow.internalNodes.map((node) => node.id),
        workflowInputBoundaryId(workflow.id),
        workflowOutputBoundaryId(workflow.id),
      ]),
    ]),
  );

  const scopeIssue = (scopeWorkflowId: string | null): string | null => {
    if (scopeWorkflowId === null) {
      return null;
    }
    if (!rootNodeIds.has(scopeWorkflowId)) {
      return `Authoring scope 不存在: ${scopeWorkflowId}`;
    }
    if (!workflowContainerScopeIds.has(scopeWorkflowId)) {
      return `Authoring scope 不是 workflow container: ${scopeWorkflowId}`;
    }
    return null;
  };

  const reserveNodeId = (scopeWorkflowId: string | null, nodeId: string): boolean => {
    if (!nodeId) {
        errors.push('节点 id 不能为空');
      return false;
    }
    if (scopeWorkflowId === null) {
      if (rootNodeIds.has(nodeId)) {
        errors.push(`节点 id 已存在: ${nodeId}`);
        return false;
      }
      rootNodeIds.add(nodeId);
      return true;
    }
    const ids = internalNodeIdsByWorkflow.get(scopeWorkflowId);
    if (!ids) {
      errors.push(`Authoring scope 不存在: ${scopeWorkflowId}`);
      return false;
    }
    if (ids.has(nodeId)) {
        errors.push(`节点 id 已存在: ${scopeWorkflowId}.${nodeId}`);
      return false;
    }
    ids.add(nodeId);
    return true;
  };

  const nodeExists = (scopeWorkflowId: string | null, nodeId: string): boolean => {
    if (scopeWorkflowId === null) {
      return rootNodeIds.has(nodeId);
    }
    return Boolean(internalNodeIdsByWorkflow.get(scopeWorkflowId)?.has(nodeId));
  };

  for (const operation of proposal.operations) {
    if ('scope_workflow_id' in operation) {
      const issue = scopeIssue(operation.scope_workflow_id);
      if (issue) {
        errors.push(issue);
        continue;
      }
    }

    if (operation.op === 'add_existing_callable_node') {
      const callable = callableMap.get(operation.callable_id);
      if (!callable) {
        errors.push(`Callable 不存在: ${operation.callable_id}`);
      } else if (operation.callable_kind !== callable.kind) {
        errors.push(`Callable kind 不匹配: ${operation.callable_id}`);
      }
      reserveNodeId(operation.scope_workflow_id, operation.node_id);
      continue;
    }

    if (operation.op === 'add_workflow_container') {
      if (operation.workflow_ref && !workflowMap.has(operation.workflow_ref)) {
        errors.push(`Workflow 模板不存在: ${operation.workflow_ref}`);
      }
      if (reserveNodeId(null, operation.node_id)) {
        workflowContainerScopeIds.add(operation.node_id);
        internalNodeIdsByWorkflow.set(
          operation.node_id,
          new Set([
            workflowInputBoundaryId(operation.node_id),
            workflowOutputBoundaryId(operation.node_id),
          ]),
        );
      }
      continue;
    }

    if (operation.op === 'create_temporary_agent_template') {
      if (!isTemporaryCallableId(operation.draft_id)) {
        errors.push(`临时 agent draft id 必须使用 ${TEMPORARY_CALLABLE_ID_PREFIX} 前缀`);
      }
      if (context.temporaryResources[operation.draft_id]) {
        errors.push(`临时 agent draft 已存在: ${operation.draft_id}`);
      }
      reserveNodeId(operation.scope_workflow_id, operation.node_id);
      continue;
    }

    if (
      operation.op === 'update_invocation_input' ||
      operation.op === 'update_invocation_label' ||
      operation.op === 'update_output_schema' ||
      operation.op === 'set_ports'
    ) {
      if (!nodeExists(operation.scope_workflow_id, operation.node_id)) {
        errors.push(`节点不存在: ${operation.scope_workflow_id ? `${operation.scope_workflow_id}.` : ''}${operation.node_id}`);
      }
      continue;
    }

    if (operation.op === 'add_control_edge') {
      if (!nodeExists(operation.scope_workflow_id, operation.from)) {
        errors.push(`控制线来源节点不存在: ${operation.from}`);
      }
      if (!nodeExists(operation.scope_workflow_id, operation.to)) {
        errors.push(`控制线目标节点不存在: ${operation.to}`);
      }
      continue;
    }

    if (operation.op === 'add_data_edge') {
      if (!nodeExists(operation.scope_workflow_id, operation.from.node)) {
        errors.push(`Data Edge 来源节点不存在: ${operation.from.node}`);
      }
      if (!nodeExists(operation.scope_workflow_id, operation.to.node)) {
        errors.push(`Data Edge 目标节点不存在: ${operation.to.node}`);
      }
      continue;
    }

    if (operation.op === 'remove_edge') {
      if (!authoringEdgeExists(context.canvas, operation.scope_workflow_id, operation.edge_id)) {
        errors.push(`连线不存在: ${operation.scope_workflow_id ? `${operation.scope_workflow_id}.` : ''}${operation.edge_id}`);
      }
      continue;
    }

    if (operation.op === 'replace_temporary_template_with_existing_callable') {
      const callable = callableMap.get(operation.callable_id);
      if (!callable) {
        errors.push(`Callable 不存在: ${operation.callable_id}`);
      } else if (operation.callable_kind !== callable.kind) {
        errors.push(`Callable kind 不匹配: ${operation.callable_id}`);
      }
      const node = findAuthoringNode(context.canvas, operation.scope_workflow_id, operation.node_id);
      const resourceId = node?.temporaryResourceId || (isTemporaryCallableId(node?.callableId) ? node?.callableId : '');
      if (!node) {
        errors.push(`节点不存在: ${operation.node_id}`);
      } else if (!resourceId) {
        errors.push(`节点不是临时 agent template: ${operation.node_id}`);
      } else if (resourceId !== operation.temporary_resource_id) {
        errors.push(`临时资源不匹配: ${operation.node_id}`);
      }
      const draft = context.temporaryResources[operation.temporary_resource_id];
      if (!draft) {
        errors.push(`临时资源不存在: ${operation.temporary_resource_id}`);
      } else if (draft.status === 'discarded') {
        errors.push(`临时资源已丢弃: ${operation.temporary_resource_id}`);
      } else if (draft.referenced_by.length && !draft.referenced_by.includes(operation.node_id)) {
        errors.push(`临时资源未引用节点: ${operation.node_id}`);
      }
    }
  }

  return Array.from(new Set(errors));
}

export function applyCanvasAuthoringProposal({
  canvas,
  taskId,
  proposal,
  temporaryResources,
  callables,
  workflows,
}: {
  canvas: WorkspaceCanvasModel;
  taskId: string;
  proposal: CanvasAuthoringProposal;
  temporaryResources: Record<string, TemporaryResourceDraft>;
  callables: CallableSummary[];
  workflows: WorkflowSummary[];
}): CanvasAuthoringApplyResult {
  const validation = validateCanvasAuthoringProposal(proposal, {
    canvas,
    taskId,
    temporaryResources,
    callables,
    workflows,
  });
  if (validation.status === 'invalid') {
    throw new Error(validation.errors.join('\n'));
  }
  return applyCanvasAuthoringOperations({ canvas, proposal, temporaryResources, callables, workflows });
}

function applyCanvasAuthoringOperations({
  canvas,
  proposal,
  temporaryResources,
  callables,
  workflows,
}: {
  canvas: WorkspaceCanvasModel;
  proposal: CanvasAuthoringProposal;
  temporaryResources: Record<string, TemporaryResourceDraft>;
  callables: CallableSummary[];
  workflows: WorkflowSummary[];
}): CanvasAuthoringApplyResult {
  const callableMap = new Map(callables.map((callable) => [callable.id, callable]));
  const workflowMap = new Map(workflows.map((workflow) => [workflow.path, workflow]));
  let nextCanvas = stripRuntimeStateFromCanvas(canvas);
  let nextTemporaryResources = { ...temporaryResources };
  let nextSelection: CanvasSelection = { type: 'task_canvas', taskId: canvas.id };
  const messages: string[] = [];
  const layoutScopes = new Set<string | null>();
  let layoutTriggerCount = 0;

  const markLayoutScope = (scopeWorkflowId: string | null) => {
    layoutScopes.add(scopeWorkflowId);
    layoutTriggerCount += 1;
  };

  for (const operation of proposal.operations) {
    if (operation.op === 'add_existing_callable_node') {
      const callable = callableMap.get(operation.callable_id);
      if (!callable) {
        throw new Error(`Callable 不存在: ${operation.callable_id}`);
      }
      nextCanvas = addAuthoringCallableNode(nextCanvas, operation, paletteItemFromCallable(callable));
      nextSelection =
        operation.scope_workflow_id === null
          ? { type: 'workflow', id: operation.node_id }
          : { type: 'internal', workflowId: operation.scope_workflow_id, nodeId: operation.node_id };
      messages.push(`已添加节点 ${operation.node_id}`);
      markLayoutScope(operation.scope_workflow_id);
      continue;
    }
    if (operation.op === 'add_workflow_container') {
      if (operation.workflow_ref && !workflowMap.has(operation.workflow_ref)) {
        throw new Error(`Workflow 模板不存在: ${operation.workflow_ref}`);
      }
      nextCanvas = addAuthoringWorkflowContainer(nextCanvas, operation);
      nextSelection = { type: 'workflow', id: operation.node_id };
      messages.push(`已添加 Workflow ${operation.node_id}`);
      markLayoutScope(null);
      continue;
    }
    if (operation.op === 'create_temporary_agent_template') {
      nextCanvas = addAuthoringTemporaryAgentNode(nextCanvas, operation);
      nextTemporaryResources[operation.draft_id] = {
        draft_id: operation.draft_id,
        kind: 'agent_template',
        status: 'approved_for_canvas',
        agent_draft: operation.agent_draft,
        referenced_by: [operation.node_id],
      };
      nextSelection =
        operation.scope_workflow_id === null
          ? { type: 'workflow', id: operation.node_id }
          : { type: 'internal', workflowId: operation.scope_workflow_id, nodeId: operation.node_id };
      messages.push(`已创建临时 agent 草稿 ${operation.draft_id}`);
      markLayoutScope(operation.scope_workflow_id);
      continue;
    }
    if (operation.op === 'update_invocation_input') {
      nextCanvas = updateAuthoringNode(nextCanvas, operation.scope_workflow_id, operation.node_id, {
        input: operation.input,
      });
      messages.push(`已更新 ${operation.node_id} 的输入`);
      continue;
    }
    if (operation.op === 'update_invocation_label') {
      nextCanvas = updateAuthoringNode(nextCanvas, operation.scope_workflow_id, operation.node_id, {
        label: operation.label,
      });
      messages.push(`已更新 ${operation.node_id} 的标签`);
      continue;
    }
    if (operation.op === 'update_output_schema') {
      nextCanvas = updateAuthoringNode(nextCanvas, operation.scope_workflow_id, operation.node_id, {
        outputSchema: operation.output_schema,
      });
      messages.push(`已更新 ${operation.node_id} 的 output_schema`);
      continue;
    }
    if (operation.op === 'set_ports') {
      nextCanvas = updateAuthoringNode(nextCanvas, operation.scope_workflow_id, operation.node_id, {
        inputPorts: operation.input_ports,
        outputPorts: operation.output_ports,
      });
      messages.push(`已更新 ${operation.node_id} 的端口`);
      continue;
    }
    if (operation.op === 'add_control_edge') {
      nextCanvas = addAuthoringControlEdge(nextCanvas, operation);
      messages.push(`已添加控制线 ${operation.from} -> ${operation.to}`);
      markLayoutScope(operation.scope_workflow_id);
      continue;
    }
    if (operation.op === 'add_data_edge') {
      nextCanvas = createDataEdgeCommand(nextCanvas, {
        scopeWorkflowId: operation.scope_workflow_id,
        sourceNodeId: operation.from.node,
        sourcePortId: operation.from.port,
        targetNodeId: operation.to.node,
        targetPortId: operation.to.port,
        materialization: operation.materialization,
        replaceExisting: operation.replace_existing,
      }).canvas;
      messages.push(`已添加 Data Edge ${operation.from.node}.${operation.from.port} -> ${operation.to.node}.${operation.to.port}`);
      markLayoutScope(operation.scope_workflow_id);
      continue;
    }
    if (operation.op === 'remove_edge') {
      nextCanvas = removeAuthoringEdge(nextCanvas, operation.scope_workflow_id, operation.edge_id);
      messages.push(`已删除连线 ${operation.edge_id}`);
      continue;
    }
    if (operation.op === 'replace_temporary_template_with_existing_callable') {
      const callable = callableMap.get(operation.callable_id);
      if (!callable) {
        throw new Error(`Callable 不存在: ${operation.callable_id}`);
      }
      nextCanvas = replaceTemporaryAuthoringNode(nextCanvas, operation);
      nextTemporaryResources = {
        ...nextTemporaryResources,
        [operation.temporary_resource_id]: {
          ...nextTemporaryResources[operation.temporary_resource_id],
          status: 'discarded',
        },
      };
      messages.push(`已将临时节点 ${operation.node_id} 替换为 ${operation.callable_id}`);
      continue;
    }
  }

  return {
    canvas: layoutCanvasAfterAuthoringApply(normalizeCanvasEdges(nextCanvas), layoutScopes, layoutTriggerCount),
    temporaryResources: nextTemporaryResources,
    selection: nextSelection,
    messages,
  };
}

function layoutCanvasAfterAuthoringApply(
  canvas: WorkspaceCanvasModel,
  layoutScopes: Set<string | null>,
  triggerCount: number,
): WorkspaceCanvasModel {
  if (triggerCount < 2 || layoutScopes.size === 0) {
    return canvas;
  }
  if (layoutScopes.size === 1) {
    const [scopeWorkflowId] = Array.from(layoutScopes);
    if (scopeWorkflowId) {
      return {
        ...canvas,
        workflows: canvas.workflows.map((workflow) =>
          workflow.id === scopeWorkflowId ? layoutWorkflowInternalNodes(workflow) : workflow,
        ),
      };
    }
  }
  return layoutWorkspaceCanvas(canvas);
}

function addAuthoringCallableNode(
  canvas: WorkspaceCanvasModel,
  operation: Extract<CanvasAuthoringOperation, { op: 'add_existing_callable_node' }>,
  item: Exclude<PaletteItem, { kind: 'workflow' }>,
): WorkspaceCanvasModel {
  const beforeCanvas = canvas;
  const nextCanvas =
    operation.scope_workflow_id === null
      ? addCallableNodeFromPalette(canvas, item, operation.position)
      : addInternalNodeFromPalette(canvas, operation.scope_workflow_id, item, operation.position);
  const actualNodeId = addedAuthoringNodeId(beforeCanvas, nextCanvas, operation.scope_workflow_id);
  const canvasWithProposalId = renameAuthoringNodeId(
    nextCanvas,
    operation.scope_workflow_id,
    actualNodeId,
    operation.node_id,
  );
  return updateAuthoringNode(canvasWithProposalId, operation.scope_workflow_id, operation.node_id, {
    label: operation.label,
    input: operation.input,
    inputPorts: operation.input_ports,
    outputPorts: operation.output_ports,
    outputSchema: operation.output_schema,
  });
}

function addAuthoringWorkflowContainer(
  canvas: WorkspaceCanvasModel,
  operation: Extract<CanvasAuthoringOperation, { op: 'add_workflow_container' }>,
): WorkspaceCanvasModel {
  const beforeCanvas = canvas;
  const nextCanvas = addWorkflowFromPalette(
    canvas,
    { kind: 'workflow', workflowRef: operation.workflow_ref, label: operation.label },
    operation.position,
  );
  const actualNodeId = addedAuthoringNodeId(beforeCanvas, nextCanvas, null);
  return renameAuthoringNodeId(nextCanvas, null, actualNodeId, operation.node_id);
}

function addAuthoringTemporaryAgentNode(
  canvas: WorkspaceCanvasModel,
  operation: Extract<CanvasAuthoringOperation, { op: 'create_temporary_agent_template' }>,
): WorkspaceCanvasModel {
  const item: Exclude<PaletteItem, { kind: 'workflow' }> = {
    kind: 'agent',
    callableId: operation.draft_id,
    label: operation.label,
    inputPorts: workflowPortsFromPortContracts(operation.agent_draft.input_ports, 'input'),
    outputPorts: workflowPortsFromPortContracts(operation.agent_draft.output_ports, 'output'),
    outputSchema: operation.output_schema || outputSchemaFromArtifactContract(operation.agent_draft.artifact_contract),
  };
  const beforeCanvas = canvas;
  const nextCanvas =
    operation.scope_workflow_id === null
      ? addCallableNodeFromPalette(canvas, item, operation.position)
      : addInternalNodeFromPalette(canvas, operation.scope_workflow_id, item, operation.position);
  const actualNodeId = addedAuthoringNodeId(beforeCanvas, nextCanvas, operation.scope_workflow_id);
  const canvasWithProposalId = renameAuthoringNodeId(
    nextCanvas,
    operation.scope_workflow_id,
    actualNodeId,
    operation.node_id,
  );
  return updateAuthoringNode(canvasWithProposalId, operation.scope_workflow_id, operation.node_id, {
    label: operation.label,
    input: operation.input,
    outputSchema: operation.output_schema,
    temporaryResourceId: operation.draft_id,
    warnings: ['临时 agent template：不能 run/save，需要替换为真实 callable。'],
  });
}

function addedAuthoringNodeId(
  beforeCanvas: WorkspaceCanvasModel,
  afterCanvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
): string {
  if (scopeWorkflowId === null) {
    const beforeIds = new Set(beforeCanvas.workflows.map((workflow) => workflow.id));
    const added = afterCanvas.workflows.filter((workflow) => !beforeIds.has(workflow.id));
    if (added.length !== 1) {
      throw new Error('无法定位新增节点');
    }
    return added[0].id;
  }
  const beforeWorkflow = beforeCanvas.workflows.find((workflow) => workflow.id === scopeWorkflowId);
  const afterWorkflow = afterCanvas.workflows.find((workflow) => workflow.id === scopeWorkflowId);
  const beforeIds = new Set(beforeWorkflow?.internalNodes.map((node) => node.id) || []);
  const added = (afterWorkflow?.internalNodes || []).filter((node) => !beforeIds.has(node.id));
  if (added.length !== 1) {
    throw new Error(`无法定位新增内部节点: ${scopeWorkflowId}`);
  }
  return added[0].id;
}

function renameAuthoringNodeId(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  actualNodeId: string,
  expectedNodeId: string,
): WorkspaceCanvasModel {
  if (actualNodeId === expectedNodeId) {
    return canvas;
  }
  if (scopeWorkflowId === null) {
    if (canvas.workflows.some((workflow) => workflow.id === expectedNodeId)) {
      throw new Error(`节点 id 已存在: ${expectedNodeId}`);
    }
    return {
      ...canvas,
      rootWorkflowId: canvas.rootWorkflowId === actualNodeId ? expectedNodeId : canvas.rootWorkflowId,
      workflows: canvas.workflows.map((workflow) =>
        workflow.id === actualNodeId ? { ...workflow, id: expectedNodeId } : workflow,
      ),
      edges: canvas.edges.map((edge) => replaceEdgeNodeId(edge, actualNodeId, expectedNodeId)),
    };
  }
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
      if (workflow.id !== scopeWorkflowId) {
        return workflow;
      }
      if (workflow.internalNodes.some((node) => node.id === expectedNodeId)) {
        throw new Error(`节点 id 已存在: ${scopeWorkflowId}.${expectedNodeId}`);
      }
      return {
        ...workflow,
        internalNodes: workflow.internalNodes.map((node) =>
          node.id === actualNodeId ? { ...node, id: expectedNodeId } : node,
        ),
        internalEdges: workflow.internalEdges.map((edge) =>
          replaceEdgeNodeId(edge, actualNodeId, expectedNodeId),
        ),
      };
    }),
  };
}

function updateAuthoringWorkflowId(
  canvas: WorkspaceCanvasModel,
  expectedNodeId: string,
): WorkspaceCanvasModel {
  if (canvas.workflows.some((workflow) => workflow.id === expectedNodeId)) {
    return canvas;
  }
  const lastWorkflow = canvas.workflows[canvas.workflows.length - 1];
  if (!lastWorkflow) {
    throw new Error(`无法创建 Workflow 节点: ${expectedNodeId}`);
  }
  if (canvas.workflows.some((workflow) => workflow.id === expectedNodeId)) {
    throw new Error(`节点 id 已存在: ${expectedNodeId}`);
  }
  return {
    ...canvas,
    rootWorkflowId: canvas.rootWorkflowId === lastWorkflow.id ? expectedNodeId : canvas.rootWorkflowId,
    workflows: canvas.workflows.map((workflow) =>
      workflow.id === lastWorkflow.id ? { ...workflow, id: expectedNodeId } : workflow,
    ),
    edges: canvas.edges.map((edge) => replaceEdgeNodeId(edge, lastWorkflow.id, expectedNodeId)),
  };
}

function updateAuthoringNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
  updates: {
    label?: string;
    input?: Record<string, unknown>;
    inputPorts?: WorkflowPortView[];
    outputPorts?: WorkflowPortView[];
    outputSchema?: Record<string, unknown>;
    temporaryResourceId?: string;
    warnings?: string[];
  },
): WorkspaceCanvasModel {
  if (scopeWorkflowId === null) {
    let found = false;
    const workflows = canvas.workflows.map((workflow) => {
      if (workflow.id !== nodeId) {
        return workflow;
      }
      found = true;
      return {
        ...workflow,
        title: updates.label ?? workflow.title,
        invocationLabel: updates.label ?? workflow.invocationLabel,
        sourceInput: updates.input ?? workflow.sourceInput,
        inputPorts: updates.inputPorts ?? workflow.inputPorts,
        outputPorts: updates.outputPorts ?? workflow.outputPorts,
        outputSchema: updates.outputSchema ?? workflow.outputSchema,
        temporaryResourceId: updates.temporaryResourceId ?? workflow.temporaryResourceId,
        warnings: updates.warnings ?? workflow.warnings,
      };
    });
    if (!found) {
      throw new Error(`节点不存在: ${nodeId}`);
    }
    return { ...canvas, workflows };
  }

  let found = false;
  const workflows = canvas.workflows.map((workflow) => {
    if (workflow.id !== scopeWorkflowId) {
      return workflow;
    }
    return {
      ...workflow,
      internalNodes: workflow.internalNodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }
        found = true;
        return {
          ...node,
          name: updates.label ?? node.name,
          invocationLabel: updates.label ?? node.invocationLabel,
          task: updates.label ?? node.task,
          input: updates.input ?? node.input,
          inputPorts: updates.inputPorts ?? node.inputPorts,
          outputPorts: updates.outputPorts ?? node.outputPorts,
          outputSchema: updates.outputSchema ?? node.outputSchema,
          temporaryResourceId: updates.temporaryResourceId ?? node.temporaryResourceId,
        };
      }),
    };
  });
  if (!found) {
    throw new Error(`节点不存在: ${scopeWorkflowId}.${nodeId}`);
  }
  return { ...canvas, workflows };
}

function addAuthoringControlEdge(
  canvas: WorkspaceCanvasModel,
  operation: Extract<CanvasAuthoringOperation, { op: 'add_control_edge' }>,
): WorkspaceCanvasModel {
  const edge: Extract<WorkflowCanvasEdge, { kind: 'control' }> = controlEdgeWithId(
    uniqueEdgeIdForScope(
      canvas,
      operation.scope_workflow_id,
      'control',
      operation.from,
      operation.to,
    ),
    operation.from,
    operation.to,
  ) as Extract<WorkflowCanvasEdge, { kind: 'control' }>;
  const endpointIssue = authoringControlEndpointIssue(canvas, operation.scope_workflow_id, edge);
  if (endpointIssue) {
    throw new Error(endpointIssue);
  }
  if (wouldCreateControlCycle(canvas, operation.scope_workflow_id, edge)) {
    throw new Error('这条控制线会形成循环');
  }
  const issue = controlSlotLimitIssue(canvas, operation.scope_workflow_id, edge);
  if (issue) {
    throw new Error(issue);
  }
  if (operation.scope_workflow_id) {
    return {
      ...canvas,
      workflows: canvas.workflows.map((workflow) =>
        workflow.id === operation.scope_workflow_id
          ? {
              ...workflow,
              internalEdges: [
                ...workflow.internalEdges.filter((candidate) => !canvasEdgesAreEquivalent(candidate, edge)),
                edge,
              ],
            }
          : workflow,
      ),
    };
  }
  return {
    ...canvas,
    edges: [
      ...canvas.edges.filter((candidate) => !canvasEdgesAreEquivalent(candidate, edge)),
      edge,
    ],
  };
}

function authoringControlEndpointIssue(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  edge: Extract<WorkflowCanvasEdge, { kind: 'control' }>,
): string | null {
  const source = findDataConnectNode(canvas, scopeWorkflowId, edge.source.workflowId);
  const target = findDataConnectNode(canvas, scopeWorkflowId, edge.target.workflowId);
  if (!source || !target) {
    return `控制线端点不存在: ${edge.source.workflowId} -> ${edge.target.workflowId}`;
  }
  if (!scopeWorkflowId) {
    return null;
  }
  const sourceBoundary = workflowBoundaryKind(edge.source.workflowId);
  const targetBoundary = workflowBoundaryKind(edge.target.workflowId);
  if (sourceBoundary === 'workflow_output') {
    return 'Workflow Outputs 只能作为内部控制线目标。';
  }
  if (targetBoundary === 'workflow_input') {
    return 'Workflow Inputs 只能作为内部控制线来源。';
  }
  if (sourceBoundary && targetBoundary) {
    return 'Workflow 边界之间不能直接创建控制线。';
  }
  return null;
}

function removeAuthoringEdge(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  edgeId: string,
): WorkspaceCanvasModel {
  if (!authoringEdgeExists(canvas, scopeWorkflowId, edgeId)) {
    throw new Error(`连线不存在: ${scopeWorkflowId ? `${scopeWorkflowId}.` : ''}${edgeId}`);
  }
  if (scopeWorkflowId) {
    return {
      ...canvas,
      workflows: canvas.workflows.map((workflow) =>
        workflow.id === scopeWorkflowId
          ? { ...workflow, internalEdges: workflow.internalEdges.filter((edge) => edge.id !== edgeId) }
          : workflow,
      ),
    };
  }
  return { ...canvas, edges: canvas.edges.filter((edge) => edge.id !== edgeId) };
}

function replaceTemporaryAuthoringNode(
  canvas: WorkspaceCanvasModel,
  operation: Extract<CanvasAuthoringOperation, { op: 'replace_temporary_template_with_existing_callable' }>,
): WorkspaceCanvasModel {
  const node = findAuthoringNode(canvas, operation.scope_workflow_id, operation.node_id);
  const resourceId = node?.temporaryResourceId || (isTemporaryCallableId(node?.callableId) ? node?.callableId : '');
  if (!node) {
    throw new Error(`节点不存在: ${operation.node_id}`);
  }
  if (!resourceId) {
    throw new Error(`节点不是临时 agent template: ${operation.node_id}`);
  }
  if (resourceId !== operation.temporary_resource_id) {
    throw new Error(`临时资源不匹配: ${operation.node_id}`);
  }
  if (operation.scope_workflow_id === null) {
    return {
      ...canvas,
      workflows: canvas.workflows.map((workflow) =>
        workflow.id === operation.node_id
          ? {
              ...workflow,
              sourceKind: operation.callable_kind === 'tool_class' ? 'tool' : 'agent_session',
              callableId: operation.callable_id,
              temporaryResourceId: undefined,
              warnings: [],
            }
          : workflow,
      ),
    };
  }
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) =>
      workflow.id === operation.scope_workflow_id
        ? {
            ...workflow,
            internalNodes: workflow.internalNodes.map((node) =>
              node.id === operation.node_id
                ? {
                    ...node,
                    kind: operation.callable_kind === 'tool_class' ? 'Tool' : 'Agent',
                    callableId: operation.callable_id,
                    runtime: operation.callable_id,
                    temporaryResourceId: undefined,
                  }
                : node,
            ),
          }
        : workflow,
    ),
  };
}

function authoringEdgeExists(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  edgeId: string,
): boolean {
  if (scopeWorkflowId) {
    return Boolean(
      canvas.workflows
        .find((workflow) => workflow.id === scopeWorkflowId)
        ?.internalEdges.some((edge) => edge.id === edgeId),
    );
  }
  return canvas.edges.some((edge) => edge.id === edgeId);
}

function findAuthoringNode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
): { temporaryResourceId?: string; callableId?: string } | null {
  if (scopeWorkflowId === null) {
    const workflow = canvas.workflows.find((item) => item.id === nodeId);
    return workflow
      ? { temporaryResourceId: workflow.temporaryResourceId, callableId: workflow.callableId }
      : null;
  }
  const node = canvas.workflows
    .find((workflow) => workflow.id === scopeWorkflowId)
    ?.internalNodes.find((item) => item.id === nodeId);
  return node
    ? { temporaryResourceId: node.temporaryResourceId, callableId: node.callableId || node.runtime }
    : null;
}

function replaceEdgeNodeId(
  edge: WorkflowCanvasEdge,
  previousId: string,
  nextId: string,
): WorkflowCanvasEdge {
  if (edge.kind === 'control') {
    return {
      ...edge,
      source: { workflowId: edge.source.workflowId === previousId ? nextId : edge.source.workflowId },
      target: { workflowId: edge.target.workflowId === previousId ? nextId : edge.target.workflowId },
    };
  }
  return {
    ...edge,
    source: {
      ...edge.source,
      workflowId: edge.source.workflowId === previousId ? nextId : edge.source.workflowId,
    },
    target: {
      ...edge.target,
      workflowId: edge.target.workflowId === previousId ? nextId : edge.target.workflowId,
    },
  };
}

