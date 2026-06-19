import type { ArtifactContent, RuntimeConfig } from '../../types';
import type { CallableDetailLoadState } from '../../hooks/useCallableDetail';
import type { AgentSessionUiState } from '../../hooks/useSelectedAgentSession';
import type { WorkbenchLiveStreamState } from '../../hooks/useWorkbenchLiveStream';
import { agentEventsLiveText } from '../../workbench/model/agentEventText';
import { isExecutableNodeWorkflow } from '../../workbench/model/selectionModel';
import { isNodeDetailModel } from '../../workbench/model/workflowViewerShell';
import type {
  CanvasSelection,
  CodexExecutionMode,
  EmptyInputPolicy,
  InternalNodeView,
  SelectedEntityDetailsModel,
  WorkflowContainerModel,
} from '../../types/workbench';
import { SelectionPropertiesPane } from '../inspector/AgentNodeSettingsPanel';
import { NodeDetailOverlay } from '../inspector/NodeDetailOverlay';
import { SelectionInputPane } from '../inspector/SelectionInputPane';
import { SelectionOutputPane } from '../inspector/SelectionOutputPane';

type WorkflowViewerNodeDetailOverlayProps = {
  open: boolean;
  model: SelectedEntityDetailsModel;
  selection: CanvasSelection;
  selectedWorkflow?: WorkflowContainerModel;
  selectedInternalNode?: InternalNodeView;
  artifactCacheByPath: Record<string, ArtifactContent>;
  selectedAgentTurnLiveState: WorkbenchLiveStreamState;
  selectedAgentLiveState: WorkbenchLiveStreamState;
  callableState: CallableDetailLoadState;
  runtimeConfig: RuntimeConfig | null;
  agentSessionState: AgentSessionUiState;
  onClose: () => void;
  onEnsureArtifactContent: (path: string | null | undefined) => Promise<void>;
  onReadEvidence: (path: string | null | undefined, title?: string) => void;
  onRefreshAgentSession: () => Promise<void>;
  onPublishAgentOutput: (expectedTurnId: string) => Promise<void>;
  onAnswerAgentInteraction: (
    interactionId: string,
    answer: Record<string, unknown>,
  ) => Promise<void>;
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

export function WorkflowViewerNodeDetailOverlay({
  open,
  model,
  selection,
  selectedWorkflow,
  selectedInternalNode,
  artifactCacheByPath,
  selectedAgentTurnLiveState,
  selectedAgentLiveState,
  callableState,
  runtimeConfig,
  agentSessionState,
  onClose,
  onEnsureArtifactContent,
  onReadEvidence,
  onRefreshAgentSession,
  onPublishAgentOutput,
  onAnswerAgentInteraction,
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
}: WorkflowViewerNodeDetailOverlayProps) {
  if (!open || !isNodeDetailModel(model)) {
    return null;
  }

  const updateSelectedInput = (nextInput: Record<string, unknown>) => {
    if (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)) {
      onUpdateWorkflowInput(selectedWorkflow.id, nextInput);
    }
    if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
      onUpdateInternalInput(selectedWorkflow.id, selectedInternalNode.id, nextInput);
    }
  };

  const updateSelectedLabel = (label: string) => {
    if (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)) {
      onUpdateWorkflowLabel(selectedWorkflow.id, label);
    }
    if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
      onUpdateInternalLabel(selectedWorkflow.id, selectedInternalNode.id, label);
    }
  };

  const updateSelectedForwardMainOutput = (value: boolean) => {
    if (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)) {
      onUpdateWorkflowForwardMainOutput(selectedWorkflow.id, value);
    }
    if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
      onUpdateInternalForwardMainOutput(selectedWorkflow.id, selectedInternalNode.id, value);
    }
  };

  const updateSelectedEmptyInputPolicy = (value: EmptyInputPolicy) => {
    if (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)) {
      onUpdateWorkflowEmptyInputPolicy(selectedWorkflow.id, value);
    }
    if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
      onUpdateInternalEmptyInputPolicy(selectedWorkflow.id, selectedInternalNode.id, value);
    }
  };

  const updateSelectedCodexExecutionMode = (value: CodexExecutionMode) => {
    if (selection.type === 'workflow' && selectedWorkflow && isExecutableNodeWorkflow(selectedWorkflow)) {
      onUpdateWorkflowCodexExecutionMode(selectedWorkflow.id, value);
    }
    if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
      onUpdateInternalCodexExecutionMode(selectedWorkflow.id, selectedInternalNode.id, value);
    }
  };

  return (
    <NodeDetailOverlay model={model} onClose={onClose}>
      <SelectionInputPane
        model={model}
        artifactCacheByPath={artifactCacheByPath}
        onEnsureArtifactContent={onEnsureArtifactContent}
      />
      <SelectionPropertiesPane
        model={model}
        callableState={callableState}
        runtimeConfig={runtimeConfig}
        agentSessionState={agentSessionState}
        onReadEvidence={onReadEvidence}
        onRefreshAgentSession={onRefreshAgentSession}
        onPublishAgentOutput={onPublishAgentOutput}
        onAnswerAgentInteraction={onAnswerAgentInteraction}
        onUpdateInput={updateSelectedInput}
        onUpdateLabel={updateSelectedLabel}
        onUpdateForwardMainOutput={updateSelectedForwardMainOutput}
        onUpdateEmptyInputPolicy={updateSelectedEmptyInputPolicy}
        onUpdateCodexExecutionMode={updateSelectedCodexExecutionMode}
        onOpenCallableResource={onOpenCallableResource}
      />
      <SelectionOutputPane
        model={model}
        liveState={
          selectedAgentTurnLiveState.events.length ? selectedAgentTurnLiveState : selectedAgentLiveState
        }
        agentEventText={agentEventsLiveText(model.events)}
        artifactCacheByPath={artifactCacheByPath}
        onEnsureArtifactContent={onEnsureArtifactContent}
      />
    </NodeDetailOverlay>
  );
}
