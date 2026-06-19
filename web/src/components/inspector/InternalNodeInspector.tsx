import type { RuntimeConfig, WorkflowRunResult } from '../../types';
import type {
  DataConnectionDraft,
  InternalNodeView,
  NodeLiveLogs,
  PortDirection,
  WorkflowContainerModel,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { nodeLiveLogsFor, nodeRunForInternalNode, statusLabel } from '../../workbench/model/selectedNodeModel';
import { internalInvocationLabel } from '../../workbench/model/selectionModel';
import {
  internalNodeInputPorts,
  internalNodeInvocationPreview,
  internalNodeOutputPorts,
} from '../../workbench/model/workflowGraphProjection';
import { DataConnectionsPanel } from './DataConnectionsPanel';
import type { InspectorRenderers } from './InspectorRenderers';

export function InternalNodeInspector({
  canvas,
  workflow,
  node,
  tab,
  workflowRun,
  liveLogs,
  dataConnectionDraft,
  renderers,
  onReadEvidence,
  onBeginDataConnection,
  onCancelDataConnection,
  onUpdateDataConnectionMaterialization,
  onCompleteDataConnection,
  onCompleteDataConnectionWithNewInputPort,
  onAddDataConnectPort,
  onRenameDataConnectPort,
  onDeleteDataConnectPort,
  onUpdateInput,
  onUpdateLabel,
}: {
  canvas: WorkspaceCanvasModel;
  workflow: WorkflowContainerModel;
  node: InternalNodeView;
  tab: string;
  workflowRun: WorkflowRunResult | null;
  runtimeConfig: RuntimeConfig | null;
  liveLogs: Record<string, NodeLiveLogs>;
  dataConnectionDraft: DataConnectionDraft;
  renderers: InspectorRenderers;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onBeginDataConnection: (draft: Exclude<DataConnectionDraft, null>) => void;
  onCancelDataConnection: () => void;
  onUpdateDataConnectionMaterialization: (materialization: 'copy' | 'reference') => void;
  onCompleteDataConnection: (
    targetNodeId: string,
    targetPortId: string,
    options?: { replaceExisting?: boolean },
  ) => void;
  onCompleteDataConnectionWithNewInputPort: (targetNodeId: string, requestedPortId: string) => void;
  onAddDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    requestedPortId: string,
  ) => void;
  onRenameDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
    requestedPortId: string,
  ) => void;
  onDeleteDataConnectPort: (
    scopeWorkflowId: string | null,
    nodeId: string,
    direction: PortDirection,
    portId: string,
  ) => void;
  onUpdateInput: (
    workflowId: string,
    nodeId: string,
    input: Record<string, unknown>,
  ) => void;
  onUpdateLabel: (workflowId: string, nodeId: string, label: string) => void;
}) {
  const nodeRun = nodeRunForInternalNode(workflowRun, workflow.id, node.id);
  const nodeLogs = nodeLiveLogsFor(liveLogs, nodeRun);
  if (tab === 'invocation') {
    return (
      <section className="inspector-stack">
        <div className="inspector-note">
          This is the invocation config for this node instance; class-level methodology remains in the resource library.
        </div>
        {renderers.invocationIdentityCard({
          scope: `Workflow: ${workflow.title}`,
          nodeId: node.id,
          label: internalInvocationLabel(node),
          callableId: node.callableId || node.runtime,
          onLabelChange: (label) => onUpdateLabel(workflow.id, node.id, label),
        })}
        {renderers.invocationInputEditor({
          input: node.input || {},
          onChange: (nextInput) => onUpdateInput(workflow.id, node.id, nextInput),
        })}
        {renderers.codeBlock({
          title: 'core-v2-invocation-preview.json',
          content: JSON.stringify(internalNodeInvocationPreview(node), null, 2),
          variant: 'json',
        })}
      </section>
    );
  }
  if (tab === 'connections') {
    return (
      <DataConnectionsPanel
        canvasNodeKind="internal"
        canvas={canvas}
        scopeWorkflowId={workflow.id}
        nodeId={node.id}
        nodeLabel={internalInvocationLabel(node)}
        callableId={node.callableId || node.runtime}
        inputPorts={internalNodeInputPorts(node)}
        outputPorts={internalNodeOutputPorts(node)}
        outputPortsReadonly
        dataConnectionDraft={dataConnectionDraft}
        onBeginDataConnection={onBeginDataConnection}
        onCancelDataConnection={onCancelDataConnection}
        onUpdateDataConnectionMaterialization={onUpdateDataConnectionMaterialization}
        onCompleteDataConnection={onCompleteDataConnection}
        onCompleteDataConnectionWithNewInputPort={onCompleteDataConnectionWithNewInputPort}
        onAddPort={onAddDataConnectPort}
        onRenamePort={onRenameDataConnectPort}
        onDeletePort={onDeleteDataConnectPort}
      />
    );
  }
  if (tab === 'input') {
    return (
      <section className="inspector-stack">
        <h4>有效输入</h4>
        {renderers.evidencePreview({
          path: nodeRun?.input_path,
          title: 'input.json',
          emptyText: '尚未运行；当前内部节点没有真实 input.json。',
        })}
        {renderers.codeBlock({
          title: '用户提示词 / 静态输入',
          content: JSON.stringify(node.input || {}, null, 2),
          variant: 'json',
        })}
      </section>
    );
  }
  if (tab === 'output') {
    return (
      <section className="inspector-stack">
        <h4>真实输出</h4>
        {renderers.evidencePreview({
          path: nodeRun?.output_path,
          title: 'output.json',
          emptyText: '尚未运行；当前内部节点没有真实 output.json。',
        })}
      </section>
    );
  }
  if (tab === 'steps') {
    return (
      <section className="inspector-stack">
        <h4>运行步骤</h4>
        {nodeRun?.steps?.length ? (
          <ul className="inspector-step-list">
            {nodeRun.steps.map((step, index) => (
              <li key={step.event_id || `${step.type}-${index}`}>
                <strong>{step.type || 'event'}</strong>
                <span>{step.summary || step.status || ''}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">暂无事件摘要。</p>
        )}
      </section>
    );
  }
  if (tab === 'artifacts') {
    return <>{renderers.nodeEvidencePaths({ nodeRun, liveLogs: nodeLogs, onReadEvidence })}</>;
  }
  if (tab === 'logs') {
    return (
      <section className="inspector-stack">
        <h4>日志摘要</h4>
        {nodeRun?.log_excerpt ? (
          renderers.codeBlock({ title: 'log excerpt', content: nodeRun.log_excerpt, variant: 'log' })
        ) : (
          <p className="empty-state">暂无日志摘要。</p>
        )}
        {renderers.nodeEvidencePaths({ nodeRun, liveLogs: nodeLogs, onReadEvidence })}
      </section>
    );
  }
  if (tab === 'raw') {
    return (
      <>
        {renderers.codeBlock({
          title: 'internal-node.json',
          content: JSON.stringify({ workflow: workflow.id, node }, null, 2),
          variant: 'json',
        })}
      </>
    );
  }
  return (
    <section className="inspector-stack">
      <dl className="definition-grid compact">
        <dt>节点</dt>
        <dd>{node.name}</dd>
        <dt>任务</dt>
        <dd>{node.task}</dd>
        <dt>类型</dt>
        <dd>{node.kind}</dd>
        <dt>状态</dt>
        <dd>{statusLabel(node.status)}</dd>
        <dt>callable</dt>
        <dd>{node.callableId || 'n/a'}</dd>
        <dt>runtime</dt>
        <dd>{node.runtime || 'n/a'}</dd>
        <dt>run</dt>
        <dd>{nodeRun?.run_dir || '尚未运行'}</dd>
      </dl>
      {renderers.liveLogBlocks(nodeLogs)}
      {renderers.invocationIdentityCard({
        scope: `Workflow: ${workflow.title}`,
        nodeId: node.id,
        label: internalInvocationLabel(node),
        callableId: node.callableId || node.runtime,
        onLabelChange: (label) => onUpdateLabel(workflow.id, node.id, label),
      })}
      {renderers.invocationInputEditor({
        input: node.input || {},
        onChange: (nextInput) => onUpdateInput(workflow.id, node.id, nextInput),
      })}
      {renderers.codeBlock({
        title: '用户提示词 / 静态输入',
        content: JSON.stringify(node.input || {}, null, 2),
        variant: 'json',
      })}
      {renderers.evidencePreview({
        path: nodeRun?.output_path,
        title: '真实输出 output.json',
        emptyText: '尚未运行；当前内部节点没有真实 output.json。',
      })}
    </section>
  );
}
