import type { NodeRunSummary, WorkflowRunResult } from '../../types';
import type {
  AgentNodeSettingsModel,
  CanvasSelection,
  InternalNodeView,
  NodeLiveLogs,
  WorkflowContainerModel,
  WorkflowMainInputBindingState,
  WorkflowStatus,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import {
  isWorkflowInputBoundaryControlBinding,
} from './canvasEdgeOps';
import {
  internalInvocationLabel,
  workflowInvocationLabel,
} from './selectionModel';
import {
  internalNodeInputPorts,
  internalNodeInvocationPreview,
  internalNodeOutputPorts,
  workflowInvocationPreview,
  workflowOutputPorts,
} from './workflowGraphProjection';
import {
  internalFlowNodeId,
  isExecutableNodeWorkflow,
  workflowInputBoundaryId,
} from './workflowNodeModel';

export type NodeRunLookupContext = {
  scope?: 'task' | 'workflow' | 'node';
  targetId?: string;
  parentWorkflowId?: string;
};

export function normalizeRunDirKey(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return value.replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase();
}

export function effectiveNodeRunDir(nodeRun?: NodeRunSummary): string {
  if (!nodeRun) {
    return '';
  }
  const projected = nodeRun as NodeRunSummary & { effective_run_dir?: string };
  return projected.effective_run_dir || nodeRun.run_dir || '';
}

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    result.push(value);
  });
  return result;
}

export function nodeRunForWorkflow(
  workflowRun: WorkflowRunResult | null,
  workflow: WorkflowContainerModel,
): NodeRunSummary | undefined {
  if (!workflowRun) {
    return undefined;
  }
  return workflowRun.nodes.find((nodeRun) => {
    if (nodeRun.ui_node_id === workflow.id || nodeRun.node_id === workflow.id) {
      return true;
    }
    return Boolean(workflow.callableId && nodeRun.callable_id === workflow.callableId && nodeRun.node_id === workflow.id);
  });
}

export function selectedNodeRunForSelection(
  workflowRun: WorkflowRunResult | null,
  selection: CanvasSelection,
  selectedWorkflow: WorkflowContainerModel | undefined,
  selectedInternalNode: InternalNodeView | undefined,
  context?: NodeRunLookupContext,
): NodeRunSummary | undefined {
  if (!workflowRun) {
    return undefined;
  }
  if (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)) {
    return nodeRunForWorkflow(workflowRun, selectedWorkflow);
  }
  if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
    return nodeRunForInternalNode(workflowRun, selectedWorkflow.id, selectedInternalNode.id, context);
  }
  return undefined;
}

export function nodeLiveLogsFor(
  liveLogs: Record<string, NodeLiveLogs>,
  nodeRun?: NodeRunSummary,
): NodeLiveLogs | undefined {
  if (!nodeRun) {
    return undefined;
  }
  for (const key of uniqueStrings([
    nodeRun.ui_node_id,
    normalizeRunDirKey(effectiveNodeRunDir(nodeRun)),
    effectiveNodeRunDir(nodeRun),
    normalizeRunDirKey(nodeRun.run_dir),
    nodeRun.run_dir,
    nodeRun.node_id,
  ])) {
    const logs = liveLogs[key];
    if (logs) {
      return logs;
    }
  }
  return undefined;
}

export function nodeRunForInternalNode(
  workflowRun: WorkflowRunResult | null,
  workflowId: string,
  nodeId: string,
  context?: NodeRunLookupContext,
): NodeRunSummary | undefined {
  if (!workflowRun) {
    return undefined;
  }
  const uiNodeId = internalFlowNodeId(workflowId, nodeId);
  return workflowRun.nodes.find((nodeRun) => {
    if (nodeRun.ui_node_id === uiNodeId || nodeRun.node_id === uiNodeId) {
      return true;
    }
    if (nodeRun.parent_node_id === workflowId && nodeRun.node_id === nodeId) {
      return true;
    }
    return (
      context?.scope === 'node' &&
      context.targetId === nodeId &&
      context.parentWorkflowId === workflowId &&
      nodeRun.node_id === nodeId
    );
  });
}

