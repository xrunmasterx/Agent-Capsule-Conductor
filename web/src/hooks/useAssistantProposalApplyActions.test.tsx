import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useRef, useState } from 'react';

import type { AuthoringRequiredAction, WorkflowGraph } from '../types';
import type {
  AssistantApplyUndoToken,
  AssistantChatMessage,
  CanvasAuthoringApplyResult,
  CanvasAuthoringProposal,
  CanvasAuthoringValidationResult,
  CanvasSelection,
  TemporaryResourceDraft,
  WorkbenchTask,
  WorkspaceCanvasModel,
} from '../types/workbench';
import { emptyWorkspaceCanvas } from '../workbench/model/taskModel';
import { canvasAuthoringHash } from '../workbench/model/authoringProposal';
import { canvasToWorkflowGraph } from '../workbench/model/workflowGraphProjection';
import {
  useAssistantProposalApplyActions,
  type UseAssistantProposalApplyActionsResult,
} from './useAssistantProposalApplyActions';

const {
  applyCanvasAuthoringProposalMock,
  authoringIdMock,
} = vi.hoisted(() => ({
  applyCanvasAuthoringProposalMock: vi.fn(),
  authoringIdMock: vi.fn((prefix: string) => `${prefix}_mock`),
}));

vi.mock('../components/authoring/authoringRuntime', () => ({
  applyCanvasAuthoringProposal: applyCanvasAuthoringProposalMock,
  authoringId: authoringIdMock,
}));

let latestActions: UseAssistantProposalApplyActionsResult | null = null;
let latestCanvas: WorkspaceCanvasModel | null = null;
let latestSourceGraph: WorkflowGraph | null = null;
let latestGraphRefCurrent: WorkflowGraph | null = null;
let latestTasks: WorkbenchTask[] = [];
let latestSelection: CanvasSelection | null = null;
let latestUndo: AssistantApplyUndoToken | null = null;
let latestProposal: CanvasAuthoringProposal | null = null;
let latestBackendValidation: CanvasAuthoringValidationResult | null = null;
let latestRequiredActions: AuthoringRequiredAction[] = [];
let latestMessages: AssistantChatMessage[] = [];
let latestMessage = '';

function namedCanvas(name: string): WorkspaceCanvasModel {
  return {
    ...emptyWorkspaceCanvas('task_1', name),
    workflows: [
      {
        id: 'workflow_1',
        title: 'Workflow 1',
        directory: 'workflows/workflow_1',
        status: 'not_run',
        inputPorts: [],
        outputPorts: [],
        internalNodes: [],
        internalEdges: [],
        position: { x: 0, y: 0 },
        size: { width: 320, height: 200 },
        warnings: [],
      },
    ],
  };
}

function temporaryDraft(id: string): TemporaryResourceDraft {
  return {
    draft_id: id,
    kind: 'agent_template',
    status: 'draft',
    agent_draft: { id: `agent_${id}` },
    referenced_by: [],
  };
}

function proposal(id = 'proposal_1'): CanvasAuthoringProposal {
  return {
    proposal_id: id,
    base_task_id: 'task_1',
    base_canvas_hash: 'hash_before',
    target: { kind: 'task_canvas', task_id: 'task_1' },
    rationale: 'revise canvas',
    operations: [],
  };
}

function taskForCanvas(canvas: WorkspaceCanvasModel, temporaryResources: Record<string, TemporaryResourceDraft>): WorkbenchTask {
  return {
    taskId: 'task_1',
    title: canvas.name,
    canvas,
    authoring: { temporaryResources },
    status: 'not_run',
  };
}

