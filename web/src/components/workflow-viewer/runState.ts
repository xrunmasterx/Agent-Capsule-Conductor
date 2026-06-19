import type { NodeRunSummary, RunEvent, WorkflowGraph, WorkflowRunResult } from '../../types';
import type { WorkflowStatus } from '../../types/workbench';

export type RunOverlayState = {
  runId: string;
  scope: 'task' | 'workflow' | 'node';
  targetId?: string;
  status: WorkflowStatus;
  nodeStatusById: Record<string, WorkflowStatus>;
  workflowStatusById: Record<string, WorkflowStatus>;
  run?: WorkflowRunResult | null;
};

type RunStateInternalNode = {
  id: string;
  status: WorkflowStatus;
};

type RunStateWorkflow<TNode extends RunStateInternalNode = RunStateInternalNode> = {
  id: string;
  status: WorkflowStatus;
  internalNodes: TNode[];
};

type RunStateCanvas<TWorkflow extends RunStateWorkflow = RunStateWorkflow> = {
  workflows: TWorkflow[];
};

export function runOverlayFromRun(
  workflowRun: WorkflowRunResult,
  options: { runId: string; scope: RunOverlayState['scope']; targetId: string },
): RunOverlayState {
  const nodeStatusEntries = workflowRun.nodes.flatMap((node) => {
    const status = normalizeWorkflowStatus(node.status);
    if (node.parent_node_id) {
      return [[node.ui_node_id || internalFlowNodeId(node.parent_node_id, node.node_id), status]];
    }
    return node.ui_node_id
      ? [
          [node.node_id, status],
          [node.ui_node_id, status],
        ]
      : [[node.node_id, status]];
  });
  const nodeStatusById = Object.fromEntries(nodeStatusEntries);
  const workflowStatus = normalizeWorkflowStatus(workflowRun.status);
  return {
    runId: options.runId,
    scope: options.scope,
    targetId: options.targetId,
    status: workflowStatus,
    nodeStatusById,
    workflowStatusById: {
      [workflowRun.workflow_id]: workflowStatus,
      [options.targetId]: workflowStatus,
    },
    run: workflowRun,
  };
}

export function applyRunOverlayToCanvas<TCanvas extends RunStateCanvas>(
  canvas: TCanvas,
  overlay: RunOverlayState | null,
): TCanvas {
  if (!overlay) {
    return canvas;
  }
  return {
    ...canvas,
    workflows: canvas.workflows.map((workflow) => {
      const directStatus =
        overlay.workflowStatusById[workflow.id] ||
        overlay.nodeStatusById[workflow.id] ||
        (overlay.targetId === workflow.id ? overlay.status : undefined);
      const internalNodes = workflow.internalNodes.map((node) => ({
        ...node,
        status:
          overlay.nodeStatusById[internalFlowNodeId(workflow.id, node.id)] ||
          node.status,
      }));
      return {
        ...workflow,
        status: directStatus || aggregateWorkflowStatus(internalNodes) || workflow.status,
        internalNodes,
      };
    }),
  } as TCanvas;
}

export function stripRuntimeStateFromCanvas<TCanvas extends RunStateCanvas>(canvas: TCanvas): TCanvas {
  return {
    ...canvas,
    workflows: canvas.workflows.map(stripRuntimeStateFromWorkflow),
  } as TCanvas;
}

export function stripRuntimeStateFromWorkflow<TWorkflow extends RunStateWorkflow>(workflow: TWorkflow): TWorkflow {
  return {
    ...workflow,
    status: 'not_run',
    internalNodes: workflow.internalNodes.map((node) => ({ ...node, status: 'not_run' })),
  } as TWorkflow;
}

