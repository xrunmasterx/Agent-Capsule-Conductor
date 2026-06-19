import { FileText, FolderCog } from 'lucide-react';

import { shortPath } from '../../format';
import type { RunEvent, RuntimeConfig, WorkflowBindingView, WorkflowRunResult, WorkflowSummary } from '../../types';
import type {
  DataConnectionDraft,
  EmptyInputPolicy,
  PortDirection,
  WorkflowContainerModel,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { bindingDirectory, nodeLiveLogsFor, nodeRunForWorkflow, statusLabel } from '../../workbench/model/selectedNodeModel';
import { isExecutableNodeWorkflow, workflowInvocationLabel } from '../../workbench/model/selectionModel';
import {
  workflowInvocationPreview,
  workflowOutputPorts,
  workflowOutputPortsReadonly,
} from '../../workbench/model/workflowGraphProjection';
import { DataConnectionsPanel } from './DataConnectionsPanel';
import type { InspectorRenderers } from './InspectorRenderers';

export function WorkflowInspector({
  canvas,
  workflow,
  tab,
  workflowRun,
  runtimeConfig,
  liveLogs,
  events,
  savedWorkflow,
  binding,
  dataConnectionDraft,
  renderers,
  onReadEvidence,
  onConfigureBinding,
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
  tab: string;
  workflowRun: WorkflowRunResult | null;
  runtimeConfig: RuntimeConfig | null;
  liveLogs: Record<string, import('../../types/workbench').NodeLiveLogs>;
  events: RunEvent[];
  savedWorkflow?: WorkflowSummary;
  binding?: WorkflowBindingView;
  dataConnectionDraft: DataConnectionDraft;
  renderers: InspectorRenderers;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onConfigureBinding: (workflowId: string) => void;
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
  onUpdateInput: (workflowId: string, input: Record<string, unknown>) => void;
  onUpdateLabel: (workflowId: string, label: string) => void;
}) {
  const nodeRun = nodeRunForWorkflow(workflowRun, workflow);
  const nodeLogs = nodeLiveLogsFor(liveLogs, nodeRun);
  const executable = isExecutableNodeWorkflow(workflow);
  if (tab === 'invocation') {
    return (
      <section className="inspector-stack">
        <div className="inspector-note">
          System/default prompt belongs to the reusable class resource. This panel edits only this invocation's user prompt and static input.
        </div>
        {renderers.invocationInputEditor({
          input: workflow.sourceInput || {},
          onChange: (nextInput) => onUpdateInput(workflow.id, nextInput),
        })}
        {renderers.codeBlock({
          title: 'core-v2-invocation-preview.json',
          content: JSON.stringify(workflowInvocationPreview(workflow), null, 2),
          variant: 'json',
        })}
      </section>
    );
  }
  if (tab === 'connections') {
    if (!executable) {
      return <p className="muted">Workflow container 的边界端口连接会在后续单独建模；当前只支持可执行节点和内部节点。</p>;
    }
    return (
      <DataConnectionsPanel
        canvasNodeKind="workflow"
        canvas={canvas}
        scopeWorkflowId={null}
        nodeId={workflow.id}
        nodeLabel={workflowInvocationLabel(workflow)}
        callableId={workflow.callableId || workflow.workflowRef}
        inputPorts={workflow.inputPorts}
        outputPorts={workflow.outputPorts}
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
    if (executable) {
      return (
        <section className="inspector-stack">
          <h4>有效输入</h4>
          {renderers.evidencePreview({
            path: nodeRun?.input_path,
            title: 'input.json',
            emptyText: '尚未运行；当前节点没有真实 input.json。',
          })}
          {renderers.codeBlock({
            title: '静态输入',
            content: JSON.stringify(workflow.sourceInput || {}, null, 2),
            variant: 'json',
          })}
          {renderers.codeBlock({
            title: '输入映射',
            content: JSON.stringify(workflow.sourceInputMapping || {}, null, 2),
            variant: 'json',
          })}
        </section>
      );
    }
    return <>{renderers.portList({ title: '输入端口', ports: workflow.inputPorts })}</>;
  }
  if (tab === 'output') {
    if (executable) {
      return (
        <section className="inspector-stack">
          <h4>真实输出</h4>
          {renderers.evidencePreview({
            path: nodeRun?.output_path,
            title: 'output.json',
            emptyText: '尚未运行；当前节点没有真实 output.json。',
          })}
        </section>
      );
    }
    return <>{renderers.portList({ title: '输出端口', ports: workflow.outputPorts })}</>;
  }
  if (tab === 'config') {
    return (
      <section className="inspector-stack">
        <dl className="definition-grid compact">
          <dt>workflow_ref</dt>
          <dd>{workflow.workflowRef || 'inline/demo'}</dd>
          {savedWorkflow ? (
            <>
              <dt>saved template</dt>
              <dd>{savedWorkflow.workflow_id}</dd>
              <dt>saved nodes</dt>
              <dd>{savedWorkflow.task_count}</dd>
            </>
          ) : null}
          <dt>cwd</dt>
          <dd>{bindingDirectory(workflow, binding)}</dd>
          <dt>binding</dt>
          <dd>{bindingPathOfView(binding) || 'unbound'}</dd>
          <dt>size</dt>
          <dd>
            {workflow.size.width} x {workflow.size.height}
          </dd>
          <dt>binding status</dt>
          <dd>{binding?.status || 'unbound'}</dd>
        </dl>
        <button type="button" className="secondary-action" onClick={() => onConfigureBinding(workflow.id)}>
          <FolderCog aria-hidden="true" size={16} />
          配置工作目录
        </button>
      </section>
    );
  }
  if (tab === 'history') {
    return (
      <section className="inspector-stack">
        <button
          type="button"
          className="path-button"
          disabled={!nodeRun?.output_path}
          onClick={() => onReadEvidence(nodeRun?.output_path, '节点输出')}
        >
          <FileText aria-hidden="true" size={16} />
          <span>输出</span>
          <small>{shortPath(nodeRun?.output_path)}</small>
        </button>
        {renderers.eventTimeline({ events, title: '工作流事件' })}
      </section>
    );
  }
  if (tab === 'raw') {
    return (
      <>
        {renderers.codeBlock({
          title: 'workflow-container.json',
          content: JSON.stringify(workflow, null, 2),
          variant: 'json',
        })}
      </>
    );
  }
  if (executable) {
    return (
      <section className="inspector-stack">
        <dl className="definition-grid compact">
          <dt>Agent</dt>
          <dd>{workflow.title}</dd>
          <dt>callable</dt>
          <dd>{workflow.callableId || 'n/a'}</dd>
          <dt>runtime</dt>
          <dd>{workflow.sourceKind === 'tool' ? 'Tool' : 'Agent'}</dd>
          <dt>状态</dt>
          <dd>{statusLabel(workflow.status)}</dd>
          <dt>run</dt>
          <dd>{nodeRun?.run_dir ? shortPath(nodeRun.run_dir) : '尚未运行'}</dd>
        </dl>
        <div className="inspector-note">
          系统提示词属于资源库里的 Agent Class；这里是本次任务里的调用实例，只显示用户输入、映射和运行证据。
        </div>
        <div className="inspector-note">
          Run mode: {runtimeConfig?.real_external_agents_enabled ? 'production / real CLI' : 'hermetic or external gate disabled'}
        </div>
        {renderers.liveLogBlocks(nodeLogs)}
        {renderers.invocationIdentityCard({
          scope: 'Root canvas',
          nodeId: workflow.id,
          label: workflowInvocationLabel(workflow),
          callableId: workflow.callableId,
          workflowRef: workflow.workflowRef,
          onLabelChange: (label) => onUpdateLabel(workflow.id, label),
        })}
        {renderers.invocationInputEditor({
          input: workflow.sourceInput || {},
          onChange: (nextInput) => onUpdateInput(workflow.id, nextInput),
        })}
        {renderers.codeBlock({
          title: '用户提示词 / 静态输入',
          content: JSON.stringify(workflow.sourceInput || {}, null, 2),
          variant: 'json',
        })}
        {renderers.codeBlock({
          title: '上游输入映射',
          content: JSON.stringify(workflow.sourceInputMapping || {}, null, 2),
          variant: 'json',
        })}
        <div className="inspector-run-evidence-grid">
          {renderers.evidencePreview({
            path: nodeRun?.input_path,
            title: '真实输入 input.json',
            emptyText: '尚未运行；当前 Agent 实例没有真实 input.json。',
          })}
          {renderers.evidencePreview({
            path: nodeRun?.output_path,
            title: '真实输出 output.json',
            emptyText: '尚未运行；当前 Agent 实例没有真实 output.json。',
          })}
        </div>
      </section>
    );
  }
  return (
    <dl className="definition-grid compact">
      <dt>名称</dt>
      <dd>{workflow.title}</dd>
      <dt>状态</dt>
      <dd>{statusLabel(workflow.status)}</dd>
      <dt>目录</dt>
      <dd>{bindingDirectory(workflow, binding)}</dd>
      <dt>端口</dt>
      <dd>
        {workflow.inputPorts.length} in / {workflow.outputPorts.length} out
      </dd>
      <dt>内部节点</dt>
      <dd>{savedWorkflow ? `${savedWorkflow.task_count} saved` : workflow.internalNodes.length}</dd>
    </dl>
  );
}

function bindingPathOfView(binding?: WorkflowBindingView): string {
  return binding?.bindingPath || binding?.binding_path || '';
}

export { workflowOutputPorts, workflowOutputPortsReadonly };
