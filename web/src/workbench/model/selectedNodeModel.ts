import type { NodeRunSummary, RunEvent, RuntimeConfig, WorkflowBindingView, WorkflowRunResult } from '../../types';
import { shortPath } from '../../format';
import type {
  AgentNodeSettingsModel,
  CanvasSelection,
  InternalNodeView,
  NodeLiveLogs,
  SelectedDetailsEvidenceAction,
  SelectedDetailsPropertyGroup,
  SelectedEntityDetailsModel,
  WorkflowCanvasEdge,
  WorkflowContainerModel,
  WorkbenchTask,
  WorkflowMainInputBindingState,
  WorkflowPortView,
  WorkflowStatus,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import {
  dataConnectEdges,
  edgeDiagnosticsForCanvasEdge,
  isWorkflowInputBoundaryControlBinding,
  isWorkflowOutputBoundaryControlBinding,
  workflowIdForBoundaryMainBinding,
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

export function sameRunDir(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return normalizeRunDirKey(left) === normalizeRunDirKey(right);
}

export function controlEdgeMainTransferMode(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  edge: WorkflowCanvasEdge,
): { label: string; reason: string } {
  if (edge.kind !== 'control') {
    return { label: '不适用', reason: 'Data Edge 显式传递指定端口。' };
  }
  const boundaryWorkflowId = workflowIdForBoundaryMainBinding(edge);
  if (boundaryWorkflowId && isWorkflowInputBoundaryControlBinding(boundaryWorkflowId, edge)) {
    return {
      label: 'Workflow main 输入绑定',
      reason: '这条线是 Workbench 边界绑定，会编译为 workflow_input_bindings，不进入 runtime control_edges。',
    };
  }
  if (boundaryWorkflowId && isWorkflowOutputBoundaryControlBinding(boundaryWorkflowId, edge)) {
    return {
      label: 'Workflow main 输出绑定',
      reason: '这条线是 Workbench 边界绑定，会编译为 workflow_output_bindings，不进入 runtime control_edges。',
    };
  }
  const samePairHasDataEdge = dataConnectEdges(canvas, scopeWorkflowId).some(
    (candidate) =>
      candidate.kind === 'data' &&
      candidate.source.workflowId === edge.source.workflowId &&
      candidate.target.workflowId === edge.target.workflowId,
  );
  if (samePairHasDataEdge) {
    return {
      label: '仅控制顺序',
      reason: '同一上游和下游之间已有 Data Edge，控制线不会重复传递完整 main 输出。',
    };
  }
  if (!sourceNodeForwardsMainByDefault(canvas, scopeWorkflowId, edge.source.workflowId)) {
    return {
      label: '仅控制顺序',
      reason: '上游节点已关闭“控制线传递完整输出”。',
    };
  }
  return {
    label: '传递 main',
    reason: '没有同 pair Data Edge，且上游节点允许控制线默认传递完整输出。',
  };
}

function sourceNodeForwardsMainByDefault(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
): boolean {
  if (scopeWorkflowId) {
    const workflow = canvas.workflows.find((item) => item.id === scopeWorkflowId);
    const node = workflow?.internalNodes.find((item) => item.id === nodeId);
    return node?.forwardMainOutputOnControl !== false;
  }
  const node = canvas.workflows.find((item) => item.id === nodeId);
  return node?.forwardMainOutputOnControl !== false;
}

export function boundaryMainBindingLabel(edge: WorkflowCanvasEdge): string | null {
  const workflowId = workflowIdForBoundaryMainBinding(edge);
  if (!workflowId) {
    return null;
  }
  if (isWorkflowInputBoundaryControlBinding(workflowId, edge)) {
    return 'Workflow main 输入绑定';
  }
  if (isWorkflowOutputBoundaryControlBinding(workflowId, edge)) {
    return 'Workflow main 输出绑定';
  }
  return null;
}

function isEmptyInspectableValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }
  return false;
}

export function boundaryInputMainConflictMessage(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  edge: WorkflowCanvasEdge,
): string | null {
  const workflowId = workflowIdForBoundaryMainBinding(edge);
  if (!workflowId || !isWorkflowInputBoundaryControlBinding(workflowId, edge)) {
    return null;
  }
  const targetNodeId = edge.target.workflowId;
  const scopedEdges = dataConnectEdges(canvas, scopeWorkflowId);
  const hasExplicitMainDataEdge = scopedEdges.some(
    (candidate) =>
      candidate.kind === 'data' &&
      candidate.target.workflowId === targetNodeId &&
      (candidate.target.portId || 'main') === 'main',
  );
  const duplicateBoundaryBinding = scopedEdges.some(
    (candidate) =>
      candidate.id !== edge.id &&
      candidate.source.workflowId === edge.source.workflowId &&
      candidate.target.workflowId === targetNodeId &&
      candidate.kind === edge.kind,
  );
  const targetInput = scopedNodeInput(canvas, scopeWorkflowId, targetNodeId);
  const staticMainValue = targetInput?.main;
  const hasStaticMainInput =
    targetInput !== undefined &&
    Object.prototype.hasOwnProperty.call(targetInput, 'main') &&
    !isEmptyInspectableValue(staticMainValue);
  if (!hasExplicitMainDataEdge && !duplicateBoundaryBinding && !hasStaticMainInput) {
    return null;
  }
  return '目标 main 存在多个输入来源；runtime 覆盖顺序保持为 static_input -> workflow_input_bindings -> node.input_bindings -> data_edges -> control-main fallback。';
}

