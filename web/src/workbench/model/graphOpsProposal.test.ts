import { describe, expect, test } from 'vitest';

import type { TemporaryResourceDraft } from '../../types/workbench';
import {
  graphOpsProposalId,
  graphOpsTransactionForTemporaryAgent,
  isTemporaryCallableId,
  persistentCallableIdForDraft,
} from './graphOpsProposal';

function temporaryDraft(overrides: Partial<TemporaryResourceDraft> = {}): TemporaryResourceDraft {
  return {
    draft_id: 'tmp_agent_researcher',
    kind: 'agent_template',
    status: 'draft',
    agent_draft: {
      id: 'Stock Researcher',
      version: '0.1.0',
      runtime: 'codex_cli',
      name: 'Stock Researcher',
      description: 'Draft agent',
      default_prompt: 'Analyze the company.',
    },
    referenced_by: ['node_a'],
    ...overrides,
  };
}

describe('graphOpsProposal', () => {
  test('sanitizes proposal ids from injected id factories', () => {
    expect(graphOpsProposalId('graphops_tx', (prefix) => `${prefix}:bad id/with spaces`)).toBe(
      'graphops_tx_bad_id_with_spaces',
    );
  });

  test('derives safe persistent callable ids from temporary drafts', () => {
    expect(persistentCallableIdForDraft(temporaryDraft())).toBe('Stock-Researcher');
    expect(
      persistentCallableIdForDraft(
        temporaryDraft({
          draft_id: 'tmp_agent_empty',
          agent_draft: {
            id: ' / ',
            name: 'Empty',
            runtime: 'codex_cli',
          },
        }),
      ),
    ).toBe('agentempty');
  });

  test('builds GraphOps create-agent transaction for a temporary resource', () => {
    const transaction = graphOpsTransactionForTemporaryAgent(temporaryDraft(), {
      idFactory: (prefix) => `${prefix}_fixed`,
    });

    expect(transaction).toMatchObject({
      schema_version: 'acc.graphops.transaction.v1',
      proposal_id: 'graphops_tx_tmp_agent_fixed',
      author: 'workbench_ai_assistant',
      source: {
        kind: 'workbench_temporary_resource',
        id: 'tmp_agent_researcher',
      },
      base: {
        content_hashes: {
          'callables/agents/Stock-Researcher.yaml': 'absent',
        },
      },
      targets: [
        {
          target_type: 'agent_class',
          target_path: 'callables/agents/Stock-Researcher.yaml',
          operation: 'create_agent_class',
          template: {
            id: 'Stock-Researcher',
            name: 'Stock Researcher',
          },
        },
      ],
    });
  });

  test('identifies workbench temporary callable ids', () => {
    expect(isTemporaryCallableId('tmp_agent_123')).toBe(true);
    expect(isTemporaryCallableId('stock-researcher.codex')).toBe(false);
    expect(isTemporaryCallableId(undefined)).toBe(false);
  });
});
