import type { GraphOpsTransactionProposal } from '../../types';
import type { TemporaryResourceDraft } from '../../types/workbench';
import { TEMPORARY_CALLABLE_ID_PREFIX } from '../constants';

export type GraphOpsProposalIdFactory = (prefix: string) => string;

export function graphOpsProposalId(
  prefix = 'graphops_tx',
  idFactory: GraphOpsProposalIdFactory = defaultGraphOpsProposalIdFactory,
): string {
  return idFactory(prefix).replace(/[^A-Za-z0-9_.-]/gu, '_');
}

export function persistentCallableIdForDraft(draft: TemporaryResourceDraft): string {
  const requestedId = draft.agent_draft.id || draft.draft_id.replace(/^tmp_agent_/, 'agent_');
  const safeId = requestedId
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return safeId || draft.draft_id.replace(/^tmp_agent_/, 'agent');
}

export function graphOpsTransactionForTemporaryAgent(
  draft: TemporaryResourceDraft,
  options: { idFactory?: GraphOpsProposalIdFactory } = {},
): GraphOpsTransactionProposal {
  const callableId = persistentCallableIdForDraft(draft);
  const targetPath = `callables/agents/${callableId}.yaml`;
  return {
    schema_version: 'acc.graphops.transaction.v1',
    proposal_id: graphOpsProposalId('graphops_tx_tmp_agent', options.idFactory),
    author: 'workbench_ai_assistant',
    source: {
      kind: 'workbench_temporary_resource',
      id: draft.draft_id,
    },
    base: {
      content_hashes: {
        [targetPath]: 'absent',
      },
    },
    rationale: `Persist temporary agent template ${draft.draft_id}.`,
    targets: [
      {
        target_type: 'agent_class',
        target_path: targetPath,
        operation: 'create_agent_class',
        template: {
          ...draft.agent_draft,
          id: callableId,
        },
      },
    ],
  };
}

function defaultGraphOpsProposalIdFactory(prefix: string): string {
  const randomId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/gu, '_')
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomId}`;
}

export function isTemporaryCallableId(callableId: string | null | undefined): boolean {
  return Boolean(callableId && callableId.startsWith(TEMPORARY_CALLABLE_ID_PREFIX));
}