export function liveWorkflowRunFromEvents(
  graph: WorkflowGraph,
  runDir: string,
  events: RunEvent[],
): WorkflowRunResult {
  const rootNodeIds = new Set(graph.nodes.map((node) => node.id));
  const statusByNode = new Map(graph.nodes.map((node) => [node.id, 'not_run']));
  const nestedNodeMeta = new Map<string, { nodeId: string; parentNodeId: string; callableId: string; runDir?: string }>();
  let workflowStatus = events.length ? 'running' : 'not_run';
  for (const event of events) {
    const type = String(event.type || event.event || '');
    const rawNodeId = typeof event.node_id === 'string' ? event.node_id : '';
    const uiNodeId = typeof event.ui_node_id === 'string' ? event.ui_node_id : '';
    const nodeId = uiNodeId || rawNodeId;
    const parentNodeId = typeof event.parent_node_id === 'string' ? event.parent_node_id : '';
    if (nodeId) {
      if (!statusByNode.has(nodeId)) {
        statusByNode.set(nodeId, 'not_run');
      }
      if (uiNodeId && parentNodeId) {
        nestedNodeMeta.set(uiNodeId, {
          nodeId: rawNodeId || uiNodeId,
          parentNodeId,
          callableId: typeof event.callable_id === 'string' ? event.callable_id : '',
          runDir: typeof event.node_run_dir === 'string' ? event.node_run_dir : undefined,
        });
      }
      if (type === 'node_scheduled') {
        statusByNode.set(nodeId, 'scheduled');
      } else if (type === 'node_started' || type === 'input_materialized' || type === 'inbox_materialized') {
        statusByNode.set(nodeId, 'running');
      } else if (type === 'node_completed') {
        statusByNode.set(nodeId, 'success');
      } else if (type === 'node_failed') {
        statusByNode.set(nodeId, String(event.status || 'failed'));
      }
    }
    if (parentNodeId) {
      continue;
    }
    if (type === 'workflow_completed') {
      workflowStatus = 'success';
    } else if (type === 'workflow_failed') {
      workflowStatus = String(event.status || 'failed');
    } else if (type === 'workflow_started') {
      workflowStatus = 'running';
    }
  }
  return {
    workflow_id: graph.id,
    status: workflowStatus,
    run_dir: runDir,
    nodes: [
      ...graph.nodes.map((node) => ({
        node_id: node.id,
        callable_id: node.callable_ref?.id || '',
        status: statusByNode.get(node.id) || 'not_run',
        run_dir: `${runDir}/nodes/${node.id}`,
        input_path: `${runDir}/nodes/${node.id}/agent_payload.json`,
        prompt_path: `${runDir}/nodes/${node.id}/resolved_prompt.md`,
        output_path: `${runDir}/nodes/${node.id}/output.json`,
        artifact_dir: `${runDir}/nodes/${node.id}/artifacts`,
        event_log: `${runDir}/nodes/${node.id}/events.jsonl`,
        stdout_log: `${runDir}/nodes/${node.id}/stdout.log`,
        stderr_log: `${runDir}/nodes/${node.id}/stderr.log`,
        errors: [],
      })),
      ...Array.from(nestedNodeMeta.entries()).map(([uiNodeId, meta]): NodeRunSummary => ({
        node_id: meta.nodeId,
        ui_node_id: uiNodeId,
        parent_node_id: meta.parentNodeId,
        callable_id: meta.callableId,
        status: statusByNode.get(uiNodeId) || 'not_run',
        run_dir: meta.runDir || `${runDir}/nodes/${meta.parentNodeId}/nested_workflow/nodes/${meta.nodeId}`,
        input_path: `${meta.runDir || `${runDir}/nodes/${meta.parentNodeId}/nested_workflow/nodes/${meta.nodeId}`}/agent_payload.json`,
        prompt_path: `${meta.runDir || `${runDir}/nodes/${meta.parentNodeId}/nested_workflow/nodes/${meta.nodeId}`}/resolved_prompt.md`,
        output_path: `${meta.runDir || `${runDir}/nodes/${meta.parentNodeId}/nested_workflow/nodes/${meta.nodeId}`}/output.json`,
        artifact_dir: `${meta.runDir || `${runDir}/nodes/${meta.parentNodeId}/nested_workflow/nodes/${meta.nodeId}`}/artifacts`,
        event_log: `${meta.runDir || `${runDir}/nodes/${meta.parentNodeId}/nested_workflow/nodes/${meta.nodeId}`}/events.jsonl`,
        stdout_log: `${meta.runDir || `${runDir}/nodes/${meta.parentNodeId}/nested_workflow/nodes/${meta.nodeId}`}/stdout.log`,
        stderr_log: `${meta.runDir || `${runDir}/nodes/${meta.parentNodeId}/nested_workflow/nodes/${meta.nodeId}`}/stderr.log`,
        errors: [],
      })),
    ],
    edges: graph.edges,
    errors: [],
  };
}

