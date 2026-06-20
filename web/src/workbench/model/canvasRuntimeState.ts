import type { WorkflowStatus } from '../../types/workbench';

type RuntimeStateInternalNode = {
  id: string;
  status: WorkflowStatus;
};

type RuntimeStateWorkflow<TNode extends RuntimeStateInternalNode = RuntimeStateInternalNode> = {
  id: string;
  status: WorkflowStatus;
  internalNodes: TNode[];
};

type RuntimeStateCanvas<TWorkflow extends RuntimeStateWorkflow = RuntimeStateWorkflow> = {
  workflows: TWorkflow[];
};

export function stripRuntimeStateFromCanvas<TCanvas extends RuntimeStateCanvas>(canvas: TCanvas): TCanvas {
  return {
    ...canvas,
    workflows: canvas.workflows.map(stripRuntimeStateFromWorkflow),
  } as TCanvas;
}

export function stripRuntimeStateFromWorkflow<TWorkflow extends RuntimeStateWorkflow>(
  workflow: TWorkflow,
): TWorkflow {
  return {
    ...workflow,
    status: 'not_run',
    internalNodes: workflow.internalNodes.map((node) => ({ ...node, status: 'not_run' })),
  };
}
