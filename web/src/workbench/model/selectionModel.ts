import type { InternalNodeView, WorkflowContainerModel } from '../../types/workbench';

export function promptFromInvocationInput(input: Record<string, unknown>): string {
  const prompt = input.user_prompt ?? input.prompt ?? input.topic;
  return typeof prompt === 'string' ? prompt : '';
}

export function staticInputFromInvocationInput(input: Record<string, unknown>): Record<string, unknown> {
  const { user_prompt: _userPrompt, prompt: _prompt, topic: _topic, ...staticInput } = input;
  return staticInput;
}

export function workflowInvocationLabel(workflow: WorkflowContainerModel): string {
  return workflow.invocationLabel || workflow.title || workflow.id;
}

export function internalInvocationLabel(node: InternalNodeView): string {
  return node.invocationLabel || node.name || node.id;
}

export function isExecutableNodeWorkflow(workflow: WorkflowContainerModel): boolean {
  if (workflow.boundaryKind) {
    return false;
  }
  if (workflow.sourceKind === 'workflow') {
    return false;
  }
  if (workflow.sourceKind && workflow.sourceKind !== 'workflow') {
    return true;
  }
  return false;
}

export function shouldDisconnectEdgeOnClick(event: { altKey: boolean; button: number }): boolean {
  return event.altKey && event.button === 0;
}
