import { render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import type { GraphOpsTransactionProposal } from '../types';
import { useGraphOpsPersistence } from './useGraphOpsPersistence';

vi.mock('../api', () => ({
  api: {
    createGraphOpsProposal: vi.fn(),
    validateGraphOpsProposal: vi.fn(),
    dryRunGraphOpsProposal: vi.fn(),
    approveGraphOpsProposal: vi.fn(),
    applyGraphOpsProposal: vi.fn(),
  },
}));

let latestActions: ReturnType<typeof useGraphOpsPersistence> | null = null;

function proposal(): GraphOpsTransactionProposal {
  return {
    schema_version: 'acc.graphops.transaction.v1',
    proposal_id: 'proposal_1',
    author: 'workbench_user',
    rationale: 'Persist temporary resource',
    base: {
      content_hashes: {
        'callables/agent.json': 'hash_1',
      },
    },
    targets: [],
  };
}

function Harness() {
  latestActions = useGraphOpsPersistence();
  return <output>graphops-persistence</output>;
}

describe('useGraphOpsPersistence', () => {
  afterEach(() => {
    latestActions = null;
    vi.clearAllMocks();
  });

  test('runs GraphOps proposal preview requests through the governance endpoints', async () => {
    const transaction = proposal();
    vi.mocked(api.createGraphOpsProposal).mockResolvedValue({
      proposal_id: 'proposal_1',
      proposal: transaction,
      status: 'created',
    });
    vi.mocked(api.validateGraphOpsProposal).mockResolvedValue({ status: 'valid' });
    vi.mocked(api.dryRunGraphOpsProposal).mockResolvedValue({
      status: 'ready',
      proposal_id: 'proposal_1',
      mutated: true,
      target_paths: ['callables/agent.json'],
      dry_run_digest: 'digest_1',
    });
    render(<Harness />);

    await latestActions?.createGraphOpsProposalRequest(transaction);
    await latestActions?.validateGraphOpsProposalRequest('proposal_1');
    await latestActions?.dryRunGraphOpsProposalRequest('proposal_1');

    expect(api.createGraphOpsProposal).toHaveBeenCalledWith(transaction);
    expect(api.validateGraphOpsProposal).toHaveBeenCalledWith('proposal_1');
    expect(api.dryRunGraphOpsProposal).toHaveBeenCalledWith('proposal_1');
  });

  test('approves and applies GraphOps proposals without rewriting approval payloads', async () => {
    const approval = {
      target_paths: ['callables/agent.json'],
      base_hashes: { 'callables/agent.json': 'hash_1' },
      dry_run_digest: 'digest_1',
    };
    vi.mocked(api.approveGraphOpsProposal).mockResolvedValue({ status: 'approved' });
    vi.mocked(api.applyGraphOpsProposal).mockResolvedValue({
      status: 'applied',
      proposal_id: 'proposal_1',
      created_files: ['callables/agent.json'],
    });
    render(<Harness />);

    await latestActions?.approveGraphOpsProposalRequest('proposal_1', approval);
    const manifest = await latestActions?.applyGraphOpsProposalRequest('proposal_1');

    expect(api.approveGraphOpsProposal).toHaveBeenCalledWith('proposal_1', approval);
    expect(api.applyGraphOpsProposal).toHaveBeenCalledWith('proposal_1');
    expect(manifest?.created_files).toEqual(['callables/agent.json']);
  });
});
