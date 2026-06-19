import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../api';
import type { ArtifactContent } from '../types';

export type UseArtifactContentCacheOptions = {
  runId?: string | null;
  normalizeContent?: (content: ArtifactContent) => ArtifactContent;
};

export type UseArtifactContentCacheResult = {
  artifactCacheByPath: Record<string, ArtifactContent>;
  ensureArtifactContent: (path: string | null | undefined) => Promise<void>;
  readArtifactContent: (path: string) => Promise<ArtifactContent>;
};

export async function readEvidenceContent(path: string, runId?: string | null): Promise<ArtifactContent> {
  if (runId) {
    try {
      return await api.runEvidence(runId, path);
    } catch {
      // Non-run artifacts still use the registered artifact boundary.
    }
  }
  return api.artifact(path);
}

export function useArtifactContentCache({
  runId = null,
  normalizeContent = (content) => content,
}: UseArtifactContentCacheOptions): UseArtifactContentCacheResult {
  const [artifactCacheByPath, setArtifactCacheByPath] = useState<Record<string, ArtifactContent>>({});
  const cacheRef = useRef(artifactCacheByPath);
  const inFlightRef = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    cacheRef.current = artifactCacheByPath;
  }, [artifactCacheByPath]);

  const readArtifactContent = useCallback(
    (path: string): Promise<ArtifactContent> => readEvidenceContent(path, runId),
    [runId],
  );

  const ensureArtifactContent = useCallback(
    async (path: string | null | undefined): Promise<void> => {
      if (!path || cacheRef.current[path]) {
        return;
      }
      const inFlight = inFlightRef.current.get(path);
      if (inFlight) {
        return inFlight;
      }

      const request = readArtifactContent(path)
        .then((content) => {
          const normalized = normalizeContent(content);
          setArtifactCacheByPath((current) => ({
            ...current,
            [path]: normalized,
          }));
        })
        .catch(() => {
          setArtifactCacheByPath((current) =>
            Object.fromEntries(Object.entries(current).filter(([key]) => key !== path)),
          );
        })
        .finally(() => {
          inFlightRef.current.delete(path);
        });

      inFlightRef.current.set(path, request);
      return request;
    },
    [normalizeContent, readArtifactContent],
  );

  return {
    artifactCacheByPath,
    ensureArtifactContent,
    readArtifactContent,
  };
}