export function workflowMainInputBindingState(
  canvas: WorkspaceCanvasModel,
  workflowId: string,
  nodeId: string,
): WorkflowMainInputBindingState | undefined {
  const workflow = canvas.workflows.find((item) => item.id === workflowId);
  if (!workflow) {
    return undefined;
  }
  const inputBoundaryId = workflowInputBoundaryId(workflowId);
  const bindingEdge = workflow.internalEdges.find((edge) => {
    if (edge.kind === 'control') {
      return isWorkflowInputBoundaryControlBinding(workflowId, edge) && edge.target.workflowId === nodeId;
    }
    return (
      edge.source.workflowId === inputBoundaryId &&
      edge.target.workflowId === nodeId &&
      (edge.source.portId || 'main') === 'main' &&
      (edge.target.portId || 'main') === 'main'
    );
  });
  if (!bindingEdge) {
    return {
      status: 'unbound',
      workflowId,
      nodeId,
      sourcePort: 'main',
      targetPort: 'main',
    };
  }
  return {
    status: 'bound',
    workflowId,
    nodeId,
    edgeId: bindingEdge.id,
    sourcePort: 'main',
    targetPort: bindingEdge.kind === 'data' ? bindingEdge.target.portId || 'main' : 'main',
  };
}

export function selectedNodeSettingsModel({
  canvas,
  selection,
  selectedWorkflow,
  selectedInternalNode,
  workflowRun,
  liveLogs,
  nodeRunLookup,
}: {
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  selectedWorkflow?: WorkflowContainerModel;
  selectedInternalNode?: InternalNodeView;
  workflowRun: WorkflowRunResult | null;
  liveLogs: Record<string, NodeLiveLogs>;
  nodeRunLookup?: NodeRunLookupContext;
}): AgentNodeSettingsModel | undefined {
  if (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)) {
    const nodeRun = nodeRunForWorkflow(workflowRun, selectedWorkflow);
    return {
      scopeLabel: 'Root canvas',
      nodeId: selectedWorkflow.id,
      label: workflowInvocationLabel(selectedWorkflow),
      task: workflowInvocationLabel(selectedWorkflow),
      kind: selectedWorkflow.sourceKind === 'tool' ? 'Tool' : 'Agent',
      status: (nodeRun?.status as WorkflowStatus | undefined) || selectedWorkflow.status,
      callableId: selectedWorkflow.callableId || '',
      codexExecutionMode: selectedWorkflow.codexExecutionMode,
      temporaryResourceId: selectedWorkflow.temporaryResourceId,
      input: selectedWorkflow.sourceInput || {},
      inputPorts: selectedWorkflow.inputPorts,
      outputPorts: workflowOutputPorts(selectedWorkflow),
      outputSchema: selectedWorkflow.outputSchema,
      forwardMainOutputOnControl: selectedWorkflow.forwardMainOutputOnControl,
      emptyInputPolicy: selectedWorkflow.emptyInputPolicy,
      run: nodeRun,
      logs: nodeLiveLogsFor(liveLogs, nodeRun),
      preview: workflowInvocationPreview(selectedWorkflow),
      raw: selectedWorkflow,
    };
  }
  if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
    const nodeRun = nodeRunForInternalNode(
      workflowRun,
      selectedWorkflow.id,
      selectedInternalNode.id,
      nodeRunLookup,
    );
    return {
      scopeLabel: `Inside: ${workflowInvocationLabel(selectedWorkflow)}`,
      nodeId: selectedInternalNode.id,
      label: internalInvocationLabel(selectedInternalNode),
      task: selectedInternalNode.task,
      kind: selectedInternalNode.kind,
      status: (nodeRun?.status as WorkflowStatus | undefined) || selectedInternalNode.status,
      callableId: selectedInternalNode.callableId || selectedInternalNode.runtime || '',
      codexExecutionMode: selectedInternalNode.codexExecutionMode,
      temporaryResourceId: selectedInternalNode.temporaryResourceId,
      input: selectedInternalNode.input || {},
      inputPorts: internalNodeInputPorts(selectedInternalNode),
      outputPorts: internalNodeOutputPorts(selectedInternalNode),
      outputSchema: selectedInternalNode.outputSchema,
      forwardMainOutputOnControl: selectedInternalNode.forwardMainOutputOnControl,
      emptyInputPolicy: selectedInternalNode.emptyInputPolicy,
      run: nodeRun,
      logs: nodeLiveLogsFor(liveLogs, nodeRun),
      workflowMainInputBinding: workflowMainInputBindingState(
        canvas,
        selectedWorkflow.id,
        selectedInternalNode.id,
      ),
      preview: internalNodeInvocationPreview(selectedInternalNode),
      raw: { workflow: selectedWorkflow.id, node: selectedInternalNode },
    };
  }
  return undefined;
}