function scopedNodeInput(
  canvas: WorkspaceCanvasModel,
  scopeWorkflowId: string | null,
  nodeId: string,
): Record<string, unknown> | undefined {
  if (scopeWorkflowId) {
    const node = canvas.workflows
      .find((workflow) => workflow.id === scopeWorkflowId)
      ?.internalNodes.find((item) => item.id === nodeId);
    return node?.input;
  }
  return canvas.workflows.find((workflow) => workflow.id === nodeId)?.sourceInput;
}

export function latestLogExcerpt(liveLogs?: NodeLiveLogs, nodeRun?: NodeRunSummary): string {
  const liveText = liveLogs?.stderr || liveLogs?.stdout || '';
  const text = liveText || nodeRun?.log_excerpt || '';
  if (!text.trim()) {
    return '';
  }
  const lines = text.trimEnd().split(/\r?\n/u);
  return lines.slice(Math.max(0, lines.length - 8)).join('\n');
}

export function workspaceRootOf(binding: WorkflowBindingView | null | undefined): string {
  return binding?.workspaceRoot || binding?.workspace_root || '';
}

export function bindingDirectory(
  workflow: WorkflowContainerModel,
  binding: WorkflowBindingView | null | undefined,
): string {
  const workspaceRoot = workspaceRootOf(binding);
  if (workspaceRoot) {
    return workspaceRoot;
  }
  return workflow.directory || '未绑定工作目录';
}

export function selectedEntityDetailsModel({
  canvas,
  selection,
  selectedWorkflow,
  selectedPort,
  selectedEdge,
  selectedInternalNode,
  selectedNodeSettings,
  workflowRun,
  workflowEvents,
  liveLogs,
  runtimeConfig,
  binding,
  currentTask,
}: {
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  selectedWorkflow?: WorkflowContainerModel;
  selectedPort?: WorkflowPortView;
  selectedEdge?: WorkflowCanvasEdge;
  selectedInternalNode?: InternalNodeView;
  selectedNodeSettings?: AgentNodeSettingsModel;
  workflowRun: WorkflowRunResult | null;
  workflowEvents: RunEvent[];
  liveLogs: Record<string, NodeLiveLogs>;
  runtimeConfig: RuntimeConfig | null;
  binding?: WorkflowBindingView;
  currentTask?: WorkbenchTask;
}): SelectedEntityDetailsModel {
  if (selectedNodeSettings) {
    const nodeRun = selectedNodeSettings.run;
    return {
      key: `node:${selectedNodeSettings.scopeLabel}:${selectedNodeSettings.nodeId}`,
      kind: selection.type === 'internal' ? 'internal-node' : 'node',
      title: selectedNodeSettings.label,
      subtitle: selectedNodeSettings.callableId || selectedNodeSettings.kind,
      status: nodeRun?.status || selectedNodeSettings.status || 'not_run',
      scopeLabel: selectedNodeSettings.scopeLabel,
      nodeRun,
      logs: selectedNodeSettings.logs,
      log: logModelFromRun(nodeRun, selectedNodeSettings.logs),
      properties: [],
      evidenceActions: evidenceActionsFromNodeRun(nodeRun),
      events: nodeEventsForRun(workflowEvents, nodeRun),
      nodeSettings: selectedNodeSettings,
    };
  }

  if (selection.type === 'workflow' && selectedWorkflow) {
    const nodeRun = nodeRunForWorkflow(workflowRun, selectedWorkflow);
    return {
      key: `workflow:${selectedWorkflow.id}`,
      kind: 'workflow',
      title: workflowInvocationLabel(selectedWorkflow),
      subtitle: selectedWorkflow.workflowRef || selectedWorkflow.workflowBodyKind || 'inline workflow',
      status: nodeRun?.status || selectedWorkflow.status || 'not_run',
      scopeLabel: 'Workflow container',
      nodeRun,
      logs: nodeLiveLogsFor(liveLogs, nodeRun),
      log: logModelFromRun(nodeRun, nodeLiveLogsFor(liveLogs, nodeRun)),
      properties: workflowContainerPropertyGroups(selectedWorkflow, binding, nodeRun),
      evidenceActions: evidenceActionsFromNodeRun(nodeRun),
      events: nodeEventsForRun(workflowEvents, nodeRun),
    };
  }

  if (selection.type === 'edge' && selectedEdge) {
    return {
      key: `edge:${selection.scopeWorkflowId || 'root'}:${selectedEdge.id}`,
      kind: 'edge',
      title: selectedEdge.kind === 'control' ? '控制边' : '数据边',
      subtitle: selectedEdge.id,
      status: workflowRun?.status || 'not_run',
      scopeLabel: selection.scopeWorkflowId ? `Workflow: ${selection.scopeWorkflowId}` : 'Root canvas',
      log: emptyLogModel(),
      properties: edgePropertyGroups(selectedEdge, selection.scopeWorkflowId || null, canvas),
      evidenceActions: [],
      events: workflowEvents,
    };
  }

  if (selection.type === 'port' && selectedWorkflow && selectedPort) {
    return {
      key: `port:${selectedWorkflow.id}:${selectedPort.direction}:${selectedPort.id}`,
      kind: 'port',
      title: `${selectedWorkflow.title}.${selectedPort.id}`,
      subtitle: selectedPort.direction === 'input' ? '输入端口' : '输出端口',
      status: selectedWorkflow.status || 'not_run',
      scopeLabel: workflowInvocationLabel(selectedWorkflow),
      log: emptyLogModel(),
      properties: portPropertyGroups(selectedWorkflow, selectedPort),
      evidenceActions: [],
      events: workflowEvents,
    };
  }

  return {
    key: `canvas:${canvas.id}:${currentTask?.taskId || 'task'}`,
    kind: 'canvas',
    title: currentTask?.title || canvas.name || '任务画布',
    subtitle: currentTask?.activeRunId || currentTask?.latestRunId || '尚未运行',
    status: currentTask?.status || workflowRun?.status || 'not_run',
    scopeLabel: 'Root canvas',
    log: emptyLogModel(),
    properties: canvasPropertyGroups(canvas, currentTask, workflowRun, runtimeConfig),
    evidenceActions: workflowRun
      ? [
          { label: 'run_summary.json', title: 'Run summary', path: `${workflowRun.run_dir}/run_summary.json` },
        ]
      : [],
    events: workflowEvents,
  };
}

