import type { PointerEvent, ReactNode } from 'react';

import type {
  RunEvent,
  RuntimeConfig,
  WorkflowBindingView,
  WorkflowRunResult,
  WorkflowSummary,
} from '../../types';
import type {
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
import { inspectorDrawerTitle } from '../../workbench/model/workflowViewerShell';
import { boundaryTransferPreviewSnapshotForCanvas } from '../../hooks/useWorkflowSaveValidationActions';
import { CodeBlock } from '../CodeBlock';
import { AgentNodeSettingsPanel } from '../inspector/AgentNodeSettingsPanel';
import { EvidencePreview } from '../inspector/EvidencePreview';
import { EventTimeline } from '../inspector/EventTimeline';
import { InvocationIdentityCard } from '../inspector/InvocationIdentityCard';
import { InvocationInputEditor } from '../inspector/InvocationInputEditor';
import { LiveLogBlocks } from '../inspector/LiveLogBlocks';
import { NodeEvidencePaths } from '../inspector/NodeEvidencePaths';
import { PortList } from '../inspector/PortList';
import { ResourceInspector, type ResourceTemplate } from '../inspector/ResourceInspector';
import { RightInspector } from '../inspector/RightInspector';

type WorkflowViewerRightPanelProps = {
  resourceDetailOpen: boolean;
  inspectorOpen: boolean;
  inspectorWidth: number;
  selection: CanvasSelection;
  selectedResource: ResourceTemplate | null;
  canvas: WorkspaceCanvasModel;
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
  workflowBindings: Record<string, WorkflowBindingView>;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  onCollapseRightPanel: () => void;
  onConnectionMode: (mode: ConnectionMode) => void;
  onBeginDataConnection: (draft: Exclude<DataConnectionDraft, null>) => void;
  onCancelDataConnection: () => void;
  onUpdateDataConnectionMaterialization: (materialization: 'copy' | 'reference') => void;
  onCompleteDataConnection: (
    targetNodeId: string,
    targetPortId: string,
    options?: { replaceExisting?: boolean },
  ) => void;
  onCompleteDataConnectionWithNewInputPort: (
    targetNodeId: string,
    requestedPortId: string,
  ) => void;
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
  onConfigureBinding: (workflowId: string | null) => void;
  onUpdateWorkflowInput: (workflowId: string, input: Record<string, unknown>) => void;
  onUpdateInternalInput: (
    workflowId: string,
    nodeId: string,
    input: Record<string, unknown>,
  ) => void;
  onUpdateWorkflowLabel: (workflowId: string, label: string) => void;
  onUpdateInternalLabel: (workflowId: string, nodeId: string, label: string) => void;
  onUpdateWorkflowForwardMainOutput: (workflowId: string, value: boolean) => void;
  onUpdateInternalForwardMainOutput: (workflowId: string, nodeId: string, value: boolean) => void;
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
  onOpenCallableResource: (
    callableId: string,
    name: string,
    kind: 'agent_class' | 'tool_class',
  ) => void;
};

export function WorkflowViewerRightPanel({
  resourceDetailOpen,
  inspectorOpen,
  inspectorWidth,
  selection,
  selectedResource,
  canvas,
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
  workflowBindings,
  onResizeStart,
  onCollapseRightPanel,
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
}: WorkflowViewerRightPanelProps) {
  if (resourceDetailOpen) {
    return (
      <RightDrawer width={inspectorWidth} onResizeStart={onResizeStart}>
        <div className="drawer-title-row">
          <strong>{inspectorDrawerTitle(selection)}</strong>
          <button type="button" onClick={onCollapseRightPanel}>
            收起
          </button>
        </div>
        {selectedResource ? <ResourceInspector resource={selectedResource} /> : null}
      </RightDrawer>
    );
  }

  if (!inspectorOpen) {
    return null;
  }

  return (
    <RightDrawer width={inspectorWidth} onResizeStart={onResizeStart}>
      <RightInspector
        canvas={canvas}
        selection={selection}
        selectedWorkflow={selectedWorkflow}
        selectedPort={selectedPort}
        selectedEdge={selectedEdge}
        selectedInternalNode={selectedInternalNode}
        connectionMode={connectionMode}
        dataConnectionDraft={dataConnectionDraft}
        runtimeConfig={runtimeConfig}
        liveLogs={liveLogs}
        workflowRun={workflowRun}
        workflowEvents={workflowEvents}
        workflows={workflows}
        binding={selectedWorkflow ? workflowBindings[selectedWorkflow.id] : undefined}
        renderers={{
          codeBlock: (props) => <CodeBlock {...props} />,
          evidencePreview: (props) => <EvidencePreview {...props} />,
          invocationInputEditor: (props) => <InvocationInputEditor {...props} />,
          invocationIdentityCard: (props) => <InvocationIdentityCard {...props} />,
          liveLogBlocks: (logs) => <LiveLogBlocks liveLogs={logs} />,
          nodeEvidencePaths: (props) => <NodeEvidencePaths {...props} />,
          portList: (props) => <PortList {...props} />,
          eventTimeline: (props) => <EventTimeline {...props} />,
        }}
        renderAgentNodeSettings={(props) => <AgentNodeSettingsPanel {...props} />}
        boundaryPreviewSnapshotForCanvas={boundaryTransferPreviewSnapshotForCanvas}
        onConnectionMode={onConnectionMode}
        onBeginDataConnection={onBeginDataConnection}
        onCancelDataConnection={onCancelDataConnection}
        onUpdateDataConnectionMaterialization={onUpdateDataConnectionMaterialization}
        onCompleteDataConnection={onCompleteDataConnection}
        onCompleteDataConnectionWithNewInputPort={onCompleteDataConnectionWithNewInputPort}
        onAddDataConnectPort={onAddDataConnectPort}
        onRenameDataConnectPort={onRenameDataConnectPort}
        onDeleteDataConnectPort={onDeleteDataConnectPort}
        onReadEvidence={onReadEvidence}
        onConfigureBinding={onConfigureBinding}
        onUpdateWorkflowInput={onUpdateWorkflowInput}
        onUpdateInternalInput={onUpdateInternalInput}
        onUpdateWorkflowLabel={onUpdateWorkflowLabel}
        onUpdateInternalLabel={onUpdateInternalLabel}
        onUpdateWorkflowForwardMainOutput={onUpdateWorkflowForwardMainOutput}
        onUpdateInternalForwardMainOutput={onUpdateInternalForwardMainOutput}
        onUpdateWorkflowEmptyInputPolicy={onUpdateWorkflowEmptyInputPolicy}
        onUpdateInternalEmptyInputPolicy={onUpdateInternalEmptyInputPolicy}
        onUpdateWorkflowCodexExecutionMode={onUpdateWorkflowCodexExecutionMode}
        onUpdateInternalCodexExecutionMode={onUpdateInternalCodexExecutionMode}
        onOpenCallableResource={onOpenCallableResource}
      />
    </RightDrawer>
  );
}

function RightDrawer({
  width,
  onResizeStart,
  children,
}: {
  width: number;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <div className="canvas-drawer canvas-drawer-right" style={{ width }}>
      <div
        className="drawer-resize-handle"
        role="separator"
        aria-label="调整节点设置面板宽度"
        aria-orientation="vertical"
        onPointerDown={onResizeStart}
      />
      {children}
    </div>
  );
}
