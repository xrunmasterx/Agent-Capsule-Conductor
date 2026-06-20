import { describe, expect, test } from 'vitest';

import type { AssistantTurnStreamCallbacks } from './useAssistantStream';
import type { RunStreamCallbacks } from './useRunStream';
import type {
  AssistantChatMessage,
  CanvasAuthoringValidationResult,
  NodeLiveLogs,
  RunProjectionSlim,
  WorkflowStatus,
} from '../types/workbench';
import type { RunSummary } from '../types';

describe('stream hook shared type contracts', () => {
  test('run stream callback contracts accept shared workflow status and log types', () => {
    const status: WorkflowStatus = 'running';
    const logs: NodeLiveLogs = { stdout: 'out', stderr: '', stdoutOffset: 3, stderrOffset: 0 };
    const run: RunProjectionSlim = {
      runId: 'run_stream_1',
      taskId: 'task_canvas_default',
      status,
      pollState: 'polling',
    };
    const summary: RunSummary = {
      run_id: run.runId,
      status: 'success',
      run_dir: 'runs/run_stream_1',
      node_count: 0,
      failed_nodes: [],
      nodes: [],
    };
    const callbacks: RunStreamCallbacks = {
      appendNodeLogDeltas: () => undefined,
      appendRunAgentEvents: () => undefined,
      appendRunLiveEvents: () => undefined,
      applyRunSummary: () => undefined,
    };

    callbacks.applyRunSummary(run.runId, summary);
    expect(logs.stdoutOffset).toBe(3);
  });

  test('assistant stream callback contracts accept shared assistant message and validation types', () => {
    const message: AssistantChatMessage = { id: 'm1', role: 'assistant', content: 'done' };
    const validation: CanvasAuthoringValidationResult = {
      status: 'valid',
      errors: [],
      warnings: [],
    };
    const callbacks: AssistantTurnStreamCallbacks = {
      setAgentSession: () => undefined,
      setSessionStatus: () => undefined,
      setMessages: (messages) => {
        expect(messages[0]).toBe(message);
      },
      setEvents: () => undefined,
      setProposal: () => undefined,
      setBackendValidation: (value) => {
        expect(value).toBe(validation);
      },
      setRequiredActions: () => undefined,
      setPendingTurn: () => undefined,
      setBusy: () => undefined,
      addSystemMessage: () => undefined,
    };

    callbacks.setMessages([message]);
    callbacks.setBackendValidation(validation);
  });
});
