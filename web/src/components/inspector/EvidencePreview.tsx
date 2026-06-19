import { useEffect, useState } from 'react';

import { api } from '../../api';
import { shortPath } from '../../format';
import type { ArtifactContent } from '../../types';
import { CodeBlock } from '../CodeBlock';

type EvidencePreviewProps = {
  path?: string | null;
  title: string;
  emptyText: string;
};

export function EvidencePreview({ path, title, emptyText }: EvidencePreviewProps) {
  const [state, setState] = useState<{
    status: 'empty' | 'loading' | 'loaded' | 'error';
    content: string;
    type: ArtifactContent['type'];
  }>({
    status: path ? 'loading' : 'empty',
    content: '',
    type: 'text',
  });

  useEffect(() => {
    let ignore = false;
    if (!path) {
      setState({ status: 'empty', content: '', type: 'text' });
      return () => {
        ignore = true;
      };
    }
    setState({ status: 'loading', content: '', type: 'text' });
    api
      .artifact(path)
      .then((artifact) => {
        if (!ignore) {
          setState({ status: 'loaded', content: artifact.content, type: artifact.type });
        }
      })
      .catch((error) => {
        if (!ignore) {
          setState({
            status: 'error',
            content: error instanceof Error ? error.message : String(error),
            type: 'log',
          });
        }
      });
    return () => {
      ignore = true;
    };
  }, [path]);

  if (state.status === 'empty') {
    return <p className="empty-state">{emptyText}</p>;
  }
  if (state.status === 'loading') {
    return <p className="empty-state">正在读取 {shortPath(path)}...</p>;
  }
  return (
    <CodeBlock
      title={`${title}${path ? ` - ${shortPath(path)}` : ''}`}
      content={state.content}
      variant={state.type}
    />
  );
}
