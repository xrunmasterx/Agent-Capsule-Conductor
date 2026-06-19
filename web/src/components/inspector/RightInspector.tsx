import { useEffect, useState, type ReactNode } from 'react';

import type {
  RunEvent,
  RuntimeConfig,
  WorkflowBindingView,
  WorkflowRunResult,
  WorkflowSummary,
} from '../../types';
import type {
  AgentNodeConnectionEditor,
  AgentNodeSettingsModel,
  CanvasSelection,
  CodexExecutionMode,
  ConnectionMode,
  DataConnectionDraft,
  EmptyInputPolicy,
  InternalNodeView,
  NodeLiveLogs,
  PortDirection,
  WorkflowCanvasEdge,
  WorkflowContainerModel,
  WorkflowPortView,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { useCallableDetail, type CallableDetailLoadState } from '../../hooks/useCallableDetail';
import {
  nodeLiveLogsFor,
  nodeRunForInternalNode,
  nodeRunForWorkflow,
  workflowMainInputBindingState,
} from '../../workbench/model/selectedNodeModel';
import {
  internalInvocationLabel,
  isExecutableNodeWorkflow,
  workflowInvocationLabel,
} from '../../workbench/model/selectionModel';
import {
  internalNodeInputPorts,
  internalNodeInvocationPreview,
  internalNodeOutputPorts,
  port,
  workflowInvocationPreview,
  workflowOutputPorts,
  workflowOutputPortsReadonly,
} from '../../workbench/model/workflowGraphProjection';
import { EdgeInspector } from './EdgeInspector';
import type { InspectorRenderers } from './InspectorRenderers';
import { InternalNodeInspector } from './InternalNodeInspector';
import { PortInspector } from './PortInspector';
import { WorkflowInspector } from './WorkflowInspector';

export type AgentNodeSettingsRendererProps = {
  node: AgentNodeSettingsModel;
  connectionEditor?: AgentNodeConnectionEditor;
  runtimeConfig: RuntimeConfig | null;
  callableState: CallableDetailLoadState;
  onUpdateInput: (input: Record<string, unknown>) => void;
  onUpdateLabel: (label: string) => void;
  onUpdateForwardMainOutput: (value: boolean) => void;
  onUpdateEmptyInputPolicy: (value: EmptyInputPolicy) => void;
  onUpdateCodexExecutionMode: (value: CodexExecutionMode) => void;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onOpenCallableResource: (callableId: string, name: string, kind: 'agent_class' | 'tool_class') => void;
};

export function RightInspector({
  canvas,
  selection,
  selectedWorkflow,
  selectedPort,
  selectedEdge,
  selectedInternalNode,
  connectionMode,
  dataConnectionDraft,
  runtimeConfig,
  liveLogs,
  workflowRun,
  workflowEvents,
  workflows,
  binding,
  renderers,
  renderAgentNodeSettings,
  boundaryPreviewSnapshotForCanvas,
  onConnectionMode,
  onBeginDataConnection,
  onCancelDataConnection,
  onUpdateDataConnectionMaterialization,
  onCompleteDataConnection,
  onCompleteDataConnectionWithNewInputPort,
  onAddDataConnectPort,
  onRenameDataConnectPort,
  onDeleteDataConnectPort,
  onReadEvidence,
  onConfigureBinding,
  onUpdateWorkflowInput,
  onUpdateInternalInput,
  onUpdateWorkflowLabel,
  onUpdateInternalLabel,
  onUpdateWorkflowForwardMainOutput,
  onUpdateInternalForwardMainOutput,
  onUpdateWorkflowEmptyInputPolicy,
  onUpdateInternalEmptyInputPolicy,
  onUpdateWorkflowCodexExecutionMode,
  onUpdateInternalCodexExecutionMode,
  onOpenCallableResource,
}: {
  canvas: WorkspaceCanvasModel;
  selection: CanvasSelection;
  selectedWorkflow?: WorkflowContainerModel;
  selectedPort?: WorkflowPortView;
  selectedEdge?: WorkflowCanvasEdge;
  selectedInternalNode?: InternalNodeView;
  connectionMode: ConnectionMode;
  dataConnectionDraft: DataConnectionDraft;
  runtimeConfig: RuntimeConfig | null;
  liveLogs: Record<string, NodeLiveLogs>;
  workflowRun: WorkflowRunResult | null;
  workflowEvents: RunEvent[];
  workflows: WorkflowSummary[];
  binding?: WorkflowBindingView;
  renderers: InspectorRenderers;
  renderAgentNodeSettings: (props: AgentNodeSettingsRendererProps) => ReactNode;
  boundaryPreviewSnapshotForCanvas: (canvas: WorkspaceCanvasModel) => Record<string, unknown>;
  onConnectionMode: (mode: ConnectionMode) => void;
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
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onConfigureBinding: (workflowId: string) => void;
  onUpdateWorkflowInput: (workflowId: string, input: Record<string, unknown>) => void;
  onUpdateInternalInput: (
    workflowId: string,
    nodeId: string,
    input: Record<string, unknown>,
  ) => void;
  onUpdateWorkflowLabel: (workflowId: string, label: string) => void;
  onUpdateInternalLabel: (workflowId: string, nodeId: string, label: string) => void;
  onUpdateWorkflowForwardMainOutput: (workflowId: string, value: boolean) => void;
  onUpdateInternalForwardMainOutput: (
    workflowId: string,
    nodeId: string,
    value: boolean,
  ) => void;
  onUpdateWorkflowEmptyInputPolicy: (workflowId: string, value: EmptyInputPolicy) => void;
  onUpdateInternalEmptyInputPolicy: (
    workflowId: string,
    nodeId: string,
    value: EmptyInputPolicy,
  ) => void;
  onUpdateWorkflowCodexExecutionMode: (workflowId: string, value: CodexExecutionMode) => void;
  onUpdateInternalCodexExecutionMode: (
    workflowId: string,
    nodeId: string,
    value: CodexExecutionMode,
  ) => void;
  onOpenCallableResource: (callableId: string, name: string, kind: 'agent_class' | 'tool_class') => void;
}) {
  const [tab, setTab] = useState('overview');
  const selectedNodeCallableId =
    selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)
      ? selectedWorkflow.callableId || ''
      : selection.type === 'internal' && selectedInternalNode
        ? selectedInternalNode.callableId || selectedInternalNode.runtime || ''
        : '';
  const callableDetailState = useCallableDetail(selectedNodeCallableId);
  const nodeSettingsTitle = inspectorDrawerTitle(selection);
  useEffect(() => {
    setTab(selection.type === 'edge' ? 'mapping' : 'overview');
  }, [selection]);

  if (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)) {
    return (
      <aside className="right-inspector node-settings-panel" aria-label="节点设置面板">
        <header className="inspector-title-row node-settings-title-row">
          <div>
            <span className="panel-kicker">当前选中</span>
            <h3>{nodeSettingsTitle}</h3>
          </div>
        </header>
        {renderAgentNodeSettings({
          node: {
            scopeLabel: '任务画布',
            nodeId: selectedWorkflow.id,
            label: workflowInvocationLabel(selectedWorkflow),
            task: workflowInvocationLabel(selectedWorkflow),
            kind: selectedWorkflow.sourceKind === 'tool' ? 'Tool' : 'Agent',
            status: selectedWorkflow.status,
            callableId: selectedWorkflow.callableId || '',
            codexExecutionMode: selectedWorkflow.codexExecutionMode,
            input: selectedWorkflow.sourceInput || {},
            inputPorts: selectedWorkflow.inputPorts,
            outputPorts: workflowOutputPorts(selectedWorkflow),
            outputSchema: selectedWorkflow.outputSchema,
            forwardMainOutputOnControl: selectedWorkflow.forwardMainOutputOnControl,
            emptyInputPolicy: selectedWorkflow.emptyInputPolicy,
            run: nodeRunForWorkflow(workflowRun, selectedWorkflow),
            logs: nodeLiveLogsFor(liveLogs, nodeRunForWorkflow(workflowRun, selectedWorkflow)),
            preview: workflowInvocationPreview(selectedWorkflow),
            raw: selectedWorkflow,
          },
          connectionEditor: {
            canvas,
            canvasNodeKind: 'workflow',
            scopeWorkflowId: null,
            nodeId: selectedWorkflow.id,
            nodeLabel: workflowInvocationLabel(selectedWorkflow),
            callableId: selectedWorkflow.callableId || selectedWorkflow.workflowRef || '',
            inputPorts: selectedWorkflow.inputPorts,
            outputPorts: workflowOutputPorts(selectedWorkflow),
            outputPortsReadonly: workflowOutputPortsReadonly(selectedWorkflow),
            dataConnectionDraft,
            onBeginDataConnection,
            onCancelDataConnection,
            onUpdateDataConnectionMaterialization,
            onCompleteDataConnection,
            onCompleteDataConnectionWithNewInputPort,
            onAddPort: onAddDataConnectPort,
            onRenamePort: onRenameDataConnectPort,
            onDeletePort: onDeleteDataConnectPort,
          },
          runtimeConfig,
          callableState: callableDetailState,
          onUpdateInput: (nextInput) => onUpdateWorkflowInput(selectedWorkflow.id, nextInput),
          onUpdateLabel: (label) => onUpdateWorkflowLabel(selectedWorkflow.id, label),
          onUpdateForwardMainOutput: (value) =>
            onUpdateWorkflowForwardMainOutput(selectedWorkflow.id, value),
          onUpdateEmptyInputPolicy: (value) =>
            onUpdateWorkflowEmptyInputPolicy(selectedWorkflow.id, value),
          onUpdateCodexExecutionMode: (value) =>
            onUpdateWorkflowCodexExecutionMode(selectedWorkflow.id, value),
          onReadEvidence,
          onOpenCallableResource,
        })}
      </aside>
    );
  }

  if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
    const nodeRun = nodeRunForInternalNode(workflowRun, selectedWorkflow.id, selectedInternalNode.id);
    return (
      <aside className="right-inspector node-settings-panel" aria-label="节点设置面板">
        <header className="inspector-title-row node-settings-title-row">
          <div>
            <span className="panel-kicker">当前选中</span>
            <h3>{nodeSettingsTitle}</h3>
          </div>
        </header>
        {renderAgentNodeSettings({
          node: {
            scopeLabel: `工作流：${workflowInvocationLabel(selectedWorkflow)}`,
            nodeId: selectedInternalNode.id,
            label: internalInvocationLabel(selectedInternalNode),
            task: selectedInternalNode.task,
            kind: selectedInternalNode.kind,
            status: selectedInternalNode.status,
            callableId: selectedInternalNode.callableId || selectedInternalNode.runtime || '',
            codexExecutionMode: selectedInternalNode.codexExecutionMode,
            input: selectedInternalNode.input || {},
            inputPorts: selectedInternalNode.inputPorts || [port('main', 'input', 'input')],
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
          },
          connectionEditor: {
            canvas,
            canvasNodeKind: 'internal',
            scopeWorkflowId: selectedWorkflow.id,
            nodeId: selectedInternalNode.id,
            nodeLabel: internalInvocationLabel(selectedInternalNode),
            callableId: selectedInternalNode.callableId || selectedInternalNode.runtime || '',
            inputPorts: selectedInternalNode.inputPorts || [port('main', 'input', 'input')],
            outputPorts: internalNodeOutputPorts(selectedInternalNode),
            outputPortsReadonly: true,
            dataConnectionDraft,
            onBeginDataConnection,
            onCancelDataConnection,
            onUpdateDataConnectionMaterialization,
            onCompleteDataConnection,
            onCompleteDataConnectionWithNewInputPort,
            onAddPort: onAddDataConnectPort,
            onRenamePort: onRenameDataConnectPort,
            onDeletePort: onDeleteDataConnectPort,
          },
          runtimeConfig,
          callableState: callableDetailState,
          onUpdateInput: (nextInput) => onUpdateInternalInput(selectedWorkflow.id, selectedInternalNode.id, nextInput),
          onUpdateLabel: (label) => onUpdateInternalLabel(selectedWorkflow.id, selectedInternalNode.id, label),
          onUpdateForwardMainOutput: (value) =>
            onUpdateInternalForwardMainOutput(selectedWorkflow.id, selectedInternalNode.id, value),
          onUpdateEmptyInputPolicy: (value) =>
            onUpdateInternalEmptyInputPolicy(selectedWorkflow.id, selectedInternalNode.id, value),
          onUpdateCodexExecutionMode: (value) =>
            onUpdateInternalCodexExecutionMode(selectedWorkflow.id, selectedInternalNode.id, value),
          onReadEvidence,
          onOpenCallableResource,
        })}
      </aside>
    );
  }

  return (
    <aside className="right-inspector" aria-label={`${nodeSettingsTitle}面板`}>
      <header className="inspector-title-row">
        <h3>{nodeSettingsTitle}</h3>
        <div className="segmented-control" aria-label="连接模式">
          <button
            type="button"
            className={connectionMode === 'data' ? 'active' : ''}
            onClick={() => onConnectionMode('data')}
          >
            数据
          </button>
          <button
            type="button"
            className={connectionMode === 'control' ? 'active' : ''}
            onClick={() => onConnectionMode('control')}
          >
            控制
          </button>
        </div>
      </header>
      <InspectorTabs selection={selection} activeTab={tab} onTab={setTab} />
      {selection.type === 'workflow' && selectedWorkflow ? (
        <WorkflowInspector
          canvas={canvas}
          workflow={selectedWorkflow}
          tab={tab}
          workflowRun={workflowRun}
          runtimeConfig={runtimeConfig}
          liveLogs={liveLogs}
          events={workflowEvents}
          savedWorkflow={workflowSummaryForRef(workflows, selectedWorkflow.workflowRef)}
          binding={binding}
          dataConnectionDraft={dataConnectionDraft}
          renderers={renderers}
          onReadEvidence={onReadEvidence}
          onConfigureBinding={onConfigureBinding}
          onBeginDataConnection={onBeginDataConnection}
          onCancelDataConnection={onCancelDataConnection}
          onUpdateDataConnectionMaterialization={onUpdateDataConnectionMaterialization}
          onCompleteDataConnection={onCompleteDataConnection}
          onCompleteDataConnectionWithNewInputPort={onCompleteDataConnectionWithNewInputPort}
          onAddDataConnectPort={onAddDataConnectPort}
          onRenameDataConnectPort={onRenameDataConnectPort}
          onDeleteDataConnectPort={onDeleteDataConnectPort}
          onUpdateInput={onUpdateWorkflowInput}
          onUpdateLabel={onUpdateWorkflowLabel}
        />
      ) : null}
      {selection.type === 'port' && selectedWorkflow && selectedPort ? (
        <PortInspector workflow={selectedWorkflow} port={selectedPort} tab={tab} canvas={canvas} />
      ) : null}
      {selection.type === 'edge' && selectedEdge ? (
        <EdgeInspector
          edge={selectedEdge}
          tab={tab}
          canvas={canvas}
          scopeWorkflowId={selection.scopeWorkflowId || null}
          boundaryPreviewSnapshotForCanvas={boundaryPreviewSnapshotForCanvas}
          onCreateTargetInputPort={(targetNodeId, targetPortId) =>
            onAddDataConnectPort(selection.scopeWorkflowId || null, targetNodeId, 'input', targetPortId)
          }
        />
      ) : null}
      {selection.type === 'internal' && selectedWorkflow && selectedInternalNode ? (
        <InternalNodeInspector
          canvas={canvas}
          workflow={selectedWorkflow}
          node={selectedInternalNode}
          tab={tab}
          workflowRun={workflowRun}
          runtimeConfig={runtimeConfig}
          liveLogs={liveLogs}
          dataConnectionDraft={dataConnectionDraft}
          renderers={renderers}
          onReadEvidence={onReadEvidence}
          onBeginDataConnection={onBeginDataConnection}
          onCancelDataConnection={onCancelDataConnection}
          onUpdateDataConnectionMaterialization={onUpdateDataConnectionMaterialization}
          onCompleteDataConnection={onCompleteDataConnection}
          onCompleteDataConnectionWithNewInputPort={onCompleteDataConnectionWithNewInputPort}
          onAddDataConnectPort={onAddDataConnectPort}
          onRenameDataConnectPort={onRenameDataConnectPort}
          onDeleteDataConnectPort={onDeleteDataConnectPort}
          onUpdateInput={onUpdateInternalInput}
          onUpdateLabel={onUpdateInternalLabel}
        />
      ) : null}
    </aside>
  );
}

