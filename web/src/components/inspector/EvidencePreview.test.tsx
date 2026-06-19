import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from '../../api';
import { EvidencePreview } from './EvidencePreview';

vi.mock('../../api', () => ({
  api: {
    artifact: vi.fn(),
  },
}));

const artifactMock = vi.mocked(api.artifact);

describe('EvidencePreview', () => {
  beforeEach(() => {
    artifactMock.mockReset();
  });

  test('renders the empty state without calling artifact API', () => {
    render(<EvidencePreview path={null} title="Input" emptyText="No input artifact" />);

    expect(screen.getByText('No input artifact')).toBeInTheDocument();
    expect(artifactMock).not.toHaveBeenCalled();
  });

  test('loads and renders artifact content', async () => {
    artifactMock.mockResolvedValue({
      path: 'C:/runs/run_1/output.json',
      name: 'output.json',
      size_bytes: 11,
      content: '{"ok":true}',
      type: 'json',
    });

    render(<EvidencePreview path="C:/runs/run_1/output.json" title="Output" emptyText="No output" />);

    await waitFor(() => {
      expect(screen.getByText('Output - runs/run_1/output.json')).toBeInTheDocument();
    });
    expect(screen.getByText(/"ok": true/)).toBeInTheDocument();
    expect(artifactMock).toHaveBeenCalledWith('C:/runs/run_1/output.json');
  });

  test('renders artifact loading errors as log content', async () => {
    artifactMock.mockRejectedValue(new Error('missing artifact'));

    render(<EvidencePreview path="C:/runs/run_1/missing.log" title="Log" emptyText="No log" />);

    await waitFor(() => {
      expect(screen.getByText('Log - runs/run_1/missing.log')).toBeInTheDocument();
    });
    expect(screen.getByText('missing artifact')).toBeInTheDocument();
  });
});