function logModelFromRun(nodeRun?: NodeRunSummary, logs?: NodeLiveLogs): SelectedEntityDetailsModel['log'] {
  return {
    stdout: logs?.stdout || '',
    stderr: logs?.stderr || '',
    excerpt: latestLogExcerpt(logs, nodeRun),
    stdoutPath: nodeRun?.stdout_log,
    stderrPath: nodeRun?.stderr_log,
  };
}

function emptyLogModel(): SelectedEntityDetailsModel['log'] {
  return { stdout: '', stderr: '', excerpt: '' };
}

export function combinedLogText(log: SelectedEntityDetailsModel['log']): string {
  const parts = [
    log.stderr ? `[stderr]\n${log.stderr.trimEnd()}` : '',
    log.stdout ? `[stdout]\n${log.stdout.trimEnd()}` : '',
  ].filter(Boolean);
  return parts.join('\n\n');
}

function evidenceActionsFromNodeRun(nodeRun?: NodeRunSummary): SelectedDetailsEvidenceAction[] {
  if (!nodeRun) {
    return [];
  }
  return [
    { label: 'input.json', title: '真实输入', path: nodeRun.input_path },
    { label: 'output.json', title: '真实输出', path: nodeRun.output_path },
    { label: 'stdout.log', title: 'stdout.log', path: nodeRun.stdout_log },
    { label: 'stderr.log', title: 'stderr.log', path: nodeRun.stderr_log },
    { label: 'event log', title: 'event log', path: nodeRun.event_log },
  ].filter((action) => Boolean(action.path));
}

function nodeEventsForRun(events: RunEvent[], nodeRun?: NodeRunSummary): RunEvent[] {
  if (!nodeRun) {
    return [];
  }
  return events.filter((event) => {
    const eventNodeId = typeof event.node_id === 'string' ? event.node_id : '';
    const eventUiNodeId = typeof event.ui_node_id === 'string' ? event.ui_node_id : '';
    const eventRunDir = typeof event.node_run_dir === 'string' ? event.node_run_dir : '';
    return (
      eventNodeId === nodeRun.node_id ||
      eventNodeId === nodeRun.ui_node_id ||
      (Boolean(nodeRun.ui_node_id) && eventUiNodeId === nodeRun.ui_node_id) ||
      sameRunDir(eventRunDir, effectiveNodeRunDir(nodeRun))
    );
  });
}