function Harness({
  initialCanvas = namedCanvas('Before'),
  initialProposal = proposal(),
  initialUndo = null,
  canUndoAssistantApply = false,
  temporaryResources = {},
  requiredActions = [],
  initialSelection = { type: 'task_canvas', taskId: 'task_1' } as CanvasSelection,
}: {
  initialCanvas?: WorkspaceCanvasModel;
  initialProposal?: CanvasAuthoringProposal | null;
  initialUndo?: AssistantApplyUndoToken | null;
  canUndoAssistantApply?: boolean;
  temporaryResources?: Record<string, TemporaryResourceDraft>;
  requiredActions?: AuthoringRequiredAction[];
  initialSelection?: CanvasSelection;
}) {
  const [canvas, setCanvas] = useState(initialCanvas);
  const [sourceGraph, setSourceGraph] = useState<WorkflowGraph>(() => canvasToWorkflowGraph(initialCanvas));
  const graphRef = useRef<WorkflowGraph>(canvasToWorkflowGraph(initialCanvas));
  const [tasks, setTasks] = useState<WorkbenchTask[]>([taskForCanvas(initialCanvas, temporaryResources)]);
  const [selection, setSelection] = useState<CanvasSelection>(initialSelection);
  const [undo, setUndo] = useState<AssistantApplyUndoToken | null>(initialUndo);
  const [currentProposal, setCurrentProposal] = useState<CanvasAuthoringProposal | null>(initialProposal);
  const [backendValidation, setBackendValidation] = useState<CanvasAuthoringValidationResult | null>({
    status: 'invalid',
    errors: ['stale validation'],
    warnings: [],
  });
  const [actions, setActions] = useState<AuthoringRequiredAction[]>(requiredActions);
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [message, setMessage] = useState('');

  latestActions = useAssistantProposalApplyActions({
    activeTaskId: 'task_1',
    canvas,
    selection,
    assistantProposal: currentProposal,
    assistantApplyUndo: undo,
    canUndoAssistantApply,
    temporaryResources,
    callables: [],
    workflows: [],
    graphRef,
    setSourceGraph,
    setCanvas,
    setTasks,
    setSelection,
    setAssistantApplyUndo: setUndo,
    setAssistantProposal: setCurrentProposal,
    setAssistantBackendValidation: setBackendValidation,
    setAssistantRequiredActions: setActions,
    setAssistantMessages: setMessages,
    setMessage,
  });
  latestCanvas = canvas;
  latestSourceGraph = sourceGraph;
  latestGraphRefCurrent = graphRef.current;
  latestTasks = tasks;
  latestSelection = selection;
  latestUndo = undo;
  latestProposal = currentProposal;
  latestBackendValidation = backendValidation;
  latestRequiredActions = actions;
  latestMessages = messages;
  latestMessage = message;

  return <output>{message}</output>;
}

