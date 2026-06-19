import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { ArtifactContent } from '../types';
import { truncateLargeLog } from '../workbench/model/workflowViewerShell';

export type EvidenceDockState = {
  open: boolean;
  title: string;
  content: ArtifactContent | null;
  owner?: {
    kind: 'validation' | 'run' | 'node' | 'artifact';
    taskId?: string;
    runId?: string;
    nodeId?: string;
    createdAt?: string;
  };
};

export type UseEvidenceDockActionsOptions = {
  activeTaskId: string;
  selectedRunId: string | null;
  readArtifactContent: (path: string) => Promise<ArtifactContent>;
  setEvidenceDock: Dispatch<SetStateAction<EvidenceDockState>>;
};

export type UseEvidenceDockActionsResult = {
  closeEvidenceDock: () => void;
  readEvidence: (path: string | null | undefined, title?: string) => Promise<void>;
};

export function useEvidenceDockActions({
  activeTaskId,
  selectedRunId,
  readArtifactContent,
  setEvidenceDock,
}: UseEvidenceDockActionsOptions): UseEvidenceDockActionsResult {
  const closeEvidenceDock = useCallback(() => {
    setEvidenceDock({ open: false, title: '运行证据', content: null });
  }, [setEvidenceDock]);

  const readEvidence = useCallback(
    async (path: string | null | undefined, title = '运行证据') => {
      if (!path) {
        return;
      }
      const content = await readArtifactContent(path);
      setEvidenceDock({
        open: true,
        title,
        content: truncateLargeLog(content),
        owner: {
          kind: 'artifact',
          taskId: activeTaskId,
          runId: selectedRunId || undefined,
          createdAt: new Date().toISOString(),
        },
      });
    },
    [activeTaskId, readArtifactContent, selectedRunId, setEvidenceDock],
  );

  return {
    closeEvidenceDock,
    readEvidence,
  };
}
