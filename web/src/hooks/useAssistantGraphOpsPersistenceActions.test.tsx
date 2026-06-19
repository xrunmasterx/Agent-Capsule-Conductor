import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useRef, useState } from 'react';

import type {
  AuthoringRequiredAction,
  GraphOpsApplyManifest,
  GraphOpsDryRunPayload,
  GraphOpsTransactionProposal,
  WorkflowGraph,
} from '../types';
import type {
  AssistantChatMessage,
  AssistantGraphOpsReview,
  TemporaryResourceDraft,
  WorkbenchTask,
  WorkspaceCanvasModel,
} from '../types/workbench';
import { emptyWorkspaceCanvas } from '../workbench/model/taskModel';
import { canvasToWorkflowGraph } from '../workbench/model/workflowGraphProjection';
import type { UseGraphOpsPersistenceResult } from './useGraphOpsPersistence';
import {
  useAssistantGraphOpsPersistenceActions,
  type UseAssistantGraphOpsPersistenceActionsResult,
} from './useAssistantGraphOpsPersistenceActions';

const { authoringIdMock } = vi.hoisted(() => ({
  authoringIdMock: vi.fn((prefix: string) => `${prefix}_mock`),
}));

vi.mock('../components/authoring/authoringRuntime', () => ({
  authoringId: authoringIdMock,
}));

let latestActions: UseAssistantGraphOpsPersistenceActionsResult | null = null;
let latestCanvas: WorkspaceCanvasModel | null = null;
let latestSourceGraph: WorkflowGraph | null = null;
let latestGraphRefCurrent: WorkflowGraph | null = null;
let latestTasks: WorkbenchTask[] = [];
let latestRequiredActions: AuthoringRequiredAction[] = [];
let latestReview: AssistantGraphOpsReview | null = null;
let latestMessages: AssistantChatMessage[] = [];
let latestBusy = false;
let latestMessage = '';

const graphOps: UseGraphOpsPersistenceResult = {
  createGraphOpsProposalRequest: vi.fn(),
  validateGraphOpsProposalRequest: vi.fn(),
  dryRunGraphOpsProposalRequest: vi.fn(),
  approveGraphOpsProposalRequest: vi.fn(),
  applyGraphOpsProposalRequest: vi.fn(),
};
const onChanged = vi.fn();

function temporaryDraft(id: string, callableId = 'agent_final'): TemporaryResourceDraft {
  return {
    draft_id: id,
    kind: 'agent_template',
    status: 'draft',
    agent_draft: { id: callableId, name: 'Final Agent' },
    referenced_by: ['workflow_1'],
  };
}

function canvasWithTemporaryWorkflow(resourceId: string): WorkspaceCanvasModel {
  return {
    ...emptyWorkspaceCanvas('task_1', 'Task Canvas'),
    workflows: [
      {
        id: 'workflow_1',
        title: 'Temporary Agent',
        directory: 'workflows/tmp',
        status: 'not_run',
        callableId: resourceId,
        temporaryResourceId: resourceId,
        inputPorts: [],
        outputPorts: [],
        internalNodes: [],
        internalEdges: [],
        position: { x: 0, y: 0 },
        size: { width: 320, height: 200 },
        warnings: ['temporary resource'],
      },
    ],
  };
}

function transaction(): GraphOpsTransactionProposal {
  return {
    schema_version: 'acc.graphops.transaction.v1',
    proposal_id: 'proposal_1',
    author: 'workbench_ai_assistant',
    base: {
      content_hashes: {
        'callables/agents/agent_final.yaml': 'absent',
      },
    },
    rationale: 'Persist temporary agent template.',
    targets: [],
  };
}

function dryRun(): GraphOpsDryRunPayload {
  return {
    status: 'valid',
    proposal_id: 'proposal_1',
    mutated: true,
    target_paths: ['callables/agents/agent_final.yaml'],
    dry_run_digest: 'digest_1',
  };
}

