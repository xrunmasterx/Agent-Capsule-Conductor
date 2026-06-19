import { useCallback, type SetStateAction } from 'react';

import type {
  CodexExecutionMode,
  EmptyInputPolicy,
  WorkspaceCanvasModel,
} from '../types/workbench';
import { normalizedCodexExecutionMode } from '../workbench/model/taskModel';

export type UseInvocationSettingsActionsOptions = {
  updateCanvas: (next: SetStateAction<WorkspaceCanvasModel>) => void;
  updateCanvasAndGraph: (next: SetStateAction<WorkspaceCanvasModel>) => void;
};

export type UseInvocationSettingsActionsResult = {
  updateWorkflowInvocationInput: (workflowId: string, input: Record<string, unknown>) => void;
  updateInternalInvocationInput: (
    workflowId: string,
    nodeId: string,
    input: Record<string, unknown>,
  ) => void;
  updateWorkflowInvocationLabel: (workflowId: string, label: string) => void;
  updateInternalInvocationLabel: (workflowId: string, nodeId: string, label: string) => void;
  updateWorkflowForwardMainOutput: (workflowId: string, value: boolean) => void;
  updateInternalForwardMainOutput: (workflowId: string, nodeId: string, value: boolean) => void;
  updateWorkflowEmptyInputPolicy: (workflowId: string, value: EmptyInputPolicy) => void;
  updateInternalEmptyInputPolicy: (
    workflowId: string,
    nodeId: string,
    value: EmptyInputPolicy,
  ) => void;
  updateWorkflowCodexExecutionMode: (workflowId: string, value: CodexExecutionMode) => void;
  updateInternalCodexExecutionMode: (
    workflowId: string,
    nodeId: string,
    value: CodexExecutionMode,
  ) => void;
};

export function useInvocationSettingsActions({
  updateCanvas,
  updateCanvasAndGraph,
}: UseInvocationSettingsActionsOptions): UseInvocationSettingsActionsResult {
  const updateWorkflowInvocationInput = useCallback(
    (workflowId: string, input: Record<string, unknown>) => {
      updateCanvasAndGraph((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === workflowId ? { ...workflow, sourceInput: input } : workflow,
        ),
      }));
    },
    [updateCanvasAndGraph],
  );

  const updateInternalInvocationInput = useCallback(
    (workflowId: string, nodeId: string, input: Record<string, unknown>) => {
      updateCanvasAndGraph((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === workflowId
            ? {
                ...workflow,
                internalNodes: workflow.internalNodes.map((node) =>
                  node.id === nodeId ? { ...node, input } : node,
                ),
              }
            : workflow,
        ),
      }));
    },
    [updateCanvasAndGraph],
  );

  const updateWorkflowInvocationLabel = useCallback(
    (workflowId: string, label: string) => {
      const nextLabel = label.trim();
      updateCanvas((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === workflowId
            ? {
                ...workflow,
                invocationLabel: nextLabel || workflow.id,
                title: nextLabel || workflow.id,
              }
            : workflow,
        ),
      }));
    },
    [updateCanvas],
  );

  const updateInternalInvocationLabel = useCallback(
    (workflowId: string, nodeId: string, label: string) => {
      const nextLabel = label.trim();
      updateCanvas((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === workflowId
            ? {
                ...workflow,
                internalNodes: workflow.internalNodes.map((node) =>
                  node.id === nodeId
                    ? {
                        ...node,
                        invocationLabel: nextLabel || node.id,
                        name: nextLabel || node.id,
                      }
                    : node,
                ),
              }
            : workflow,
        ),
      }));
    },
    [updateCanvas],
  );

  const updateWorkflowForwardMainOutput = useCallback(
    (workflowId: string, value: boolean) => {
      updateCanvasAndGraph((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === workflowId ? { ...workflow, forwardMainOutputOnControl: value } : workflow,
        ),
      }));
    },
    [updateCanvasAndGraph],
  );

  const updateInternalForwardMainOutput = useCallback(
    (workflowId: string, nodeId: string, value: boolean) => {
      updateCanvasAndGraph((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === workflowId
            ? {
                ...workflow,
                internalNodes: workflow.internalNodes.map((node) =>
                  node.id === nodeId ? { ...node, forwardMainOutputOnControl: value } : node,
                ),
              }
            : workflow,
        ),
      }));
    },
    [updateCanvasAndGraph],
  );

  const updateWorkflowEmptyInputPolicy = useCallback(
    (workflowId: string, value: EmptyInputPolicy) => {
      updateCanvasAndGraph((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === workflowId ? { ...workflow, emptyInputPolicy: value } : workflow,
        ),
      }));
    },
    [updateCanvasAndGraph],
  );

  const updateInternalEmptyInputPolicy = useCallback(
    (workflowId: string, nodeId: string, value: EmptyInputPolicy) => {
      updateCanvasAndGraph((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === workflowId
            ? {
                ...workflow,
                internalNodes: workflow.internalNodes.map((node) =>
                  node.id === nodeId ? { ...node, emptyInputPolicy: value } : node,
                ),
              }
            : workflow,
        ),
      }));
    },
    [updateCanvasAndGraph],
  );

  const updateWorkflowCodexExecutionMode = useCallback(
    (workflowId: string, value: CodexExecutionMode) => {
      updateCanvasAndGraph((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === workflowId
            ? { ...workflow, codexExecutionMode: normalizedCodexExecutionMode(value) }
            : workflow,
        ),
      }));
    },
    [updateCanvasAndGraph],
  );

  const updateInternalCodexExecutionMode = useCallback(
    (workflowId: string, nodeId: string, value: CodexExecutionMode) => {
      updateCanvasAndGraph((current) => ({
        ...current,
        workflows: current.workflows.map((workflow) =>
          workflow.id === workflowId
            ? {
                ...workflow,
                internalNodes: workflow.internalNodes.map((node) =>
                  node.id === nodeId
                    ? { ...node, codexExecutionMode: normalizedCodexExecutionMode(value) }
                    : node,
                ),
              }
            : workflow,
        ),
      }));
    },
    [updateCanvasAndGraph],
  );

  return {
    updateWorkflowInvocationInput,
    updateInternalInvocationInput,
    updateWorkflowInvocationLabel,
    updateInternalInvocationLabel,
    updateWorkflowForwardMainOutput,
    updateInternalForwardMainOutput,
    updateWorkflowEmptyInputPolicy,
    updateInternalEmptyInputPolicy,
    updateWorkflowCodexExecutionMode,
    updateInternalCodexExecutionMode,
  };
}