export function mergeWorkflowRunWithEvents(
  snapshotRun: WorkflowRunResult,
  eventRun: WorkflowRunResult,
): WorkflowRunResult {
  const nodesByKey = new Map<string, NodeRunSummary>();
  snapshotRun.nodes.forEach((node) => {
    nodesByKey.set(nodeRunProjectionKey(node), node);
  });
  eventRun.nodes.forEach((eventNode) => {
    const key = nodeRunProjectionKey(eventNode);
    const snapshotNode = nodesByKey.get(key);
    nodesByKey.set(
      key,
      snapshotNode
        ? {
            ...eventNode,
            ...snapshotNode,
            status: mergeProjectedStatus(snapshotNode.status, eventNode.status),
            ui_node_id: snapshotNode.ui_node_id || eventNode.ui_node_id,
            parent_node_id: snapshotNode.parent_node_id || eventNode.parent_node_id,
          }
        : eventNode,
    );
  });
  return {
    ...snapshotRun,
    status: mergeProjectedStatus(snapshotRun.status, eventRun.status),
    nodes: Array.from(nodesByKey.values()),
  };
}

export function workflowRunFailureText(result: WorkflowRunResult): string {
  const lines = [
    `workflow_id: ${result.workflow_id}`,
    `status: ${result.status}`,
    `run_dir: ${result.run_dir}`,
  ];
  if (result.errors?.length) {
    lines.push('', 'errors:', ...result.errors.map((error) => `- ${error}`));
  }
  const failedNodes = result.nodes.filter((node) => node.status !== 'success');
  if (failedNodes.length) {
    lines.push('', 'nodes:');
    failedNodes.forEach((node) => {
      lines.push(`- ${node.node_id}: ${node.status}`);
      if (node.error) {
        lines.push(`  error: ${node.error}`);
      } else if (node.summary) {
        lines.push(`  summary: ${node.summary}`);
      }
      if (node.event_log) {
        lines.push(`  events: ${node.event_log}`);
      }
    });
  }
  return lines.join('\n');
}

function nodeRunProjectionKey(node: NodeRunSummary): string {
  if (node.ui_node_id) {
    return node.ui_node_id;
  }
  if (node.parent_node_id) {
    return internalFlowNodeId(node.parent_node_id, node.node_id);
  }
  return node.node_id;
}

function mergeProjectedStatus(baseStatus: string, deltaStatus: string): WorkflowStatus {
  const base = normalizeWorkflowStatus(baseStatus || 'not_run');
  const delta = normalizeWorkflowStatus(deltaStatus || 'not_run');
  if (delta === 'not_run') {
    return base;
  }
  if (isTerminalWorkflowStatus(base) && !isTerminalWorkflowStatus(delta)) {
    return base;
  }
  if (base === 'not_run') {
    return delta;
  }
  return statusRank(delta) >= statusRank(base) ? delta : base;
}

function statusRank(status: WorkflowStatus): number {
  if (status === 'not_run') {
    return 0;
  }
  if (status === 'queued') {
    return 1;
  }
  if (status === 'scheduled') {
    return 2;
  }
  if (status === 'running' || status === 'cancel_requested') {
    return 3;
  }
  return 4;
}

function isTerminalWorkflowStatus(status: WorkflowStatus): boolean {
  return (
    status === 'success' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'crashed' ||
    status === 'schema_error' ||
    status === 'artifact_error' ||
    status === 'manual_review'
  );
}

function aggregateWorkflowStatus(nodes: RunStateInternalNode[]): WorkflowStatus | null {
  if (!nodes.length) {
    return null;
  }
  if (nodes.some((node) => isFailedStatus(node.status))) {
    return 'failed';
  }
  if (nodes.some((node) => node.status === 'running' || node.status === 'scheduled')) {
    return 'running';
  }
  if (nodes.every((node) => node.status === 'success')) {
    return 'success';
  }
  return null;
}

function normalizeWorkflowStatus(status: string): WorkflowStatus {
  if (
    status === 'success' ||
    status === 'failed' ||
    status === 'schema_error' ||
    status === 'artifact_error' ||
    status === 'manual_review' ||
    status === 'running' ||
    status === 'queued' ||
    status === 'cancel_requested' ||
    status === 'cancelled' ||
    status === 'crashed' ||
    status === 'scheduled' ||
    status === 'not_run'
  ) {
    return status;
  }
  if (status === 'timeout') {
    return 'failed';
  }
  return status ? 'failed' : 'not_run';
}

function isFailedStatus(status: WorkflowStatus): boolean {
  return status === 'failed' || status === 'schema_error' || status === 'artifact_error' || status === 'crashed';
}

function internalFlowNodeId(workflowId: string, nodeId: string): string {
  return `${workflowId}__internal__${nodeId}`;
}
