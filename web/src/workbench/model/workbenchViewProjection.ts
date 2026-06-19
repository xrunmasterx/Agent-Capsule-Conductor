import type {
  BottomDockMode,
  CanvasSelection,
  InternalNodeView,
  TaskWorkspaceView,
  WorkbenchChromeState,
  WorkflowContainerModel,
} from '../../types/workbench';
import { internalInvocationLabel, workflowInvocationLabel } from './selectionModel';
import { isExecutableNodeWorkflow } from './workflowNodeModel';

export type WorkbenchViewProjection = {
  blueprintActive: boolean;
  rightPanelVisible: boolean;
  resourceDetailOpen: boolean;
  inspectorOpen: boolean;
  assistantOpen: boolean;
  detailsOpen: boolean;
};

export function workbenchViewProjection({
  taskWorkspaceView,
  chrome,
  bottomDockMode,
  evidenceDockOpen,
}: {
  taskWorkspaceView: TaskWorkspaceView;
  chrome: WorkbenchChromeState;
  bottomDockMode: BottomDockMode;
  evidenceDockOpen: boolean;
}): WorkbenchViewProjection {
  const blueprintActive = taskWorkspaceView === 'blueprint';
  return {
    blueprintActive,
    rightPanelVisible: blueprintActive && chrome.rightPanel !== 'none' && chrome.rightPanel !== 'assistant',
    resourceDetailOpen: blueprintActive && chrome.rightPanel === 'resourceDetail',
    inspectorOpen: blueprintActive && chrome.rightPanel === 'inspector',
    assistantOpen: blueprintActive && bottomDockMode === 'assistant' && evidenceDockOpen,
    detailsOpen: blueprintActive && bottomDockMode === 'evidence' && evidenceDockOpen,
  };
}

export function authoringSelectionLabel(
  selection: CanvasSelection,
  selectedWorkflow?: WorkflowContainerModel,
  selectedInternalNode?: InternalNodeView,
): string {
  if (selection.type === 'workflow' && selectedWorkflow) {
    return isExecutableNodeWorkflow(selectedWorkflow)
      ? `节点: ${workflowInvocationLabel(selectedWorkflow)}`
      : `Workflow: ${workflowInvocationLabel(selectedWorkflow)}`;
  }
  if (selection.type === 'internal' && selectedWorkflow && selectedInternalNode) {
    return `内部节点: ${workflowInvocationLabel(selectedWorkflow)} / ${internalInvocationLabel(selectedInternalNode)}`;
  }
  if (selection.type === 'edge') {
    return `连线: ${selection.scopeWorkflowId || 'root'} / ${selection.id}`;
  }
  if (selection.type === 'port') {
    return `端口: ${selection.workflowId}.${selection.portId}`;
  }
  return '当前任务画布';
}
