import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from '../api';
import type { ArtifactContent } from '../types';
import { readEvidenceContent, useArtifactContentCache } from './useArtifactContentCache';

vi.mock('../api', () => ({
  api: {
    artifact: vi.fn(),
    runEvidence: vi.fn(),
  },
}));

let latestCache: ReturnType<typeof useArtifactContentCache> | null = null;

function artifact(path: string, content = path): ArtifactContent {
  return {
    path,
    name: path.split('/').pop() || path,
    type: 'text',
    content,
    size_bytes: content.length,
  };
}

function Harness({
  runId = 'run_1',
  normalizeContent,
}: {
  runId?: string | null;
  normalizeContent?: (content: ArtifactContent) => ArtifactContent;
}) {
  latestCache = useArtifactContentCache({ runId, normalizeContent });
  return <output>{Object.keys(latestCache.artifactCacheByPath).join(',')}</output>;
}

describe('useArtifactContentCache', () => {
  beforeEach(() => {
    latestCache = null;
    vi.mocked(api.runEvidence).mockResolvedValue(artifact('evidence/output.md', 'run evidence'));
    vi.mocked(api.artifact).mockResolvedValue(artifact('evidence/output.md', 'artifact'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('reads run evidence before falling back to registered artifacts', async () => {
    await expect(readEvidenceContent('evidence/output.md', 'run_1')).resolves.toMatchObject({
      content: 'run evidence',
    });

    expect(api.runEvidence).toHaveBeenCalledWith('run_1', 'evidence/output.md');
    expect(api.artifact).not.toHaveBeenCalled();
  });

  test('falls back to artifact read when run evidence is unavailable', async () => {
    vi.mocked(api.runEvidence).mockRejectedValueOnce(new Error('not found'));

    await expect(readEvidenceContent('artifact/output.md', 'run_1')).resolves.toMatchObject({
      content: 'artifact',
    });

    expect(api.runEvidence).toHaveBeenCalledWith('run_1', 'artifact/output.md');
    expect(api.artifact).toHaveBeenCalledWith('artifact/output.md');
  });

  test('caches normalized artifact content by path', async () => {
    const view = render(
      <Harness
        normalizeContent={(content) => ({
          ...content,
          content: content.content.toUpperCase(),
        })}
      />,
    );

    await act(async () => {
      await latestCache?.ensureArtifactContent('evidence/output.md');
    });
    view.rerender(<Harness />);

    expect(latestCache?.artifactCacheByPath['evidence/output.md']).toMatchObject({
      content: 'RUN EVIDENCE',
    });

    await act(async () => {
      await latestCache?.ensureArtifactContent('evidence/output.md');
    });
    expect(api.runEvidence).toHaveBeenCalledTimes(1);
  });

  test('deduplicates concurrent loads for the same path', async () => {
    let resolveEvidence: (content: ArtifactContent) => void = () => {};
    vi.mocked(api.runEvidence).mockReturnValue(
      new Promise<ArtifactContent>((resolve) => {
        resolveEvidence = resolve;
      }),
    );
    render(<Harness />);

    const firstLoad = latestCache?.ensureArtifactContent('evidence/output.md');
    const secondLoad = latestCache?.ensureArtifactContent('evidence/output.md');
    resolveEvidence(artifact('evidence/output.md', 'done'));

    await act(async () => {
      await Promise.all([firstLoad, secondLoad]);
    });

    expect(api.runEvidence).toHaveBeenCalledTimes(1);
  });

  test('removes a failed path from cache so a later call can retry', async () => {
    vi.mocked(api.runEvidence).mockRejectedValue(new Error('missing'));
    vi.mocked(api.artifact).mockRejectedValueOnce(new Error('missing'));
    render(<Harness />);

    await act(async () => {
      await latestCache?.ensureArtifactContent('missing.md');
    });
    expect(latestCache?.artifactCacheByPath['missing.md']).toBeUndefined();

    vi.mocked(api.artifact).mockResolvedValueOnce(artifact('missing.md', 'retry'));
    await act(async () => {
      await latestCache?.ensureArtifactContent('missing.md');
    });

    expect(api.artifact).toHaveBeenCalledTimes(2);
  });
});
