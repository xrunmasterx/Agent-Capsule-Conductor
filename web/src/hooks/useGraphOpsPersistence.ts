import { useCallback } from 'react';

import { api } from '../api';
import type {
  GraphOpsApplyManifest,
  GraphOpsDryRunPayload,
  GraphOpsProposalPayload,
  GraphOpsTransactionProposal,
} from '../types';

export type ApproveGraphOpsProposalPayload = {
  target_paths: string[];
  base_hashes: Record<string, string>;
  dry_run_digest: string;
  approver?: string;
};

export type UseGraphOpsPersistenceResult = {
  createGraphOpsProposalRequest: (
    proposal: GraphOpsTransactionProposal,
  ) => Promise<GraphOpsProposalPayload>;
  validateGraphOpsProposalRequest: (proposalId: string) => Promise<Record<string, unknown>>;
  dryRunGraphOpsProposalRequest: (proposalId: string) => Promise<GraphOpsDryRunPayload>;
  approveGraphOpsProposalRequest: (
    proposalId: string,
    payload: ApproveGraphOpsProposalPayload,
  ) => Promise<Record<string, unknown>>;
  applyGraphOpsProposalRequest: (proposalId: string) => Promise<GraphOpsApplyManifest>;
};

export function useGraphOpsPersistence(): UseGraphOpsPersistenceResult {
  const createGraphOpsProposalRequest = useCallback(
    (proposal: GraphOpsTransactionProposal) => api.createGraphOpsProposal(proposal),
    [],
  );
  const validateGraphOpsProposalRequest = useCallback(
    (proposalId: string) => api.validateGraphOpsProposal(proposalId),
    [],
  );
  const dryRunGraphOpsProposalRequest = useCallback(
    (proposalId: string) => api.dryRunGraphOpsProposal(proposalId),
    [],
  );
  const approveGraphOpsProposalRequest = useCallback(
    (proposalId: string, payload: ApproveGraphOpsProposalPayload) =>
      api.approveGraphOpsProposal(proposalId, payload),
    [],
  );
  const applyGraphOpsProposalRequest = useCallback(
    (proposalId: string) => api.applyGraphOpsProposal(proposalId),
    [],
  );

  return {
    createGraphOpsProposalRequest,
    validateGraphOpsProposalRequest,
    dryRunGraphOpsProposalRequest,
    approveGraphOpsProposalRequest,
    applyGraphOpsProposalRequest,
  };
}