function manifest(): GraphOpsApplyManifest {
  return {
    status: 'applied',
    proposal_id: 'proposal_1',
    created_files: ['callables/agents/agent_final.yaml'],
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
  canvas = canvasWithTemporaryWorkflow('draft_1'),
  temporaryResources = { draft_1: temporaryDraft('draft_1') },
  requiredActions = [
    { kind: 'approve_resource_persistence', resource_draft_id: 'draft_1' },
    { kind: 'approve_resource_persistence', resource_draft_id: 'draft_other' },
  ],
}: {
  canvas?: WorkspaceCanvasModel;
  temporaryResources?: Record<string, TemporaryResourceDraft>;
  requiredActions?: AuthoringRequiredAction[];
}) {
  const [currentCanvas, setCanvas] = useState(canvas);
  const [sourceGraph, setSourceGraph] = useState<WorkflowGraph>(() => canvasToWorkflowGraph(canvas));
  const graphRef = useRef<WorkflowGraph>(canvasToWorkflowGraph(canvas));
  const [tasks, setTasks] = useState<WorkbenchTask[]>([taskForCanvas(canvas, temporaryResources)]);
  const [actions, setActions] = useState<AuthoringRequiredAction[]>(requiredActions);
  const [review, setReview] = useState<AssistantGraphOpsReview | null>(null);
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  latestActions = useAssistantGraphOpsPersistenceActions({
    activeTaskId: 'task_1',
    canvas: currentCanvas,
    temporaryResources,
    graphRef,
    graphOps,
    setSourceGraph,
    setCanvas,
    setTasks,
    setAssistantRequiredActions: setActions,
    setAssistantGraphOpsReview: setReview,
    setAssistantMessages: setMessages,
    setAssistantBusy: setBusy,
    setMessage,
    onChanged,
  });
  latestCanvas = currentCanvas;
  latestSourceGraph = sourceGraph;
  latestGraphRefCurrent = graphRef.current;
  latestTasks = tasks;
  latestRequiredActions = actions;
  latestReview = review;
  latestMessages = messages;
  latestBusy = busy;
  latestMessage = message;

  return <output>{message}</output>;
}

