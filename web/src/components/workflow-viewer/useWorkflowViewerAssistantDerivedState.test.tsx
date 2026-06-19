import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type {
  AssistantApplyUndoToken,
  CanvasAuthoringProposal,
  WorkspaceCanvasModel,
} from '../../types/workbench';
import { canvasAuthoringHash } from '../../workbench/model/authoringProposal';
import { useWorkflowViewerAssistantDerivedState } from './useWorkflowViewerAssistantDerivedState';

function canvas(): WorkspaceCanvasModel {
  return {
    id: 'task_canvas',
    name: 'Task Canvas',
    rootWorkflowId: 'task_canvas',
    workflows: [],
    edges: [],
  };
}

function proposal(baseCanvasHash: string): CanvasAuthoringProposal {
  return {
    proposal_id: 'proposal_1',
    base_task_id: 'task_1',
    base_canvas_hash: baseCanvasHash,
    target: { kind: 'task_canvas', task_id: 'task_1' },
    rationale: 'test',
    operations: [],
  };
}

function undoToken(afterCanvasHash: string): AssistantApplyUndoToken {
  const currentCanvas = canvas();
  return {
    proposalId: 'proposal_1',
    taskId: 'task_1',
    beforeCanvas: currentCanvas,
    beforeTemporaryResources: {},
    beforeSelection: { type: 'task_canvas', taskId: 'task_1' },
    afterCanvasHash,
    affectedSelection: { type: 'task_canvas', taskId: 'task_1' },
  };
}

describe('useWorkflowViewerAssistantDerivedState', () => {
  test('computes current canvas hash and merged assistant validation', () => {
    const currentCanvas = canvas();
    const staleProposal = proposal('stale_hash');
    const { result } = renderHook(() =>
      useWorkflowViewerAssistantDerivedState({
        activeTaskId: 'task_1',
        canvas: currentCanvas,
        temporaryResources: {},
        callables: [],
        workflows: [],
        assistantProposal: staleProposal,
        assistantBackendValidation: { status: 'valid', errors: [], warnings: ['backend warning'] },
        assistantApplyUndo: null,
        isRunning: false,
        hasAssistantPendingTurn: false,
        setAssistantProposal: vi.fn(),
      }),
    );

    expect(result.current.currentAuthoringCanvasHash).toBe(canvasAuthoringHash('task_1', currentCanvas));
    expect(result.current.assistantValidation?.status).toBe('invalid');
    expect(result.current.assistantValidation?.warnings).toContain('backend warning');
    expect(result.current.assistantValidation?.errors.length).toBeGreaterThan(0);
  });

  test('allows undo only for matching completed assistant apply state', () => {
    const currentCanvas = canvas();
    const currentHash = canvasAuthoringHash('task_1', currentCanvas);
    const { result, rerender } = renderHook(
      ({ isRunning, hasAssistantPendingTurn }) =>
        useWorkflowViewerAssistantDerivedState({
          activeTaskId: 'task_1',
          canvas: currentCanvas,
          temporaryResources: {},
          callables: [],
          workflows: [],
          assistantProposal: null,
          assistantBackendValidation: null,
          assistantApplyUndo: undoToken(currentHash),
          isRunning,
          hasAssistantPendingTurn,
          setAssistantProposal: vi.fn(),
        }),
      { initialProps: { isRunning: false, hasAssistantPendingTurn: false } },
    );

    expect(result.current.canUndoAssistantApply).toBe(true);

    rerender({ isRunning: true, hasAssistantPendingTurn: false });
    expect(result.current.canUndoAssistantApply).toBe(false);

    rerender({ isRunning: false, hasAssistantPendingTurn: true });
    expect(result.current.canUndoAssistantApply).toBe(false);
  });

  test('clears assistant proposal through the provided store setter', () => {
    const setAssistantProposal = vi.fn();
    const { result } = renderHook(() =>
      useWorkflowViewerAssistantDerivedState({
        activeTaskId: 'task_1',
        canvas: canvas(),
        temporaryResources: {},
        callables: [],
        workflows: [],
        assistantProposal: null,
        assistantBackendValidation: null,
        assistantApplyUndo: null,
        isRunning: false,
        hasAssistantPendingTurn: false,
        setAssistantProposal,
      }),
    );

    result.current.clearAssistantProposal();

    expect(setAssistantProposal).toHaveBeenCalledWith(null);
  });
});