describe('useAssistantProposalApplyActions', () => {
  afterEach(() => {
    latestActions = null;
    latestCanvas = null;
    latestSourceGraph = null;
    latestGraphRefCurrent = null;
    latestTasks = [];
    latestSelection = null;
    latestUndo = null;
    latestProposal = null;
    latestBackendValidation = null;
    latestRequiredActions = [];
    latestMessages = [];
    latestMessage = '';
    vi.clearAllMocks();
  });

  test('applies a proposal and keeps only still-valid persistence actions', () => {
    const beforeCanvas = namedCanvas('Before');
    const afterCanvas = namedCanvas('After');
    const draftKeep = temporaryDraft('draft_keep');
    const draftDrop = temporaryDraft('draft_drop');
    const selectionAfter: CanvasSelection = { type: 'workflow', id: 'workflow_1' };
    applyCanvasAuthoringProposalMock.mockReturnValue({
      canvas: afterCanvas,
      temporaryResources: { draft_keep: draftKeep },
      selection: selectionAfter,
      messages: ['applied proposal'],
    } satisfies CanvasAuthoringApplyResult);

    render(
      <Harness
        initialCanvas={beforeCanvas}
        temporaryResources={{ draft_keep: draftKeep, draft_drop: draftDrop }}
        requiredActions={[
          { kind: 'approve_resource_persistence', resource_draft_id: 'draft_keep' },
          { kind: 'approve_resource_persistence', resource_draft_id: 'draft_drop' },
          { kind: 'confirm_canvas_apply' },
        ]}
      />,
    );

    act(() => {
      latestActions?.applyAssistantProposal();
    });

    expect(applyCanvasAuthoringProposalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas: beforeCanvas,
        taskId: 'task_1',
        temporaryResources: { draft_keep: draftKeep, draft_drop: draftDrop },
      }),
    );
    expect(latestCanvas?.name).toBe('After');
    expect(latestSourceGraph?.name).toBe('After');
    expect(latestGraphRefCurrent?.name).toBe('After');
    expect(latestTasks[0]).toMatchObject({
      title: 'After',
      canvas: { name: 'After' },
      authoring: { temporaryResources: { draft_keep: draftKeep } },
    });
    expect(latestSelection).toEqual(selectionAfter);
    expect(latestUndo).toMatchObject({
      proposalId: 'proposal_1',
      taskId: 'task_1',
      beforeCanvas: { name: 'Before' },
      beforeTemporaryResources: { draft_keep: draftKeep, draft_drop: draftDrop },
      beforeSelection: { type: 'task_canvas', taskId: 'task_1' },
      affectedSelection: selectionAfter,
      afterCanvasHash: canvasAuthoringHash('task_1', afterCanvas),
    });
    expect(latestProposal).toBeNull();
    expect(latestBackendValidation).toBeNull();
    expect(latestRequiredActions).toEqual([
      { kind: 'approve_resource_persistence', resource_draft_id: 'draft_keep' },
    ]);
    expect(latestMessage).toBe('applied proposal');
    expect(latestMessages).toContainEqual(
      expect.objectContaining({ id: 'assistant_msg_mock', role: 'system', content: 'applied proposal' }),
    );
  });

  test('does nothing when there is no proposal to apply', () => {
    render(<Harness initialProposal={null} />);

    act(() => {
      latestActions?.applyAssistantProposal();
    });

    expect(applyCanvasAuthoringProposalMock).not.toHaveBeenCalled();
    expect(latestCanvas?.name).toBe('Before');
    expect(latestMessage).toBe('');
  });

  test('restores the previous canvas snapshot on undo', () => {
    const beforeCanvas = namedCanvas('Before');
    const afterCanvas = namedCanvas('After');
    const beforeTemporaryResources = { draft_before: temporaryDraft('draft_before') };
    const beforeSelection: CanvasSelection = { type: 'workflow', id: 'workflow_1' };
    render(
      <Harness
        initialCanvas={afterCanvas}
        initialUndo={{
          proposalId: 'proposal_1',
          taskId: 'task_1',
          beforeCanvas,
          beforeTemporaryResources,
          beforeSelection,
          afterCanvasHash: canvasAuthoringHash('task_1', afterCanvas),
          affectedSelection: { type: 'task_canvas', taskId: 'task_1' },
        }}
        canUndoAssistantApply
      />,
    );

    act(() => {
      latestActions?.undoLastAssistantApply();
    });

    expect(latestCanvas?.name).toBe('Before');
    expect(latestSourceGraph?.name).toBe('Before');
    expect(latestGraphRefCurrent?.name).toBe('Before');
    expect(latestTasks[0]).toMatchObject({
      title: 'Before',
      canvas: { name: 'Before' },
      authoring: { temporaryResources: beforeTemporaryResources },
    });
    expect(latestSelection).toEqual(beforeSelection);
    expect(latestUndo).toBeNull();
    expect(latestMessage).toBe('已撤回上一次 AI 应用到画布的修改。');
    expect(latestMessages).toContainEqual(
      expect.objectContaining({ role: 'system', content: '已撤回上一次 AI 应用到画布的修改。' }),
    );
  });

  test('discard clears pending proposal state without changing the canvas', () => {
    render(
      <Harness
        requiredActions={[
          { kind: 'approve_resource_persistence', resource_draft_id: 'draft_keep' },
        ]}
      />,
    );

    act(() => {
      latestActions?.discardAssistantProposal();
    });

    expect(latestCanvas?.name).toBe('Before');
    expect(latestProposal).toBeNull();
    expect(latestBackendValidation).toBeNull();
    expect(latestRequiredActions).toEqual([]);
    expect(latestMessage).toBe('');
    expect(latestMessages).toContainEqual(
      expect.objectContaining({ role: 'system', content: '已丢弃当前 proposal。' }),
    );
  });
});