function InspectorTabs({
  selection,
  activeTab,
  onTab,
}: {
  selection: CanvasSelection;
  activeTab: string;
  onTab: (tab: string) => void;
}) {
  const tabs =
    selection.type === 'edge'
      ? ['overview', 'upstream', 'downstream', 'mapping', 'raw']
      : selection.type === 'port'
        ? ['overview', 'contract', 'connections', 'evidence']
        : selection.type === 'internal'
          ? ['overview', 'invocation', 'connections', 'input', 'output', 'steps', 'artifacts', 'logs', 'raw']
          : ['overview', 'invocation', 'connections', 'input', 'output', 'config', 'history', 'raw'];
  const labels: Record<string, string> = {
    overview: '概览',
    invocation: '调用配置',
    connections: '连接',
    input: '输入',
    output: '输出',
    config: '配置',
    history: '历史',
    raw: 'Raw',
    contract: '端口契约',
    evidence: '运行证据',
    upstream: '上游',
    downstream: '下游',
    mapping: '数据映射',
    artifacts: '产物',
    events: '事件',
    steps: '步骤',
    logs: '详细日志',
  };
  return (
    <div className="tab-strip compact-tabs" role="tablist" aria-label="Inspector tabs">
      {tabs.map((tabValue) => (
        <button
          key={tabValue}
          type="button"
          className={activeTab === tabValue ? 'active' : ''}
          aria-label={tabValue === 'input' ? 'Inspector input tab' : undefined}
          onClick={() => onTab(tabValue)}
        >
          {labels[tabValue] || tabValue}
        </button>
      ))}
    </div>
  );
}

function inspectorDrawerTitle(selection: CanvasSelection): string {
  if (selection.type === 'workflow') {
    return 'Workflow / 节点设置';
  }
  if (selection.type === 'internal') {
    return '内部节点设置';
  }
  if (selection.type === 'edge') {
    return '边详情';
  }
  if (selection.type === 'port') {
    return '端口详情';
  }
  return '画布详情';
}

function workflowSummaryForRef(
  workflows: WorkflowSummary[],
  workflowRef: string | undefined,
): WorkflowSummary | undefined {
  if (!workflowRef) {
    return undefined;
  }
  const normalized = workflowRef.replace(/\\/gu, '/');
  return workflows.find((workflow) => {
    const path = workflow.path.replace(/\\/gu, '/');
    return path === normalized || workflow.workflow_id === workflowRef || workflow.file_id === workflowRef;
  });
}