function workflowContainerPropertyGroups(
  workflow: WorkflowContainerModel,
  binding: WorkflowBindingView | undefined,
  nodeRun?: NodeRunSummary,
): SelectedDetailsPropertyGroup[] {
  return [
    {
      title: 'Workflow',
      rows: [
        { label: 'id', value: workflow.id },
        { label: '类型', value: isExecutableNodeWorkflow(workflow) ? 'Workflow 调用节点' : 'Inline workflow 容器' },
        { label: 'workflow_ref', value: workflow.workflowRef || 'inline container' },
        { label: '目录', value: bindingDirectory(workflow, binding) },
        { label: '内部节点', value: String(workflow.internalNodes.length) },
        { label: '内部边', value: String(workflow.internalEdges.length) },
        { label: 'run', value: nodeRun?.run_dir ? shortPath(nodeRun.run_dir) : '尚未运行' },
      ],
    },
  ];
}

function edgePropertyGroups(
  edge: WorkflowCanvasEdge,
  scopeWorkflowId: string | null,
  canvas: WorkspaceCanvasModel,
): SelectedDetailsPropertyGroup[] {
  const source = edge.kind === 'control' ? edge.source.workflowId : `${edge.source.workflowId}.${edge.source.portId}`;
  const target = edge.kind === 'control' ? edge.target.workflowId : `${edge.target.workflowId}.${edge.target.portId}`;
  const diagnostics = edgeDiagnosticsForCanvasEdge(canvas, scopeWorkflowId, edge);
  const transferMode = controlEdgeMainTransferMode(canvas, scopeWorkflowId, edge);
  const boundaryLabel = boundaryMainBindingLabel(edge);
  const conflictMessage = boundaryInputMainConflictMessage(canvas, scopeWorkflowId, edge);
  return [
    {
      title: boundaryLabel || (edge.kind === 'control' ? '控制边' : '数据边'),
      rows: [
        { label: 'id', value: edge.id },
        { label: 'scope', value: scopeWorkflowId || 'Root canvas' },
        { label: 'source', value: source },
        { label: 'target', value: target },
        { label: 'kind', value: edge.kind },
        { label: 'materialization', value: edge.kind === 'data' ? edge.materialization : edge.context || 'none' },
        ...(edge.kind === 'control'
          ? [
              { label: '数据传递', value: transferMode.label },
              { label: '传递规则', value: transferMode.reason },
            ]
          : []),
        ...(conflictMessage ? [{ label: '输入覆盖', value: conflictMessage }] : []),
        ...(diagnostics.length
          ? [
              { label: 'diagnostics', value: diagnostics.map((diagnostic) => diagnostic.message).join('；') },
              {
                label: 'repair',
                value: diagnostics.some((diagnostic) => diagnostic.code === 'dangling_data_edge_source')
                  ? '更新上游 output_schema，或迁移 data edge source port'
                  : '创建 target input port，或迁移 data edge target port',
              },
            ]
          : []),
      ],
    },
  ];
}

function portPropertyGroups(workflow: WorkflowContainerModel, portValue: WorkflowPortView): SelectedDetailsPropertyGroup[] {
  return [
    {
      title: '端口',
      rows: [
        { label: 'workflow', value: workflowInvocationLabel(workflow) },
        { label: 'port id', value: portValue.id },
        { label: '方向', value: portValue.direction === 'input' ? '输入' : '输出' },
        { label: '必填', value: portValue.required ? '是' : '否' },
        { label: 'cardinality', value: portValue.cardinality || 'one' },
        { label: 'artifact types', value: portValue.artifactTypes?.join(', ') || '未声明' },
      ],
    },
  ];
}

function canvasPropertyGroups(
  canvas: WorkspaceCanvasModel,
  task: WorkbenchTask | undefined,
  workflowRun: WorkflowRunResult | null,
  runtimeConfig: RuntimeConfig | null,
): SelectedDetailsPropertyGroup[] {
  return [
    {
      title: '任务画布',
      rows: [
        { label: '任务', value: task?.title || canvas.name },
        { label: '状态', value: statusLabel(task?.status || workflowRun?.status || 'not_run') },
        { label: 'root workflow', value: canvas.rootWorkflowId },
        { label: '节点数', value: String(canvas.workflows.length) },
        { label: '边数', value: String(canvas.edges.length) },
        { label: 'run mode', value: runtimeConfig?.real_external_agents_enabled ? 'production / real CLI' : 'hermetic or gated' },
      ],
    },
  ];
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    success: '成功',
    failed: '失败',
    timeout: '超时',
    schema_error: 'Schema 错误',
    artifact_error: '产物错误',
    running: '运行中',
    scheduled: '已调度',
    manual_review: '等待人工确认',
    not_run: '未运行',
  };
  return labels[status] || status;
}