describe('useAssistantGraphOpsPersistenceActions', () => {
  afterEach(() => {
    latestActions = null;
    latestCanvas = null;
    latestSourceGraph = null;
    latestGraphRefCurrent = null;
    latestTasks = [];
    latestRequiredActions = [];
    latestReview = null;
    latestMessages = [];
    latestBusy = false;
    latestMessage = '';
    onChanged.mockClear();
    vi.clearAllMocks();
  });

  test('creates a GraphOps dry-run review for a temporary resource', async () => {
    vi.mocked(graphOps.createGraphOpsProposalRequest).mockResolvedValue({
      proposal_id: 'ignored',
      status: 'created',
      proposal: transaction(),
    });
    vi.mocked(graphOps.validateGraphOpsProposalRequest).mockResolvedValue({ status: 'valid' });
    vi.mocked(graphOps.dryRunGraphOpsProposalRequest).mockResolvedValue(dryRun());
    render(<Harness />);

    await act(async () => {
      await latestActions?.persistTemporaryResourceDraft('draft_1');
    });

    const submittedProposal = vi.mocked(graphOps.createGraphOpsProposalRequest).mock.calls[0][0];
    expect(submittedProposal.targets[0]).toMatchObject({
      target_type: 'agent_class',
      target_path: 'callables/agents/agent_final.yaml',
    });
    expect(graphOps.validateGraphOpsProposalRequest).toHaveBeenCalledWith(submittedProposal.proposal_id);
    expect(graphOps.dryRunGraphOpsProposalRequest).toHaveBeenCalledWith(submittedProposal.proposal_id);
    expect(latestReview).toMatchObject({
      resourceDraftId: 'draft_1',
      callableId: 'agent_final',
      validation: { status: 'valid' },
      dryRun: { target_paths: ['callables/agents/agent_final.yaml'] },
    });
    expect(latestBusy).toBe(false);
    expect(latestMessage).toBe(`GraphOps proposal 已预览: ${submittedProposal.proposal_id}`);
    expect(latestMessages.at(-1)?.content).toContain('请检查预览后再批准写入。');
  });

  test('reports a missing temporary resource without calling GraphOps APIs', async () => {
    render(<Harness temporaryResources={{}} />);

    await act(async () => {
      await latestActions?.persistTemporaryResourceDraft('missing_draft');
    });

    expect(graphOps.createGraphOpsProposalRequest).not.toHaveBeenCalled();
    expect(latestMessage).toBe('临时资源不存在或已丢弃: missing_draft');
    expect(latestMessages).toContainEqual(
      expect.objectContaining({ role: 'system', content: '临时资源不存在或已丢弃: missing_draft' }),
    );
  });

  test('records validation failures as assistant system messages', async () => {
    vi.mocked(graphOps.createGraphOpsProposalRequest).mockResolvedValue({
      proposal_id: 'proposal_1',
      status: 'created',
      proposal: transaction(),
    });
    vi.mocked(graphOps.validateGraphOpsProposalRequest).mockResolvedValue({
      status: 'invalid',
      errors: ['bad proposal'],
    });
    render(<Harness />);

    await act(async () => {
      await latestActions?.persistTemporaryResourceDraft('draft_1');
    });

    expect(graphOps.dryRunGraphOpsProposalRequest).not.toHaveBeenCalled();
    expect(latestReview).toBeNull();
    expect(latestBusy).toBe(false);
    expect(latestMessage).toContain('GraphOps validate failed');
    expect(latestMessages.at(-1)?.content).toContain('bad proposal');
  });

  test('applies an approved GraphOps review and replaces temporary callable references', async () => {
    vi.mocked(graphOps.approveGraphOpsProposalRequest).mockResolvedValue({ status: 'approved' });
    vi.mocked(graphOps.applyGraphOpsProposalRequest).mockResolvedValue(manifest());
    const draft = temporaryDraft('draft_1');
    const review: AssistantGraphOpsReview = {
      resourceDraftId: 'draft_1',
      callableId: 'agent_final',
      proposal: transaction(),
      validation: { status: 'valid' },
      dryRun: dryRun(),
    };
    render(<Harness temporaryResources={{ draft_1: draft }} />);

    await act(async () => {
      await latestActions?.applyGraphOpsPersistenceReview(review);
    });

    expect(graphOps.approveGraphOpsProposalRequest).toHaveBeenCalledWith('proposal_1', {
      target_paths: ['callables/agents/agent_final.yaml'],
      base_hashes: { 'callables/agents/agent_final.yaml': 'absent' },
      dry_run_digest: 'digest_1',
    });
    expect(graphOps.applyGraphOpsProposalRequest).toHaveBeenCalledWith('proposal_1');
    expect(latestCanvas?.workflows[0]).toMatchObject({
      callableId: 'agent_final',
      sourceKind: 'agent_session',
      warnings: [],
    });
    expect(latestCanvas?.workflows[0].temporaryResourceId).toBeUndefined();
    expect(latestSourceGraph?.nodes[0].callable_ref.id).toBe('agent_final');
    expect(latestGraphRefCurrent?.nodes[0].callable_ref.id).toBe('agent_final');
    expect(latestTasks[0].authoring?.temporaryResources.draft_1.status).toBe('discarded');
    expect(latestRequiredActions).toEqual([
      { kind: 'approve_resource_persistence', resource_draft_id: 'draft_other' },
    ]);
    expect(latestReview).toBeNull();
    expect(latestMessage).toBe('已保存临时资源为 agent_final');
    expect(latestMessages.at(-1)?.content).toContain('GraphOps 已持久化 agent_final');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
